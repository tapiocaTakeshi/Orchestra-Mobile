/**
 * チューニング (コスト) タブの計算まわり。ネットワークにも UI にも依存しない。
 *
 * 方針の妥当性チェックは IDE 側 AutoRouting.tsx と同じ条件に揃えてある。
 * 食い違うと「IDE では保存できるのにアプリでは弾かれる」といった事故になる。
 */

import { RoutingHistoryItem, RoutingPolicy, RoutingQuote } from './divisionRouting';

// ---------------------------------------------------------------------------
// 方針の検証
// ---------------------------------------------------------------------------

export const POLICY_LIMITS = {
	minPerformance: { min: 0, max: 100 },
	maxCostUsd: { min: 0.000001, max: 100 },
	maxOutputTokens: { min: 256, max: 32768 },
} as const;

export type PolicyIssue = { field: keyof RoutingPolicy; message: string };

export const validatePolicy = (policy: RoutingPolicy): PolicyIssue[] => {
	const issues: PolicyIssue[] = [];
	const { minPerformance, maxCostUsd, maxOutputTokens } = policy;

	if (!Number.isFinite(minPerformance) || minPerformance < 0 || minPerformance > 100) {
		issues.push({ field: 'minPerformance', message: '最低性能スコアは 0〜100 で入力してください。' });
	}
	if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 100) {
		issues.push({ field: 'maxCostUsd', message: '1 回あたりの上限は 0 より大きく 100 USD 以下にしてください。' });
	}
	if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 32768) {
		issues.push({ field: 'maxOutputTokens', message: '最大出力トークンは 256〜32768 の整数にしてください。' });
	}
	return issues;
};

export const isPolicyValid = (policy: RoutingPolicy): boolean => validatePolicy(policy).length === 0;

/** 入力トークン数の入力欄の検証 (IDE 側と同じ 0〜2,000,000 の整数)。 */
export const isInputTokensValid = (value: number): boolean =>
	Number.isInteger(value) && value >= 0 && value <= 2_000_000;

/**
 * 依頼文からのざっくりしたトークン数。見積もりの初期値に使うだけで、
 * 実際の課金は Division API 側の実測値による。
 * 日本語などの全角文字は 1 文字 ≒ 1 トークン、それ以外は 4 文字 ≒ 1 トークンとみなす。
 */
export const estimateInputTokens = (text: string): number => {
	if (!text) return 0;
	let wide = 0;
	let narrow = 0;
	for (const char of text) {
		// 全角・かな・漢字・ハングルなどは 1 文字で 1 トークン相当として数える。
		if (char.charCodeAt(0) > 0x3000) wide += 1;
		else narrow += 1;
	}
	return Math.max(1, Math.round(wide + narrow / 4));
};

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

export const formatUsd = (value: number, digits = 6): string => {
	if (!Number.isFinite(value)) return '—';
	return `$${value.toFixed(digits)}`;
};

/** 残高など、桁が大きいものは 2 桁で十分。 */
export const formatUsdShort = (value: number): string => formatUsd(value, 2);

export const formatTokens = (value: number): string =>
	Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';

/** 日付だけの文字列 (YYYY-MM-DD)。集計のキーに使う。 */
export const dayKey = (iso: string): string => {
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return '—';
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
};

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

export type CostTotals = {
	count: number;
	inputTokens: number;
	outputTokens: number;
	totalCostUsd: number;
	/** 見積もりが記録されている分だけの合計 */
	estimateUsd: number;
	/** 見積もりが記録されている件数 */
	estimatedCount: number;
	/** 見積もりが記録されている分の、実測料金の合計 (見積もりと突き合わせる相手) */
	estimatedActualUsd: number;
};

export const emptyTotals = (): CostTotals => ({
	count: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0, estimateUsd: 0, estimatedCount: 0, estimatedActualUsd: 0,
});

export const sumHistory = (items: RoutingHistoryItem[]): CostTotals =>
	items.reduce<CostTotals>((acc, item) => {
		const estimated = item.estimateUsd !== undefined;
		return {
			count: acc.count + 1,
			inputTokens: acc.inputTokens + item.inputTokens,
			outputTokens: acc.outputTokens + item.outputTokens,
			totalCostUsd: acc.totalCostUsd + item.totalCostUsd,
			estimateUsd: acc.estimateUsd + (item.estimateUsd ?? 0),
			estimatedCount: acc.estimatedCount + (estimated ? 1 : 0),
			estimatedActualUsd: acc.estimatedActualUsd + (estimated ? item.totalCostUsd : 0),
		};
	}, emptyTotals());

export type CostGroup = { key: string; label: string; totals: CostTotals };

const groupBy = (
	items: RoutingHistoryItem[],
	keyOf: (item: RoutingHistoryItem) => string,
	labelOf: (key: string) => string = k => k,
): CostGroup[] => {
	const buckets = new Map<string, RoutingHistoryItem[]>();
	for (const item of items) {
		const key = keyOf(item) || '—';
		const bucket = buckets.get(key);
		if (bucket) bucket.push(item);
		else buckets.set(key, [item]);
	}
	return [...buckets.entries()]
		.map(([key, group]) => ({ key, label: labelOf(key), totals: sumHistory(group) }))
		.sort((a, b) => b.totals.totalCostUsd - a.totals.totalCostUsd);
};

export const byModel = (items: RoutingHistoryItem[]): CostGroup[] => groupBy(items, i => i.modelId);

export const byRole = (items: RoutingHistoryItem[]): CostGroup[] => groupBy(items, i => i.role);

/** 日ごとの合計。グラフではなく一覧で出すので、新しい日付が先。 */
export const byDay = (items: RoutingHistoryItem[]): CostGroup[] =>
	groupBy(items, i => dayKey(i.createdAt)).sort((a, b) => b.key.localeCompare(a.key));

/**
 * 見積もりと実測の差。プラスなら見積もりより高くついている。
 * 見積もりが残っていない実行 (古い履歴) を混ぜると比較にならないので、
 * 両方が揃っている分だけで突き合わせる。
 */
export const estimateDrift = (totals: CostTotals): number | null => {
	if (totals.estimatedCount === 0) return null;
	return totals.estimatedActualUsd - totals.estimateUsd;
};

// ---------------------------------------------------------------------------
// 見積もり結果の判定
// ---------------------------------------------------------------------------

export const quoteTotalUsd = (quotes: RoutingQuote[]): number =>
	quotes.reduce((sum, q) => sum + q.totalCostUsd, 0);

/** 方針に収まっていない見積もり。UI で赤く出す。 */
export const quoteViolations = (quotes: RoutingQuote[], policy: RoutingPolicy): Record<string, string> => {
	const result: Record<string, string> = {};
	for (const quote of quotes) {
		if (quote.totalCostUsd > policy.maxCostUsd) {
			result[quote.role] = `1 回あたりの上限 ${formatUsd(policy.maxCostUsd)} を超えています`;
		} else if (quote.performance < policy.minPerformance) {
			result[quote.role] = `最低性能スコア ${policy.minPerformance} を下回っています`;
		}
	}
	return result;
};

/** 残高が今のペースであと何回分もつか。0 除算を避けて null を返す。 */
export const remainingRuns = (creditBalanceUsd: number, averageCostUsd: number): number | null => {
	if (!(averageCostUsd > 0) || !Number.isFinite(creditBalanceUsd)) return null;
	return Math.floor(creditBalanceUsd / averageCostUsd);
};

export const averageCost = (totals: CostTotals): number =>
	totals.count === 0 ? 0 : totals.totalCostUsd / totals.count;
