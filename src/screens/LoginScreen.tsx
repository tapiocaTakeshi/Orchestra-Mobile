/**
 * 未接続 & 未ログインのときに出る画面。
 *
 * Division アカウント (デスクトップと共通) でサインインすると、次に DiscoverScreen が
 * ログイン中アカウントに紐づくデスクトップセッションを自動的に探してくれる。
 * アカウントを使わない場合は、下のリンクから今まで通り手動ペアリングもできる。
 */

import React, { useCallback, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Body, Button, Card, Input, Muted, Title } from '../components/ui';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { spacing } from '../theme';

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
						<Title>Orchestra にログイン</Title>
						<Muted>デスクトップと同じ Division アカウントでサインインすると、接続先を自動的に見つけます。</Muted>
					</View>

					<Card>
						<Input
							value={email}
							onChangeText={setEmail}
							placeholder='you@example.com'
							autoCapitalize='none'
							autoCorrect={false}
							keyboardType='email-address'
							autoComplete='email'
						/>
						<Input
							value={password}
							onChangeText={setPassword}
							placeholder='パスワード'
							autoCapitalize='none'
							autoCorrect={false}
							secureTextEntry
							autoComplete='password'
						/>
						<Button title='ログイン' onPress={() => { void onSubmit(); }} loading={busy} />
						{status ? <Body>{status}</Body> : null}
					</Card>

					<Card>
						<Muted>アカウントの新規作成はデスクトップの Orchestra から行ってください。</Muted>
					</Card>

					<Button title='ペアリングリンクで接続する' variant='ghost' onPress={onSkip} />

				</ScrollView>
			</KeyboardAvoidingView>
		</View>
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
});
