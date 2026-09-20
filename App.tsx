/**
 * アプリのルート。
 *
 * ナビゲーションライブラリを足さずに自前のタブバーで切り替える。
 * タブは 2 種類ある:
 *   - PC に接続しているとき  … リモート / カンバン / Division / 共有 / コスト / 接続
 *   - 接続していないとき      … 共有 / コスト / 接続 (ソーシャルとチューニングは
 *                                Division 直結なので PC なしでも使える)
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { Icon, Loading } from './src/components/ui';
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

const TabBar = ({ tabs, active, onChange, busy }: {
	tabs: Tab[];
	active: TabKey;
	onChange: (t: TabKey) => void;
	busy: boolean;
}) => (
	<View style={styles.tabBar}>
		{tabs.map(tab => {
			const selected = tab.key === active;
			return (
				<Pressable
					key={tab.key}
					accessibilityRole='tab'
					accessibilityState={{ selected }}
					onPress={() => onChange(tab.key)}
					accessibilityLabel={tab.key === 'remote' && busy ? `${tab.label}、エージェント稼働中または承認待ち` : tab.label}
					style={({ pressed }) => [styles.tab, selected && styles.tabActive, pressed && { opacity: 0.7 }]}
				>
					<View style={[styles.tabIcon, selected && styles.tabIconActive]}>
						<Icon name={tab.icon} size={20} color={selected ? colors.accentText : colors.fgFaint} />
					</View>
					<Text style={[styles.tabLabel, selected && styles.tabLabelActive]} numberOfLines={1}>{tab.label}</Text>
					{selected ? <View style={styles.tabIndicator} /> : null}
					{tab.key === 'remote' && busy ? <View style={styles.busyDot} /> : null}
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

	if (!session && !connection) {
		return (
			<SafeAreaView style={styles.root} edges={['top', 'bottom']}>
				{showManualConnect
					? <ConnectScreen onBack={() => setShowManualConnect(false)} />
					: <LoginScreen />}
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
			</SafeAreaView>
		);
	}

	const busy = !!snapshot && (snapshot.chat.isRunning || snapshot.chat.awaitingApproval);

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
			</View>
			<TabBar tabs={tabs} active={activeTab} onChange={setTab} busy={busy} />
		</SafeAreaView>
	);
};

export default function App() {
	return (
		<SafeAreaProvider>
			<StatusBar style='light' />
			<DivisionAuthProvider>
				<AppProvider>
					<Shell />
				</AppProvider>
			</DivisionAuthProvider>
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
		borderTopWidth: 1,
		borderTopColor: colors.border,
		backgroundColor: colors.bgElevated,
		paddingHorizontal: spacing.xs,
	},
	tab: {
		flex: 1,
		alignItems: 'center',
		paddingVertical: spacing.sm,
		paddingHorizontal: 2,
		minHeight: 62,
		gap: 3,
		borderTopWidth: 2,
		borderTopColor: 'transparent',
	},
	tabActive: { borderTopColor: colors.accent },
	tabIcon: { width: 44, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
	tabIconActive: { backgroundColor: 'transparent' },
	tabLabel: {
		color: colors.fgFaint,
		fontSize: fontSize.xs - 1,
		fontWeight: '600',
	},
	tabLabelActive: {
		color: colors.accentText,
	},
	tabIndicator: { position: 'absolute', top: -2, width: 24, height: 2, borderRadius: 2, backgroundColor: colors.accent },
	busyDot: {
		position: 'absolute',
		top: spacing.xs,
		right: '22%',
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: colors.running,
	},
});
