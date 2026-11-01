/**
 * 未接続 & 未ログインのときに出る画面。
 *
 * Division アカウント (デスクトップと共通) でサインインすると、次に DiscoverScreen が
 * ログイン中アカウントに紐づくデスクトップセッションを自動的に探してくれる。
 * アカウントを使わない場合は、下のリンクから今まで通り手動ペアリングもできる。
 *
 * App Store Guideline 1.2 のため、利用規約 (不適切なコンテンツ・迷惑行為を許容しない旨を含む) に
 * 同意しないとログインできない。規約の全文は「利用規約」からアプリ内で読める。
 */

import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { LegalLinks, TermsCheckbox, TermsSheet } from '../components/TermsSheet';
import { ErrorBanner, IconButton, Input } from '../components/ui';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { colors, fontSize, radius, spacing } from '../theme';

export const LoginScreen = () => {
	const { login, termsAccepted, acceptTerms } = useDivisionAuth();

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [showPassword, setShowPassword] = useState(false);
	/** 以前に最新の規約へ同意していればチェック済みから始める (版が上がっていれば外れている)。 */
	const [agreed, setAgreed] = useState(termsAccepted);
	const [showTerms, setShowTerms] = useState(false);
	const passwordRef = useRef<TextInput>(null);

	const onSubmit = useCallback(async () => {
		if (busy) return;
		if (!agreed) {
			setStatus('ログインするには利用規約に同意してください。');
			return;
		}
		if (!email.trim() || !password) {
			setStatus('メールアドレスとパスワードを入力してください。');
			return;
		}
		setBusy(true);
		setStatus(null);
		try {
			// 同意した版を先に保存してからログインする (ログイン後にサーバーへも記録される)。
			if (!termsAccepted) await acceptTerms();
			await login(email.trim(), password);
		} catch (e) {
			setStatus(e instanceof Error ? e.message : 'ログインに失敗しました。');
		} finally {
			setBusy(false);
		}
	}, [busy, agreed, email, password, termsAccepted, acceptTerms, login]);

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
							<TermsCheckbox
								checked={agreed}
								onToggle={() => { setAgreed(v => !v); setStatus(null); }}
								onOpenTerms={() => setShowTerms(true)}
							/>
							{status ? <ErrorBanner message={status} style={styles.bannerFlush} /> : null}
							<Pressable
								accessibilityRole='button'
								accessibilityLabel='ログイン'
								accessibilityHint={agreed ? undefined : '利用規約に同意するとログインできます'}
								accessibilityState={{ disabled: busy || !agreed, busy }}
								disabled={busy}
								onPress={() => { void onSubmit(); }}
								style={({ pressed }) => [styles.loginButton, pressed && agreed && styles.loginButtonPressed, (busy || !agreed) && styles.loginButtonBusy]}
							>
								{busy ? <ActivityIndicator color={colors.onAccent} size='small' /> : null}
								<Text style={styles.loginText}>{busy ? 'ログインしています…' : 'ログイン'}</Text>
							</Pressable>
							<Text style={styles.noteText}>アカウントの作成はデスクトップの Orchestra から</Text>
							<View style={styles.legalLinks}><LegalLinks /></View>
						</View>
					</View>
				</ScrollView>
			</KeyboardAvoidingView>
			{showTerms ? (
				<TermsSheet
					onClose={() => setShowTerms(false)}
					onAgree={() => { setAgreed(true); setStatus(null); }}
				/>
			) : null}
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
		backgroundColor: colors.accent,
	},
	loginButtonPressed: { backgroundColor: colors.accentPressed },
	loginButtonBusy: { opacity: 0.6 },
	loginText: { color: colors.onAccent, fontSize: fontSize.sm - 1, fontWeight: '600' },
	legalLinks: { alignItems: 'center', marginTop: spacing.sm },
	noteText: { color: colors.fgFaint, fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.sm },
});
