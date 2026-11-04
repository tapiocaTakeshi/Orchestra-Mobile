### 1. 実装プラン

**前提**
- 本体は Expo / React Native の構成として進めます。根拠は、モックアップに「実装（Expo / React Native）」とあること、`src/screens/*.tsx`・`src/lib/__tests__` があること、EAS を使っていることです。
- 既存ファイル（`src/screens/HomeScreen.tsx`・`src/design/screenMap.ts` など）の現在の中身は手元の資料に入っていません。SEARCH/REPLACE の SEARCH 部分は一字一句一致しないと失敗し、ファイルを壊すおそれがあります。そのため、このタスクでは既存ファイルを編集せず、新しいファイルだけで共通基盤を作ります。各画面での利用は、後続の画面タスクで既存画面の import を差し替えて行います。
- `src/theme.ts` が既にあるかどうか分からないため、上書きを避けて `src/design/` の下に置きます（`screenMap.ts` と同じ場所です）。

**作るもの**
- **デザイントークン（`src/design/tokens.ts`）**
  - `DESIGN.html` の `:root` にある色・余白・角丸・影を、名前と値を変えずに TS の定数にします（ライトとダークの両方）。
  - このファイルは React Native を import しないので、jest から単体で検証できます。
- **テーマ（`src/design/theme.ts`）**
  - `useTheme()` で、OS のライト／ダーク設定に合わせた色・フォント・文字サイズ・影を返します。
  - フォントは、Web では CSS と同じフォント指定をそのまま使います。iOS は System／Georgia／Menlo、Android は既定／serif／monospace に置き換えます。
  - 影は、iOS では shadow 系の指定、Android では elevation、Web では boxShadow で再現します。
- **共通部品（`src/components/ui/`）**
  - 対象: Button、IconButton、TextField、Card、Badge／StatusDot、Chip、Tabs、Toggle、Avatar、AppText、ScreenHeader、ScreenShell、Toast、BottomSheet、SideDrawer。
  - 寸法は mock の CSS に合わせています（ボタン 44／36、ヘッダー 56、チップ 28、バッジ 22、タブ 32、スイッチ 44×26、ドロワー幅 300、シートの上角の丸み 24、トースト 1.8 秒）。
- **画面の土台（ScreenShell）**
  - セーフエリアに対応します。`SafeAreaProvider` がなくても落ちないよう、その場合は代わりの値を使います。
  - iOS ではキーボード表示時に画面を押し上げます。
  - 下部固定の領域（入力欄・承認帯）では、下端のセーフエリア分の余白を取ります。
  - 狭い画面ではそのまま画面幅いっぱいに広がり、Web やタブレットでは本文の幅を最大 720px に制限して中央に寄せます。
- **移植しないもの**: 端末の枠と閲覧用ツールバーは本体に入れません。ナビゲーションは既存の方式のままです。
- **影響範囲**: 新規ファイルのみです。既存の画面・lib・テストの動作は変わりません。

### 2. ファイル一覧
| ファイル | 操作 | 概要 |
|---|---|---|
| src/design/tokens.ts | 新規 | `DESIGN.html` の `:root` を写したトークン（ライト／ダーク、余白、角丸、影） |
| src/design/theme.ts | 新規 | `useTheme()`、フォント、文字サイズ、影の生成 |
| src/design/__tests__/tokens.test.ts | 新規 | モックアップ HTML の `:root` とトークンが一致するかを機械的に確認 |
| src/components/ui/safeArea.ts | 新規 | Provider がなくても使えるセーフエリア取得 |
| src/components/ui/AppText.tsx | 新規 | 文字スタイル付きの Text |
| src/components/ui/Button.tsx | 新規 | Primary／Secondary／Ghost／Danger、通常／小 |
| src/components/ui/IconButton.tsx | 新規 | 44×44 のアイコンボタン |
| src/components/ui/TextField.tsx | 新規 | 入力欄（フォーカス時は枠をアクセント色に） |
| src/components/ui/Card.tsx | 新規 | カード |
| src/components/ui/Badge.tsx | 新規 | バッジと状態ドット |
| src/components/ui/Avatar.tsx | 新規 | ✻ のアバター |
| src/components/ui/Chip.tsx | 新規 | 入力欄のチップ |
| src/components/ui/Tabs.tsx | 新規 | 丸い形のフィルタタブ |
| src/components/ui/Toggle.tsx | 新規 | スイッチ |
| src/components/ui/ScreenHeader.tsx | 新規 | 会話用とページ用のヘッダー |
| src/components/ui/ScreenShell.tsx | 新規 | 画面の土台（セーフエリア、キーボード、下部固定領域） |
| src/components/ui/Toast.tsx | 新規 | ToastProvider と useToast |
| src/components/ui/BottomSheet.tsx | 新規 | シートと選択肢 |
| src/components/ui/SideDrawer.tsx | 新規 | ドロワー、ナビ項目、見出し |
| src/components/ui/index.ts | 新規 | まとめて export |
| docs/ui-foundation.md | 新規 | 部品と mock の対応表、組み込み方 |

### 3. コード本体

```ts:src/design/tokens.ts
/**
 * Design tokens — .division/DESIGN.html の :root をそのまま写したもの。
 * 名前は CSS 変数の `--color-xxx-yyy` を camelCase にしたもの（例: --color-bg-sidebar → bgSidebar）。
 * 値を変更する場合は DESIGN.html を先に変更し、src/design/__tests__/tokens.test.ts で一致を確認すること。
 * このファイルは react-native を import しない（jest で単体検証するため）。
 */

export const lightColors = {
  bg: '#faf9f5',
  bgSidebar: '#f0eee6',
  bgElevated: '#ffffff',
  bgInput: '#ffffff',
  bgHover: '#ebe8de',
  border: '#e6e2d6',
  borderStrong: '#d6d1c3',
  fg: '#3d3929',
  fgStrong: '#1f1e1b',
  fgMuted: '#5e5a4c',
  fgFaint: '#78735f',
  accent: '#b95a3a',
  accentPressed: '#a24f30',
  onAccent: '#ffffff',
  accentText: '#b5532f',
  success: '#2f7d4f',
  warning: '#9c610c',
  danger: '#b3261e',
  running: '#3b6db3',
  scrim: 'rgba(31,30,27,.32)',
  shadow: '#3d3929',
} as const;

export type ColorName = keyof typeof lightColors;
export type ColorTokens = Record<ColorName, string>;

export const darkColors: ColorTokens = {
  bg: '#1f1e1b',
  bgSidebar: '#262420',
  bgElevated: '#2b2924',
  bgInput: '#2b2924',
  bgHover: '#3a372f',
  border: '#3a372f',
  borderStrong: '#4a463c',
  fg: '#e8e4d8',
  fgStrong: '#f5f2ea',
  fgMuted: '#b3ad9c',
  fgFaint: '#8d8776',
  accent: '#d07855',
  accentPressed: '#b95a3a',
  onAccent: '#1f1e1b',
  accentText: '#d99a7f',
  success: '#6fb389',
  warning: '#d19a4a',
  danger: '#e08a84',
  running: '#8aa9d4',
  scrim: 'rgba(0,0,0,.5)',
  shadow: '#000000',
};

/** --space-* */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 48,
  '3xl': 64,
} as const;

/** --radius-* */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * --shadow-1..3（0 Ypx BLURpx rgba(61,57,41,OPACITY)）
 * 色は --color-shadow を使う。
 */
export const shadowSpec = {
  1: { y: 1, blur: 2, opacity: 0.05, css: '0 1px 2px rgba(61,57,41,.05)' },
  2: { y: 2, blur: 10, opacity: 0.06, css: '0 2px 10px rgba(61,57,41,.06)' },
  3: { y: 8, blur: 28, opacity: 0.12, css: '0 8px 28px rgba(61,57,41,.12)' },
} as const;

export type ShadowLevel = keyof typeof shadowSpec;

/** --font-* （Web ではこのスタックをそのまま使用） */
export const fontStacks = {
  body: '-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif',
  serif: 'Georgia,"Hiragino Mincho ProN",serif',
  mono: 'Menlo,Consolas,monospace',
} as const;

/**
 * モックアップ（.avatar / .logo）で使われているアクセントの淡色背景。
 * DESIGN.html のトークンではなく mock の CSS に直接書かれた値をそのまま転記している。
 */
export const accentSoft = 'rgba(185,90,58,.12)';

/** camelCase のトークン名 → CSS 変数名 */
export function cssVarOf(name: ColorName): string {
  return '--color-' + name.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}
```

```ts:src/design/theme.ts
import { useMemo } from 'react';
import { Platform, TextStyle, ViewStyle, useColorScheme } from 'react-native';
import {
  ColorTokens,
  ShadowLevel,
  accentSoft,
  darkColors,
  fontStacks,
  lightColors,
  radius,
  shadowSpec,
  space,
} from './tokens';

/** --font-body / --font-serif / --font-mono をプラットフォームごとに解決 */
export const fonts: { body?: string; serif: string; mono: string } = {
  body: Platform.select<string | undefined>({ web: fontStacks.body, ios: 'System', default: undefined }),
  serif: Platform.select<string>({ web: fontStacks.serif, ios: 'Georgia', android: 'serif', default: 'serif' }) as string,
  mono: Platform.select<string>({ web: fontStacks.mono, ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
};

export function makeShadow(level: ShadowLevel, colors: ColorTokens): ViewStyle {
  const s = shadowSpec[level];
  if (Platform.OS === 'web') {
    return { boxShadow: s.css } as unknown as ViewStyle;
  }
  return {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: s.y },
    shadowOpacity: s.opacity,
    shadowRadius: s.blur / 2,
    elevation: level === 1 ? 1 : level === 2 ? 3 : 8,
  };
}

/** mock の文字スタイル（px と line-height を変換） */
export function makeType(colors: ColorTokens) {
  return {
    /** .display 30 / 1.25 serif */
    display: { fontFamily: fonts.serif, fontSize: 30, lineHeight: 38, fontWeight: '500', color: colors.fgStrong },
    /** .page-title / .sheet h2 / .drawer-brand 22 / 1.3 serif */
    pageTitle: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 29, fontWeight: '500', color: colors.fgStrong },
    /** .section-h / .header-title b 17 */
    title: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24, fontWeight: '600', color: colors.fgStrong },
    /** body 15 / 1.5 */
    body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.fg },
    /** .agent-body / .lead 15 / 23 */
    bodyLoose: { fontFamily: fonts.body, fontSize: 15, lineHeight: 23, color: colors.fg },
    /** .row-h 15 / 1.4 600 */
    rowTitle: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, fontWeight: '600', color: colors.fgStrong },
    /** .muted 13 / 18 */
    muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.fgMuted },
    /** .agent-name / .tab 13 600 */
    label: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.fgMuted },
    /** .caption 12 */
    caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.fgFaint },
    /** .mono / .tool-line 12 / 18 */
    mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: colors.fgFaint },
  } satisfies Record<string, TextStyle>;
}

export type TypeVariant = keyof ReturnType<typeof makeType>;

export type Theme = {
  scheme: 'light' | 'dark';
  colors: ColorTokens;
  space: typeof space;
  radius: typeof radius;
  fonts: typeof fonts;
  type: ReturnType<typeof makeType>;
  shadow: (level: ShadowLevel) => ViewStyle;
  accentSoft: string;
};

export function buildTheme(scheme: 'light' | 'dark'): Theme {
  const colors = scheme === 'dark' ? darkColors : lightColors;
  return {
    scheme,
    colors,
    space,
    radius,
    fonts,
    type: makeType(colors),
    shadow: (level) => makeShadow(level, colors),
    accentSoft,
  };
}

/** OS のライト/ダーク設定に追従するテーマ */
export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return useMemo(() => buildTheme(scheme), [scheme]);
}
```

```ts:src/design/__tests__/tokens.test.ts
import * as fs from 'fs';
import * as path from 'path';
import { ColorName, cssVarOf, darkColors, lightColors, radius, space } from '../tokens';

const root = path.resolve(__dirname, '..', '..', '..');
const indexHtml = path.join(root, '.division', 'design', 'index.html');
const listHtml = path.join(root, '.division', 'design', 'orchestra-mobile-mockup.html');

function norm(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, '');
}

function parseVars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out['--' + m[1]] = norm(m[2]);
  return out;
}

function rootBlock(html: string, from = 0): string {
  const start = html.indexOf(':root{', from);
  if (start < 0) return '';
  const end = html.indexOf('}', start);
  return html.slice(start, end);
}

const names = Object.keys(lightColors) as ColorName[];

describe('design tokens', () => {
  const hasIndex = fs.existsSync(indexHtml);
  (hasIndex ? it : it.skip)('light colors match .division/design/index.html :root', () => {
    const vars = parseVars(rootBlock(fs.readFileSync(indexHtml, 'utf8')));
    for (const n of names) {
      expect([cssVarOf(n), vars[cssVarOf(n)]]).toEqual([cssVarOf(n), norm(lightColors[n])]);
    }
  });

  (hasIndex ? it : it.skip)('space / radius match :root', () => {
    const vars = parseVars(rootBlock(fs.readFileSync(indexHtml, 'utf8')));
    for (const [k, v] of Object.entries(space)) expect(vars['--space-' + k]).toBe(`${v}px`);
    for (const [k, v] of Object.entries(radius)) expect(vars['--radius-' + k]).toBe(`${v}px`);
  });

  const hasList = fs.existsSync(listHtml);
  (hasList ? it : it.skip)('dark colors match prefers-color-scheme: dark :root', () => {
    const html = fs.readFileSync(listHtml, 'utf8');
    const darkAt = html.indexOf('prefers-color-scheme: dark');
    expect(darkAt).toBeGreaterThan(-1);
    const vars = parseVars(rootBlock(html, darkAt));
    for (const n of names) {
      expect([cssVarOf(n), vars[cssVarOf(n)]]).toEqual([cssVarOf(n), norm(darkColors[n])]);
    }
  });

  it('cssVarOf converts camelCase to CSS variable names', () => {
    expect(cssVarOf('bgSidebar')).toBe('--color-bg-sidebar');
    expect(cssVarOf('onAccent')).toBe('--color-on-accent');
  });
});
```

```ts:src/components/ui/safeArea.ts
import { useContext } from 'react';
import { Platform, StatusBar } from 'react-native';
import { EdgeInsets, SafeAreaInsetsContext } from 'react-native-safe-area-context';

/**
 * SafeAreaProvider があればその値を、無ければプラットフォーム既定値を返す。
 * （Provider 未設定のルートでもクラッシュさせないため）
 */
export function useSafeInsets(): EdgeInsets {
  const ctx = useContext(SafeAreaInsetsContext);
  if (ctx) return ctx;
  if (Platform.OS === 'android') {
    return { top: StatusBar.currentHeight ?? 0, bottom: 0, left: 0, right: 0 };
  }
  if (Platform.OS === 'ios') {
    return { top: 44, bottom: 34, left: 0, right: 0 };
  }
  return { top: 0, bottom: 0, left: 0, right: 0 };
}
```

```tsx:src/components/ui/AppText.tsx
import React from 'react';
import { Text, TextProps } from 'react-native';
import { TypeVariant, useTheme } from '../../design/theme';
import { ColorName } from '../../design/tokens';

export type AppTextProps = TextProps & {
  variant?: TypeVariant;
  color?: ColorName;
};

export function AppText({ variant = 'body', color, style, ...rest }: AppTextProps) {
  const t = useTheme();
  return <Text {...rest} style={[t.type[variant], color ? { color: t.colors[color] } : null, style]} />;
}
```

```tsx:src/components/ui/Button.tsx
import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { useTheme } from '../../design/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  block?: boolean;
  disabled?: boolean;
  icon?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  block,
  disabled,
  icon,
  accessibilityLabel,
  style,
  testID,
}: ButtonProps) {
  const t = useTheme();
  const c = t.colors;
  const sm = size === 'sm';

  const fg =
    variant === 'primary' || variant === 'danger'
      ? c.onAccent
      : variant === 'ghost'
        ? c.accentText
        : c.fgStrong;

  const bgOf = (pressed: boolean) => {
    switch (variant) {
      case 'primary':
        return pressed ? c.accentPressed : c.accent;
      case 'secondary':
        return pressed ? c.bgHover : c.bgElevated;
      case 'danger':
        return c.danger;
      default:
        return pressed ? c.bgHover : 'transparent';
    }
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={sm ? 4 : 0}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: sm ? 36 : 44,
          paddingHorizontal: sm ? t.space.md : t.space.lg,
          borderRadius: sm ? t.radius.sm : t.radius.md,
          backgroundColor: bgOf(pressed && !disabled),
          borderColor: variant === 'secondary' ? c.borderStrong : 'transparent',
        },
        block ? styles.block : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {icon ? <Text style={[styles.label, { color: fg, fontSize: sm ? 13 : 15 }]}>{icon}</Text> : null}
      <Text
        numberOfLines={1}
        style={[styles.label, { color: fg, fontSize: sm ? 13 : 15, fontFamily: t.fonts.body }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
  },
  block: { alignSelf: 'stretch' },
  disabled: { opacity: 0.4 },
  label: { fontWeight: '600' },
});
```

```tsx:src/components/ui/IconButton.tsx
import React from 'react';
import { Pressable, StyleProp, Text, ViewStyle } from 'react-native';
import { useTheme } from '../../design/theme';

export type IconButtonProps = {
  glyph: string;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** mock の .icon-btn（44×44, radius-md, 押下で bg-hover） */
export function IconButton({ glyph, label, onPress, disabled, style, testID }: IconButtonProps) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: 44,
          height: 44,
          borderRadius: t.radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? t.colors.bgHover : 'transparent',
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      <Text style={{ fontSize: 20, color: t.colors.fgStrong }}>{glyph}</Text>
    </Pressable>
  );
}
```

```tsx:src/components/ui/TextField.tsx
import React, { forwardRef, useState } from 'react';
import { TextInput, TextInputProps } from 'react-native';
import { useTheme } from '../../design/theme';

/** mock の .input（44 高、radius-md、フォーカスで accent-text の枠） */
export const TextField = forwardRef<TextInput, TextInputProps>(function TextField(
  { style, onFocus, onBlur, ...rest },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={t.colors.fgFaint}
      {...rest}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        {
          minHeight: 44,
          paddingHorizontal: t.space.md,
          borderWidth: 1,
          borderColor: focused ? t.colors.accentText : t.colors.border,
          borderRadius: t.radius.md,
          backgroundColor: t.colors.bgInput,
          color: t.colors.fg,
          fontSize: 15,
          fontFamily: t.fonts.body,
        },
        style,
      ]}
    />
  );
});
```

```tsx:src/components/ui/Card.tsx
import React from 'react';
import { Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { useTheme } from '../../design/theme';

export type CardProps = {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** mock の .card（bg-elevated, border, radius-lg, padding lg, shadow-1） */
export function Card({ children, onPress, accessibilityLabel, style, testID }: CardProps) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.colors.bgElevated,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: t.radius.lg,
    padding: t.space.lg,
    ...t.shadow(1),
  };
  if (!onPress) {
    return (
      <View testID={testID} style={[base, style]}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [base, pressed ? { backgroundColor: t.colors.bgHover } : null, style]}
    >
      {children}
    </Pressable>
  );
}
```

```tsx:src/components/ui/Badge.tsx
import React from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../../design/theme';

export type Status = 'running' | 'warning' | 'success' | 'danger';

export function StatusDot({ status, style }: { status: Status; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors[status] }, style]}
    />
  );
}

/** mock の .badge（22 高、pill、12px 600） */
export function Badge({ label, status, style }: { label: string; status?: Status; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 4,
          height: 22,
          paddingHorizontal: 8,
          borderRadius: t.radius.pill,
          borderWidth: 1,
          borderColor: t.colors.border,
          backgroundColor: t.colors.bgElevated,
        },
        style,
      ]}
    >
      {status ? <StatusDot status={status} /> : null}
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', color: t.colors.fgMuted, fontFamily: t.fonts.body }}>
        {label}
      </Text>
    </View>
  );
}
```

```tsx:src/components/ui/Avatar.tsx
import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../design/theme';

/** mock の .avatar（26px 円, accent 淡色地に ✻）。size=64 で .logo 相当 */
export function Avatar({ size = 26, glyph = '✻', rounded = 'circle' }: { size?: number; glyph?: string; rounded?: 'circle' | 'lg' }) {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: rounded === 'circle' ? size / 2 : t.radius.lg,
        backgroundColor: t.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: t.colors.accent, fontSize: Math.round(size / 2) + 1 }}>{glyph}</Text>
    </View>
  );
}
```

```tsx:src/components/ui/Chip.tsx
import React from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '../../design/theme';

export type ChipProps = {
  label: string;
  onPress?: () => void;
  /** 既定値から変更済み（mock の .chip.changed） */
  changed?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** mock の .chip（28 高、pill、mono 12px） */
export function Chip({ label, onPress, changed, accessibilityLabel, testID }: ChipProps) {
  const t = useTheme();
  const tone = changed ? t.colors.accentText : t.colors.fgMuted;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        height: 28,
        paddingHorizontal: 10,
        borderRadius: t.radius.pill,
        borderWidth: 1,
        borderColor: changed ? t.colors.accentText : t.colors.border,
        backgroundColor: pressed ? t.colors.bgHover : t.colors.bg,
      })}
    >
      <Text numberOfLines={1} style={{ fontFamily: t.fonts.mono, fontSize: 12, color: tone }}>
        {label}
      </Text>
    </Pressable>
  );
}
```

```tsx:src/components/ui/Tabs.tsx
import React from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { useTheme } from '../../design/theme';

export type TabItem<K extends string> = { key: K; label: string };

/** mock の .tabs / .tab（32 高 pill、選択中は accent-text の枠と文字） */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      style={{ flexGrow: 0, marginBottom: t.space.md }}
      contentContainerStyle={{ gap: 6, paddingBottom: t.space.xs }}
    >
      {items.map((it) => {
        const selected = it.key === value;
        return (
          <Pressable
            key={it.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(it.key)}
            style={({ pressed }) => ({
              height: 32,
              paddingHorizontal: t.space.md,
              borderRadius: t.radius.pill,
              borderWidth: 1,
              borderColor: selected ? t.colors.accentText : t.colors.border,
              backgroundColor: pressed ? t.colors.bgHover : t.colors.bgElevated,
              justifyContent: 'center',
            })}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '600',
                fontFamily: t.fonts.body,
                color: selected ? t.colors.accentText : t.colors.fgMuted,
              }}
            >
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
```

```tsx:src/components/ui/Toggle.tsx
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../../design/theme';

/** mock の .switch（44×26、ON で accent、つまみ 20px が 18px 移動） */
export function Toggle({
  value,
  onChange,
  label,
  testID,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={9}
      style={{
        width: 44,
        height: 26,
        borderRadius: t.radius.pill,
        backgroundColor: value ? t.colors.accent : t.colors.borderStrong,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 3,
          left: 3,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: t.colors.bgElevated,
          transform: [{ translateX: value ? 18 : 0 }],
          ...t.shadow(1),
        }}
      />
    </Pressable>
  );
}
```

```tsx:src/components/ui/ScreenHeader.tsx
import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../design/theme';
import { Status, StatusDot } from './Badge';
import { IconButton } from './IconButton';

export type HeaderAction = { glyph: string; label: string; onPress?: () => void; testID?: string };

export type ScreenHeaderProps = {
  /** page: セリフ 22px の .page-title / conversation: 17px + サブ行の .header-title */
  variant?: 'page' | 'conversation';
  title: string;
  subtitle?: string;
  subtitleStatus?: Status;
  left?: HeaderAction;
  right?: HeaderAction | React.ReactNode;
};

function isAction(v: unknown): v is HeaderAction {
  return !!v && typeof v === 'object' && 'glyph' in (v as object) && 'label' in (v as object);
}

/** mock の .header（56 高、border-bottom、左右 4px） */
export function ScreenHeader({ variant = 'page', title, subtitle, subtitleStatus, left, right }: ScreenHeaderProps) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="header"
      style={{
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.xs,
        paddingHorizontal: t.space.xs,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.border,
        backgroundColor: t.colors.bg,
      }}
    >
      {left ? <IconButton {...left} /> : <View style={{ width: t.space.md }} />}
      {variant === 'page' ? (
        <Text numberOfLines={1} style={[t.type.pageTitle, { flex: 1 }]}>
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[t.type.title, { lineHeight: 22 }]}>
            {title}
          </Text>
          {subtitle ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {subtitleStatus ? <StatusDot status={subtitleStatus} /> : null}
              <Text numberOfLines={1} style={t.type.caption}>
                {subtitle}
              </Text>
            </View>
          ) : null}
        </View>
      )}
      {isAction(right) ? <IconButton {...right} /> : (right as React.ReactNode) ?? null}
    </View>
  );
}
```

```tsx:src/components/ui/ScreenShell.tsx
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
```

```tsx:src/components/ui/Toast.tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { useTheme } from '../../design/theme';
import { useSafeInsets } from './safeArea';

type ToastApi = { show: (message: string) => void };

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/** mock の .toast（下から 48px、fg-strong 地の pill、1.8 秒、0.2 秒フェード） */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeInsets();
  const [message, setMessage] = useState<string | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (msg: string) => {
      setMessage(msg);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      }, 1800);
    },
    [anim],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      <View style={{ flex: 1 }}>
        {children}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 0, right: 0, bottom: t.space['2xl'] + insets.bottom, alignItems: 'center' }}
        >
          {message ? (
            <Animated.View
              