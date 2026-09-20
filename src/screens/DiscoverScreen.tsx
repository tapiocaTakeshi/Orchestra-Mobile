/**
 * ログイン済み & 未接続のときに出る画面。
 *
 * ログイン中の Division アカウントに紐づくデスクトップセッション (RemoteSession) を
 * 一定間隔でポーリングして一覧表示する。タップするだけで接続できる。
 * 見つからない/繋がらない場合のために、手動ペアリング画面への導線も残す。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Body, Button, Card, EmptyState, Muted, Row, Screen, SectionTitle, Title } from '../components/ui';
import { RemoteSessionRow, listRemoteSessions } from '../lib/divisionAuth';
import { verifyAndConnect } from '../lib/connect';
import { relativeTimeFromIso } from '../lib/format';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, spacing } from '../theme';

const POLL_INTERVAL_MS = 5_000;

export const DiscoverScreen = ({ onManualConnect }: { onManualConnect: () => void }) => {
	const { connect } = useApp();
	const { session, logout, newSessionIds, dismissNewSession } = useDivisionAuth();

	const [sessions, setSessions] = useState<RemoteSessionRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [connectingId, setConnectingId] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);

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

	const onConnect = useCallback(async (row: RemoteSessionRow) => {
		setConnectingId(row.id);
		setStatus(null);
		const result = await verifyAndConnect({ url: row.lanUrl, token: row.token, label: row.deviceLabel }, connect, session.accessToken);
		if (!result.ok) setStatus(result.message);
		else dismissNewSession(row.id);
		setConnectingId(null);
	}, [connect, dismissNewSession]);

	if (!session) return null;

	return (
		<Screen>
			<ScrollView
				contentContainerStyle={styles.content}
				refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void refresh(); }} tintColor={colors.accent} />}
			>
				<View style={styles.hero}>
					<Image source={require('../../assets/logo.png')} style={styles.heroMark} resizeMode='contain' />
					<Title>接続先を選ぶ</Title>
					<Muted>{session.email} でログイン中</Muted>
				</View>

				{error ? (
					<Card>
						<Body>{error}</Body>
					</Card>
				) : null}

				{status ? (
					<Card>
						<Body>{status}</Body>
					</Card>
				) : null}

				{sessions.length === 0 && !loading ? (
					<EmptyState
						title='デバイスが見つかりません'
						detail='IDE 側でリモートコントロールを有効にし、同じ Division アカウントでログインしてください。'
					/>
				) : (
					<View>
						<SectionTitle>見つかったデバイス</SectionTitle>
						{sessions.map(row => (
							<Card key={row.id} style={styles.deviceCard}>
								<Row>
									<Body numberOfLines={1}>{row.deviceLabel || row.lanUrl}</Body>
									{newSessionIds.includes(row.id) ? <View style={styles.newBadge} /> : null}
								</Row>
								<Muted>{row.lanUrl} · {relativeTimeFromIso(row.lastSeenAt)}</Muted>
								<Button
									title='接続'
									onPress={() => { void onConnect(row); }}
									loading={connectingId === row.id}
								/>
							</Card>
						))}
					</View>
				)}

				<Row>
					<Button title='手入力・ペアリングリンクで接続' variant='ghost' onPress={onManualConnect} style={styles.flex} />
				</Row>
				<Button title='ログアウト' variant='ghost' onPress={() => { void logout(); }} />
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
	deviceCard: {
		marginBottom: spacing.sm,
	},
	newBadge: {
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: colors.accent,
	},
});
