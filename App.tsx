/**
 * アプリのルート。
 *
 * タブバーは置かない。最初の画面はホーム (ChatGPT のアプリのような見た目) で、見出し左の ☰ で開く
 * ナビゲーションドロワーからページを開く。
 *   - 開閉できるナビゲーションドロワー … Division のプロジェクト管理・カンバン・UI・ソーシャル
 *     (閉じているときは完全に非表示で、レールのような常設の幅・余白は残らない)
 *   - 見出しのモード切り替え   … クラウドエージェント / リモートコントロール (未接続なら接続先の一覧)
 *   - 入力欄の「コスト」       … コストの見積もりと方針
 * ドロワーから開いたものはページとして開き、「戻る」(Android は戻るキーも) でホームに戻る。
 * ページの中から別のページを開いたとき (クラウドの「カンバン」「コスト」など) は重ねて開き、
 * 「戻る」で元のページに戻る。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { BackProvider, Icon, Loading, ToastHost, ToastProvider } from './src/components/ui';
import { OpenPage, PageKey, canOpenPage, pushPage } from './src/navigation';
import { CloudAgentsScreen } from './src/screens/CloudAgentsScreen';
import { HomeMode, HomeScreen } from './src/screens/HomeScreen';
import { KanbanScreen } from './src/screens/KanbanScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ProjectsScreen } from './src/screens/ProjectsScreen';
import { QuickActionsScreen } from './src/screens/QuickActionsScreen';
import { McpScreen } from './src/screens/McpScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SocialScreen } from './src/screens/SocialScreen';
import { TuningScreen } from './src/screens/TuningScreen';
import { AppProvider, useApp } from './src/state/AppContext';
import { DivisionAuthProvider, useDivisionAuth } from './src/state/DivisionAuthContext';
import { colors, fontSize, spacing } from './src/theme';

const PageContent = ({ page, onOpenPage, cloudSessionId }: { page: PageKey; onOpenPage: OpenPage; cloudSessionId: string | null }) => {
	switch (page) {
		case 'kanban': return <KanbanScreen onOpenPage={onOpenPage} />;
		case 'projects': return <ProjectsScreen />;
		case 'cloud': return <CloudAgentsScreen onOpenPage={onOpenPage} initialSessionId={cloudSessionId} />;
		case 'mcp': return <McpScreen />;
		case 'social': return <SocialScreen />;
		case 'tuning': return <TuningScreen onOpenPage={onOpenPage} />;
		case 'actions': return <QuickActionsScreen />;
		case 'settings': return <SettingsScreen />;
	}
};

const Shell = () => {
	const { connection, isRestoring, snapshot } = useApp();
	const { session, isRestoring: isRestoringAuth } = useDivisionAuth();
	/** 開いているページの重なり (末尾がいま見えているページ)。空なら最初の画面。 */
	const [stack, setStack] = useState<PageKey[]>([]);
	/** クラウドのページを開いたときにすぐ開くセッション (カンバンの「クラウドで開く」から) */
	const [cloudSessionId, setCloudSessionId] = useState<string | null>(null);
	/** ホームのモード。PC に繋いでいればリモートコントロール、そうでなければクラウドエージェントから始める。 */
	const [homeMode, setHomeMode] = useState<HomeMode>(() => (connection ? 'remote' : 'cloud'));

	// アカウントが替わったら、前のアカウントで開いていた画面を持ち越さない。
	useEffect(() => {
		setStack([]);
		setCloudSessionId(null);
	}, [session?.userId]);

	// 接続が切れたら、繋いでいないと使えないページには留まらない。
	const connected = !!connection;
	// 起動時に保存済みの接続が戻ったとき・接続先の一覧から繋いだときは、ホームをリモートコントロールにする。
	useEffect(() => {
		if (connected) setHomeMode('remote');
	}, [connected]);
	const visibleStack = useMemo(() => stack.filter(p => canOpenPage(p, connected)), [stack, connected]);
	const openPage = visibleStack.length > 0 ? visibleStack[visibleStack.length - 1] : null;

	/** 最初の画面のメニューから開く。 */
	const setPage = useCallback((next: PageKey | null) => {
		setCloudSessionId(null);
		setStack(next ? [next] : []);
	}, []);
	/** ページの中から開く (重ねる)。 */
	const pushFromPage = useCallback<OpenPage>((next, options) => {
		setCloudSessionId(next === 'cloud' ? options?.cloudSessionId ?? null : null);
		setStack(prev => pushPage(prev.filter(p => canOpenPage(p, connected)), next));
	}, [connected]);
	const popPage = useCallback(() => {
		setCloudSessionId(null);
		setStack(prev => prev.filter(p => canOpenPage(p, connected)).slice(0, -1));
	}, [connected]);

	// 描画のたびに作り直すと戻るキーの登録もやり直しになり、ページ側 (クラウドの詳細など) で
	// 後から登録した戻るキーより先に呼ばれてしまうので、開いている画面が変わったときだけ作る。
	const goBack = useMemo(
		() => (openPage ? popPage : null),
		[openPage, popPage],
	);

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
			<BackProvider value={popPage}>
				{/* ページを見ているあいだに承認を求められても気づけるよう、上に細い帯を出す */}
				{awaitingApproval ? (
					<Pressable accessibilityRole='button' onPress={() => { setHomeMode('remote'); setPage(null); }} style={styles.approvalBar}>
						<View style={styles.approvalDot} />
						<Text style={styles.approvalText}>ツールの実行が確認待ちです</Text>
						<Text style={styles.approvalLink}>チャットへ</Text>
						<Icon name='chevron-right' size={14} color={colors.fg} />
					</Pressable>
				) : null}
				{/* key: 重なりか開くセッションが変わったら作り直す (カンバンの「クラウドで開く」で、開くセッションを渡し直す) */}
				<PageContent key={`${visibleStack.length}:${openPage}:${cloudSessionId ?? ''}`} page={openPage} onOpenPage={pushFromPage} cloudSessionId={cloudSessionId} />
			</BackProvider>
		);
	} else {
		content = <HomeScreen mode={homeMode} onModeChange={setHomeMode} onOpenPage={setPage} />;
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
