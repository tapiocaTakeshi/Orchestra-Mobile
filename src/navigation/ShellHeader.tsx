import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton } from '../components/mockup/primitives';
import { colors, fontSize, space } from '../design/tokens';
import { fonts } from '../design/theme';
import { useAppNavigation } from './NavigationContext';
import { ROUTES } from './routes';

/**
 * モックアップの .header（高さ 56、下線、44px の icon-btn + serif 22 のページタイトル）。
 * 戻れる画面では ←、ルート画面（会話）では ☰ でドロワーを開く。
 */
export function ShellHeader() {
  const nav = useAppNavigation();
  const def = ROUTES[nav.route];
  const showBack = nav.canGoBack && nav.route !== 'home';
  return (
    <View style={styles.header} accessibilityRole="header">
      {showBack ? (
        <IconButton icon="←" accessibilityLabel="戻る" onPress={() => nav.goBack()} testID="header-back" />
      ) : (
        <IconButton icon="☰" accessibilityLabel="メニューを開く" onPress={nav.openDrawer} testID="header-menu" />
      )}
      <Text style={styles.title} numberOfLines={1}>
        {def.title}
      </Text>
      {showBack ? (
        <IconButton icon="☰" accessibilityLabel="メニューを開く" onPress={nav.openDrawer} testID="header-menu" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.serif,
    fontSize: fontSize.page,
    fontWeight: '500',
    color: colors.fgStrong,
  },
});
