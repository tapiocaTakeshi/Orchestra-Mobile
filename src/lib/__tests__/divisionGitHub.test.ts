/**
 * GitHub アカウント連携の API クライアントと、連携の完了待ち (ポーリング) を確認する。
 * Supabase (JWT の取得) はフェイクに差し替え、fetch はテストごとに差し替える。
 */

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
	getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
}));

import { DivisionCloudError, cloudErrorText } from '../divisionCloud';
import {
	GitHubRepo,
	GitHubStatus,
	disconnectGitHub,
	getGitHubStatus,
	githubErrorText,
	isGitHubNotConnected,
	listGitHubBranches,
	listGitHubRepos,
	mergeRepoPages,
	repoListQuery,
	startGitHubConnect,
	toGitHubRepo,
	watchGitHubConnection,
} from '../divisionGitHub';

const BASE = 'https://api.division.he-ro.io/api/github';
const auth = { userId: 'u1', email: 'a@example.com', accessToken: 'at', refreshToken: 'rt' };

type FetchCall = { url: string; init: RequestInit };
const calls: FetchCall[] = [];

const respond = (status: number, body: unknown) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
}) as unknown as Response;

const mockFetch = (impl: (url: string, init: RequestInit) => { status: number; body: unknown }) => {
	(globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		const { status, body } = impl(url, init);
		return respond(status, body);
	});
};

const headersOf = (call: FetchCall): Record<string, string> => call.init.headers as Record<string, string>;

const rawRepo = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	fullName: 'octo/app',
	name: 'app',
	owner: 'octo',
	private: true,
	defaultBranch: 'main',
	description: 'The app',
	pushedAt: '2026-10-10T00:00:00.000Z',
	htmlUrl: 'https://github.com/octo/app',
	...over,
});

const repo = (fullName: string): GitHubRepo => toGitHubRepo(rawRepo({ fullName, name: fullName.split('/')[1], owner: fullName.split('/')[0] }));

beforeEach(() => {
	calls.length = 0;
});

describe('status', () => {
	it('gets the status with the bearer token', async () => {
		mockFetch(() => ({ status: 200, body: { configured: true, connected: true, login: 'octo', avatarUrl: 'https://a/x.png', scopes: 'repo' } }));
		const status = await getGitHubStatus(auth);
		expect(calls[0].url).toBe(`${BASE}/status`);
		expect(calls[0].init.method).toBe('GET');
		expect(calls[0].init.body).toBeUndefined();
		expect(headersOf(calls[0]).Authorization).toBe('Bearer jwt-token');
		expect(status).toEqual({ configured: true, connected: true, login: 'octo', avatarUrl: 'https://a/x.png', scopes: 'repo' });
	});

	it('never reports connected when the server is not configured', async () => {
		mockFetch(() => ({ status: 200, body: { configured: false, connected: true } }));
		expect(await getGitHubStatus(auth)).toEqual({ configured: false, connected: false });
	});

	it('treats an old server (404) or github_not_configured (503) as not configured', async () => {
		mockFetch(() => ({ status: 404, body: { error: 'Not found' } }));
		expect(await getGitHubStatus(auth)).toEqual({ configured: false, connected: false });
		mockFetch(() => ({ status: 503, body: { error: 'GitHub OAuth is not configured', code: 'github_not_configured' } }));
		expect(await getGitHubStatus(auth)).toEqual({ configured: false, connected: false });
	});

	it('throws other failures', async () => {
		mockFetch(() => ({ status: 401, body: { error: 'Authentication required' } }));
		await expect(getGitHubStatus(auth)).rejects.toMatchObject({ status: 401 });
	});
});

describe('connect / disconnect', () => {
	it('posts connect and returns the authorize URL', async () => {
		mockFetch(() => ({ status: 200, body: { url: 'https://github.com/login/oauth/authorize?client_id=x&state=y' } }));
		const url = await startGitHubConnect(auth);
		expect(calls[0].url).toBe(`${BASE}/connect`);
		expect(calls[0].init.method).toBe('POST');
		expect(JSON.parse(String(calls[0].init.body))).toEqual({});
		expect(url).toBe('https://github.com/login/oauth/authorize?client_id=x&state=y');
	});

	it('rejects a missing or non-https URL', async () => {
		mockFetch(() => ({ status: 200, body: { url: 'javascript:alert(1)' } }));
		await expect(startGitHubConnect(auth)).rejects.toBeInstanceOf(DivisionCloudError);
		mockFetch(() => ({ status: 200, body: {} }));
		await expect(startGitHubConnect(auth)).rejects.toBeInstanceOf(DivisionCloudError);
	});

	it('posts disconnect', async () => {
		mockFetch(() => ({ status: 200, body: { ok: true } }));
		await disconnectGitHub(auth);
		expect(calls[0].url).toBe(`${BASE}/disconnect`);
		expect(calls[0].init.method).toBe('POST');
		expect(JSON.parse(String(calls[0].init.body))).toEqual({});
	});
});

describe('repos', () => {
	it('builds the query (q is encoded, omitted when empty; page defaults to 1)', () => {
		expect(repoListQuery()).toBe('?page=1');
		expect(repoListQuery({ q: '  ', page: 2 })).toBe('?page=2');
		expect(repoListQuery({ q: 'my repo&x=1/é', page: 3 })).toBe('?q=my%20repo%26x%3D1%2F%C3%A9&page=3');
		expect(repoListQuery({ page: 0 })).toBe('?page=1');
		expect(repoListQuery({ page: 2.7 })).toBe('?page=2');
	});

	it('lists repos with q and page and normalizes the DTO', async () => {
		mockFetch(() => ({
			status: 200,
			body: {
				repos: [rawRepo(), rawRepo({ fullName: 'octo/lib', name: undefined, owner: undefined, private: false, description: null, pushedAt: null, htmlUrl: undefined }), { name: 'broken' }],
				hasMore: true,
			},
		}));
		const res = await listGitHubRepos(auth, { q: 'ap p', page: 2 });
		expect(calls[0].url).toBe(`${BASE}/repos?q=ap%20p&page=2`);
		expect(calls[0].init.method).toBe('GET');
		expect(res.hasMore).toBe(true);
		// fullName の無い行は落とす
		expect(res.repos).toHaveLength(2);
		expect(res.repos[0]).toEqual({
			fullName: 'octo/app', name: 'app', owner: 'octo', private: true, defaultBranch: 'main',
			description: 'The app', pushedAt: '2026-10-10T00:00:00.000Z', htmlUrl: 'https://github.com/octo/app',
		});
		// 欠けた値は fullName から補う
		expect(res.repos[1]).toMatchObject({ name: 'lib', owner: 'octo', private: false, description: null, pushedAt: null, htmlUrl: 'https://github.com/octo/lib' });
	});

	it('lists the first page without q by default', async () => {
		mockFetch(() => ({ status: 200, body: { repos: [] } }));
		const res = await listGitHubRepos(auth);
		expect(calls[0].url).toBe(`${BASE}/repos?page=1`);
		expect(res).toEqual({ repos: [], hasMore: false });
	});

	it('merges pages without duplicates', () => {
		const merged = mergeRepoPages([repo('a/one'), repo('a/two')], [repo('a/two'), repo('a/three'), repo('a/three')]);
		expect(merged.map(r => r.fullName)).toEqual(['a/one', 'a/two', 'a/three']);
	});
});

describe('branches', () => {
	it('encodes the repo and puts the default branch first', async () => {
		mockFetch(() => ({ status: 200, body: { branches: ['dev', 'main', 'feature/x'], defaultBranch: 'main' } }));
		const res = await listGitHubBranches(auth, 'octo/my.app');
		expect(calls[0].url).toBe(`${BASE}/branches?repo=octo%2Fmy.app`);
		expect(calls[0].init.method).toBe('GET');
		expect(res).toEqual({ branches: ['main', 'dev', 'feature/x'], defaultBranch: 'main' });
	});

	it('falls back to the first branch when defaultBranch is missing', async () => {
		mockFetch(() => ({ status: 200, body: { branches: ['trunk', 'x', 3] } }));
		expect(await listGitHubBranches(auth, 'o/r')).toEqual({ branches: ['trunk', 'x'], defaultBranch: 'trunk' });
	});

	it('validates the repo name before calling the API', async () => {
		mockFetch(() => ({ status: 200, body: {} }));
		await expect(listGitHubBranches(auth, 'not a repo')).rejects.toMatchObject({ status: 400 });
		await expect(listGitHubBranches(auth, 'o/r/x')).rejects.toMatchObject({ status: 400 });
		await expect(listGitHubBranches(auth, '../r')).rejects.toMatchObject({ status: 400 });
		expect(calls).toHaveLength(0);
	});
});

describe('errors', () => {
	const errorFor = async (status: number, body: unknown): Promise<DivisionCloudError> => {
		mockFetch(() => ({ status, body }));
		try {
			await listGitHubRepos(auth);
		} catch (e) {
			return e as DivisionCloudError;
		}
		throw new Error('expected a rejection');
	};

	it('maps 409 github_not_connected', async () => {
		const e = await errorFor(409, { error: 'GitHub is not connected', code: 'github_not_connected' });
		expect(e.status).toBe(409);
		expect(e.code).toBe('github_not_connected');
		expect(isGitHubNotConnected(e)).toBe(true);
		expect(e.userMessage).toContain('GitHub と連携');
		expect(githubErrorText(e)).toBe(e.userMessage);
		expect(cloudErrorText(e)).toBe(e.userMessage);
	});

	it('maps 503 github_not_configured', async () => {
		const e = await errorFor(503, { error: 'GitHub OAuth is not configured', code: 'github_not_configured' });
		expect(e.code).toBe('github_not_configured');
		expect(isGitHubNotConnected(e)).toBe(false);
		expect(githubErrorText(e)).toContain('サーバー側で GitHub 連携が未設定');
	});

	it('maps an old server (404 without code) to "not supported"', async () => {
		expect(githubErrorText(await errorFor(404, { error: 'Not found' }))).toContain('GitHub 連携に未対応');
	});

	it('keeps the generic Division messages for other statuses', async () => {
		expect(githubErrorText(await errorFor(401, { error: 'Authentication required' }))).toContain('もう一度ログイン');
		expect(githubErrorText(await errorFor(502, { error: 'GitHub API error' }))).toBe('GitHub API error');
		expect(isGitHubNotConnected(new Error('x'))).toBe(false);
	});
});

describe('watchGitHubConnection', () => {
	const connected: GitHubStatus = { configured: true, connected: true, login: 'octo' };
	const notYet: GitHubStatus = { configured: true, connected: false };

	it('polls until connected', async () => {
		const check = jest.fn()
			.mockResolvedValueOnce(notYet)
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValueOnce(connected);
		const watcher = watchGitHubConnection(check, { intervalMs: 5, timeoutMs: 5_000 });
		expect(check).not.toHaveBeenCalled(); // 最初の確認は intervalMs 後
		await expect(watcher.result).resolves.toEqual({ kind: 'connected', status: connected });
		expect(check).toHaveBeenCalledTimes(3);
	});

	it('times out', async () => {
		const check = jest.fn(async () => notYet);
		const watcher = watchGitHubConnection(check, { intervalMs: 5, timeoutMs: 30 });
		await expect(watcher.result).resolves.toEqual({ kind: 'timeout' });
		expect(check.mock.calls.length).toBeGreaterThanOrEqual(1);
	});

	it('checks immediately on checkNow and stops when cancelled', async () => {
		const check = jest.fn(async () => notYet);
		const watcher = watchGitHubConnection(check, { intervalMs: 60_000, timeoutMs: 300_000 });
		watcher.checkNow();
		expect(check).toHaveBeenCalledTimes(1);
		await Promise.resolve();
		watcher.cancel();
		await expect(watcher.result).resolves.toEqual({ kind: 'cancelled' });
		watcher.checkNow();
		expect(check).toHaveBeenCalledTimes(1);
	});

	it('resolves on checkNow when the user came back connected', async () => {
		const check = jest.fn(async () => connected);
		const watcher = watchGitHubConnection(check, { intervalMs: 60_000, timeoutMs: 300_000 });
		watcher.checkNow();
		await expect(watcher.result).resolves.toEqual({ kind: 'connected', status: connected });
	});
});
