/**
 * モバイル共通トークン。見た目は Claude のアプリに合わせる:
 * 暖かいオフホワイトの地に、落ち着いた濃い茶系の文字を置き、色は控えめなテラコッタ (accent) を
 * 主な操作 (送信・主ボタン) とリンクにだけ使う。線や面はベージュ寄りの淡いグレーの濃淡で組む。
 * ナビゲーションドロワーだけ一段沈んだ地 (bgSidebar) にして、本文と分ける。
 *
 * 互換のため、トークン名は従来 (暗い配色のころ) のまま使う。
 *   - fg 系 … 文字 (濃い色)。fg を塗りに使うところ (チェック・バッジ等) は「濃い塗り + bg の文字」になる
 *   - bg 系 … 地 (淡い色)
 */

export const colors = {
	bg: '#faf9f5', // 画面の地 (暖かいオフホワイト)
	bgSidebar: '#f0eee6', // ナビゲーションドロワーの地
	bgElevated: '#ffffff', // 入力欄の箱・カード
	bgInput: '#ffffff', // 1 行の入力欄
	bgHover: '#ebe8de', // 押したとき・自分の吹き出し
	border: '#e6e2d6',
	borderStrong: '#d6d1c3',

	fg: '#3d3929', // 本文
	fgStrong: '#1f1e1b', // 見出し
	fgMuted: '#5e5a4c',
	// プレースホルダ・補足。地 (bg) だけでなく、ドロワー (bgSidebar)・押したとき (bgHover) の上でも 4.5:1 を保つ
	fgFaint: '#6b6654',

	// 控えめなテラコッタ。主な操作の塗りと、リンク・印の文字色に使う
	accent: '#b95a3a', // 白文字を載せて 4.5:1 以上
	accentPressed: '#a24f30',
	/** accent の塗りの上に置く文字・アイコン */
	onAccent: '#ffffff',
	accentText: '#b5532f',

	success: '#2f7d4f',
	warning: '#9c610c', // 「確認待ち」のドット (淡い地でも読める濃さ)
	/** warning の薄い地 (注意の帯・札) の上に置く文字。warning のままだと 4.5:1 に届かない */
	warningText: '#85530a',
	danger: '#b3261e',
	running: '#3b6db3', // 「作業中」の印

	/** ドロワーの後ろの半透明の地 */
	scrim: 'rgba(31, 30, 27, 0.32)',
	/** トースト等の影 */
	shadow: '#3d3929',
} as const;

/** `#rrggbb` に透明度を足す (デスクトップの `${color}22` と同じ書き方)。 */
export const withAlpha = (hex: string, alpha: string): string =>
	/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex;

const channels = (hex: string): [number, number, number] =>
	[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

const luminance = (hex: string): number => {
	const [r, g, b] = channels(hex).map(v => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG のコントラスト比 (`#rrggbb` どうし)。 */
export const contrastRatio = (a: string, b: string): number => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

const inkCache = new Map<string, string>();

/**
 * 鮮やかな色 (カンバンの優先度・ラベルなど、デスクトップと揃えた色) を小さな文字に使うための濃い色。
 * 色みは残したまま、淡い地の上で 4.5:1 に届くまで見出しの色 (fgStrong) へ寄せる。
 * 点や薄い地には元の色をそのまま使い、文字にだけこれを使う。
 */
export const inkOf = (hex: string, background: string = colors.bg): string => {
	if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
	const key = `${hex}|${background}`;
	const cached = inkCache.get(key);
	if (cached) return cached;
	const from = channels(hex);
	const to = channels(colors.fgStrong);
	let ink = hex;
	for (let step = 0; step <= 20 && contrastRatio(ink, background) < 4.5; step++) {
		const t = step / 20;
		ink = `#${from.map((v, i) => Math.round(v + (to[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
	}
	inkCache.set(key, ink);
	return ink;
};

export const spacing = {
	xs: 4,
	sm: 8,
	md: 12,
	lg: 16,
	xl: 24,
} as const;

/** 角は Claude のアプリのように少し大きめに丸める。 */
export const radius = {
	sm: 8,
	md: 12,
	lg: 16,
} as const;

export const fontSize = {
	xs: 12,
	sm: 15,
	md: 17,
	lg: 22,
	xl: 30,
} as const;
