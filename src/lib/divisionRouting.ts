/**
 * Division API のルーティング (自動割り当て) API。
 *
 * IDE 側の AutoRouting.tsx と同じエンドポイントを叩く。
 *   POST /api/routing/quote   … Jev に出力トークン予算を判定させ、条件を満たす最安モデルを見積もる
 *   GET  /api/routing/history … モデル実行ごとの実測トークン数と料金
 *   POST /api/routing/project … プロンプトとエフォート・コスト・性能を Jev に送り、Division プロジェクトを作る
 * 認証はDivisionアカウントのSupabase JWTをBearerで渡す。
 */

import { DIVISION_API_BASE_URL } from './divisionAuthConfig';
import { DivisionSession, getDivisionAccessToken } from './divisionAuth';

/** ルーティングの方針。IDE の globalSettings.divisionAutoRouting と同じ形。 */
export type RoutingPolicy = {
	/** 0〜100。これ未満の性能スコアのモデルは選ばれない */
	minPerformance: number;
	/** 1 回のモデル呼び出しの上限 (USD) */
	maxCostUsd: number;
	/** Jev が割り当てられる最大出力トークン */
	maxOutputTokens: number;
};

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
	minPerformance: 70,
	maxCostUsd: 0.05,
	maxOutputTokens: 4096,
};

/** 見積もりを出す役割。IDE 側と同じ 3 つ。 */
export const QUOTE_ROLES = ['leader', 'coder', 'review'] as const;

export type RoutingBenchmark = {
	score: number;
	rawScore: number;
	metric: string;
	source: string;
	asOf: string | null;
	citation?: string | null;
	sourceUrl?: string | null;
};

export type RoutingQuote = {
	role: string;
	model: string;
	domain?: string;
	performance: number;
	performanceSource: string;
	benchmark?: RoutingBenchmark;
	inputTokens: number;
	outputTokens: number;
	totalCostUsd: number;
};

export type RoutingPlan = {
	allocator: 'jev';
	snapshotId: string;
	catalogUpdatedAt: string;
	quotes: RoutingQuote[];
	allocatorCostUsd: number;
	inferenceEstimateUsd: number;
	totalEstimateUsd: number;
	overallPerformance: {
		score: number;
		minimum: number;
		method: string;
		isEstimate: true;
		note: string;
	};
	scope: string;
};

export type RoutingHistoryItem = {
	id: string;
	createdAt: string;
	role: string;
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	totalCostUsd: number;
	requestGroupId?: string;
	estimateUsd?: number;
};

export type RoutingHistoryPage = {
	items: RoutingHistoryItem[];
	nextCursor: string | null;
	/** リクエスト単位 (同じ依頼の全記録) の合計 USD */
	groupTotals: Record<string, number>;
};

export class DivisionRoutingError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'DivisionRoutingError';
		this.status = status;
	}

	get userMessage(): string {
		switch (this.status) {
			case 0: return 'Division API に接続できません。通信環境を確認してください。';
			case 401:
				return 'DivisionのJWTが無効です。もう一度ログインしてください。';
			case 402: return 'クレジットが不足しています。管理タブからクレジットを確認してください。';
			case 403:
				return this.message.toLowerCase().includes('plus') || this.message.includes('有料')
					? 'この機能は有料プラン（Plus）が必要です。管理タブからプランを確認してください。'
					: 'このアカウントではこの機能を利用できません。';
			case 404: return 'この Division API はルーティング API に対応していません。';
			default: return this.message;
		}
	}
}

const num = (value: unknown, fallback = 0): number => {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
};

const request = async <T>(
	session: DivisionSession,
	path: string,
	options: { body?: unknown; endpoint?: string; timeoutMs?: number } = {},
): Promise<T> => {
	const accessToken = await getDivisionAccessToken(session).catch((error: unknown) => {
		throw new DivisionRoutingError(401, error instanceof Error ? error.message : String(error));
	});

	const base = (options.endpoint || DIVISION_API_BASE_URL).replace(/\/+$/, '');
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

	let response: Response;
	try {
		response = await fetch(`${base}/api/routing/${path}`, {
			method: options.body ? 'POST' : 'GET',
			headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
			...(options.body ? { body: JSON.stringify(options.body) } : {}),
			signal: controller.signal,
		});
	} catch (e) {
		throw new DivisionRoutingError(0, e instanceof Error ? e.message : String(e));
	} finally {
		clearTimeout(timer);
	}

	const data = (await response.json().catch(() => ({}))) as { error?: string };
	if (!response.ok) throw new DivisionRoutingError(response.status, data.error || `HTTP ${response.status}`);
	return data as T;
};

/** Jev に保存済みの料金・性能を渡し、分野・モデル・トークン配分を見積もる。 */
export const fetchRoutingPlan = async (
	session: DivisionSession,
	input: { input: string; inputTokens: number; policy: RoutingPolicy; roles?: readonly string[]; endpoint?: string },
): Promise<RoutingPlan> => {
	const data = await request<Record<string, unknown>>(session, 'quote', {
		endpoint: input.endpoint,
		body: {
			input: input.input,
			inputTokens: input.inputTokens,
			roles: input.roles ?? QUOTE_ROLES,
			policy: input.policy,
		},
	});

	const quotes = ((data.quotes as unknown[]) ?? []).map(raw => {
		const q = (raw ?? {}) as Record<string, unknown>;
		return {
			role: String(q.role ?? ''),
			model: String(q.model ?? ''),
			domain: String(q.domain ?? ''),
			performance: num(q.performance),
			performanceSource: String(q.performanceSource ?? ''),
			benchmark: q.benchmark && typeof q.benchmark === 'object' ? q.benchmark as RoutingBenchmark : undefined,
			inputTokens: num(q.inputTokens),
			outputTokens: num(q.outputTokens),
			totalCostUsd: num(q.totalCostUsd),
		};
	});
	const performance = (data.overallPerformance ?? {}) as Record<string, unknown>;
	return {
		allocator: 'jev',
		snapshotId: String(data.snapshotId ?? ''),
		catalogUpdatedAt: String(data.catalogUpdatedAt ?? ''),
		quotes,
		allocatorCostUsd: num(data.allocatorCostUsd),
		inferenceEstimateUsd: num(data.inferenceEstimateUsd, quotes.reduce((sum, q) => sum + q.totalCostUsd, 0)),
		totalEstimateUsd: num(data.totalEstimateUsd, quotes.reduce((sum, q) => sum + q.totalCostUsd, 0)),
		overallPerformance: {
			score: num(performance.score),
			minimum: num(performance.minimum),
			method: String(performance.method ?? ''),
			isEstimate: true,
			note: String(performance.note ?? ''),
		},
		scope: String(data.scope ?? ''),
	};
};

/** 旧呼び出し元向け。新しい画面では合計と性能を含む fetchRoutingPlan を使う。 */
export const fetchRoutingQuotes = async (...args: Parameters<typeof fetchRoutingPlan>): Promise<RoutingQuote[]> =>
	(await fetchRoutingPlan(...args)).quotes;

export const refreshRoutingCatalog = async (session: DivisionSession, endpoint?: string) => {
	const accessToken = await getDivisionAccessToken(session);
	const base = (endpoint || DIVISION_API_BASE_URL).replace(/\/+$/, '');
	const response = await fetch(`${base}/api/models/sync`, {
		method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
	});
	const data = await response.json().catch(() => ({})) as Record<string, unknown>;
	if (!response.ok) throw new DivisionRoutingError(response.status, String(data.error ?? `HTTP ${response.status}`));
	return data as { routingCatalog?: { snapshotId?: string; fetchedAt?: string; models?: number; domains?: string[] } };
};

export const fetchRoutingHistory = async (
	session: DivisionSession,
	options: { cursor?: string | null; endpoint?: string } = {},
): Promise<RoutingHistoryPage> => {
	const path = options.cursor ? `history?cursor=${encodeURIComponent(options.cursor)}` : 'history';
	const data = await request<{ items?: unknown[]; nextCursor?: string | null; groupTotals?: Record<string, unknown> }>(
		session, path, { endpoint: options.endpoint },
	);

	const items = (data.items ?? []).map(raw => {
		const h = (raw ?? {}) as Record<string, unknown>;
		const routing = (h.routingDetails ?? {}) as Record<string, unknown>;
		return {
			id: String(h.id ?? ''),
			createdAt: String(h.createdAt ?? ''),
			role: String(h.role ?? ''),
			modelId: String(h.modelId ?? ''),
			inputTokens: num(h.inputTokens),
			outputTokens: num(h.outputTokens),
			totalCostUsd: num(h.totalCostUsd),
			requestGroupId: typeof routing.requestGroupId === 'string' ? routing.requestGroupId : undefined,
			estimateUsd: routing.estimateUsd === undefined ? undefined : num(routing.estimateUsd),
		};
	});

	const groupTotals: Record<string, number> = {};
	for (const [key, value] of Object.entries(data.groupTotals ?? {})) groupTotals[key] = num(value);

	return { items, nextCursor: data.nextCursor ?? null, groupTotals };
};

// ---------------------------------------------------------------------------
// Jev で Division プロジェクトを作る (デスクトップのコスト管理・Web のダッシュボードと同じ)
//
//   POST /api/routing/project … プロンプトとエフォート・コスト・性能を Jev に送る。Jev は 3 つの値を
//   そのまま使い、ロール別ランキング (RoleRanking) を読んでロールとロールごとのモデルを選び、
//   Division がそのプロジェクトを作る (所有者はログイン中のユーザー)。Jev の料金がかかる (Plus)。
// ---------------------------------------------------------------------------

export const JEV_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type JevEffort = typeof JEV_EFFORTS[number];
export const JEV_EFFORT_LABELS: Record<JevEffort, string> = { low: '低い', medium: 'ふつう', high: '高い', xhigh: 'とても高い', max: '最大' };
/** 1 ロール 1 回あたりの上限 (USD)。Division の PLAN_COST_STEPS と同じ刻み。 */
export const JEV_COST_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5] as const;

export type JevSliders = { effort: JevEffort; maxCostUsd: number; minPerformance: number };
export const DEFAULT_JEV_SLIDERS: JevSliders = { effort: 'medium', maxCostUsd: 0.05, minPerformance: 70 };

export type JevAssignmentStatus = 'ok' | 'below-performance' | 'over-budget';
export type JevAssignment = {
	roleSlug: string;
	roleName: string;
	providerId: string;
	providerName: string;
	modelId: string;
	modelName: string;
	rank: number;
	score: number;
	effort: JevEffort | null;
	costUsd: number;
	status: JevAssignmentStatus;
	/** Jev が (いちばん安いもの以外から) 選んだモデルか */
	pickedByJev: boolean;
};
export type JevProjectResult = {
	projectId: string;
	projectName: string;
	sliders: JevSliders;
	assignments: JevAssignment[];
	totalCostUsd: number;
	averageScore: number;
	jevCostUsd: number;
};

const isEffort = (v: unknown): v is JevEffort => typeof v === 'string' && (JEV_EFFORTS as readonly string[]).includes(v);
const STATUSES: readonly JevAssignmentStatus[] = ['ok', 'below-performance', 'over-budget'];

/** 空ならプロンプトの 1 行目をプロジェクト名にする (Division 側と同じ)。 */
export const defaultJevProjectName = (goal: string): string => {
	const line = goal.split('\n').map(s => s.trim()).find(Boolean) ?? '';
	return line.length > 60 ? `${line.slice(0, 60)}…` : line;
};

/** POST /api/routing/project の応答を画面で使う形にする。 */
export const parseJevProjectResult = (data: unknown, fallback: { name: string; sliders: JevSliders }): JevProjectResult => {
	const root = (data ?? {}) as Record<string, unknown>;
	const project = (root.project ?? {}) as Record<string, unknown>;
	const plan = (root.plan ?? {}) as Record<string, unknown>;
	const picks = (plan.picks && typeof plan.picks === 'object' ? plan.picks : {}) as Record<string, unknown>;
	const sliders = (plan.sliders ?? {}) as Record<string, unknown>;
	const totals = (plan.totals ?? {}) as Record<string, unknown>;
	const jev = (plan.jev ?? {}) as Record<string, unknown>;
	const assignments = ((plan.assignments as unknown[]) ?? []).map(raw => {
		const a = (raw ?? {}) as Record<string, unknown>;
		const providerId = String(a.providerId ?? '');
		const modelId = String(a.modelId ?? '');
		const roleSlug = String(a.roleSlug ?? '');
		return {
			roleSlug,
			roleName: String(a.roleName ?? roleSlug),
			providerId,
			providerName: String(a.providerName ?? providerId),
			modelId,
			modelName: String(a.modelName ?? modelId),
			rank: num(a.rank),
			score: num(a.score),
			effort: isEffort(a.effort) ? a.effort : null,
			costUsd: num(a.costUsd),
			status: STATUSES.includes(a.status as JevAssignmentStatus) ? a.status as JevAssignmentStatus : 'ok',
			pickedByJev: picks[roleSlug] === `${providerId}/${modelId}`,
		};
	});
	return {
		projectId: String(project.id ?? ''),
		projectName: String(project.name ?? fallback.name),
		sliders: {
			effort: isEffort(sliders.effort) ? sliders.effort : fallback.sliders.effort,
			maxCostUsd: num(sliders.maxCostUsd, fallback.sliders.maxCostUsd),
			minPerformance: num(sliders.minPerformance, fallback.sliders.minPerformance),
		},
		assignments,
		totalCostUsd: num(totals.costUsd, assignments.reduce((sum, a) => sum + a.costUsd, 0)),
		averageScore: num(totals.performance),
		jevCostUsd: num(jev.costUsd),
	};
};

/** プロンプトと 3 つの値を Jev に送り、Division プロジェクトを作る。 */
export const createProjectWithJev = async (
	session: DivisionSession,
	input: { goal: string; sliders: JevSliders; name?: string; endpoint?: string },
): Promise<JevProjectResult> => {
	const goal = input.goal.trim();
	if (!goal) throw new DivisionRoutingError(400, 'プロンプトを入力してください。');
	const name = input.name?.trim() || defaultJevProjectName(goal);
	const data = await request<Record<string, unknown>>(session, 'project', {
		endpoint: input.endpoint,
		body: { goal, sliders: input.sliders, ...(name ? { name } : {}) },
		// Jev の判断とプロジェクトの作成を 1 回で行うので、見積もりより長く待つ
		timeoutMs: 60_000,
	});
	return parseJevProjectResult(data, { name, sliders: input.sliders });
};
