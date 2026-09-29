/**
 * ログイン済み & 未接続のときの最初の画面。
 *
 * ログイン中の Division アカウントに紐づくデスクトップセッション (RemoteSession) を
 * 一定間隔でポーリングして一覧表示する。行をタップするだけで接続できる。
 * 見つからない/繋がらない場合のための手入力と、未接続でも使えるページ (共有・コスト) への導線も置く。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
	ErrorBanner,
	Icon,
	IconName,
	Loading,
	Muted,
	Screen,
	ScreenHeader,
	confirmAction,
} from '../components/ui';
import { RemoteSessionRow, listRemoteSessions } from '../lib/divisionAuth';
import { verifyAndConnect } from '../lib/connect';
import { relativeTimeFromIso } from '../lib/format';
import { PageKey, pagesFor } from '../navigation';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, fontSize, spacing } from '../theme';

const POLL_INTERVAL_MS = 5_000;

/** 一覧の 1 行 (アイコン・題名・補足・右端)。 */
const ListRow = ({ icon, title, detail, right, onPress, disabled, accessibilityLabel }: {
	icon: IconName;
	title: string;
	detail?: string;
	right?: React.ReactNode;
	onPress: () => void;
	disabled?: boolean;
	accessibilityLabel?: string;
}) => (
	<Pressable
		accessibilityRole='button'
		accessibilityLabel={accessibilityLabel}
		accessibilityState={{ disabled: !!disabled }}
		disabled={disabled}
		onPress={onPress}
		style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
	>
		<Icon name={icon} size={18} color={colors.fgMuted} />
		<View style={styles.flex}>
			<Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
			{detail ? <Muted numberOfLines={1}>{detail}</Muted> : null}
		</View>
		{right ?? <Icon name='chevron-right' size={16} color={colors.fgFaint} />}
	</Pressable>
);

export const DiscoverScreen = ({
	onManualConnect,
	onOpenPage,
}: {
	onManualConnect: () => void;
	/** 未接続でも開けるページ (共有・コスト) を開く */
	onOpenPage: (page: PageKey) => void;
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

	return (
		<Screen>
			<ScreenHeader title='接続先' />
			<ScrollView
				contentContainerStyle={styles.content}
				refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => { void onPull(); }} tintColor={colors.fgMuted} />}
			>
				{error ? <ErrorBanner message={error} onRetry={() => { void refresh(); }} style={styles.banner} /> : null}
				{status ? <ErrorBanner message={status} style={styles.banner} /> : null}

				{loading ? (
					<Loading label='PC を探しています…' />
				) : sessions.length === 0 ? (
					<Text style={styles.empty}>
						同じアカウントでログインしている PC が見つかりません。PC 側でリモートコントロールを有効にすると、ここに出ます。
					</Text>
				) : (
					<View>
						{sessions.map(row => (
							<ListRow
								key={row.id}
								icon='monitor'
								title={row.deviceLabel || row.lanUrl}
								detail={`${newSessionIds.includes(row.id) ? 'NEW · ' : ''}${relativeTimeFromIso(row.lastSeenAt)}`}
								accessibilityLabel={`${row.deviceLabel || row.lanUrl} に接続`}
								disabled={connectingId !== null}
								right={connectingId === row.id ? <ActivityIndicator size='small' color={colors.fgMuted} /> : undefined}
								onPress={() => { void onConnect(row); }}
							/>
						))}
					</View>
				)}

				<View style={styles.more}>
					<ListRow icon='edit-3' title='手入力で接続' onPress={onManualConnect} />
					{pagesFor(false).map(page => (
						<ListRow key={page.key} icon={page.icon} title={page.label} onPress={() => onOpenPage(page.key)} />
					))}
					<ListRow
						icon='log-out'
						title='ログアウト'
						detail={session.email}
						right={<View />}
						onPress={() => { void onLogout(); }}
					/>
				</View>
			</ScrollView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	content: {
		paddingHorizontal: spacing.lg,
		paddingBottom: spacing.xl,
	},
	banner: { marginHorizontal: 0 },
	empty: { color: colors.fgFaint, fontSize: fontSize.xs + 1, lineHeight: 21, paddingVertical: spacing.lg },
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		minHeight: 60,
		paddingVertical: spacing.sm,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	rowPressed: { opacity: 0.6 },
	rowTitle: { color: colors.fg, fontSize: fontSize.sm },
	more: { marginTop: spacing.xl },
});
