/**
 * Division API のルーティング (自動割り当て) API。
 *
 * IDE 側の AutoRouting.tsx と同じエンドポイントを叩く。
 *   POST /api/routing/quote   … Jev に出力トークン予算を判定させ、条件を満たす最安モデルを見積もる
 *   GET  /api/routing/history … モデル実行ごとの実測トークン数と料金
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

export type RoutingQuote = {
	role: string;
	model: string;
	performance: number;
	performanceSource: string;
	inputTokens: number;
	outputTokens: number;
	totalCostUsd: number;
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
			case 403: return 'DivisionのJWTが無効です。もう一度ログインしてください。';
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

/** Jev にトークン予算を判定させて見積もる。実行のたびに判定料金がかかる。 */
export const fetchRoutingQuotes = async (
	session: DivisionSession,
	input: { input: string; inputTokens: number; policy: RoutingPolicy; roles?: readonly string[]; endpoint?: string },
): Promise<RoutingQuote[]> => {
	const data = await request<{ quotes?: unknown[] }>(session, 'quote', {
		endpoint: input.endpoint,
		body: {
			input: input.input,
			inputTokens: input.inputTokens,
			roles: input.roles ?? QUOTE_ROLES,
			policy: input.policy,
		},
	});

	return (data.quotes ?? []).map(raw => {
		const q = (raw ?? {}) as Record<string, unknown>;
		return {
			role: String(q.role ?? ''),
			model: String(q.model ?? ''),
			performance: num(q.performance),
			performanceSource: String(q.performanceSource ?? ''),
			inputTokens: num(q.inputTokens),
			outputTokens: num(q.outputTokens),
			totalCostUsd: num(q.totalCostUsd),
		};
	});
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
