/**
 * 未接続 & 未ログインのときに出る画面。
 *
 * Division アカウント (デスクトップと共通) でサインインすると、次に DiscoverScreen が
 * ログイン中アカウントに紐づくデスクトップセッションを自動的に探してくれる。
 * アカウントを使わない場合は、下のリンクから今まで通り手動ペアリングもできる。
 */

import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ErrorBanner, IconButton, Input } from '../components/ui';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, fontSize, radius, spacing } from '../theme';

export const LoginScreen = () => {
	const { login } = useDivisionAuth();

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [showPassword, setShowPassword] = useState(false);
	const passwordRef = useRef<TextInput>(null);

	const onSubmit = useCallback(async () => {
		if (busy) return;
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
	}, [busy, email, password, login]);

	// 飾りの箱や色は使わず、ロゴ・見出し・入力欄・ボタンだけを縦に並べる。
	return (
		<View style={styles.flex}>
			<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
				<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
					<View style={styles.panel}>
						<View style={styles.hero}>
							<Image source={require('../../assets/logo.png')} style={styles.heroMark} resizeMode='contain' />
							<Text accessibilityRole='header' style={styles.headline}>Orchestra にログイン</Text>
							<Text style={styles.heroDetail}>デスクトップと同じ Division アカウントを使います。</Text>
						</View>

						<View style={styles.form}>
							<Text style={styles.label}>メールアドレス</Text>
							<Input
								accessibilityLabel='メールアドレス'
								value={email}
								onChangeText={text => { setEmail(text); setStatus(null); }}
								placeholder='you@example.com'
								autoCapitalize='none'
								autoCorrect={false}
								keyboardType='email-address'
								autoComplete='email'
								textContentType='username'
								returnKeyType='next'
								onSubmitEditing={() => passwordRef.current?.focus()}
								blurOnSubmit={false}
							/>
							<Text style={styles.label}>パスワード</Text>
							<View style={styles.passwordRow}>
								<Input
									ref={passwordRef}
									accessibilityLabel='パスワード'
									value={password}
									onChangeText={text => { setPassword(text); setStatus(null); }}
									placeholder='パスワード'
									autoCapitalize='none'
									autoCorrect={false}
									secureTextEntry={!showPassword}
									autoComplete='password'
									textContentType='password'
									returnKeyType='go'
									onSubmitEditing={() => { void onSubmit(); }}
										style={styles.flex}
								/>
								<IconButton
									icon={showPassword ? 'eye-off' : 'eye'}
									accessibilityLabel={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
									onPress={() => setShowPassword(v => !v)}
								/>
							</View>
							{status ? <ErrorBanner message={status} style={styles.bannerFlush} /> : null}
							<Pressable
								accessibilityRole='button'
								accessibilityLabel='ログイン'
								accessibilityState={{ disabled: busy, busy }}
								disabled={busy}
								onPress={() => { void onSubmit(); }}
								style={({ pressed }) => [styles.loginButton, pressed && styles.loginButtonPressed, busy && styles.loginButtonBusy]}
							>
								{busy ? <ActivityIndicator color={colors.bg} size='small' /> : null}
								<Text style={styles.loginText}>{busy ? 'ログインしています…' : 'ログイン'}</Text>
							</Pressable>
							<Text style={styles.noteText}>アカウントの作成はデスクトップの Orchestra から</Text>
						</View>
					</View>
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
	},
	panel: { gap: spacing.xl },
	hero: { alignItems: 'flex-start', gap: spacing.sm },
	heroMark: { width: 44, height: 44, marginBottom: spacing.sm },
	headline: { color: colors.fgStrong, fontSize: 24, fontWeight: '600' },
	heroDetail: { color: colors.fgFaint, fontSize: fontSize.xs + 1, lineHeight: 21 },
	form: { gap: spacing.sm },
	label: { color: colors.fgMuted, fontSize: fontSize.xs, marginTop: spacing.xs },
	passwordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
	bannerFlush: { margin: 0 },
	loginButton: {
		marginTop: spacing.md,
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		gap: spacing.sm,
		minHeight: 48,
		borderRadius: radius.md,
		backgroundColor: colors.fg,
	},
	loginButtonPressed: { backgroundColor: colors.fgMuted },
	loginButtonBusy: { opacity: 0.6 },
	loginText: { color: colors.bg, fontSize: fontSize.sm - 1, fontWeight: '600' },
	noteText: { color: colors.fgFaint, fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.sm },
});
