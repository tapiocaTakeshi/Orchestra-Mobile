/** アプリ全体の色とスペーシング。Orchestra IDE のダークテーマに、ブランドの Orchestra Red アクセントを合わせている。 */

export const colors = {
	bg: '#0c0d10',
	bgElevated: '#17191e',
	bgInput: '#111216',
	border: '#2a2d35',
	borderStrong: '#444852',

	fg: '#e6edf3',
	fgMuted: '#9aa7b4',
	fgFaint: '#9299a6',

	// Orchestra ブランドロゴのクリムゾンレッド（brand-500 / brand-600）
	accent: '#e02431',
	accentPressed: '#c4182a',
	accentSoft: '#32171e',
	accentText: '#ff7c87',
	success: '#10b981',
	warning: '#f59e0b',
	danger: '#ef4444',

	// エージェント実行中を示すハイライト
	running: '#a855f7',
} as const;

export const spacing = {
	xs: 4,
	sm: 8,
	md: 12,
	lg: 16,
	xl: 24,
} as const;

export const radius = {
	sm: 12,
	md: 18,
	lg: 24,
} as const;

export const fontSize = {
	xs: 12,
	sm: 15,
	md: 17,
	lg: 22,
	xl: 30,
} as const;

