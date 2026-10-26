/**
 * ホーム。ログインしたら最初に出る画面で、見た目は ChatGPT のアプリに合わせている。
 *
 *   - ナビゲーションドロワー … 見出し左の ☰ で左から開き、Division のプロジェクト管理・カンバン・UI (エディタ操作)・ソーシャルを開く。
 *                              PC 接続が要るものは鍵の印にして、押すと案内を出す。下端はアカウント。
 *                              閉じているときはアイコンもラベルも完全に表示されず、本文は全幅で使える
 *                              (レールのような常設の幅・余白・不可視の操作領域は残らない)。
 *                              Division のプロジェクト管理は Division API 直結なので、PC 未接続でも開ける
 *   - 本文                     … Claude Code のアプリのように、クラウドエージェントのセッションと
 *                                PC (リモートコントロール) のチャット・接続できる PC を 1 つの一覧に混ぜる
 *                                (全て / 稼働中 / 承認待ち / エラー で絞り込み)。入力欄の送り先で
 *                                クラウドか接続中の PC かを選ぶ。PC のチャットを押すとリモートコントロールの画面を開く
 *   - 見出し                   … PC との接続状態 (未接続 / 接続中 / 接続済み / 接続切れ)
 *   - コスト                   … 入力欄の「コスト」から、書いている指示の見積もりと方針を開く
 */

import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CloudAgentsScreen } from './CloudAgentsScreen';
import { RemoteScreen } from './RemoteScreen';
import { REMOTE_CONNECTION_LABELS } from '../lib/remoteSession';
import { Drawer, Icon, IconButton, IconName, Muted, Sheet, confirmAction, useToast } from '../components/ui';
import { PageKey, DRAWER_PAGES, canOpenPage } from '../navigation';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, fontSize, radius, spacing } from '../theme';

/** ドロワーの 1 項目。アイコンと名前を横に並べた 1 行 (ChatGPT のアプリのドロワーと同じ形)。 */
const DrawerItem = ({ icon, label, title, locked, onPress }: {
	icon: IconName;
	label: string;
	title: string;
	locked?: boolean;
	onPress: () => void;
}) => (
	<Pressable
		accessibilityRole='button'
		accessibilityLabel={locked ? `${title}。PC に接続すると使えます` : `${title}を開く`}
		accessibilityState={{ disabled: !!locked }}
		onPress={onPress}
		style={({ pressed }) => [styles.drawerItem, pressed && styles.sheetRowPressed]}
	>
		<Icon name={icon} size={20} color={locked ? colors.fgFaint : colors.fg} />
		<Text style={[styles.drawerItemLabel, locked && styles.drawerItemLabelLocked]} numberOfLines={1}>{label}</Text>
		{locked ? <Icon name='lock' size={13} color={colors.fgFaint} /> : null}
	</Pressable>
);

/**
 * 開閉できるナビゲーションドロワー。open=false のとき Drawer ごと描かないので、
 * 閉じている画面にはアイコン・ラベル・幅・余白・不可視の操作領域が一切残らない。
 */
const NavigationDrawer = ({ open, connected, email, onClose, onOpenPage, onAccount }: {
	open: boolean;
	connected: boolean;
	email: string;
	onClose: () => void;
	onOpenPage: (page: PageKey) => void;
	onAccount: () => void;
}) => {
	const toast = useToast();
	return (
		<Drawer open={open} onClose={onClose}>
			<ScrollView style={styles.flex} contentContainerStyle={styles.drawerBody} showsVerticalScrollIndicator={false}>
				<View style={styles.drawerLogo}>
					<Image source={require('../../assets/logo.png')} style={styles.drawerLogoImage} resizeMode='contain' accessibilityIgnoresInvertColors />
				</View>
				{DRAWER_PAGES.map(page => {
					const enabled = canOpenPage(page.key, connected);
					return (
						<DrawerItem
							key={page.key}
							icon={page.icon}
							label={page.title}
							title={page.title}
							locked={!enabled}
							onPress={() => (enabled ? onOpenPage(page.key) : toast.show(`${page.title}は PC に接続すると使えます`, 'info'))}
						/>
					);
				})}
			</ScrollView>
			<Pressable
				accessibilityRole='button'
				accessibilityLabel={`アカウント ${email}`}
				onPress={onAccount}
				style={({ pressed }) => [styles.drawerAccount, pressed && styles.sheetRowPressed]}
			>
				<View style={styles.avatar}>
					<Text style={styles.avatarText}>{(email.trim()[0] ?? '?').toUpperCase()}</Text>
				</View>
				<Text style={styles.drawerAccountEmail} numberOfLines={1}>{email}</Text>
			</Pressable>
		</Drawer>
	);
};

/** シートの中の 1 行 (モード選択・アカウント)。 */
const SheetRow = ({ icon, title, detail, selected, tone = 'default', onPress }: {
	icon: IconName;
	title: string;
	detail?: string;
	selected?: boolean;
	tone?: 'default' | 'danger';
	onPress: () => void;
}) => (
	<Pressable
		accessibilityRole='button'
		accessibilityState={{ selected: !!selected }}
		onPress={onPress}
		style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
	>
		<View style={styles.sheetRowIcon}>
			<Icon name={icon} size={18} color={tone === 'danger' ? colors.danger : colors.fg} />
		</View>
		<View style={styles.flex}>
			<Text style={[styles.sheetRowTitle, tone === 'danger' && { color: colors.danger }]}>{title}</Text>
			{detail ? <Muted style={styles.sheetRowDetail}>{detail}</Muted> : null}
		</View>
		{selected ? <Icon name='check' size={18} color={colors.fg} /> : null}
	</Pressable>
);

export const HomeScreen = ({ pcChatOpen, onPcChatOpenChange, onOpenPage }: {
	/** PC (リモートコントロール) のチャットを開いているか (承認の帯から開けるよう App が持つ) */
	pcChatOpen: boolean;
	onPcChatOpenChange: (open: boolean) => void;
	/** ドロワーや一覧の中から開くページ (App のページの重なりに積む) */
	onOpenPage: (page: PageKey) => void;
}) => {
	const { connection, connectionStatus, snapshot, disconnect } = useApp();
	const { session, logout } = useDivisionAuth();
	const [sheet, setSheet] = useState<'account' | null>(null);
	// ナビゲーションドロワーの開閉。閉じている (初期状態) ときは画面にナビゲーションの痕跡を残さない。
	const [drawerOpen, setDrawerOpen] = useState(false);
	const connected = !!connection;
	const showPcChat = pcChatOpen && connected;

	// 接続を切ったら (接続先を選び直すなど) 一覧に戻る
	useEffect(() => {
		if (pcChatOpen && !connected) onPcChatOpenChange(false);
	}, [pcChatOpen, connected, onPcChatOpenChange]);
	// PC のチャットを開いているあいだは、Android の戻るキーで一覧に戻る
	useEffect(() => {
		if (!showPcChat) return;
		const sub = BackHandler.addEventListener('hardwareBackPress', () => { onPcChatOpenChange(false); return true; });
		return () => sub.remove();
	}, [showPcChat, onPcChatOpenChange]);

	/** ドロワーの項目から開く。ページに移ったあとドロワーは閉じる。 */
	const openFromDrawer = useCallback((page: PageKey) => {
		setDrawerOpen(false);
		onOpenPage(page);
	}, [onOpenPage]);

	const onLogout = useCallback(async () => {
		setSheet(null);
		const ok = await confirmAction({
			title: 'ログアウトしますか？',
			message: '保存済みの接続先は端末に残ります。',
			confirmLabel: 'ログアウト',
			destructive: true,
		});
		if (ok) await logout();
	}, [logout]);

	if (!session) return null;

	// リモートコントロールの状態: 未接続 / 接続中 / 接続済み / 接続切れ
	const pcName = snapshot?.ide?.workspaceName || connection?.label || 'PC';
	const remoteSubtitle = connectionStatus === 'disconnected'
		? 'PC に未接続'
		: `${REMOTE_CONNECTION_LABELS[connectionStatus]} · ${pcName}`;
	const homeHeader = (
		<View style={styles.headerRow}>
			<IconButton
				icon='menu'
				accessibilityLabel='ナビゲーションドロワーを開く'
				expanded={drawerOpen}
				onPress={() => setDrawerOpen(true)}
			/>
			<View style={styles.switcher}>
				<Text accessibilityRole='header' style={styles.switcherTitle} numberOfLines={1}>Orchestra</Text>
				<Text style={styles.switcherSubtitle} numberOfLines={1}>{remoteSubtitle}</Text>
			</View>
		</View>
	);
	// PC のチャットを開いたときの見出し: 戻る + PC 名と接続状態
	const pcChatHeader = (
		<View style={styles.headerRow}>
			<IconButton icon='chevron-left' accessibilityLabel='一覧に戻る' onPress={() => onPcChatOpenChange(false)} />
			<View style={styles.switcher}>
				<Text accessibilityRole='header' style={styles.switcherTitle} numberOfLines={1}>{pcName}</Text>
				<Text style={styles.switcherSubtitle} numberOfLines={1}>リモートコントロール · {REMOTE_CONNECTION_LABELS[connectionStatus]}</Text>
			</View>
		</View>
	);

	const content = showPcChat
		? <RemoteScreen headerTitle={pcChatHeader} onOpenPage={onOpenPage} />
		: <CloudAgentsScreen headerTitle={homeHeader} onOpenPage={page => onOpenPage(page)} onOpenPcChat={() => onPcChatOpenChange(true)} />;

	return (
		<View style={styles.root}>
			<View style={styles.main}>{content}</View>
			<NavigationDrawer
				open={drawerOpen}
				connected={connected}
				email={session.email}
				onClose={() => setDrawerOpen(false)}
				onOpenPage={openFromDrawer}
				onAccount={() => { setDrawerOpen(false); setSheet('account'); }}
			/>

			{sheet === 'account' ? (
				<Sheet title='アカウント' eyebrow={session.email} onClose={() => setSheet(null)}>
					<View style={styles.sheetContent}>
						{connected ? (
							<>
								<SheetRow icon='link' title='接続の設定' detail={connection?.label} onPress={() => { setSheet(null); onOpenPage('settings'); }} />
								<SheetRow icon='x-circle' title='PC との接続を切る' onPress={() => { setSheet(null); void disconnect(); }} />
							</>
						) : null}
						<SheetRow icon='bar-chart-2' title='コストの方針と残高' detail='入力欄の「コスト」からも開けます' onPress={() => { setSheet(null); onOpenPage('tuning'); }} />
						<SheetRow icon='log-out' title='ログアウト' tone='danger' onPress={() => { void onLogout(); }} />
					</View>
				</Sheet>
			) : null}
		</View>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	root: { flex: 1, backgroundColor: colors.bg },
	main: { flex: 1, backgroundColor: colors.bg },
	pressed: { opacity: 0.6 },

	// ドロワーの中身。閉じているときは Drawer ごと描かないので画面に幅・余白を残さない。
	drawerBody: { gap: 2, paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.md },
	drawerLogo: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
	drawerLogoImage: { width: 30, height: 30 },
	drawerItem: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		minHeight: 48,
		paddingHorizontal: spacing.md,
		borderRadius: radius.md,
	},
	drawerItemLabel: { flex: 1, color: colors.fg, fontSize: fontSize.sm, fontWeight: '500' },
	drawerItemLabelLocked: { color: colors.fgFaint },
	drawerAccount: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		minHeight: 56,
		paddingHorizontal: spacing.lg,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: colors.border,
	},
	drawerAccountEmail: { flex: 1, color: colors.fgMuted, fontSize: fontSize.xs + 1 },
	avatar: {
		width: 30,
		height: 30,
		borderRadius: 15,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.bgHover,
	},
	avatarText: { color: colors.fgStrong, fontSize: fontSize.xs + 1, fontWeight: '600' },

	headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
	switcher: { alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: 2, flexShrink: 1 },
	switcherLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
	switcherTitle: { color: colors.fgStrong, fontSize: fontSize.md, fontWeight: '600', flexShrink: 1 },
	switcherSubtitle: { color: colors.fgFaint, fontSize: fontSize.xs, marginTop: 1 },

	sheetContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.xs },
	sheetRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		minHeight: 56,
		paddingHorizontal: spacing.sm,
		paddingVertical: spacing.sm,
		borderRadius: radius.lg,
	},
	sheetRowPressed: { backgroundColor: colors.bgHover },
	sheetRowIcon: {
		width: 36,
		height: 36,
		borderRadius: 18,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.bgElevated,
	},
	sheetRowTitle: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '500' },
	sheetRowDetail: { marginTop: 2, lineHeight: 18 },
});
