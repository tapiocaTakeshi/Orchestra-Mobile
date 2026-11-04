import { Platform, useColorScheme, ViewStyle } from 'react-native';

/**
 * .division/design/index.html の :root をそのまま移植したデザイントークン。
 * CSS 変数名 → camelCase（--color-bg-sidebar → bgSidebar）。値は変更しないこと。
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

export type ColorTokens = { [K in keyof typeof lightColors]: string };

/** orchestra-mobile-mockup.html の prefers-color-scheme: dark の値 */
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

/** モックアップの .avatar / .logo 背景にあるリテラル rgba(185,90,58,.12) */
export const accentSoft = 'rgba(185,90,58,.12)';

/** --font-body / --font-serif / --font-mono をネイティブのフォント名に対応付け */
export const fonts = {
  body: Platform.select({ ios: 'System', android: 'sans-serif', default: undefined }) as string | undefined,
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' }) as string,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'Menlo' }) as string,
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 48, '3xl': 64 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** モックアップで使われている文字サイズだけ（11px 未満は使わない） */
export const fontSize = { caption: 12, small: 13, body: 15, title: 17, page: 22, display: 30 } as const;

export const lineHeight = { caption: 18, small: 18, body: 22, bodyLoose: 23, title: 24, page: 29, display: 38 } as const;

/** 画面寸法の基準（390×844 を基準幅とする） */
export const layout = {
  baseWidth: 390,
  header: 56,
  hit: 44,
  drawerWidth: 300,
  composerMaxHeight: 160,
} as const;

type ShadowLevel = 1 | 2 | 3;

/** --shadow-1/2/3 をネイティブの影に換算 */
export function shadow(level: ShadowLevel, color: string): ViewStyle {
  switch (level) {
    case 1:
      return { shadowColor: color, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 1, elevation: 1 };
    case 2:
      return { shadowColor: color, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 5, elevation: 3 };
    case 3:
    default:
      return { shadowColor: color, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 14, elevation: 12 };
  }
}

export type Theme = {
  scheme: 'light' | 'dark';
  colors: ColorTokens;
};

export function getTheme(scheme: 'light' | 'dark' | null | undefined): Theme {
  return scheme === 'dark' ? { scheme: 'dark', colors: darkColors } : { scheme: 'light', colors: lightColors };
}

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return getTheme(scheme);
}

export type StatusKind = 'running' | 'warning' | 'success' | 'danger';
