import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/mockup/primitives';
import { colors, fontSize, radius, space } from '../design/tokens';
import { fonts } from '../design/theme';
import { SessionUser } from './authAdapter';
import { useAppNavigation } from './NavigationContext';
import { DRAWER_ORDER, ROUTES } from './routes';

const WIDTH = 300;

interface Props {
  open: boolean;
  user: SessionUser | null;
  /** 最近の会話（HomeScreen 側の担当。未提供なら空表示） */
  recent?: string[];
}

/** モックアップ .layer > .scrim + .drawer */
export function AppDrawer({ open, user, recent = [] }: Props) {
  const nav = useAppNavigation();
  const anim = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(anim, { toValue: open ? 1 : 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [open, anim]);

  if (!mounted) return null;

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-WIDTH, 0] });

  return (
    <View style={StyleSheet.absoluteFill} testID="drawer-layer">
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: anim }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="メニューを閉じる"
          onPress={nav.closeDrawer}
          testID="drawer-scrim"
        />
      </Animated.View>
      <Animated.View
        style={[styles.drawer, { transform: [{ translateX }] }]}
        accessibilityViewIsModal
        accessibilityLabel="ナビゲーション"
      >
        <View style={styles.brand}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>✻</Text>
          </View>
          <Text style={styles.brandText}>Orchestra</Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.nav}>
          {DRAWER_ORDER.map((name) => {
            const def = ROUTES[name];
            const current = nav.route === name;
            return (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                onPress={() => nav.selectFromDrawer(name)}
                testID={`drawer-item-${name}`}
                style={({ pressed }) => [styles.item, (current || pressed) && { backgroundColor: colors.bgHover }]}
              >
                <Text style={[styles.itemIcon, current && { color: colors.accentText }]}>{def.icon}</Text>
                <Text style={[styles.itemLabel, current && { color: colors.fgStrong }]} numberOfLines={1}>
                  {def.title}
                </Text>
              </Pressable>
            );
          })}

          <Text style={styles.navLabel}>最近の会話</Text>
          {recent.length === 0 ? (
            <Text style={styles.recentEmpty}>まだ会話はありません</Text>
          ) : (
            recent.map((title, i) => (
              <Pressable
                key={`${title}-${i}`}
                accessibilityRole="button"
                onPress={() => nav.selectFromDrawer('home')}
                style={({ pressed }) => [styles.recent, pressed && { backgroundColor: colors.bgHover }]}
              >
                <Text style={styles.recentText} numberOfLines={1}>
                  {title}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>

        <View style={styles.account}>
          <Pressable
            style={styles.accountMain}
            accessibilityRole="button"
            accessibilityLabel="設定を開く"
            onPress={() => nav.selectFromDrawer('settings')}
            testID="drawer-account"
          >
            <View style={styles.av}>
              <Text style={styles.avText}>{user?.initial ?? '?'}</Text>
            </View>
            <View style={styles.who}>
              <Text style={styles.whoName} numberOfLines={1}>
                {user?.name ?? 'アカウント'}
              </Text>
              {user?.email ? (
                <Text style={styles.caption} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
            </View>
          </Pressable>
          <Button label="ログアウト" variant="ghost" size="sm" onPress={nav.signOut} testID="drawer-logout" />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: colors.scrim },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: WIDTH,
    maxWidth: '85%',
    backgroundColor: colors.bgSidebar,
    paddingTop: space.lg,
    paddingHorizontal: space.md,
    paddingBottom: space.lg,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 56, paddingHorizontal: space.sm },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontSize: 14 },
  brandText: { fontFamily: fonts.serif, fontSize: fontSize.page, fontWeight: '500', color: colors.fgStrong },
  scroll: { flex: 1 },
  nav: { gap: 2, marginTop: space.sm, paddingBottom: space.md },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  itemIcon: { width: 20, textAlign: 'center', fontSize: 18, color: colors.fgMuted },
  itemLabel: { flex: 1, fontSize: fontSize.body, fontWeight: '500', color: colors.fg },
  navLabel: {
    fontSize: fontSize.caption,
    color: colors.fgFaint,
    paddingTop: space.lg,
    paddingHorizontal: space.md,
    paddingBottom: space.xs,
  },
  recent: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm },
  recentText: { fontSize: fontSize.small, color: colors.fgMuted },
  recentEmpty: { fontSize: fontSize.small, color: colors.fgFaint, paddingHorizontal: space.md, paddingVertical: space.sm },
  account: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  accountMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  av: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avText: { fontWeight: '600', color: colors.fgStrong, fontSize: fontSize.body },
  who: { flex: 1, minWidth: 0 },
  whoName: { fontSize: fontSize.body, fontWeight: '600', color: colors.fgStrong },
  caption: { fontSize: fontSize.caption, color: colors.fgFaint },
});
