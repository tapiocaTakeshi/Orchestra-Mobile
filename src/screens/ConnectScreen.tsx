/**
 * 未接続のときに出る画面。
 *
 * IDE の設定パネルでコピーしたペアリングリンクを貼るのが最短。うまくいかない環境
 * (クリップボード共有ができないなど) のために、アドレスとトークンの手入力も残す。
 */

import React, { useCallback, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Connection } from '../api/types';
import {
	Body,
	Button,
	Card,
	ErrorBanner,
	Icon,
	IconButton,
	Input,
	Muted,
	Row,
	Screen,
	SectionTitle,
	SegmentedControl,
	Title,
	confirmAction,
} from '../components/ui';
import { verifyAndConnect } from '../lib/connect';
import { listRemoteSessions } from '../lib/divisionAuth';
import { buildConnection, parsePairingInput } from '../lib/pairing';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, radius, spacing } from '../theme';

type Mode = 'link' | 'manual';

export const ConnectScreen = ({ onBack }: { onBack?: () => void }) => {
	const { connect, connections, forget } = useApp();
	const { session } = useDivisionAuth();

	const [mode, setMode] = useState<Mode>('link');
	const [link, setLink] = useState('');
	const [host, setHost] = useState('');
	const [token, setToken] = useState('');
	const [status, setStatus] = useState<{ message: string; tone: 'error' | 'warning' } | null>(null);
	const [busy, setBusy] = useState(false);
	/** どのボタンから繋ぎに行ったか。そのボタンにだけスピナーを出す。 */
	const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
	const tokenRef = useRef<TextInput>(null);

	/**
	 * リンクや手入力で指定された PC でも、ログイン中アカウントのセッションでなければ繋がない。
	 * アカウントの RemoteSession (オフラインの行も含む) を取り、トークンで照合してから
	 * /api/ping と /api/state で相手と権限を確かめる。
	 */
	const tryConnect = useCallback(async (candidate: Connection, source: string) => {
		if (!session) {
			setStatus({ message: 'リモートコントロールには、デスクトップと同じ Division アカウントでのログインが必要です。', tone: 'error' });
			return;
		}
		setBusy(true);
		setConnectingFrom(source);
		setStatus(null);
		try {
			const sessions = await listRemoteSessions(session, Number.POSITIVE_INFINITY);
			const result = await verifyAndConnect(candidate, connect, { accessToken: session.accessToken, sessions });
			if (!result.ok) setStatus({ message: result.message, tone: 'error' });
			else if (result.warning) setStatus({ message: result.warning, tone: 'warning' });
		} catch (e) {
			setStatus({ message: e instanceof Error ? e.message : String(e), tone: 'error' });
		} finally {
			setBusy(false);
			setConnectingFrom(null);
		}
	}, [connect, session]);

	const onSubmitLink = useCallback(() => {
		const parsed = parsePairingInput(link);
		if (!parsed) {
			setStatus({ message: 'ペアリングリンクを読み取れませんでした。IDE の設定 → リモートコントロール →「ペアリングリンクをコピー」で取得したものを貼り付けてください。', tone: 'error' });
			return;
		}
		void tryConnect(parsed, 'link');
	}, [link, tryConnect]);

	const onSubmitManual = useCallback(() => {
		const built = buildConnection(host, token);
		if (!built) {
			setStatus({ message: 'アドレスとトークンの両方を入力してください。', tone: 'error' });
			return;
		}
		void tryConnect(built, 'manual');
	}, [host, token, tryConnect]);

	const onForget = useCallback(async (c: Connection) => {
		const ok = await confirmAction({
			title: '保存済みの接続を削除しますか？',
			message: `${c.label} (${c.url}) を一覧から削除します。`,
			confirmLabel: '削除',
			destructive: true,
		});
		if (ok) await forget(c.url);
	}, [forget]);

	return (
		<Screen>
			<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
				<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>

					{onBack ? <Button title='戻る' icon='chevron-left' variant='ghost' size='sm' onPress={onBack} style={styles.back} /> : null}

					<View style={styles.hero}>
						<Image source={require('../../assets/logo.png')} style={styles.heroMark} resizeMode='contain' />
						<Title>Orchestra に接続</Title>
						<Muted>繋げるのは、このアカウント ({session?.email}) でログインしている PC だけです。PC 側の Orchestra でも同じアカウントでログインし、設定 → リモートコントロールを有効にしてください。</Muted>
					</View>

					<Card>
						<SegmentedControl<Mode>
							options={[{ value: 'link', label: 'リンクを貼る' }, { value: 'manual', label: '手入力' }]}
							value={mode}
							onChange={next => { setMode(next); setStatus(null); }}
						/>

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
								<Button title='接続' icon='link' onPress={onSubmitLink} loading={connectingFrom === 'link'} disabled={!link.trim() || busy} />
							</>
						) : (
							<>
								<Muted>IDE の設定に出ているアドレスとトークンを入力します。ポートを省くと 39231 を使います。</Muted>
								<Input
									value={host}
									onChangeText={setHost}
									placeholder='192.168.0.12:39231'
									accessibilityLabel='アドレス'
									autoCapitalize='none'
									autoCorrect={false}
									keyboardType='url'
									returnKeyType='next'
									onSubmitEditing={() => tokenRef.current?.focus()}
									blurOnSubmit={false}
								/>
								<Input
									ref={tokenRef}
									value={token}
									onChangeText={setToken}
									placeholder='トークン'
									autoCapitalize='none'
									autoCorrect={false}
									secureTextEntry
									returnKeyType='go'
									onSubmitEditing={onSubmitManual}
								/>
								<Button title='接続' icon='link' onPress={onSubmitManual} loading={connectingFrom === 'manual'} disabled={!host.trim() || !token.trim() || busy} />
							</>
						)}

						{status ? <ErrorBanner message={status.message} tone={status.tone} style={styles.bannerFlush} /> : null}
					</Card>

					{connections.length > 0 ? (
						<View style={styles.list}>
							<SectionTitle>保存済みの接続</SectionTitle>
							{connections.map(c => (
								<Card key={c.url}>
									<Row>
										<View style={styles.deviceIcon}>
											<Icon name='monitor' size={20} color={colors.fgMuted} />
										</View>
										<View style={styles.flex}>
											<Body numberOfLines={1}>{c.label}</Body>
											<Muted numberOfLines={1}>{c.url}</Muted>
										</View>
										<IconButton icon='trash-2' accessibilityLabel={`${c.label} を削除`} onPress={() => void onForget(c)} />
									</Row>
									<Button
										title='接続'
										icon='link'
										onPress={() => void tryConnect(c, `saved:${c.url}`)}
										loading={connectingFrom === `saved:${c.url}`}
										disabled={busy}
									/>
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
	back: { alignSelf: 'flex-start' },
	bannerFlush: { margin: 0 },
	list: { gap: spacing.sm },
	deviceIcon: {
		width: 40,
		height: 40,
		borderRadius: radius.md,
		backgroundColor: colors.bgHover,
		alignItems: 'center',
		justifyContent: 'center',
	},
});

