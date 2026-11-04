import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../design/theme';
import { useSafeInsets } from './safeArea';

export type ScreenShellProps = {
  header?: React.ReactNode;
  children: React.ReactNode;
  /** 画面下に固定する領域（承認帯・入力欄など）。下端セーフエリアはここで確保 */
  footer?: React.ReactNode;
  /** true: 本文を ScrollView（.content 相当の padding 16/12/24）で包む */
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** ドロワー・シートなど画面全体に重ねる要素 */
  overlay?: React.ReactNode;
  scrollRef?: React.Ref<ScrollView>;
  testID?: string;
};

/**
 * 画面シェル。端末フレーム/ステータスバー描画は行わず、OS のセーフエリアを使う。
 * 広い画面（Web / タブレット）では本文幅を 720px に制限して中央寄せ。
 */
export function ScreenShell({
  header,
  children,
  footer,
  scroll = true,
  contentStyle,
  overlay,
  scrollRef,
  testID,
}: ScreenShellProps) {
  const t = useTheme();
  const insets = useSafeInsets();

  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: t.colors.bg, paddingTop: insets.top }}>
      <StatusBar
        barStyle={t.scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={t.colors.bg}
      />
      <View style={{ flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        {header}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {scroll ? (
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              contentContainerStyle={[
                {
                  paddingTop: t.space.lg,
                  paddingHorizontal: t.space.md + Math.max(insets.left, insets.right),
                  paddingBottom: t.space.xl + (footer ? 0 : insets.bottom),
                },
                contentStyle,
              ]}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[{ flex: 1, minHeight: 0 }, contentStyle]}>{children}</View>
          )}
          {footer ? <View style={{ paddingBottom: insets.bottom, backgroundColor: t.colors.bg }}>{footer}</View> : null}
        </KeyboardAvoidingView>
      </View>
      {overlay}
    </View>
  );
}
