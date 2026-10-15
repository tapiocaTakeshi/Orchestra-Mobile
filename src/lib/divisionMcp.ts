/**
 * Division API の MCP サーバー設定 (クラウドエージェントが使う外部ツール)。
 *
 * 登録した MCP サーバーのツールは、クラウドエージェントのセッションで mcp__<サーバー>__<ツール> として使える。
 * トークンは Division のサーバーが暗号化して持ち、端末には保存しない (一覧にもヘッダー名しか返らない)。
 *
 *   GET    /api/mcp-servers/catalog    MCP ストア (ワンタップで追加できるサーバー)
 *   GET    /api/mcp-servers            登録済みのサーバー
 *   POST   /api/mcp-servers            ストアから { catalogId, token } / カスタム { name, url, headers }
 *   PATCH  /api/mcp-servers/:id        { name?, enabled?, token?, headers? }
 *   DELETE /api/mcp-servers/:id
 *   POST   /api/mcp-servers/:id/test   接続してツール一覧を取る
 */

import { DivisionSession } from './divisionAuth';
import { DivisionCloudError, cloudErrorText, divisionApiRequest } from './divisionCloud';

// ---------------------------------------------------------------------------
// 型 (Division 側の DTO と同じ形)
// ---------------------------------------------------------------------------

export type McpAuthType = 'none' | 'bearer' | 'header';

export type McpCatalogEntry = {
	id: string;
	name: string;
	description: string;
	category: string;
	url: string;
	homepage: string;
	auth: {
		type: McpAuthType;
		header?: string;
		label?: string;
		placeholder?: string;
		/** トークンなしでも使える */
		optional?: boolean;
		/** トークンの発行ページ */
		docsUrl?: string;
	};
};

export type McpServer = {
	id: string;
	name: string;
	url: string;
	catalogId: string | null;
	enabled: boolean;
	headerNames: string[];
	createdAt: string;
	updatedAt: string;
};

export type McpTool = { name: string; description: string };

export type McpTestResult = { ok: true; tools: McpTool[] } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// DTO の取り出し (欠けた値で画面が落ちないように)
// ---------------------------------------------------------------------------

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const AUTH_TYPES: McpAuthType[] = ['none', 'bearer', 'header'];

export const toMcpCatalogEntry = (raw: unknown): McpCatalogEntry => {
	const e = (raw ?? {}) as Record<string, unknown>;
	const a = (e.auth ?? {}) as Record<string, unknown>;
	const type = AUTH_TYPES.includes(a.type as McpAuthType) ? (a.type as McpAuthType) : 'none';
	return {
		id: str(e.id),
		name: str(e.name) || str(e.id),
		description: str(e.description),
		category: str(e.category, 'その他') || 'その他',
		url: str(e.url),
		homepage: str(e.homepage),
		auth: {
			type,
			...(typeof a.header === 'string' ? { header: a.header } : {}),
			...(typeof a.label === 'string' ? { label: a.label } : {}),
			...(typeof a.placeholder === 'string' ? { placeholder: a.placeholder } : {}),
			...(a.optional === true ? { optional: true } : {}),
			...(typeof a.docsUrl === 'string' ? { docsUrl: a.docsUrl } : {}),
		},
	};
};

export const toMcpServer = (raw: unknown): McpServer => {
	const s = (raw ?? {}) as Record<string, unknown>;
	return {
		id: str(s.id),
		name: str(s.name),
		url: str(s.url),
		catalogId: typeof s.catalogId === 'string' && s.catalogId ? s.catalogId : null,
		enabled: s.enabled !== false,
		headerNames: Array.isArray(s.headerNames) ? s.headerNames.filter((h): h is string => typeof h === 'string') : [],
		createdAt: str(s.createdAt),
		updatedAt: str(s.updatedAt),
	};
};

/** トークンが必須か (ストアから追加するときに入力欄を必須にする)。 */
export const needsToken = (entry: McpCatalogEntry): boolean => entry.auth.type !== 'none' && !entry.auth.optional;

/** ストアのエントリをカテゴリごとにまとめる (サーバーが返した順を保つ)。 */
export const groupCatalog = (catalog: McpCatalogEntry[]): { category: string; entries: McpCatalogEntry[] }[] => {
	const groups: { category: string; entries: McpCatalogEntry[] }[] = [];
	for (const entry of catalog) {
		const group = groups.find(g => g.category === entry.category);
		if (group) group.entries.push(entry);
		else groups.push({ category: entry.category, entries: [entry] });
	}
	return groups;
};

/** カスタムサーバーの入力の問題 (なければ null)。サーバーでも同じ確認をする。 */
export const customServerIssue = (input: { name: string; url: string; headerName?: string; headerValue?: string }): string | null => {
	if (!input.name.trim()) return '名前を入力してください';
	if (!/^https:\/\/\S+$/i.test(input.url.trim())) return 'URL は https:// で始まる必要があります';
	const headerName = input.headerName?.trim() ?? '';
	if (headerName && !/^[A-Za-z0-9-_]{1,64}$/.test(headerName)) return 'ヘッダー名には英数字・-・_ だけ使えます';
	if (!headerName && input.headerValue?.trim()) return 'ヘッダー名を入力してください';
	return null;
};

// ---------------------------------------------------------------------------
// エンドポイント
// ---------------------------------------------------------------------------

const base = '/api/mcp-servers';
const idPath = (id: string): string => `${base}/${encodeURIComponent(id)}`;

export const getMcpCatalog = async (session: DivisionSession): Promise<McpCatalogEntry[]> => {
	const data = await divisionApiRequest<{ catalog?: unknown[] }>(session, `${base}/catalog`);
	return (data.catalog ?? []).map(toMcpCatalogEntry).filter(e => !!e.id && !!e.url);
};

export const listMcpServers = async (session: DivisionSession): Promise<McpServer[]> => {
	const data = await divisionApiRequest<{ servers?: unknown[] }>(session, base);
	return (data.servers ?? []).map(toMcpServer).filter(s => !!s.id);
};

export const installMcpFromCatalog = async (session: DivisionSession, catalogId: string, token?: string): Promise<McpServer> => {
	const body: Record<string, string> = { catalogId };
	if (token?.trim()) body.token = token.trim();
	const data = await divisionApiRequest<{ server?: unknown }>(session, base, { method: 'POST', body });
	return toMcpServer(data.server);
};

export const addCustomMcpServer = async (
	session: DivisionSession,
	input: { name: string; url: string; headerName?: string; headerValue?: string },
): Promise<McpServer> => {
	const issue = customServerIssue(input);
	if (issue) throw new DivisionCloudError(400, issue);
	const headers: Record<string, string> = {};
	if (input.headerName?.trim() && input.headerValue?.trim()) headers[input.headerName.trim()] = input.headerValue.trim();
	const data = await divisionApiRequest<{ server?: unknown }>(session, base, {
		method: 'POST',
		body: { name: input.name.trim(), url: input.url.trim(), headers },
	});
	return toMcpServer(data.server);
};

export const updateMcpServer = async (
	session: DivisionSession,
	id: string,
	patch: { name?: string; enabled?: boolean; token?: string },
): Promise<McpServer> => {
	const data = await divisionApiRequest<{ server?: unknown }>(session, idPath(id), { method: 'PATCH', body: patch });
	return toMcpServer(data.server);
};

export const deleteMcpServer = async (session: DivisionSession, id: string): Promise<void> => {
	await divisionApiRequest<{ ok?: boolean }>(session, idPath(id), { method: 'DELETE' });
};

export const testMcpServer = async (session: DivisionSession, id: string): Promise<McpTestResult> => {
	const data = await divisionApiRequest<{ ok?: unknown; error?: unknown; tools?: unknown[] }>(
		session, `${idPath(id)}/test`, { method: 'POST', body: {}, timeoutMs: 30_000 },
	);
	if (data.ok !== true) return { ok: false, error: str(data.error) || '接続できませんでした' };
	const tools = (data.tools ?? []).map(t => {
		const r = (t ?? {}) as Record<string, unknown>;
		return { name: str(r.name), description: str(r.description) };
	}).filter(t => !!t.name);
	return { ok: true, tools };
};

/** 画面に出すエラー文言。404 はサーバーが MCP 設定に未対応。 */
export const mcpErrorText = (e: unknown): string => {
	if (e instanceof DivisionCloudError && e.status === 404 && /HTTP 404/.test(e.message)) {
		return 'この Division サーバーは MCP の設定に未対応です。サーバーを更新してください。';
	}
	return cloudErrorText(e);
};
