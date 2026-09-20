import { RoutingHistoryItem, RoutingQuote } from '../divisionRouting';
import {
	averageCost,
	byDay,
	byModel,
	byRole,
	dayKey,
	estimateDrift,
	estimateInputTokens,
	formatTokens,
	formatUsd,
	isInputTokensValid,
	quoteTotalUsd,
	quoteViolations,
	remainingRuns,
	sumHistory,
	validatePolicy,
} from '../tuning';

const item = (overrides: Partial<RoutingHistoryItem> & { id: string }): RoutingHistoryItem => ({
	createdAt: '2026-09-01T09:00:00.000Z',
	role: 'coder',
	modelId: 'claude-sonnet-5',
	inputTokens: 1000,
	outputTokens: 100,
	totalCostUsd: 0.01,
	...overrides,
});

const quote = (overrides: Partial<RoutingQuote> & { role: string }): RoutingQuote => ({
	model: 'gpt-5.4-mini',
	performance: 80,
	performanceSource: 'registry',
	inputTokens: 2000,
	outputTokens: 500,
	totalCostUsd: 0.01,
	...overrides,
});

describe('validatePolicy', () => {
	it('既定値は通る', () => {
		expect(validatePolicy({ minPerformance: 70, maxCostUsd: 0.05, maxOutputTokens: 4096 })).toEqual([]);
	});

	it('IDE 側と同じ範囲で弾く', () => {
		const issues = validatePolicy({ minPerformance: 101, maxCostUsd: 0, maxOutputTokens: 100 });
		expect(issues.map(i => i.field).sort()).toEqual(['maxCostUsd', 'maxOutputTokens', 'minPerformance']);
	});

	it('出力トークンは整数のみ', () => {
		const issues = validatePolicy({ minPerformance: 70, maxCostUsd: 0.05, maxOutputTokens: 4096.5 });
		expect(issues).toHaveLength(1);
		expect(issues[0].field).toBe('maxOutputTokens');
	});

	it('数値でない入力 (空欄など) も弾く', () => {
		const issues = validatePolicy({ minPerformance: NaN, maxCostUsd: NaN, maxOutputTokens: NaN });
		expect(issues).toHaveLength(3);
	});
});

describe('入力トークンの概算', () => {
	it('英文はおよそ 4 文字で 1 トークン', () => {
		expect(estimateInputTokens('abcd'.repeat(10))).toBe(10);
	});

	it('日本語は 1 文字で 1 トークン相当', () => {
		expect(estimateInputTokens('あいうえお')).toBe(5);
	});

	it('空文字は 0、何かあれば最低 1', () => {
		expect(estimateInputTokens('')).toBe(0);
		expect(estimateInputTokens('a')).toBe(1);
	});

	it('入力欄の範囲は 0〜2,000,000 の整数', () => {
		expect(isInputTokensValid(0)).toBe(true);
		expect(isInputTokensValid(2_000_000)).toBe(true);
		expect(isInputTokensValid(2_000_001)).toBe(false);
		expect(isInputTokensValid(1.5)).toBe(false);
		expect(isInputTokensValid(-1)).toBe(false);
	});
});

describe('集計', () => {
	const history = [
		item({ id: '1', role: 'coder', modelId: 'claude-sonnet-5', totalCostUsd: 0.03, estimateUsd: 0.02, createdAt: '2026-09-01T09:00:00.000Z' }),
		item({ id: '2', role: 'review', modelId: 'gpt-5.4', totalCostUsd: 0.01, createdAt: '2026-09-01T23:00:00.000Z' }),
		item({ id: '3', role: 'coder', modelId: 'claude-sonnet-5', totalCostUsd: 0.02, estimateUsd: 0.03, createdAt: '2026-09-02T09:00:00.000Z' }),
	];

	it('合計と平均を出す', () => {
		const totals = sumHistory(history);
		expect(totals.count).toBe(3);
		expect(totals.totalCostUsd).toBeCloseTo(0.06);
		expect(totals.inputTokens).toBe(3000);
		expect(totals.estimatedCount).toBe(2);
		expect(averageCost(totals)).toBeCloseTo(0.02);
	});

	it('記録が無ければ平均は 0', () => {
		expect(averageCost(sumHistory([]))).toBe(0);
	});

	it('見積もりとの差は、見積もりのある分だけで比べる', () => {
		// 実測 0.03 + 0.02 に対して見積もり 0.02 + 0.03 → 差はゼロ
		expect(estimateDrift(sumHistory(history))).toBeCloseTo(0);
		expect(estimateDrift(sumHistory([item({ id: 'x' })]))).toBeNull();
	});

	it('モデル別・役割別は金額の大きい順', () => {
		expect(byModel(history).map(g => g.key)).toEqual(['claude-sonnet-5', 'gpt-5.4']);
		expect(byRole(history).map(g => g.key)).toEqual(['coder', 'review']);
		expect(byModel(history)[0].totals.totalCostUsd).toBeCloseTo(0.05);
	});

	it('日別は新しい日が先', () => {
		expect(byDay(history).map(g => g.key)).toEqual(['2026-09-02', '2026-09-01']);
	});

	it('日付にならない値は — にまとめる', () => {
		expect(dayKey('not-a-date')).toBe('—');
	});
});

describe('見積もりの判定', () => {
	const policy = { minPerformance: 70, maxCostUsd: 0.05, maxOutputTokens: 4096 };

	it('合計を出す', () => {
		expect(quoteTotalUsd([quote({ role: 'leader' }), quote({ role: 'coder', totalCostUsd: 0.02 })])).toBeCloseTo(0.03);
	});

	it('上限超過と性能不足を見つける', () => {
		const violations = quoteViolations([
			quote({ role: 'leader' }),
			quote({ role: 'coder', totalCostUsd: 0.2 }),
			quote({ role: 'review', performance: 10 }),
		], policy);
		expect(violations.leader).toBeUndefined();
		expect(violations.coder).toContain('上限');
		expect(violations.review).toContain('性能');
	});
});

describe('残高の目安', () => {
	it('平均単価で割る', () => {
		expect(remainingRuns(1, 0.02)).toBe(50);
	});

	it('平均が 0 なら出さない', () => {
		expect(remainingRuns(1, 0)).toBeNull();
	});
});

describe('表示の整形', () => {
	it('USD は既定で 6 桁', () => {
		expect(formatUsd(0.012345678)).toBe('$0.012346');
		expect(formatUsd(1.5, 2)).toBe('$1.50');
		expect(formatUsd(Number.NaN)).toBe('—');
	});

	it('トークン数は桁区切り', () => {
		expect(formatTokens(1234567)).toBe('1,234,567');
	});
});
