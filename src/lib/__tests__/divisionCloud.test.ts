/**
 * クラウドエージェントの API クライアントと、UI 非依存の補助関数を確認する。
 * Supabase (JWT の取得) はフェイクに差し替え、fetch はテストごとに差し替える。
 */

jest.mock('../divisionAuth', () => {
	const state: { current: unknown } = { current: null };
	return {
		getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: state.current } }) } }),
		getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
		__setCurrentSession: (value: unknown) => { state.current = value; },
	};
});

import {
	CLOUD_TIMEOUTS,
	CloudSession,
	CloudSessionEvent,
	DivisionCloudError,
	archiveCloudSession,
	canSendMessage,
	classifyPatchLines,
	cloudSource,
	cloudStatusLabel,
	createCloudSession,
	fetchCloudChanges,
	fetchCloudEvents,
	finishedSessions,
	getCloudSession,
	isActive,
	launchSessions,
	launchTitles,
	listCloudSessions,
	listPollInterval,
	mergeEvents,
	repoFolderName,
	repoLabel,
	sectionForChange,
	sendCloudMessage,
	splitPatch,
	startCloudSession,
	stopCloudSession,
	toolCallSummary,
	truncateLines,
	validateBranch,
	validateRepoUrl,
} from '../divisionCloud';

const BASE = 'https://api.division.he-ro.jp/api/cloud-sessions';
const auth = { userId: 'u1', email: 'a@example.com', accessToken: 'at', refreshToken: 'rt' };

type FetchCall = { url: string; init: RequestInit };
const calls: FetchCall[] = [];

const rawSession = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: 's1',
	title: 'Fix bug',
	prompt: 'Fix bug',
	status: 'running',
	model: null,
	modelLabel: null,
	projectId: null,
	workspaceName: null,
	workspaceInfo: null,
	summary: null,
	errorMsg: null,
	changedFiles: 0,
	lastSeq: 0,
	createdAt: '2026-10-01T00:00:00.000Z',
	updatedAt: '2026-10-01T00:00:00.000Z',
	startedAt: '2026-10-01T00:00:00.000Z',
	completedAt: null,
	...over,
});

const session = (over: Partial<CloudSession> = {}): CloudSession => ({
	...(rawSession() as unknown as CloudSession),
	...over,
});

const respond = (status: number, body: unknown) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
}) as unknown as Response;

const mockFetch = (impl: (url: string, init: RequestInit) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>) => {
	(globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		const { status, body } = await impl(url, init);
		return respond(status, body);
	});
};

const bodyOf = (call: FetchCall): unknown => JSON.parse(String(call.init.body));
const headersOf = (call: FetchCall): Record<string, string> => call.init.headers as Record<string, string>;

beforeEach(() => {
	calls.length = 0;
	jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// クライアント
// ---------------------------------------------------------------------------

describe('client requests', () => {
	it('lists sessions with the bearer token and normalizes the DTO', async () => {
		mockFetch(() => ({ status: 200, body: { sessions: [rawSession({ workspaceInfo: { fileCount: 3, bytes: 10, skipped: 0, repoUrl: 'https://github.com/o/r' } })] } }));
		const rows = await listCloudSessions(auth);

		expect(calls[0].url).toBe(`${BASE}?limit=50`);
		expect(calls[0].init.method).toBe('GET');
		expect(calls[0].init.body).toBeUndefined();
		expect(headersOf(calls[0]).Authorization).toBe('Bearer jwt-token');
		expect(rows).toHaveLength(1);
		expect(rows[0].workspaceInfo).toEqual({ fileCount: 3, bytes: 10, skipped: 0, repoUrl: 'https://github.com/o/r' });
	});

	it('gets one session and encodes the id', async () => {
		mockFetch(() => ({ status: 200, body: { session: rawSession({ id: 'a/b' }) } }));
		const s = await getCloudSession(auth, 'a/b');
		expect(calls[0].url).toBe(`${BASE}/a%2Fb`);
		expect(s.id).toBe('a/b');
	});

	it('fetches events after a sequence number', async () => {
		mockFetch(() => ({
			status: 200,
			body: { events: [{ seq: 4, type: 'user', data: { text: 'hi' }, createdAt: 'x' }], session: rawSession({ lastSeq: 4 }) },
		}));
		const res = await fetchCloudEvents(auth, 's1', 3);
		expect(calls[0].url).toBe(`${BASE}/s1/events?after=3&limit=500`);
		expect(res.events).toEqual([{ seq: 4, type: 'user', data: { text: 'hi' }, createdAt: 'x' }]);
		expect(res.session.lastSeq).toBe(4);
	});

	it('creates a session with only the given fields', async () => {
		mockFetch(() => ({ status: 201, body: { session: rawSession({ status: 'uploading' }) } }));
		const s = await createCloudSession(auth, { prompt: 'do it', title: ' T ', model: '' });
		expect(calls[0].url).toBe(BASE);
		expect(calls[0].init.method).toBe('POST');
		expect(headersOf(calls[0])['Content-Type']).toBe('application/json');
		expect(bodyOf(calls[0])).toEqual({ prompt: 'do it', title: 'T' });
		expect(s.status).toBe('uploading');
	});

	it('starts with a repo (branch optional) or with an empty body', async () => {
		mockFetch(() => ({ status: 200, body: { session: rawSession() } }));
		await startCloudSession(auth, 's1', { repo: { url: ' https://github.com/o/r.git ', branch: 'dev' } });
		await startCloudSession(auth, 's1', { repo: { url: 'https://github.com/o/r', branch: '  ' } });
		await startCloudSession(auth, 's1');
		expect(calls[0].url).toBe(`${BASE}/s1/start`);
		expect(bodyOf(calls[0])).toEqual({ repo: { url: 'https://github.com/o/r.git', branch: 'dev' } });
		expect(bodyOf(calls[1])).toEqual({ repo: { url: 'https://github.com/o/r' } });
		expect(bodyOf(calls[2])).toEqual({});
	});

	it('sends messages, stops, archives and loads changes', async () => {
		mockFetch(url => {
			if (url.endsWith('/changes')) {
				return {
					status: 200,
					body: { changes: [{ path: 'a.ts', status: 'modified', additions: 2, deletions: 1, binary: false }], patch: 'diff', patchTruncated: true },
				};
			}
			if (url.endsWith('/archive')) return { status: 200, body: { ok: true } };
			return { status: 200, body: { session: rawSession({ status: url.endsWith('/stop') ? 'cancelled' : 'running' }) } };
		});

		await sendCloudMessage(auth, 's1', 'more');
		expect(calls[0].url).toBe(`${BASE}/s1/messages`);
		expect(bodyOf(calls[0])).toEqual({ text: 'more' });

		expect((await stopCloudSession(auth, 's1')).status).toBe('cancelled');
		expect(calls[1].url).toBe(`${BASE}/s1/stop`);
		expect(calls[1].init.method).toBe('POST');
		expect(bodyOf(calls[1])).toEqual({});

		await archiveCloudSession(auth, 's1');
		expect(calls[2].url).toBe(`${BASE}/s1/archive`);
		expect(bodyOf(calls[2])).toEqual({});

		const changes = await fetchCloudChanges(auth, 's1');
		expect(calls[3].url).toBe(`${BASE}/s1/changes`);
		expect(calls[3].init.method).toBe('GET');
		expect(changes).toEqual({
			changes: [{ path: 'a.ts', status: 'modified', additions: 2, deletions: 1, binary: false }],
			patch: 'diff',
			patchTruncated: true,
		});
	});
});

describe('timeouts', () => {
	/** 指定時間後に abort されるまで返らない fetch。 */
	const hangingFetch = () => {
		(globalThis as unknown as { fetch: unknown }).fetch = jest.fn((url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Promise((_, reject) => {
				init.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
			});
		});
	};

	const expectTimeout = async (run: () => Promise<unknown>, ms: number) => {
		jest.useFakeTimers();
		hangingFetch();
		const promise = run();
		const settled = jest.fn();
		promise.then(settled, settled);

		// トークンの取得 (非同期) を待ってから fetch が呼ばれる
		for (let i = 0; i < 10 && calls.length === 0; i++) await Promise.resolve();
		expect(calls).toHaveLength(1);

		await jest.advanceTimersByTimeAsync(ms - 1);
		expect(settled).not.toHaveBeenCalled();
		expect(calls[0].init.signal?.aborted).toBe(false);

		await jest.advanceTimersByTimeAsync(1);
		expect(calls[0].init.signal?.aborted).toBe(true);
		await expect(promise).rejects.toMatchObject({ status: 0, message: 'timeout' });
		calls.length = 0;
	};

	it('uses 300 s for create and start', async () => {
		await expectTimeout(() => createCloudSession(auth, { prompt: 'x' }), CLOUD_TIMEOUTS.launch);
		await expectTimeout(() => startCloudSession(auth, 's1'), CLOUD_TIMEOUTS.launch);
		expect(CLOUD_TIMEOUTS.launch).toBe(300_000);
	});

	it('uses 120 s for changes and 30 s for the rest', async () => {
		await expectTimeout(() => fetchCloudChanges(auth, 's1'), 120_000);
		await expectTimeout(() => listCloudSessions(auth), 30_000);
		await expectTimeout(() => fetchCloudEvents(auth, 's1'), 30_000);
		await expectTimeout(() => sendCloudMessage(auth, 's1', 'x'), 30_000);
	});

	it('reports a timeout with a Japanese message', () => {
		expect(new DivisionCloudError(0, 'timeout').userMessage).toContain('応答がありませんでした');
	});
});

describe('errors', () => {
	const errorFor = async (status: number, body: unknown): Promise<DivisionCloudError> => {
		mockFetch(() => ({ status, body }));
		try {
			await listCloudSessions(auth);
		} catch (e) {
			return e as DivisionCloudError;
		}
		throw new Error('expected a rejection');
	};

	it('maps statuses to Japanese user messages', async () => {
		expect((await errorFor(401, { error: 'Authentication required' })).userMessage).toContain('もう一度ログイン');
		expect((await errorFor(402, { error: 'Insufficient credits' })).userMessage).toContain('クレジットが不足');
		expect((await errorFor(403, { error: 'Orchestra Plus is required' })).userMessage).toContain('Orchestra Plus');
		expect((await errorFor(404, { error: 'Session not found' })).userMessage).toContain('見つかりません');
		expect((await errorFor(409, { error: 'Session is running' })).userMessage).toContain('この操作はできません');
		expect((await errorFor(503, { error: 'Cloud sandboxes are not configured on this server (DAYTONA_API_KEY).' })).userMessage)
			.toContain('設定されていません');
		expect((await errorFor(503, { error: 'down' })).userMessage).toContain('一時的に');
	});

	it('passes the server message through for 429 and unknown statuses', async () => {
		const limit = await errorFor(429, { error: '同時に実行できるクラウドエージェントは 10 個までです。' });
		expect(limit.status).toBe(429);
		expect(limit.userMessage).toBe('同時に実行できるクラウドエージェントは 10 個までです。');
		expect((await errorFor(502, { error: 'サンドボックスの作成に失敗しました: x' })).userMessage).toBe('サンドボックスの作成に失敗しました: x');
		expect((await errorFor(500, {})).message).toBe('HTTP 500');
	});

	it('reports a network failure as status 0', async () => {
		(globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => { throw new Error('Network request failed'); });
		const error = await listCloudSessions(auth).then(() => null, (e: unknown) => e as DivisionCloudError);
		expect(error).toBeInstanceOf(DivisionCloudError);
		expect(error?.status).toBe(0);
		expect(error?.userMessage).toContain('接続できません');
	});

	it('prefers the Supabase client\'s refreshed session of the same user', async () => {
		const { __setCurrentSession } = jest.requireMock('../divisionAuth') as { __setCurrentSession: (v: unknown) => void };
		mockFetch(() => ({ status: 200, body: { sessions: [] } }));
		try {
			__setCurrentSession({ access_token: 'refreshed', user: { id: 'u1' } });
			await listCloudSessions(auth);
			__setCurrentSession({ access_token: 'someone-else', user: { id: 'u2' } });
			await listCloudSessions(auth);
		} finally {
			__setCurrentSession(null);
		}
		expect(headersOf(calls[0]).Authorization).toBe('Bearer refreshed');
		expect(headersOf(calls[1]).Authorization).toBe('Bearer jwt-token');
	});

	it('reports a token failure as 401 without calling fetch', async () => {
		const { getDivisionAccessToken } = jest.requireMock('../divisionAuth') as { getDivisionAccessToken: jest.Mock };
		getDivisionAccessToken.mockRejectedValueOnce(new Error('expired'));
		mockFetch(() => ({ status: 200, body: {} }));
		await expect(listCloudSessions(auth)).rejects.toMatchObject({ status: 401 });
		expect(calls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// 補助関数
// ---------------------------------------------------------------------------

describe('status helpers', () => {
	it('labels every status in Japanese', () => {
		expect(cloudStatusLabel('provisioning')).toBe('準備中');
		expect(cloudStatusLabel('uploading')).toBe('アップロード中');
		expect(cloudStatusLabel('running')).toBe('実行中');
		expect(cloudStatusLabel('idle')).toBe('待機中');
		expect(cloudStatusLabel('failed')).toBe('失敗');
		expect(cloudStatusLabel('cancelled')).toBe('停止');
	});

	it('knows which statuses are active and when messages can be sent', () => {
		expect(['provisioning', 'uploading', 'running'].every(s => isActive(s as CloudSession['status']))).toBe(true);
		expect(['idle', 'failed', 'cancelled'].some(s => isActive(s as CloudSession['status']))).toBe(false);
		expect(canSendMessage({ status: 'idle', startedAt: 'x' })).toBe(true);
		expect(canSendMessage({ status: 'running', startedAt: 'x' })).toBe(true);
		expect(canSendMessage({ status: 'uploading', startedAt: null })).toBe(false);
		// サンドボックスの用意中に止めたセッションは開始していないので送れない
		expect(canSendMessage({ status: 'cancelled', startedAt: null })).toBe(false);
	});

	it('polls faster while something is active', () => {
		expect(listPollInterval([{ status: 'idle' }, { status: 'running' }])).toBe(4_000);
		expect(listPollInterval([{ status: 'idle' }])).toBe(20_000);
		expect(listPollInterval([])).toBe(20_000);
	});

	it('detects sessions that finished since the last poll', () => {
		const before = new Map<string, CloudSession['status']>([['a', 'running'], ['b', 'running'], ['c', 'idle'], ['d', 'provisioning']]);
		const next = [
			session({ id: 'a', status: 'idle' }),
			session({ id: 'b', status: 'cancelled' }),
			session({ id: 'c', status: 'idle' }),
			session({ id: 'd', status: 'failed' }),
			session({ id: 'new', status: 'idle' }),
		];
		expect(finishedSessions(before, next).map(s => s.id)).toEqual(['a', 'd']);
	});

	it('describes where a session runs', () => {
		expect(cloudSource({ workspaceName: 'r', workspaceInfo: { fileCount: 0, bytes: 0, skipped: 0, repoUrl: 'https://github.com/o/r.git', gitBranch: 'dev' } }))
			.toEqual({ kind: 'repo', label: 'github.com/o/r @ dev' });
		expect(cloudSource({ workspaceName: 'my-app', workspaceInfo: { fileCount: 3, bytes: 1, skipped: 0, gitBranch: 'main' } }))
			.toEqual({ kind: 'workspace', label: 'my-app @ main' });
		expect(cloudSource({ workspaceName: null, workspaceInfo: null })).toEqual({ kind: 'empty', label: '空のフォルダ' });
		expect(repoLabel('https://github.com/o/r.git/')).toBe('github.com/o/r');
		expect(repoFolderName('https://github.com/o/r.git')).toBe('r');
		expect(repoFolderName('https://example.com')).toBe('');
	});
});

describe('mergeEvents', () => {
	const ev = (seq: number, type: CloudSessionEvent['type'] = 'assistant'): CloudSessionEvent => ({ seq, type, data: { text: String(seq) }, createdAt: '' });

	it('appends a continuation without reordering', () => {
		const current = [ev(1), ev(2)];
		expect(mergeEvents(current, [ev(3), ev(4)]).map(e => e.seq)).toEqual([1, 2, 3, 4]);
		expect(mergeEvents(current, [])).toBe(current);
	});

	it('drops duplicates and sorts out-of-order pages', () => {
		const merged = mergeEvents([ev(1), ev(2), ev(3)], [ev(2, 'tool'), ev(5), ev(4)]);
		expect(merged.map(e => e.seq)).toEqual([1, 2, 3, 4, 5]);
		// 同じ seq は新しく来た方を使う
		expect(merged[1].type).toBe('tool');
	});

	it('starts from an empty list', () => {
		expect(mergeEvents([], [ev(2), ev(1)]).map(e => e.seq)).toEqual([1, 2]);
	});
});

describe('toolCallSummary', () => {
	it('summarizes common tools in one line', () => {
		expect(toolCallSummary('read_file', { path: 'src/a.ts' })).toBe('read_file src/a.ts');
		expect(toolCallSummary('run_command', { command: 'npm test', cwd: '.' })).toBe('run_command npm test');
		expect(toolCallSummary('search', { query: 'foo', limit: 3 })).toBe('search foo');
		expect(toolCallSummary('custom', { note: 'hello' })).toBe('custom hello');
	});

	it('falls back to the name and collapses long or multi-line values', () => {
		expect(toolCallSummary('list_dir', {})).toBe('list_dir');
		expect(toolCallSummary('list_dir', null)).toBe('list_dir');
		expect(toolCallSummary('', undefined)).toBe('tool');
		expect(toolCallSummary('write_file', { path: 'a\n  b' })).toBe('write_file a b');
		const long = toolCallSummary('run_command', { command: 'x'.repeat(200) });
		expect(long.length).toBe(80);
		expect(long.endsWith('…')).toBe(true);
	});
});

describe('repo validation', () => {
	it('accepts public https URLs', () => {
		expect(validateRepoUrl('https://github.com/o/r.git')).toBeNull();
		expect(validateRepoUrl('  https://gitlab.com/group/sub/repo  ')).toBeNull();
	});

	it('rejects what the server rejects', () => {
		expect(validateRepoUrl('')).not.toBeNull();
		expect(validateRepoUrl('github.com/o/r')).not.toBeNull();
		expect(validateRepoUrl('http://github.com/o/r')).toContain('https://');
		expect(validateRepoUrl('git@github.com:o/r.git')).not.toBeNull();
		expect(validateRepoUrl('https://user:token@github.com/o/r')).toContain('トークン');
		expect(validateRepoUrl('https://token@github.com/o/r')).not.toBeNull();
		expect(validateRepoUrl('https://github.com/o/r$(x)')).not.toBeNull();
		expect(validateRepoUrl(`https://github.com/${'a'.repeat(500)}`)).not.toBeNull();
	});

	it('validates branch names like the server', () => {
		expect(validateBranch('')).toBeNull();
		expect(validateBranch('feature/x-1.2_b')).toBeNull();
		expect(validateBranch('-rf')).not.toBeNull();
		expect(validateBranch('a..b')).not.toBeNull();
		expect(validateBranch('has space')).not.toBeNull();
		expect(validateBranch('a;b')).not.toBeNull();
	});
});

describe('launchSessions', () => {
	it('suffixes titles only when launching more than one', () => {
		expect(launchTitles({ prompt: 'Fix it\nmore', count: 1 })).toEqual([undefined]);
		expect(launchTitles({ prompt: 'Fix it', count: 1, title: 'Mine' })).toEqual(['Mine']);
		expect(launchTitles({ prompt: 'Fix it\nmore', count: 3 })).toEqual(['Fix it #1', 'Fix it #2', 'Fix it #3']);
		expect(launchTitles({ prompt: 'p', count: 2, title: 'T' })).toEqual(['T #1', 'T #2']);
	});

	it('creates and starts every session concurrently', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		let created = 0;
		mockFetch(async (url, init) => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise(resolve => setTimeout(resolve, 5));
			inFlight -= 1;
			if (url === BASE) {
				created += 1;
				const body = JSON.parse(String(init.body)) as { title?: string };
				return { status: 201, body: { session: rawSession({ id: `s${created}`, title: body.title, status: 'uploading' }) } };
			}
			const id = url.split('/').slice(-2)[0];
			return { status: 200, body: { session: rawSession({ id, status: 'running' }) } };
		});

		const results = await launchSessions(auth, {
			prompt: 'Add tests',
			count: 3,
			repo: { url: 'https://github.com/o/r.git', branch: 'main' },
			model: 'anthropic/claude',
		});

		expect(maxInFlight).toBe(3);
		const creates = calls.filter(c => c.url === BASE);
		const starts = calls.filter(c => c.url.endsWith('/start'));
		expect(creates).toHaveLength(3);
		expect(starts).toHaveLength(3);
		expect(creates.map(c => (bodyOf(c) as { title: string }).title).sort()).toEqual(['Add tests #1', 'Add tests #2', 'Add tests #3']);
		expect(bodyOf(creates[0])).toMatchObject({ prompt: 'Add tests', model: 'anthropic/claude', workspaceName: 'r' });
		expect(bodyOf(starts[0])).toEqual({ repo: { url: 'https://github.com/o/r.git', branch: 'main' } });
		expect(results.map(r => r.index)).toEqual([0, 1, 2]);
		expect(results.every(r => !r.error && r.session?.status === 'running')).toBe(true);
	});

	it('starts in an empty folder when no repo is given', async () => {
		mockFetch(url => (url === BASE
			? { status: 201, body: { session: rawSession({ id: 'e1', status: 'uploading' }) } }
			: { status: 200, body: { session: rawSession({ id: 'e1' }) } }));
		const [result] = await launchSessions(auth, { prompt: 'scaffold', count: 1 });
		expect(result.error).toBeUndefined();
		expect(bodyOf(calls[0])).toEqual({ prompt: 'scaffold' });
		expect(bodyOf(calls[1])).toEqual({});
	});

	it('reports per-session failures and keeps the others', async () => {
		let n = 0;
		mockFetch((url, init) => {
			if (url === BASE) {
				n += 1;
				const title = (JSON.parse(String(init.body)) as { title: string }).title;
				if (title.endsWith('#2')) return { status: 429, body: { error: '同時に実行できるクラウドエージェントは 10 個までです。' } };
				return { status: 201, body: { session: rawSession({ id: title.endsWith('#3') ? 'bad' : `ok${n}`, status: 'uploading' }) } };
			}
			if (url.includes('/bad/')) return { status: 502, body: { error: 'workspace setup failed' } };
			return { status: 200, body: { session: rawSession({ id: 'ok' }) } };
		});

		const results = await launchSessions(auth, { prompt: 'p', count: 3 });
		expect(results[0].error).toBeUndefined();
		expect(results[1]).toMatchObject({ index: 1, title: 'p #2', error: '同時に実行できるクラウドエージェントは 10 個までです。' });
		expect(results[1].session).toBeUndefined();
		// 作成はできて開始に失敗したものは、作成済みのセッションも返す
		expect(results[2]).toMatchObject({ index: 2, error: 'workspace setup failed' });
		expect(results[2].session?.id).toBe('bad');
	});

	it('validates the input before calling the API', async () => {
		mockFetch(() => ({ status: 200, body: {} }));
		await expect(launchSessions(auth, { prompt: '  ', count: 1 })).rejects.toThrow('指示');
		await expect(launchSessions(auth, { prompt: 'p', count: 0 })).rejects.toThrow('並列数');
		await expect(launchSessions(auth, { prompt: 'p', count: 11 })).rejects.toThrow('並列数');
		await expect(launchSessions(auth, { prompt: 'p', count: 1.5 })).rejects.toThrow('並列数');
		await expect(launchSessions(auth, { prompt: 'p', count: 1, repo: { url: 'http://x.com/r' } })).rejects.toThrow('https://');
		expect(calls).toHaveLength(0);
	});
});

describe('patch helpers', () => {
	const patch = [
		'diff --git a/src/a.ts b/src/a.ts',
		'index 111..222 100644',
		'--- a/src/a.ts',
		'+++ b/src/a.ts',
		'@@ -1,2 +1,2 @@',
		' keep',
		'-old',
		'+new',
		'+++ added line that looks like a header',
		'diff --git a/img.png b/img.png',
		'new file mode 100644',
		'index 000..333',
		'GIT binary patch',
		'literal 3',
		'zcmV',
		'',
		'diff --git a/gone.txt b/gone.txt',
		'deleted file mode 100644',
		'--- a/gone.txt',
		'+++ /dev/null',
		'@@ -1 +0,0 @@',
		'-bye',
		'',
	].join('\n');

	it('splits a unified diff per file', () => {
		const sections = splitPatch(patch);
		expect(sections.map(s => s.path)).toEqual(['src/a.ts', 'img.png', 'gone.txt']);
		expect(sections.map(s => s.binary)).toEqual([false, true, false]);
		expect(sections[0].lines).toHaveLength(9);
		expect(sections[2].lines[sections[2].lines.length - 1]).toBe('-bye');
		expect(splitPatch('')).toEqual([]);
	});

	it('classifies lines and treats +++ inside a hunk as an addition', () => {
		const [first] = splitPatch(patch);
		expect(classifyPatchLines(first.lines)).toEqual(['meta', 'meta', 'meta', 'meta', 'hunk', 'context', 'del', 'add', 'add']);
	});

	it('finds the section for a change by path, then by position', () => {
		const sections = splitPatch(patch);
		const changes = [
			{ path: 'src/a.ts', status: 'modified' as const, additions: 2, deletions: 1, binary: false },
			{ path: 'img.png', status: 'added' as const, additions: -1, deletions: -1, binary: true },
			{ path: '"quoted"', status: 'deleted' as const, additions: 0, deletions: 1, binary: false },
		];
		expect(sectionForChange(sections, changes, 0)?.path).toBe('src/a.ts');
		expect(sectionForChange(sections, changes, 2)?.path).toBe('gone.txt');
		expect(sectionForChange(sections, changes, 5)).toBeNull();
	});

	it('truncates long line lists', () => {
		const lines = Array.from({ length: 10 }, (_, i) => String(i));
		expect(truncateLines(lines, 20)).toEqual({ lines, truncated: false, hidden: 0 });
		expect(truncateLines(lines, 4)).toEqual({ lines: ['0', '1', '2', '3'], truncated: true, hidden: 6 });
	});
});
