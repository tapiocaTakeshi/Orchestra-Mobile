/**
 * アプリのルート。
 *
 * タブバーは置かない。最初の画面は 1 つだけで、
 *   - PC に接続しているとき  … チャット
 *   - 接続していないとき      … 接続先の一覧
 * それ以外 (カンバン・Division・共有・コスト・クイック操作・接続) はメニューからページとして開き、
 * 「戻る」(Android は戻るキーも) で最初の画面に戻る。
 */

import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { BackProvider, Icon, Loading, ToastHost, ToastProvider } from './src/components/ui';
import { PageKey, canOpenPage } from './src/navigation';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { DiscoverScreen } from './src/screens/DiscoverScreen';
import { KanbanScreen } from './src/screens/KanbanScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ProjectsScreen } from './src/screens/ProjectsScreen';
import { QuickActionsScreen } from './src/screens/QuickActionsScreen';
import { RemoteScreen } from './src/screens/RemoteScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SocialScreen } from './src/screens/SocialScreen';
import { TuningScreen } from './src/screens/TuningScreen';
import { AppProvider, useApp } from './src/state/AppContext';
import { DivisionAuthProvider, useDivisionAuth } from './src/state/DivisionAuthContext';
import { colors, fontSize, spacing } from './src/theme';

const PageContent = ({ page }: { page: PageKey }) => {
	switch (page) {
		case 'kanban': return <KanbanScreen />;
		case 'projects': return <ProjectsScreen />;
		case 'social': return <SocialScreen />;
		case 'tuning': return <TuningScreen />;
		case 'actions': return <QuickActionsScreen />;
		case 'settings': return <SettingsScreen />;
	}
};

const Shell = () => {
	const { connection, isRestoring, snapshot } = useApp();
	const { session, isRestoring: isRestoringAuth } = useDivisionAuth();
	const [page, setPage] = useState<PageKey | null>(null);
	const [showManualConnect, setShowManualConnect] = useState(false);

	// アカウントが替わったら、前のアカウントで開いていた画面を持ち越さない。
	useEffect(() => {
		setPage(null);
		setShowManualConnect(false);
	}, [session?.userId]);

	// 接続が切れたら、繋いでいないと使えないページには留まらない。
	const openPage = page && canOpenPage(page, !!connection) ? page : null;
	const goBack = openPage ? () => setPage(null) : showManualConnect ? () => setShowManualConnect(false) : null;

	// Android の戻るキーでも、ページから最初の画面へ戻る。
	useEffect(() => {
		if (!goBack) return;
		const sub = BackHandler.addEventListener('hardwareBackPress', () => { goBack(); return true; });
		return () => sub.remove();
	}, [goBack]);

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

	const awaitingApproval = !!connection && !!snapshot?.chat.awaitingApproval;

	let content: React.ReactNode;
	if (openPage) {
		content = (
			<BackProvider value={() => setPage(null)}>
				{/* ページを見ているあいだに承認を求められても気づけるよう、上に細い帯を出す */}
				{awaitingApproval ? (
					<Pressable accessibilityRole='button' onPress={() => setPage(null)} style={styles.approvalBar}>
						<View style={styles.approvalDot} />
						<Text style={styles.approvalText}>ツールの実行が確認待ちです</Text>
						<Text style={styles.approvalLink}>チャットへ</Text>
						<Icon name='chevron-right' size={14} color={colors.fg} />
					</Pressable>
				) : null}
				<PageContent page={openPage} />
			</BackProvider>
		);
	} else if (!connection) {
		content = showManualConnect
			? <BackProvider value={() => setShowManualConnect(false)}><ConnectScreen /></BackProvider>
			: <DiscoverScreen onManualConnect={() => setShowManualConnect(true)} onOpenPage={setPage} />;
	} else {
		content = <RemoteScreen onOpenPage={setPage} />;
	}

	return (
		<SafeAreaView style={styles.root} edges={['top', 'bottom']}>
			<View style={styles.body}>
				{content}
				<ToastHost />
			</View>
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
	approvalBar: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		minHeight: 40,
		paddingHorizontal: spacing.lg,
		backgroundColor: colors.bgHover,
	},
	approvalDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.warning },
	approvalText: { flex: 1, color: colors.fg, fontSize: fontSize.xs + 1 },
	approvalLink: { color: colors.fg, fontSize: fontSize.xs + 1, fontWeight: '600' },
});
