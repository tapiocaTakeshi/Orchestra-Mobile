/**
 * MCP サーバー設定 (MCP ストア) の API クライアントと、UI 非依存の補助関数を確認する。
 * Supabase (JWT の取得) はフェイクに差し替え、fetch はテストごとに差し替える。
 */

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
	getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
}));

import {
	addCustomMcpServer,
	customServerIssue,
	deleteMcpServer,
	getMcpCatalog,
	groupCatalog,
	installMcpFromCatalog,
	listMcpServers,
	mcpErrorText,
	needsToken,
	testMcpServer,
	toMcpCatalogEntry,
	toMcpServer,
	updateMcpServer,
} from '../divisionMcp';
import { DivisionCloudError } from '../divisionCloud';

const BASE = 'https://api.division.he-ro.jp/api/mcp-servers';
const auth = { userId: 'u1', email: 'a@example.com', accessToken: 'at', refreshToken: 'rt' };

type FetchCall = { url: string; init: RequestInit };
const calls: FetchCall[] = [];

const mockFetch = (impl: (url: string, init: RequestInit) => { status: number; body: unknown }) => {
	(globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		const { status, body } = impl(url, init);
		return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
	});
};

const bodyOf = (call: FetchCall): unknown => (call.init.body ? JSON.parse(call.init.body as string) : undefined);

const rawServer = (over: Record<string, unknown> = {}) => ({
	id: 's1',
	name: 'GitHub',
	url: 'https://api.githubcopilot.com/mcp/',
	catalogId: 'github',
	enabled: true,
	headerNames: ['Authorization'],
	createdAt: '2026-10-15T00:00:00.000Z',
	updatedAt: '2026-10-15T00:00:00.000Z',
	...over,
});

beforeEach(() => {
	calls.length = 0;
});

describe('DTO', () => {
	test('catalog entries tolerate missing fields', () => {
		const e = toMcpCatalogEntry({ id: 'x', url: 'https://x.dev/mcp', auth: { type: 'weird' } });
		expect(e).toMatchObject({ id: 'x', name: 'x', category: 'その他', auth: { type: 'none' } });
		expect(needsToken(e)).toBe(false);
		expect(needsToken(toMcpCatalogEntry({ id: 'y', auth: { type: 'bearer' } }))).toBe(true);
		expect(needsToken(toMcpCatalogEntry({ id: 'z', auth: { type: 'bearer', optional: true } }))).toBe(false);
	});

	test('servers default to enabled and keep only header names', () => {
		expect(toMcpServer({ id: 's', headerNames: ['A', 3] })).toMatchObject({ id: 's', enabled: true, catalogId: null, headerNames: ['A'] });
		expect(toMcpServer(rawServer({ enabled: false })).enabled).toBe(false);
	});

	test('groupCatalog keeps the server order', () => {
		const groups = groupCatalog([
			toMcpCatalogEntry({ id: 'a', category: '開発' }),
			toMcpCatalogEntry({ id: 'b', category: 'ドキュメント' }),
			toMcpCatalogEntry({ id: 'c', category: '開発' }),
		]);
		expect(groups.map(g => [g.category, g.entries.map(e => e.id)])).toEqual([['開発', ['a', 'c']], ['ドキュメント', ['b']]]);
	});

	test('customServerIssue checks name, https URL and header name', () => {
		expect(customServerIssue({ name: '', url: 'https://x' })).toMatch(/名前/);
		expect(customServerIssue({ name: 'a', url: 'http://x' })).toMatch(/https/);
		expect(customServerIssue({ name: 'a', url: 'https://x', headerName: 'bad name', headerValue: 'v' })).toMatch(/ヘッダー名/);
		expect(customServerIssue({ name: 'a', url: 'https://x', headerName: '', headerValue: 'v' })).toMatch(/ヘッダー名/);
		expect(customServerIssue({ name: 'a', url: 'https://x/mcp', headerName: 'Authorization', headerValue: 'Bearer t' })).toBeNull();
	});
});

describe('endpoints', () => {
	test('catalog and server list', async () => {
		mockFetch(url => url.endsWith('/catalog')
			? { status: 200, body: { catalog: [{ id: 'deepwiki', name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp', auth: { type: 'none' } }, { id: '' }] } }
			: { status: 200, body: { servers: [rawServer()] } });
		expect((await getMcpCatalog(auth)).map(e => e.id)).toEqual(['deepwiki']);
		expect((await listMcpServers(auth)).map(s => s.id)).toEqual(['s1']);
		expect(calls.map(c => [c.init.method, c.url])).toEqual([['GET', `${BASE}/catalog`], ['GET', BASE]]);
	});

	test('install from the store sends the trimmed token only when given', async () => {
		mockFetch(() => ({ status: 201, body: { server: rawServer() } }));
		await installMcpFromCatalog(auth, 'github', '  tok  ');
		await installMcpFromCatalog(auth, 'deepwiki');
		expect(bodyOf(calls[0])).toEqual({ catalogId: 'github', token: 'tok' });
		expect(bodyOf(calls[1])).toEqual({ catalogId: 'deepwiki' });
	});

	test('custom servers send one header and are validated before the request', async () => {
		mockFetch(() => ({ status: 201, body: { server: rawServer({ catalogId: null }) } }));
		await addCustomMcpServer(auth, { name: ' Mine ', url: 'https://x.dev/mcp', headerName: 'X-Key', headerValue: 'v' });
		expect(bodyOf(calls[0])).toEqual({ name: 'Mine', url: 'https://x.dev/mcp', headers: { 'X-Key': 'v' } });
		await expect(addCustomMcpServer(auth, { name: 'x', url: 'http://x' })).rejects.toBeInstanceOf(DivisionCloudError);
		expect(calls).toHaveLength(1);
	});

	test('update, delete and test use PATCH / DELETE / POST', async () => {
		mockFetch((url, init) => {
			if (url.endsWith('/test')) return { status: 200, body: { ok: true, tools: [{ name: 'search', description: 'd' }, {}] } };
			if (init.method === 'DELETE') return { status: 200, body: { ok: true } };
			return { status: 200, body: { server: rawServer({ enabled: false }) } };
		});
		expect((await updateMcpServer(auth, 's/1', { enabled: false })).enabled).toBe(false);
		await deleteMcpServer(auth, 's1');
		expect(await testMcpServer(auth, 's1')).toEqual({ ok: true, tools: [{ name: 'search', description: 'd' }] });
		expect(calls.map(c => [c.init.method, c.url])).toEqual([
			['PATCH', `${BASE}/s%2F1`],
			['DELETE', `${BASE}/s1`],
			['POST', `${BASE}/s1/test`],
		]);
		expect(bodyOf(calls[0])).toEqual({ enabled: false });
	});

	test('a failed connection test is a result, not an exception', async () => {
		mockFetch(() => ({ status: 200, body: { ok: false, error: '401' } }));
		expect(await testMcpServer(auth, 's1')).toEqual({ ok: false, error: '401' });
	});

	test('a server without MCP support gets a clear message', async () => {
		mockFetch(() => ({ status: 404, body: {} }));
		const error = await listMcpServers(auth).catch(e => e);
		expect(mcpErrorText(error)).toMatch(/未対応/);
	});
});
