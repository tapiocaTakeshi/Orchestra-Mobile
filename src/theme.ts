/** アプリ全体の色とスペーシング。Orchestra IDE のダークテーマに寄せている。 */

export const colors = {
	bg: '#0d1117',
	bgElevated: '#151b23',
	bgInput: '#0b0f14',
	border: '#232b36',
	borderStrong: '#313b48',

	fg: '#e6edf3',
	fgMuted: '#9aa7b4',
	fgFaint: '#6b7885',

	accent: '#3b82f6',
	accentPressed: '#2563eb',
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
	sm: 6,
	md: 10,
	lg: 14,
} as const;

export const fontSize = {
	xs: 11,
	sm: 13,
	md: 15,
	lg: 18,
	xl: 22,
} as const;
