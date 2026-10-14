/**
 * ログイン済み & 未接続のときの最初の画面。
 *
 * ログイン中の Division アカウントに紐づくデスクトップセッション (RemoteSession) を
 * 一定間隔でポーリングして一覧表示する。行をタップするだけで接続できる。
 * 未接続でも使えるページ (クラウド・共有・コスト) への導線も置く。
 *
 * 情報の優先順位: 接続できる PC (主役) → 未接続でも開けるページ → アカウント。
 * 区画ごとに見出しと平らなグループ (地 bgElevated + 細い線) で分け、余白はテーマの spacing だけで組む。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
	Badge,
	EmptyState,
	ErrorBanner,
	Icon,
	IconName,
	Loading,
	Muted,
	Screen,
	ScreenHeader,
	SectionTitle,
	confirmAction,
} from '../components/ui';
import { RemoteSessionRow, listRemoteSessions } from '../lib/divisionAuth';
import { verifyAndConnect } from '../lib/connect';
import { relativeTimeFromIso } from '../lib/format';
import { PageKey, pagesFor } from '../navigation';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, fontSize, radius, spacing } from '../theme';

const POLL_INTERVAL_MS = 5_000;

/** グループ内の 1 行 (アイコン・題名・補足・右端)。最後の行だけ区切り線を消す。 */
const ListRow = ({ icon, title, detail, badge, right, onPress, disabled, accessibilityLabel, last, tone = 'default', primary }: {
	icon: IconName;
	title: string;
	detail?: string;
	/** 題名の横に出す小さな印 (例: NEW)。 */
	badge?: string;
	right?: React.ReactNode;
	onPress: () => void;
	disabled?: boolean;
	accessibilityLabel?: string;
	last?: boolean;
	/** danger はログアウトのような取り消しにくい操作。赤い文字で出す。 */
	tone?: 'default' | 'danger';
	/** 主役の行 (接続できる PC)。アイコンをアクセント色にして目立たせる。 */
	primary?: boolean;
}) => {
	const iconColor = tone === 'danger' ? colors.danger : primary ? colors.accentText : colors.fgMuted;
	return (
		<Pressable
			accessibilityRole='button'
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ disabled: !!disabled }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.rowPressed]}
		>
			<View style={styles.rowIcon}>
				<Icon name={icon} size={18} color={iconColor} />
			</View>
			<View style={styles.rowBody}>
				<View style={styles.rowTitleLine}>
					<Text style={[styles.rowTitle, tone === 'danger' && styles.rowTitleDanger]} numberOfLines={1}>{title}</Text>
					{badge ? <Badge label={badge} color={colors.accentText} /> : null}
				</View>
				{detail ? <Muted numberOfLines={1} style={styles.rowDetail}>{detail}</Muted> : null}
			</View>
			{right ?? <Icon name='chevron-right' size={16} color={colors.fgFaint} />}
		</Pressable>
	);
};

export const DiscoverScreen = ({
	onOpenPage,
	headerTitle,
}: {
	/** 未接続でも開けるページ (クラウド・共有・コスト) を開く */
	onOpenPage: (page: PageKey) => void;
	/**
	 * ホームの中に出すときの見出し (モード切り替え)。渡したときはページへの導線とアカウントを出さない
	 * (どちらもホームのナビゲーションレールにある)。
	 */
	headerTitle?: React.ReactNode;
}) => {
	const { connect } = useApp();
	const { session, logout, newSessionIds, dismissNewSession } = useDivisionAuth();

	const [sessions, setSessions] = useState<RemoteSessionRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [connectingId, setConnectingId] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [pulling, setPulling] = useState(false);

	const refresh = useCallback(async () => {
		if (!session) return;
		try {
			const rows = await listRemoteSessions(session);
			setSessions(rows);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'デバイス一覧の取得に失敗しました。');
		} finally {
			setLoading(false);
		}
	}, [session]);

	useEffect(() => {
		void refresh();
		const timer = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [refresh]);

	const onPull = useCallback(async () => {
		setPulling(true);
		try { await refresh(); } finally { setPulling(false); }
	}, [refresh]);

	const onLogout = useCallback(async () => {
		const ok = await confirmAction({
			title: 'ログアウトしますか？',
			message: '保存済みの接続先は端末に残ります。',
			confirmLabel: 'ログアウト',
			destructive: true,
		});
		if (ok) await logout();
	}, [logout]);

	const onConnect = useCallback(async (row: RemoteSessionRow) => {
		if (!session) return;
		setConnectingId(row.id);
		setStatus(null);
		// 一覧はログイン中アカウントの RemoteSession だけなので、それをそのまま照合に使う。
		const result = await verifyAndConnect(
			{ url: row.lanUrl, token: row.token, label: row.deviceLabel },
			connect,
			{ accessToken: session.accessToken, sessions },
		);
		if (!result.ok) setStatus(result.message);
		else dismissNewSession(row.id);
		setConnectingId(null);
	}, [connect, dismissNewSession, session, sessions]);

	if (!session) return null;

	const inHome = headerTitle !== undefined;
	const pages = inHome ? [] : pagesFor(false);

	return (
		<Screen>
			<ScreenHeader title={headerTitle ?? '接続先'} />
			<ScrollView
				contentContainerStyle={styles.content}
				refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => { void onPull(); }} tintColor={colors.fgMuted} />}
			>
				{error ? <ErrorBanner message={error} onRetry={() => { void refresh(); }} style={styles.banner} /> : null}
				{status ? <ErrorBanner message={status} style={styles.banner} /> : null}

				{/* 主役: 接続できる PC */}
				<View style={styles.section}>
					<SectionTitle right={!loading && sessions.length > 0 ? <Muted>{sessions.length} 台</Muted> : undefined}>
						PC に接続
					</SectionTitle>
					<Text style={styles.lead}>同じアカウントでログインしている PC です。タップすると接続します。</Text>
					<View style={styles.group}>
						{loading ? (
							<Loading label='PC を探しています…' />
						) : sessions.length === 0 ? (
							<EmptyState
								icon='monitor'
								title='PC が見つかりません'
								detail='PC 側でリモートコントロールを有効にすると、ここに表示されます。'
							/>
						) : (
							sessions.map((row, i) => (
								<ListRow
									key={row.id}
									icon='monitor'
									primary
									title={row.deviceLabel || row.lanUrl}
									badge={newSessionIds.includes(row.id) ? 'NEW' : undefined}
									detail={`最終確認 ${relativeTimeFromIso(row.lastSeenAt)}`}
									accessibilityLabel={`${row.deviceLabel || row.lanUrl} に接続`}
									disabled={connectingId !== null}
									right={connectingId === row.id ? <ActivityIndicator size='small' color={colors.fgMuted} /> : undefined}
									last={i === sessions.length - 1}
									onPress={() => { void onConnect(row); }}
								/>
							))
						)}
					</View>
				</View>

				{/* 未接続でも開けるページ */}
				{pages.length > 0 ? (
					<View style={styles.section}>
						<SectionTitle>接続せずに使う</SectionTitle>
						<View style={styles.group}>
							{pages.map((page, i) => (
								<ListRow
									key={page.key}
									icon={page.icon}
									title={page.label}
									last={i === pages.length - 1}
									onPress={() => onOpenPage(page.key)}
								/>
							))}
						</View>
					</View>
				) : null}

				{/* アカウント (ホームではレールの下端にある) */}
				{inHome ? null : <View style={styles.section}>
					<SectionTitle>アカウント</SectionTitle>
					<View style={styles.group}>
						<ListRow
							icon='log-out'
							title='ログアウト'
							detail={session.email}
							tone='danger'
							right={<View />}
							last
							onPress={() => { void onLogout(); }}
						/>
					</View>
				</View>}
			</ScrollView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	content: {
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.sm,
		paddingBottom: spacing.xl * 2,
	},
	banner: { marginHorizontal: 0, marginBottom: 0 },
	section: { marginTop: spacing.xl, gap: spacing.sm },
	lead: { color: colors.fgFaint, fontSize: fontSize.xs + 1, lineHeight: 21 },
	// 区画のまとまり。色は足さず、地と細い線の濃淡だけで分ける
	group: {
		backgroundColor: colors.bgElevated,
		borderRadius: radius.lg,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.border,
		overflow: 'hidden',
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		minHeight: 60,
		paddingVertical: spacing.sm,
		paddingHorizontal: spacing.md,
	},
	rowDivider: {
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	rowPressed: { backgroundColor: colors.bgHover },
	rowIcon: {
		width: 36,
		height: 36,
		borderRadius: radius.md,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.bgHover,
	},
	rowBody: { flex: 1, gap: 2 },
	rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	rowTitle: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '500', flexShrink: 1 },
	rowTitleDanger: { color: colors.danger },
	rowDetail: { color: colors.fgFaint },
});
