/** Desktop Orchestra の Modern UI に合わせた、モバイル共通トークン。 */

export const colors = {
	bg: '#0b0f1a',
	bgElevated: '#131a2c',
	bgInput: '#0f1424',
	border: '#1f2740',
	borderStrong: '#33405f',

	fg: '#e8ecf6',
	fgMuted: '#9aa3b8',
	fgFaint: '#6f7b96',

	// Desktop Modern UI brand tokens
	accent: '#3b6bff',
	accentPressed: '#2a52e6',
	accentSoft: '#172653',
	accentText: '#8aaeff',
	success: '#10b981',
	warning: '#f59e0b',
	danger: '#ef4444',
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
