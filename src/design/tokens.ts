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

/* ---- 画面コードから使う静的エイリアス（ライトテーマ固定。動的テーマは design/theme の useTheme を使う） ---- */

/** ライトテーマの色 + accentSoft */
export const colors = { ...lightColors, accentSoft } as const;
/** colors の別名 */
export const color = colors;

/** モックアップで使われている文字サイズ */
export const fontSize = { caption: 12, small: 13, body: 15, title: 17, page: 22, display: 30 } as const;

function nativeShadow(level: ShadowLevel) {
  const s = shadowSpec[level];
  return {
    shadowColor: lightColors.shadow,
    shadowOffset: { width: 0, height: s.y },
    shadowOpacity: s.opacity,
    shadowRadius: s.blur / 2,
    elevation: level === 1 ? 1 : level === 2 ? 3 : 8,
  };
}

/** --shadow-1..3 のネイティブ影（shadow[1] / shadows.s1 のどちらでも参照可） */
export const shadow = { 1: nativeShadow(1), 2: nativeShadow(2), 3: nativeShadow(3) } as const;
export const shadows = { s1: shadow[1], s2: shadow[2], s3: shadow[3] } as const;

function colorVars(c: ColorTokens): Record<string, string> {
  const out: Record<string, string> = {};
  (Object.keys(c) as ColorName[]).forEach((k) => {
    out[cssVarOf(k)] = c[k];
  });
  return out;
}

/** DESIGN.html / index.html の :root と同じ CSS 変数一覧 */
export const cssTokens: Record<string, string> = {
  ...colorVars(lightColors),
  '--font-body': fontStacks.body,
  '--font-serif': fontStacks.serif,
  '--font-mono': fontStacks.mono,
  ...Object.fromEntries(Object.entries(space).map(([k, v]) => ['--space-' + k, v + 'px'])),
  ...Object.fromEntries(Object.entries(radius).map(([k, v]) => ['--radius-' + k, v + 'px'])),
  '--shadow-1': shadowSpec[1].css,
  '--shadow-2': shadowSpec[2].css,
  '--shadow-3': shadowSpec[3].css,
};

/** ダークテーマの色の CSS 変数 */
export const darkCssTokens: Record<string, string> = colorVars(darkColors);
