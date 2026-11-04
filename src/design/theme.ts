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
