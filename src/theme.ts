/**
 * モバイル共通トークン。見た目は ChatGPT のアプリに合わせる:
 * 無彩色のグレーの濃淡 (地・入力欄・線) で組み、色は状態の印とリンクくらいにしか使わない。
 * 左のナビゲーションレールだけ一段暗い地 (bgSidebar) にして、本文と分ける。
 */

export const colors = {
	bg: '#212121', // 画面の地
	bgSidebar: '#171717', // ナビゲーションレール・ドロワーの地
	bgElevated: '#2f2f2f', // 入力欄の箱・カンバンのカード
	bgInput: '#2a2a2a', // 1 行の入力欄
	bgHover: '#3a3a3a', // 押したとき・自分の吹き出し
	border: '#333333',
	borderStrong: '#424242',

	fg: '#ececec',
	fgStrong: '#ffffff',
	fgMuted: '#b4b4b4',
	fgFaint: '#8e8e8e',

	// 色はほぼ使わず、リンクや稼働中の印だけ青にする
	accentText: '#7ab7ff',

	success: '#4ade80',
	warning: '#facc15', // 「確認待ち」のドット
	danger: '#f87171',
	running: '#7ab7ff', // 「作業中」の印
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
