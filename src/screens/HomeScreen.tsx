/**
 * ホーム。ログインしたら最初に出る画面で、見た目は ChatGPT のアプリに合わせている。
 *
 *   - ナビゲーションドロワー … Division のプロジェクト管理・カンバン・UI (エディタ操作)・ソーシャルを開く。
 *                             見出し左のメニューボタン (☰) で開き、中の ‹ や外側の暗い部分を押すと閉じる。
 *                             閉じている間はドロワーを描画しないので、アイコンも幅も残らず本文が全幅になる。
 *                             PC 接続が要るものは鍵の印にして、押すと案内を出す。下端はアカウント。
 *                             Division のプロジェクト管理は Division API 直結なので、PC 未接続でも開ける
 *   - 見出しのモード切り替え   … ChatGPT のモデル選択のように、題名を押して
 *                               「クラウドエージェント」と「リモートコントロール」を切り替える
 *   - 本文                   … クラウドエージェントなら起動の入力欄とセッション一覧、
 *                              リモートコントロールなら PC のチャット (未接続なら接続できる PC の一覧)
 *   - コスト                 … どちらのモードでも入力欄の「コスト」から、書いている指示の見積もりと方針を開く
 */

import React, { useCallback, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CloudAgentsScreen } from './CloudAgentsScreen';
import { DiscoverScreen } from './DiscoverScreen';
import { RemoteScreen } from './RemoteScreen';
import { Icon, IconButton, IconName, Muted, Sheet, ToastHost, confirmAction, useToast } from '../components/ui';
import { PageKey, RAIL_PAGES, canOpenPage } from '../navigation';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, fontSize, radius, spacing } from '../theme';

export type HomeMode = 'cloud' | 'remote';

const MODES: { value: HomeMode; label: string; detail: string; icon: IconName }[] = [
	{
		value: 'cloud',
		label: 'クラウドエージェント',
		detail: 'Division のサンドボックスでエージェントを動かします。PC に繋いでいなくても使えます。',
		icon: 'cloud',
	},
	{
		value: 'remote',
		label: 'リモートコントロール',
		detail: 'PC の Orchestra に接続して、チャット・承認・中断を手元から操作します。',
		icon: 'monitor',
	},
];

/** ChatGPT のモデル選択のような見出し。押すとモードを選ぶシートを開く。 */
const ModeSwitcher = ({ mode, subtitle, onPress }: { mode: HomeMode; subtitle?: string; onPress: () => void }) => {
	const current = MODES.find(m => m.value === mode)!;
	return (
		<Pressable
			accessibilityRole='button'
			accessibilityLabel={`モード: ${current.label}。切り替える`}
			hitSlop={6}
			onPress={onPress}
			style={({ pressed }) => [styles.switcher, pressed && styles.pressed]}
		>
			<View style={styles.switcherLine}>
				<Text accessibilityRole='header' style={styles.switcherTitle} numberOfLines={1}>{current.label}</Text>
				<Icon name='chevron-down' size={16} color={colors.fgFaint} />
			</View>
			{subtitle ? <Text style={styles.switcherSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
		</Pressable>
	);
};

/** ドロワーの 1 項目。アイコンと名前を横に並べた 1 行で、押すとページを開く。 */
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
		style={({ pressed }) => [styles.drawerItem, pressed && styles.pressedBg]}
	>
		<View style={styles.drawerItemIcon}>
			<Icon name={icon} size={20} color={locked ? colors.fgFaint : colors.fg} />
			{locked ? (
				<View style={styles.drawerLock}>
					<Icon name='lock' size={9} color={colors.fgMuted} />
				</View>
			) : null}
		</View>
		<View style={styles.flex}>
			<Text style={[styles.drawerItemTitle, locked && styles.drawerItemLocked]} numberOfLines={1}>{title}</Text>
			{label !== title ? <Muted numberOfLines={1}>{label}</Muted> : null}
		</View>
		{locked ? <Muted>PC で有効</Muted> : <Icon name='chevron-right' size={16} color={colors.fgFaint} />}
	</Pressable>
);

/**
 * 開閉できるナビゲーションのドロワー。Modal で本文の上に被せ、閉じるとき (onClose でアンマウント)
 * 画面にはメニューボタン以外何も残さない。外側の暗い部分・中の ‹ でも閉じられる。
 */
const NavigationDrawer = ({ connected, email, onClose, onOpenPage, onAccount }: {
	connected: boolean;
	email: string;
	onClose: () => void;
	onOpenPage: (page: PageKey) => void;
	onAccount: () => void;
}) => {
	const toast = useToast();
	return (
		<Modal visible transparent animationType='fade' onRequestClose={onClose}>
			<View style={styles.drawerOverlay}>
				{/* 透明な Modal は全画面なので、ノッチやホームバーに掛からないよう上下と左の安全領域をとる */}
				<SafeAreaView style={styles.drawer} edges={['top', 'bottom', 'left']}>
					<View style={styles.drawerHeader}>
						<View style={styles.drawerLogo}>
							<Image source={require('../../assets/logo.png')} style={styles.drawerLogoImage} resizeMode='contain' accessibilityIgnoresInvertColors />
						</View>
						<IconButton icon='chevron-left' accessibilityLabel='ナビゲーションを閉じる' onPress={onClose} />
					</View>
					<ScrollView style={styles.flex} contentContainerStyle={styles.drawerItems} showsVerticalScrollIndicator={false}>
						{RAIL_PAGES.map(page => {
							const enabled = canOpenPage(page.key, connected);
							return (
								<DrawerItem
									key={page.key}
									icon={page.icon}
									label={page.label}
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
						style={({ pressed }) => [styles.drawerAccount, pressed && styles.pressedBg]}
					>
						<View style={styles.avatar}>
							<Text style={styles.avatarText}>{(email.trim()[0] ?? '?').toUpperCase()}</Text>
						</View>
						<Text style={styles.drawerAccountEmail} numberOfLines={1}>{email}</Text>
					</Pressable>
				</SafeAreaView>
				{/* ドロワーの外側。押すと閉じる。ラベルを付けて操作対象であることを明確にする。 */}
				<Pressable
					accessibilityRole='button'
					accessibilityLabel='ナビゲーションを閉じる'
					onPress={onClose}
					style={styles.drawerScrim}
				/>
				{/* Modal は別レイヤーに描かれるので、ロック項目の案内が隠れないようここにもトーストを置く */}
				<ToastHost />
			</View>
		</Modal>
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

export const HomeScreen = ({ mode, onModeChange, onOpenPage }: {
	mode: HomeMode;
	onModeChange: (mode: HomeMode) => void;
	/** レールやモードの中から開くページ (App のページの重なりに積む) */
	onOpenPage: (page: PageKey) => void;
}) => {
	const { connection, snapshot, disconnect } = useApp();
	const { session, logout } = useDivisionAuth();
	const [sheet, setSheet] = useState<'mode' | 'account' | null>(null);
	// ナビゲーションのドロワー。閉じている (初期値) あいだは描画自体をしないので、
	// アイコンも幅も余白も残らず、本文が使える幅いっぱいに広がる。
	const [drawerOpen, setDrawerOpen] = useState(false);
	const connected = !!connection;

	// ページを開くときはドロワーを先に閉じてから遷移する。アカウントのシートもドロワーの上に出ないよう閉じてから開く。
	const openPage = useCallback((page: PageKey) => {
		setDrawerOpen(false);
		onOpenPage(page);
	}, [onOpenPage]);
	const openAccount = useCallback(() => {
		setDrawerOpen(false);
		setSheet('account');
	}, []);

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

	const remoteSubtitle = connected
		? snapshot?.ide?.workspaceName || connection?.label || 'PC に接続中'
		: 'PC に未接続';
	const switcher = (
		<ModeSwitcher
			mode={mode}
			subtitle={mode === 'remote' ? remoteSubtitle : undefined}
			onPress={() => setSheet('mode')}
		/>
	);
	// ドロワーが閉じていても開けるように、メニューボタンは本文の見出し側に置く。
	const menuButton = (
		<IconButton icon='menu' accessibilityLabel='メニューを開く' onPress={() => setDrawerOpen(true)} />
	);

	let content: React.ReactNode;
	if (mode === 'cloud') {
		content = <CloudAgentsScreen headerTitle={switcher} headerLeft={menuButton} onOpenPage={page => onOpenPage(page)} />;
	} else if (connected) {
		content = <RemoteScreen headerTitle={switcher} headerLeft={menuButton} onOpenPage={onOpenPage} />;
	} else {
		content = <DiscoverScreen headerTitle={switcher} headerLeft={menuButton} onOpenPage={onOpenPage} />;
	}

	return (
		<View style={styles.root}>
			<View style={styles.main}>{content}</View>

			{drawerOpen ? (
				<NavigationDrawer
					connected={connected}
					email={session.email}
					onClose={() => setDrawerOpen(false)}
					onOpenPage={openPage}
					onAccount={openAccount}
				/>
			) : null}

			{sheet === 'mode' ? (
				<Sheet title='始める' onClose={() => setSheet(null)}>
					<View style={styles.sheetContent}>
						{MODES.map(m => (
							<SheetRow
								key={m.value}
								icon={m.icon}
								title={m.label}
								detail={m.detail}
								selected={m.value === mode}
								onPress={() => { setSheet(null); onModeChange(m.value); }}
							/>
						))}
					</View>
				</Sheet>
			) : null}

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

/** ドロワーの幅。細長い表示 (Web) でははみ出さないよう、画面幅の 8 割までにする。 */
const DRAWER_MAX_WIDTH = 304;

const styles = StyleSheet.create({
	flex: { flex: 1 },
	root: { flex: 1, backgroundColor: colors.bg },
	main: { flex: 1, backgroundColor: colors.bg },
	pressed: { opacity: 0.6 },
	pressedBg: { backgroundColor: colors.bgHover },

	drawerOverlay: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.5)' },
	drawer: {
		width: DRAWER_MAX_WIDTH,
		maxWidth: '80%',
		backgroundColor: colors.bgSidebar,
		borderRightWidth: StyleSheet.hairlineWidth,
		borderRightColor: colors.border,
	},
	drawerScrim: { flex: 1 },
	drawerHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		paddingLeft: spacing.lg,
		paddingRight: spacing.xs,
		minHeight: 56,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	drawerLogo: { flex: 1, alignItems: 'flex-start' },
	drawerLogoImage: { width: 28, height: 28 },
	drawerItems: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, gap: 2 },
	drawerItem: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		minHeight: 48,
		paddingHorizontal: spacing.sm,
		borderRadius: radius.md,
	},
	drawerItemIcon: { width: 24, alignItems: 'center', justifyContent: 'center' },
	drawerLock: {
		position: 'absolute',
		right: -4,
		bottom: -4,
		width: 14,
		height: 14,
		borderRadius: 7,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.bgSidebar,
	},
	drawerItemTitle: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '500' },
	drawerItemLocked: { color: colors.fgFaint },
	drawerAccount: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.md,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: colors.border,
	},
	drawerAccountEmail: { flex: 1, color: colors.fg, fontSize: fontSize.sm },
	avatar: {
		width: 34,
		height: 34,
		borderRadius: 17,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.bgHover,
	},
	avatarText: { color: colors.fgStrong, fontSize: fontSize.xs + 1, fontWeight: '600' },

	switcher: { alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: 2 },
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
