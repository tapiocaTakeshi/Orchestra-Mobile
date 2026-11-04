import { Platform } from 'react-native';

/**
 * .division/design/index.html の :root と同じ名前・同じ値。
 * 独自の色は追加しない（accentTint のみモックアップ .avatar の rgba をそのまま転記）。
 */
export const color = {
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
  accentTint: 'rgba(185,90,58,.12)',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 48, xxxl: 64 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const font = {
  body: Platform.select({ ios: undefined, android: undefined, default: undefined }),
  serif: Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'Menlo' }),
};

export const shadow = {
  s1: { shadowColor: color.shadow, shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  s2: { shadowColor: color.shadow, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  s3: { shadowColor: color.shadow, shadowOpacity: 0.12, shadowRadius: 28, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
} as const;
