/**
 * モバイル共通トークン。色はデスクトップ Orchestra の既定テーマ「Orchestra Dark」
 * (extensions/theme-orchestra) の値を使い、右のコメントに元の VS Code 色キーを書いている。
 * 見た目は Claude Code のように飾りを減らす方針: 地・線・文字の濃淡で組み、色は状態の印くらいにしか使わない。
 */

export const colors = {
	bg: '#0e0c0b', // editor.background — 画面の地
	bgElevated: '#131110', // sideBar.background — 入力欄の箱・カンバンのカード
	bgInput: '#1a1716', // input.background — 1 行の入力欄
	bgHover: '#24201e', // list.hoverBackground / button.secondaryBackground
	border: '#262120', // sideBar.border / editorGroup.border
	borderStrong: '#3a3330', // input.border

	fg: '#ece6de', // editor.foreground
	fgStrong: '#f7f2ea', // tab.activeForeground
	fgMuted: '#bdb3a8', // sideBar.foreground
	fgFaint: '#877c72', // input.placeholderForeground / tab.inactiveForeground

	// 色はほぼ使わず、リンクや稼働中の印だけゴールドにする
	accentText: '#c6a769', // textLink.foreground

	success: '#89d185', // charts.green (デスクトップの状態ドット)
	warning: '#cca700', // charts.yellow (= --void-warning、「確認待ち」のドット)
	danger: '#f87171',
	running: '#c6a769', // 「作業中」の印
} as const;

/** `#rrggbb` に透明度を足す (デスクトップの `${color}22` と同じ書き方)。 */
export const withAlpha = (hex: string, alpha: string): string =>
	/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex;

export const spacing = {
	xs: 4,
	sm: 8,
	md: 12,
	lg: 16,
	xl: 24,
} as const;

/** デスクトップの rounded-md (6) / rounded-lg (8) / rounded-xl (12) に揃える。 */
export const radius = {
	sm: 6,
	md: 8,
	lg: 12,
} as const;

export const fontSize = {
	xs: 12,
	sm: 15,
	md: 17,
	lg: 22,
	xl: 30,
} as const;
