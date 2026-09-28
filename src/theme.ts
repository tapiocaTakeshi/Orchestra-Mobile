/**
 * デスクトップ Orchestra の既定テーマ「Orchestra Dark」(extensions/theme-orchestra) に合わせた、
 * モバイル共通トークン。値はテーマの VS Code 色キーから取っている (右のコメント)。
 */

export const colors = {
	bg: '#0e0c0b', // editor.background — 画面の地
	bgElevated: '#131110', // sideBar / titleBar.background — ヘッダー・タブバー・カード
	bgInput: '#1a1716', // input.background — 入力欄・カンバンのカード
	bgHover: '#24201e', // list.hoverBackground / button.secondaryBackground
	border: '#262120', // sideBar.border / editorGroup.border
	borderStrong: '#3a3330', // input.border

	fg: '#ece6de', // editor.foreground
	fgStrong: '#f7f2ea', // tab.activeForeground
	fgMuted: '#bdb3a8', // sideBar.foreground
	fgFaint: '#877c72', // input.placeholderForeground / tab.inactiveForeground

	// 主ボタンはロゴのクリムゾン、選択・フォーカス・リンクはゴールド
	accent: '#8f1d2c', // button.background
	accentPressed: '#a5263a', // button.hoverBackground
	accentFg: '#fbf6ee', // button.foreground
	accentText: '#c6a769', // textLink.foreground / activityBar.activeBorder
	accentSoft: '#c6a7691f', // list.activeSelectionBackground
	focus: '#c6a769b3', // focusBorder
	selectedBorder: '#c6a76999', // inputOption.activeBorder

	// ログイン画面だけは、デスクトップのログインと同じ明るい赤
	brand: '#dc2626',
	brandPressed: '#b91c1c',

	success: '#89d185', // charts.green (デスクトップの状態ドット)
	warning: '#cca700', // charts.yellow (= --void-warning、「確認待ち」のドット)
	danger: '#f87171',
	running: '#c6a769', // 生成中のカードの枠と同じゴールド
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
