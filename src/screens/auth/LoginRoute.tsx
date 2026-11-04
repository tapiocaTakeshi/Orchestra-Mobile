import React, { useCallback, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/mockup/primitives';
import { colors, fontSize, radius, space } from '../../design/tokens';
import { fonts } from '../../design/theme';
import { AuthProvider, hasAnySignIn, hasSignIn, restoreSession, signIn } from '../../navigation/authAdapter';
import { getPrivacyUrl, getTermsUrl } from '../../navigation/devPreview';
import { createLegacyNavigation, useAppNavigation } from '../../navigation/NavigationContext';
import { LegacyLoginScreen } from '../../navigation/screenRegistry';

interface Props {
  onSignedIn: (session: unknown) => void;
}

/** .division/design/index.html「01 · LoginScreen」 */
export function LoginRoute({ onSignedIn }: Props) {
  if (!hasAnySignIn() && LegacyLoginScreen) {
    return <LegacyLogin onSignedIn={onSignedIn} />;
  }
  return <MockupLogin onSignedIn={onSignedIn} />;
}

function MockupLogin({ onSignedIn }: Props) {
  const nav = useAppNavigation();
  const [busy, setBusy] = useState<AuthProvider | null>(null);

  const run = useCallback(
    async (provider: AuthProvider) => {
      if (busy) return;
      setBusy(provider);
      try {
        const session = await signIn(provider);
        if (session) {
          onSignedIn(session);
        } else {
          nav.toast('サインインがキャンセルされました');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        nav.toast(`サインインに失敗しました: ${msg}`);
      } finally {
        setBusy(null);
      }
    },
    [busy, nav, onSignedIn],
  );

  const openDoc = useCallback(
    (url: string | null, label: string) => {
      if (url) {
        Linking.openURL(url).catch(() => nav.toast(`${label}を開けませんでした`));
      } else {
        nav.toast(`${label}の URL が設定されていません`);
      }
    },
    [nav],
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.login}
      keyboardShouldPersistTaps="handled"
      testID="login-screen"
    >
      <View style={styles.logo}>
        <Text style={styles.logoText}>✻</Text>
      </View>
      <Text style={styles.display} accessibilityRole="header">
        {'Orchestra で\nエージェントと話す'}
      </Text>
      <Text style={styles.lead}>
        手元の Mac やクラウドで動くコーディングエージェントに、スマートフォンから指示・承認・確認ができます。
      </Text>

      <View style={styles.actions}>
        <Button
          label="GitHub でサインイン"
          block
          loading={busy === 'github'}
          disabled={(busy !== null && busy !== 'github') || !hasSignIn('github')}
          onPress={() => run('github')}
          testID="login-github"
        />
        <Button
          label="Division アカウントで続行"
          variant="secondary"
          block
          loading={busy === 'division'}
          disabled={(busy !== null && busy !== 'division') || !hasSignIn('division')}
          onPress={() => run('division')}
          testID="login-division"
        />
        <View style={styles.divider}>
          <View style={styles.rule} />
          <Text style={styles.dividerText}>または</Text>
          <View style={styles.rule} />
        </View>
        <Button
          label="ペアリングコードで接続"
          variant="ghost"
          block
          disabled={busy !== null}
          onPress={() => nav.navigate('remote')}
          testID="login-pairing"
        />
        <Text style={styles.terms}>
          続行すると{' '}
          <Text style={styles.link} accessibilityRole="link" onPress={() => openDoc(getTermsUrl(), '利用規約')}>
            利用規約
          </Text>{' '}
          と{' '}
          <Text
            style={styles.link}
            accessibilityRole="link"
            onPress={() => openDoc(getPrivacyUrl(), 'プライバシーポリシー')}
          >
            プライバシーポリシー
          </Text>{' '}
          に同意したものとみなされます。
        </Text>
      </View>
    </ScrollView>
  );
}

/** authAdapter が認証関数を特定できない場合は既存 LoginScreen をそのまま使う */
function LegacyLogin({ onSignedIn }: Props) {
  const nav = useAppNavigation();
  const Legacy = LegacyLoginScreen;
  const complete = useCallback(
    async (maybe?: unknown) => {
      const restored = await restoreSession().catch(() => null);
      const session = restored ?? maybe ?? null;
      if (session) onSignedIn(session);
    },
    [onSignedIn],
  );
  if (!Legacy) return null;
  return (
    <Legacy
      navigation={createLegacyNavigation(nav)}
      route={{ key: 'login', name: 'Login', params: {} }}
      onLoggedIn={complete}
      onSignedIn={complete}
      onLogin={complete}
      onSuccess={complete}
    />
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  login: {
    flexGrow: 1,
    paddingTop: space['2xl'],
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xl,
  },
  logoText: { fontSize: 32, color: colors.accent },
  display: {
    fontFamily: fonts.serif,
    fontSize: fontSize.display,
    fontWeight: '500',
    lineHeight: 38,
    color: colors.fgStrong,
    marginBottom: space.md,
  },
  lead: { fontSize: fontSize.body, lineHeight: 23, color: colors.fgMuted },
  actions: { marginTop: 'auto', paddingTop: space.xl, gap: space.md },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rule: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: fontSize.caption, color: colors.fgFaint },
  terms: { textAlign: 'center', fontSize: fontSize.caption, color: colors.fgFaint, lineHeight: 18 },
  link: { color: colors.accentText, fontSize: fontSize.caption },
});
