/**
 * ログイン済み & 未接続のときに出る画面。
 *
 * ログイン中の Division アカウントに紐づくデスクトップセッション (RemoteSession) を
 * 一定間隔でポーリングして一覧表示する。タップするだけで接続できる。
 * 見つからない/繋がらない場合のために、手動ペアリング画面への導線も残す。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import {
	Badge,
	Body,
	Button,
	Card,
	EmptyState,
	ErrorBanner,
	Icon,
	Loading,
	Muted,
	Row,
	Screen,
	SectionTitle,
	Title,
	confirmAction,
} from '../components/ui';
import { RemoteSessionRow, listRemoteSessions } from '../lib/divisionAuth';
import { verifyAndConnect } from '../lib/connect';
import { relativeTimeFromIso } from '../lib/format';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, radius, spacing } from '../theme';

const POLL_INTERVAL_MS = 5_000;

export const DiscoverScreen = ({
	onManualConnect,
	onBrowseOffline,
}: {
	onManualConnect: () => void;
	/** PC に繋がずに、ソーシャル / チューニングだけ見たいときの導線。 */
	onBrowseOffline?: () => void;
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
		const result = await verifyAndConnect({ url: row.lanUrl, token: row.token, label: row.deviceLabel }, connect, session.accessToken);
		if (!result.ok) setStatus(result.message);
		else dismissNewSession(row.id);
		setConnectingId(null);
	}, [connect, dismissNewSession, session]);

	if (!session) return null;

	return (
		<Screen>
			<ScrollView
				contentContainerStyle={styles.content}
				refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => { void onPull(); }} tintColor={colors.accentText} />}
			>
				<View style={styles.hero}>
					<Image source={require('../../assets/logo.png')} style={styles.heroMark} resizeMode='contain' />
					<Title>接続先を選ぶ</Title>
					<Muted>{session.email} でログイン中</Muted>
				</View>

				{error ? <ErrorBanner message={error} onRetry={() => { void refresh(); }} style={styles.bannerFlush} /> : null}
				{status ? <ErrorBanner message={status} style={styles.bannerFlush} /> : null}

				{loading ? (
					<Loading label='同じアカウントの PC を探しています…' />
				) : sessions.length === 0 ? (
					<EmptyState
						icon='monitor'
						title='デバイスが見つかりません'
						detail='IDE 側でリモートコントロールを有効にし、同じ Division アカウントでログインしてください。見つかると自動でここに表示されます。'
					/>
				) : (
					<View style={styles.list}>
						<SectionTitle right={<Muted>自動で更新中</Muted>}>見つかったデバイス</SectionTitle>
						{sessions.map(row => {
							const isNew = newSessionIds.includes(row.id);
							return (
								<Card key={row.id}>
									<Row>
										<View style={styles.deviceIcon}>
											<Icon name='monitor' size={20} color={colors.accentText} />
										</View>
										<View style={styles.flex}>
											<Row>
												<Body numberOfLines={1}>{row.deviceLabel || row.lanUrl}</Body>
												{isNew ? <Badge label='NEW' color={colors.accentText} /> : null}
											</Row>
											<Muted numberOfLines={1}>{row.lanUrl} · {relativeTimeFromIso(row.lastSeenAt)}</Muted>
										</View>
									</Row>
									<Button
										title='接続'
										icon='link'
										onPress={() => { void onConnect(row); }}
										loading={connectingId === row.id}
										disabled={connectingId !== null && connectingId !== row.id}
									/>
								</Card>
							);
						})}
					</View>
				)}

				<View style={styles.links}>
					<Button title='手入力・ペアリングリンクで接続' icon='edit-3' variant='ghost' onPress={onManualConnect} />
					{onBrowseOffline ? (
						<Button title='接続せずに共有 / コストを見る' icon='compass' variant='ghost' onPress={onBrowseOffline} />
					) : null}
					<Button title='ログアウト' icon='log-out' variant='ghost' onPress={() => { void onLogout(); }} />
				</View>
			</ScrollView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	content: {
		padding: spacing.lg,
		gap: spacing.lg,
	},
	hero: {
		alignItems: 'center',
		gap: spacing.xs,
		paddingTop: spacing.xl,
	},
	heroMark: {
		width: 64,
		height: 64,
	},
	list: { gap: spacing.sm },
	deviceIcon: {
		width: 40,
		height: 40,
		borderRadius: radius.md,
		backgroundColor: colors.accentSoft,
		alignItems: 'center',
		justifyContent: 'center',
	},
	links: { gap: spacing.xs, alignItems: 'center' },
	bannerFlush: { margin: 0 },
});
