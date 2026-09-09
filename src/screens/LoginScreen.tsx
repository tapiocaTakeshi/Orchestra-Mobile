/**
 * 未接続 & 未ログインのときに出る画面。
 *
 * Division アカウント (デスクトップと共通) でサインインすると、次に DiscoverScreen が
 * ログイン中アカウントに紐づくデスクトップセッションを自動的に探してくれる。
 * アカウントを使わない場合は、下のリンクから今まで通り手動ペアリングもできる。
 */

import React, { useCallback, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, ErrorBanner, Input, Muted, SectionTitle } from '../components/ui';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, fontSize, spacing } from '../theme';

export const LoginScreen = ({ onSkip }: { onSkip: () => void }) => {
	const { login } = useDivisionAuth();

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<string | null>(null);

	const onSubmit = useCallback(async () => {
		if (!email.trim() || !password) {
			setStatus('メールアドレスとパスワードを入力してください。');
			return;
		}
		setBusy(true);
		setStatus(null);
		try {
			await login(email.trim(), password);
		} catch (e) {
			setStatus(e instanceof Error ? e.message : 'ログインに失敗しました。');
		} finally {
			setBusy(false);
		}
	}, [email, password, login]);

	return (
		<View style={styles.flex}>
			<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
				<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>

					<View style={styles.hero}>
						<Image source={require('../../assets/logo.png')} style={styles.heroMark} resizeMode='contain' />
						<Text style={styles.eyebrow}>ORCHESTRA MOBILE</Text>
						<Text accessibilityRole='header' style={styles.headline}>創る時間を、{ '\n' }どこからでも。</Text>
						<Muted style={styles.heroDetail}>エージェントへの指示も、タスクの確認も。{ '\n' }手元から Orchestra につながります。</Muted>
					</View>

					<Card>
						<SectionTitle>ログイン</SectionTitle>
						<Muted>デスクトップと同じ Division アカウントを使います。</Muted>
						<Muted>メールアドレス</Muted>
						<Input
							accessibilityLabel='メールアドレス'
							value={email}
							onChangeText={setEmail}
							placeholder='you@example.com'
							autoCapitalize='none'
							autoCorrect={false}
							keyboardType='email-address'
							autoComplete='email'
						/>
						<Muted>パスワード</Muted>
						<Input
							accessibilityLabel='パスワード'
							value={password}
							onChangeText={setPassword}
							placeholder='パスワード'
							autoCapitalize='none'
							autoCorrect={false}
							secureTextEntry
							autoComplete='password'
						/>
						<Button title='ログイン' onPress={() => { void onSubmit(); }} loading={busy} />
						{status ? <ErrorBanner message={status} /> : null}
					</Card>

					<Muted style={{ textAlign: 'center' }}>アカウントの作成はデスクトップの Orchestra から。</Muted>

					<Button title='ペアリングリンクで接続する' variant='ghost' onPress={onSkip} />

				</ScrollView>
			</KeyboardAvoidingView>
		</View>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	content: {
		flexGrow: 1,
		justifyContent: 'center',
		width: '100%',
		maxWidth: 480,
		alignSelf: 'center',
		padding: spacing.lg,
		gap: spacing.lg,
	},
	hero: {
		alignItems: 'center',
		gap: spacing.md,
		paddingBottom: spacing.lg,
		paddingTop: spacing.xl,
	},
	eyebrow: { color: colors.accentText, fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 2 },
	headline: { color: colors.fg, fontSize: 32, fontWeight: '700', lineHeight: 44, textAlign: 'center' },
	heroDetail: { textAlign: 'center', lineHeight: 22 },
	heroMark: {
		width: 64,
		height: 64,
	},
});

