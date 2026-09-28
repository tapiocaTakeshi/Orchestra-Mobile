/**
 * アプリのルート。
 *
 * ナビゲーションライブラリを足さずに自前のタブバーで切り替える。
 * タブは 2 種類ある:
 *   - PC に接続しているとき  … リモート / カンバン / Division / 共有 / コスト / 接続
 *   - 接続していないとき      … 共有 / コスト / 接続 (ソーシャルとチューニングは
 *                                Division 直結なので PC なしでも使える)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { Icon, Loading, ToastHost, ToastProvider } from './src/components/ui';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { DiscoverScreen } from './src/screens/DiscoverScreen';
import { KanbanScreen } from './src/screens/KanbanScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ProjectsScreen } from './src/screens/ProjectsScreen';
import { RemoteScreen } from './src/screens/RemoteScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SocialScreen } from './src/screens/SocialScreen';
import { TuningScreen } from './src/screens/TuningScreen';
import { AppProvider, useApp } from './src/state/AppContext';
import { DivisionAuthProvider, useDivisionAuth } from './src/state/DivisionAuthContext';
import { colors, fontSize, spacing } from './src/theme';

type TabKey = 'remote' | 'kanban' | 'projects' | 'social' | 'tuning' | 'settings';

type Tab = { key: TabKey; label: string; icon: React.ComponentProps<typeof Icon>['name'] };

const TABS: Tab[] = [
	{ key: 'remote', label: 'リモート', icon: 'message-square' },
	{ key: 'kanban', label: 'カンバン', icon: 'columns' },
	{ key: 'projects', label: 'Division', icon: 'layers' },
	{ key: 'social', label: '共有', icon: 'share-2' },
	{ key: 'tuning', label: 'コスト', icon: 'bar-chart-2' },
	{ key: 'settings', label: '接続', icon: 'link' },
];

/** 未接続でも使えるタブ。接続タブは接続先を選ぶ画面になる。 */
const OFFLINE_TAB_KEYS: TabKey[] = ['social', 'tuning', 'settings'];

/** リモートタブに付ける印。承認待ちは急ぎなので稼働中と色を分ける。 */
type RemoteStatus = 'idle' | 'running' | 'approval';

const TabBar = ({ tabs, active, onChange, remoteStatus }: {
	tabs: Tab[];
	active: TabKey;
	onChange: (t: TabKey) => void;
	remoteStatus: RemoteStatus;
}) => (
	<View accessibilityRole='tablist' style={styles.tabBar}>
		{tabs.map(tab => {
			const selected = tab.key === active;
			const status = tab.key === 'remote' ? remoteStatus : 'idle';
			const statusLabel = status === 'approval' ? '、承認待ち' : status === 'running' ? '、エージェント稼働中' : '';
			return (
				<Pressable
					key={tab.key}
					accessibilityRole='tab'
					accessibilityState={{ selected }}
					onPress={() => onChange(tab.key)}
					accessibilityLabel={`${tab.label}${statusLabel}`}
					style={({ pressed }) => [styles.tab, pressed && { backgroundColor: colors.bgHover }]}
				>
					<View style={styles.tabIcon}>
						<Icon name={tab.icon} size={20} color={selected ? colors.fgStrong : colors.fgFaint} />
						{status !== 'idle' ? (
							<View style={[styles.busyDot, { backgroundColor: status === 'approval' ? colors.warning : colors.running }]} />
						) : null}
					</View>
					<Text style={[styles.tabLabel, selected && styles.tabLabelActive]} numberOfLines={1}>{tab.label}</Text>
				</Pressable>
			);
		})}
	</View>
);

const Shell = () => {
	const { connection, isRestoring, snapshot } = useApp();
	const { session, isRestoring: isRestoringAuth } = useDivisionAuth();
	const [tab, setTab] = useState<TabKey>('remote');
	// ログイン中でも、手動ペアリング画面へ抜けたい場合があるので明示的に切り替える。
	const [showManualConnect, setShowManualConnect] = useState(false);
	// 「接続せずに使う」を選んだあとは、未接続のままタブを出す。
	const [browseOffline, setBrowseOffline] = useState(false);

	// アカウントが替わったら、前のアカウントで選んでいた画面の状態を持ち越さない。
	useEffect(() => {
		setBrowseOffline(false);
		setShowManualConnect(false);
	}, [session?.userId]);

	const isOffline = !connection;
	const tabs = useMemo(
		() => (isOffline ? TABS.filter(t => OFFLINE_TAB_KEYS.includes(t.key)) : TABS),
		[isOffline],
	);
	// 接続が切れたときに、繋がっているときにしか無いタブへ取り残されないようにする。
	const activeTab = tabs.some(t => t.key === tab) ? tab : (tabs[0]?.key ?? 'settings');

	if (isRestoring || isRestoringAuth) {
		return (
			<SafeAreaView style={styles.root} edges={['top', 'bottom']}>
				<Loading label='起動しています…' />
			</SafeAreaView>
		);
	}

	// 繋げるのはログイン中アカウントのセッションだけなので、未ログインならまずログイン。
	if (!session) {
		return (
			<SafeAreaView style={styles.root} edges={['top', 'bottom']}>
				<LoginScreen />
				<ToastHost />
			</SafeAreaView>
		);
	}

	if (!connection && !browseOffline) {
		return (
			<SafeAreaView style={styles.root} edges={['top', 'bottom']}>
				{showManualConnect ? (
					<ConnectScreen onBack={() => setShowManualConnect(false)} />
				) : (
					<DiscoverScreen
						onManualConnect={() => setShowManualConnect(true)}
						onBrowseOffline={() => { setBrowseOffline(true); setTab('social'); }}
					/>
				)}
				<ToastHost />
			</SafeAreaView>
		);
	}

	const remoteStatus: RemoteStatus = !snapshot
		? 'idle'
		: snapshot.chat.awaitingApproval ? 'approval' : snapshot.chat.isRunning ? 'running' : 'idle';

	return (
		<SafeAreaView style={styles.root} edges={['top', 'bottom']}>
			<View style={styles.body}>
				{activeTab === 'remote' ? <RemoteScreen /> : null}
				{activeTab === 'kanban' ? <KanbanScreen /> : null}
				{activeTab === 'projects' ? <ProjectsScreen /> : null}
				{activeTab === 'social' ? <SocialScreen /> : null}
				{activeTab === 'tuning' ? <TuningScreen /> : null}
				{activeTab === 'settings' ? (
					isOffline
						? <DiscoverScreen
							onManualConnect={() => { setBrowseOffline(false); setShowManualConnect(true); }}
						/>
						: <SettingsScreen />
				) : null}
				<ToastHost />
			</View>
			<TabBar tabs={tabs} active={activeTab} onChange={setTab} remoteStatus={remoteStatus} />
		</SafeAreaView>
	);
};

export default function App() {
	return (
		<SafeAreaProvider>
			<StatusBar style='light' />
			<ToastProvider>
				<DivisionAuthProvider>
					<AppProvider>
						<Shell />
					</AppProvider>
				</DivisionAuthProvider>
			</ToastProvider>
		</SafeAreaProvider>
	);
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: colors.bg,
	},
	body: {
		flex: 1,
	},
	tabBar: {
		flexDirection: 'row',
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: colors.borderStrong,
		backgroundColor: colors.bg,
		paddingHorizontal: spacing.xs,
	},
	tab: {
		flex: 1,
		alignItems: 'center',
		paddingTop: spacing.sm,
		paddingBottom: spacing.xs + 2,
		paddingHorizontal: 2,
		minHeight: 60,
		gap: 4,
	},
	tabIcon: { width: 44, height: 28, alignItems: 'center', justifyContent: 'center' },
	tabLabel: {
		color: colors.fgFaint,
		fontSize: fontSize.xs - 1,
		fontWeight: '600',
	},
	tabLabelActive: {
		color: colors.fgStrong,
	},
	busyDot: {
		position: 'absolute',
		top: 1,
		right: 6,
		width: 9,
		height: 9,
		borderRadius: 5,
		borderWidth: 1.5,
		borderColor: colors.bgElevated,
	},
});
