import { darkColors, getTheme, lightColors, radius, space, fontSize } from '../tokens';

describe('design tokens (.division/design/index.html :root)', () => {
  it('ライト配色がモックアップの値と一致する', () => {
    expect(lightColors).toMatchObject({
      bg: '#faf9f5',
      bgSidebar: '#f0eee6',
      bgElevated: '#ffffff',
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
    });
  });

  it('ダーク配色はライトと同じキーを持つ', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
    expect(darkColors.bg).toBe('#1f1e1b');
    expect(darkColors.accent).toBe('#d07855');
  });

  it('余白・角丸・文字サイズがモックアップと一致する', () => {
    expect(space).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 48, '3xl': 64 });
    expect(radius).toEqual({ sm: 8, md: 12, lg: 16, xl: 24, pill: 999 });
    Object.values(fontSize).forEach((v) => expect(v).toBeGreaterThanOrEqual(11));
  });

  it('getTheme は scheme に応じて色を切り替える', () => {
    expect(getTheme('dark').colors).toBe(darkColors);
    expect(getTheme('light').colors).toBe(lightColors);
    expect(getTheme(null).colors).toBe(lightColors);
  });
});
