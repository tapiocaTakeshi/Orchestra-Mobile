/**
 * アプリのルート。
 *
 * タブは 4 つだけなので、ナビゲーションライブラリを足さずに自前のタブバーで切り替える。
 * 未接続のときはタブを出さず、接続画面だけを表示する。
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { Loading } from './src/components/ui';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { DiscoverScreen } from './src/screens/DiscoverScreen';
import { KanbanScreen } from './src/screens/KanbanScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ProjectsScreen } from './src/screens/ProjectsScreen';
import { RemoteScreen } from './src/screens/RemoteScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { AppProvider, useApp } from './src/state/AppContext';
import { DivisionAuthProvider, useDivisionAuth } from './src/state/DivisionAuthContext';
import { colors, fontSize, spacing } from './src/theme';

type TabKey = 'remote' | 'kanban' | 'projects' | 'settings';

const TABS: { key: TabKey; label: string; icon: string }[] = [
	{ key: 'remote', label: 'リモート', icon: '🎛' },
	{ key: 'kanban', label: 'カンバン', icon: '🗂' },
	{ key: 'projects', label: 'Division', icon: '🎭' },
	{ key: 'settings', label: '接続', icon: '⚙️' },
];

const TabBar = ({ active, onChange, busy }: { active: TabKey; onChange: (t: TabKey) => void; busy: boolean }) => (
	<View style={styles.tabBar}>
		{TABS.map(tab => {
			const selected = tab.key === active;
			return (
				<Pressable
					key={tab.key}
					accessibilityRole='tab'
					accessibilityState={{ selected }}
					onPress={() => onChange(tab.key)}
					style={styles.tab}
				>
					<Text style={styles.tabIcon}>{tab.icon}</Text>
					<Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{tab.label}</Text>
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

	if (isRestoring || isRestoringAuth) {
		return (
			<SafeAreaView style={styles.root} edges={['top', 'bottom']}>
				<Loading label='起動しています…' />
			</SafeAreaView>
		);
	}

	if (!connection) {
		return (
			<SafeAreaView style={styles.root} edges={['top', 'bottom']}>
				{showManualConnect ? (
					<ConnectScreen />
				) : session ? (
					<DiscoverScreen onManualConnect={() => setShowManualConnect(true)} />
				) : (
					<LoginScreen onSkip={() => setShowManualConnect(true)} />
				)}
			</SafeAreaView>
		);
	}

	const busy = !!snapshot && (snapshot.chat.isRunning || snapshot.chat.awaitingApproval);

	return (
		<SafeAreaView style={styles.root} edges={['top', 'bottom']}>
			<View style={styles.body}>
				{tab === 'remote' ? <RemoteScreen /> : null}
				{tab === 'kanban' ? <KanbanScreen /> : null}
				{tab === 'projects' ? <ProjectsScreen /> : null}
				{tab === 'settings' ? <SettingsScreen /> : null}
			</View>
			<TabBar active={tab} onChange={setTab} busy={busy} />
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
	},
	tab: {
		flex: 1,
		alignItems: 'center',
		paddingVertical: spacing.sm,
		gap: 2,
	},
	tabIcon: {
		fontSize: 18,
	},
	tabLabel: {
		color: colors.fgFaint,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
	tabLabelActive: {
		color: colors.accent,
	},
	busyDot: {
		position: 'absolute',
		top: spacing.xs,
		right: '28%',
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: colors.running,
	},
});
