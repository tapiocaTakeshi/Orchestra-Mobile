/**
 * ホーム。ログインしたら最初に出る画面で、見た目は ChatGPT のアプリに合わせている。
 *
 *   - 左のナビゲーションレール … Division のプロジェクト管理・カンバン・UI (エディタ操作)・ソーシャルを開く。
 *                                PC 接続が要るものは鍵の印にして、押すと案内を出す。下端はアカウント
 *   - 見出しのモード切り替え     … ChatGPT のモデル選択のように、題名を押して
 *                                「クラウドエージェント」と「リモートコントロール」を切り替える
 *   - 本文                     … クラウドエージェントなら起動の入力欄とセッション一覧、
 *                                リモートコントロールなら PC のチャット (未接続なら接続できる PC の一覧)
 *   - コスト                   … どちらのモードでも入力欄の「コスト」から、書いている指示の見積もりと方針を開く
 */

import React, { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CloudAgentsScreen } from './CloudAgentsScreen';
import { DiscoverScreen } from './DiscoverScreen';
import { RemoteScreen } from './RemoteScreen';
import { Icon, IconName, Muted, Sheet, confirmAction, useToast } from '../components/ui';
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

/** レールの 1 項目。アイコンの下に短い名前を出す (Material のナビゲーションレールと同じ形)。 */
const RailItem = ({ icon, label, title, locked, onPress }: {
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
		style={styles.railItem}
	>
		{({ pressed }) => (
			<>
				<View style={[styles.railIcon, pressed && styles.railIconPressed]}>
					<Icon name={icon} size={20} color={locked ? colors.fgFaint : colors.fg} />
					{locked ? (
						<View style={styles.railLock}>
							<Icon name='lock' size={9} color={colors.fgMuted} />
						</View>
					) : null}
				</View>
				<Text style={[styles.railLabel, locked && styles.railLabelLocked]} numberOfLines={1}>{label}</Text>
			</>
		)}
	</Pressable>
);

const NavigationRail = ({ connected, email, onOpenPage, onAccount }: {
	connected: boolean;
	email: string;
	onOpenPage: (page: PageKey) => void;
	onAccount: () => void;
}) => {
	const toast = useToast();
	return (
		<View style={styles.rail}>
			<View style={styles.railLogo}>
				<Image source={require('../../assets/logo.png')} style={styles.railLogoImage} resizeMode='contain' accessibilityIgnoresInvertColors />
			</View>
			<ScrollView style={styles.flex} contentContainerStyle={styles.railItems} showsVerticalScrollIndicator={false}>
				{RAIL_PAGES.map(page => {
					const enabled = canOpenPage(page.key, connected);
					return (
						<RailItem
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
				style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
			>
				<Text style={styles.avatarText}>{(email.trim()[0] ?? '?').toUpperCase()}</Text>
			</Pressable>
		</View>
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
	const connected = !!connection;

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

	let content: React.ReactNode;
	if (mode === 'cloud') {
		content = <CloudAgentsScreen headerTitle={switcher} onOpenPage={page => onOpenPage(page)} />;
	} else if (connected) {
		content = <RemoteScreen headerTitle={switcher} onOpenPage={onOpenPage} />;
	} else {
		content = <DiscoverScreen headerTitle={switcher} onOpenPage={onOpenPage} />;
	}

	return (
		<View style={styles.root}>
			<NavigationRail
				connected={connected}
				email={session.email}
				onOpenPage={onOpenPage}
				onAccount={() => setSheet('account')}
			/>
			<View style={styles.main}>{content}</View>

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

const RAIL_WIDTH = 68;

const styles = StyleSheet.create({
	flex: { flex: 1 },
	root: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
	main: { flex: 1, backgroundColor: colors.bg },
	pressed: { opacity: 0.6 },

	rail: {
		width: RAIL_WIDTH,
		alignItems: 'center',
		paddingTop: spacing.sm,
		paddingBottom: spacing.md,
		backgroundColor: colors.bgSidebar,
		borderRightWidth: StyleSheet.hairlineWidth,
		borderRightColor: colors.border,
	},
	railLogo: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
	railLogoImage: { width: 28, height: 28 },
	railItems: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
	railItem: { width: RAIL_WIDTH, alignItems: 'center', gap: 4, paddingVertical: 2 },
	railIcon: {
		width: 48,
		height: 32,
		borderRadius: 16,
		alignItems: 'center',
		justifyContent: 'center',
	},
	railIconPressed: { backgroundColor: colors.bgHover },
	railLock: {
		position: 'absolute',
		right: 6,
		bottom: 0,
		width: 14,
		height: 14,
		borderRadius: 7,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.bgSidebar,
	},
	railLabel: { color: colors.fg, fontSize: 10, fontWeight: '500', maxWidth: RAIL_WIDTH - 4 },
	railLabelLocked: { color: colors.fgFaint },
	avatar: {
		width: 34,
		height: 34,
		borderRadius: 17,
		alignItems: 'center',
		justifyContent: 'center',
		marginTop: spacing.sm,
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
