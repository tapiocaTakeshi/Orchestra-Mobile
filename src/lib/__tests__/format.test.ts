import { durationText, oneLine, providerTitle, relativeTime, relativeTimeFromIso, roleTitle } from '../format';

const NOW = Date.parse('2026-02-01T12:00:00Z');

describe('relativeTime', () => {
	it('describes recent and older timestamps', () => {
		expect(relativeTime(NOW - 10_000, NOW)).toBe('たった今');
		expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分前');
		expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 時間前');
		expect(relativeTime(NOW - 4 * 86_400_000, NOW)).toBe('4 日前');
	});

	it('handles missing and future timestamps', () => {
		expect(relativeTime(null, NOW)).toBe('—');
		expect(relativeTime(0, NOW)).toBe('—');
		expect(relativeTime(NOW + 60_000, NOW)).toBe('まもなく');
	});

	it('parses ISO strings and rejects garbage', () => {
		expect(relativeTimeFromIso('2026-02-01T11:30:00Z', NOW)).toBe('30 分前');
		expect(relativeTimeFromIso('nonsense', NOW)).toBe('—');
	});
});

describe('durationText', () => {
	it('formats seconds, minutes and hours', () => {
		expect(durationText(4_000)).toBe('4 秒');
		expect(durationText(125_000)).toBe('2 分 5 秒');
		expect(durationText(3_600_000 + 600_000)).toBe('1 時間 10 分');
		expect(durationText(-1)).toBe('—');
	});
});

describe('oneLine', () => {
	it('collapses whitespace and truncates', () => {
		expect(oneLine('  hello\n\n  world  ')).toBe('hello world');
		expect(oneLine('abcdefghij', 5)).toBe('abcd…');
	});
});

describe('display names', () => {
	it('maps known providers and roles, passing through unknown ones', () => {
		expect(providerTitle('openAI')).toBe('OpenAI');
		expect(providerTitle('somethingNew')).toBe('somethingNew');
		expect(roleTitle('coder')).toBe('コーダー');
		expect(roleTitle('custom')).toBe('custom');
	});
});
