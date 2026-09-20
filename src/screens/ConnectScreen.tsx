/**
 * 未接続のときに出る画面。
 *
 * IDE の設定パネルでコピーしたペアリングリンクを貼るのが最短。うまくいかない環境
 * (クリップボード共有ができないなど) のために、アドレスとトークンの手入力も残す。
 */

import React, { useCallback, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Connection } from '../api/types';
import { Body, Button, Card, Input, Muted, Row, Screen, SectionTitle, Title } from '../components/ui';
import { verifyAndConnect } from '../lib/connect';
import { buildConnection, parsePairingInput } from '../lib/pairing';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, fontSize, spacing } from '../theme';

type Mode = 'link' | 'manual';

export const ConnectScreen = ({ onBack }: { onBack?: () => void }) => {
	const { connect, connections, forget } = useApp();
	const { session } = useDivisionAuth();

	const [mode, setMode] = useState<Mode>('link');
	const [link, setLink] = useState('');
	const [host, setHost] = useState('');
	const [token, setToken] = useState('');
	const [status, setStatus] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	/** 繋ぐ前に /api/ping と /api/state を叩いて、相手と権限を確かめる。 */
	const tryConnect = useCallback(async (candidate: Connection) => {
		if (!session) {
			setStatus('リモートコントロールには、デスクトップと同じ Division アカウントでのログインが必要です。');
			return;
		}
		setBusy(true);
		setStatus(null);
		const result = await verifyAndConnect(candidate, connect, session.accessToken);
		setStatus(result.ok ? (result.warning ?? null) : result.message);
		setBusy(false);
	}, [connect, session]);

	const onSubmitLink = useCallback(() => {
		const parsed = parsePairingInput(link);
		if (!parsed) {
			setStatus('ペアリングリンクを読み取れませんでした。IDE の設定 → リモートコントロール →「ペアリングリンクをコピー」で取得したものを貼り付けてください。');
			return;
		}
		void tryConnect(parsed);
	}, [link, tryConnect]);

	const onSubmitManual = useCallback(() => {
		const built = buildConnection(host, token);
		if (!built) {
			setStatus('アドレスとトークンの両方を入力してください。');
			return;
		}
		void tryConnect(built);
	}, [host, token, tryConnect]);

	return (
		<Screen>
			<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
				<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>

					{onBack ? <Button title='戻る' variant='ghost' onPress={onBack} style={{ alignSelf: 'flex-start' }} /> : null}

					<View style={styles.hero}>
						<Image source={require('../../assets/logo.png')} style={styles.heroMark} resizeMode='contain' />
						<Title>Orchestra に接続</Title>
						<Muted>IDE の 設定 → リモートコントロール で「リモートコントロールを有効にする」をオンにしてください。</Muted>
					</View>

					<Card>
						<Row>
							<Button
								title='リンクを貼る'
								variant={mode === 'link' ? 'primary' : 'secondary'}
								onPress={() => setMode('link')}
								style={styles.flex}
							/>
							<Button
								title='手入力'
								variant={mode === 'manual' ? 'primary' : 'secondary'}
								onPress={() => setMode('manual')}
								style={styles.flex}
							/>
						</Row>

						{mode === 'link' ? (
							<>
								<Muted>orchestra://pair?... で始まるリンク、または QR に入っている JSON を貼り付けます。</Muted>
								<Input
									value={link}
									onChangeText={setLink}
									placeholder='orchestra://pair?v=1&url=...&token=...'
									autoCapitalize='none'
									autoCorrect={false}
									multiline
								/>
								<Button title='接続' onPress={onSubmitLink} loading={busy} />
							</>
						) : (
							<>
								<Muted>IDE の設定に出ているアドレスとトークンを入力します。ポートを省くと 39231 を使います。</Muted>
								<Input
									value={host}
									onChangeText={setHost}
									placeholder='192.168.0.12:39231'
									autoCapitalize='none'
									autoCorrect={false}
									keyboardType='url'
								/>
								<Input
									value={token}
									onChangeText={setToken}
									placeholder='トークン'
									autoCapitalize='none'
									autoCorrect={false}
									secureTextEntry
								/>
								<Button title='接続' onPress={onSubmitManual} loading={busy} />
							</>
						)}

						{status ? <Text style={styles.status}>{status}</Text> : null}
					</Card>

					{connections.length > 0 ? (
						<View>
							<SectionTitle>保存済みの接続</SectionTitle>
							{connections.map(c => (
								<Card key={c.url} style={styles.savedCard}>
									<Body numberOfLines={1}>{c.label}</Body>
									<Muted>{c.url}</Muted>
									<Row>
										<Button title='接続' onPress={() => void tryConnect(c)} style={styles.flex} />
										<Button title='削除' variant='secondary' onPress={() => void forget(c.url)} />
									</Row>
								</Card>
							))}
						</View>
					) : null}

					<Card>
						<SectionTitle>繋がらないときは</SectionTitle>
						<Muted>・スマホと PC が同じ Wi-Fi にあるか確認する</Muted>
						<Muted>・IDE 側の「LAN からの接続を許可」がオンか確認する</Muted>
						<Muted>・PC のファイアウォールが 39231 番ポートを塞いでいないか確認する</Muted>
						<Muted>・USB 接続なら adb reverse tcp:39231 tcp:39231 でも繋がります</Muted>
					</Card>

				</ScrollView>
			</KeyboardAvoidingView>
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
	status: {
		color: colors.warning,
		fontSize: fontSize.xs,
		lineHeight: 17,
	},
	savedCard: {
		marginBottom: spacing.sm,
	},
});

