/**
 * Pull requests from GitHub-repo cloud sessions: the GET / POST client, the session DTO's pullRequest,
 * and the pure helpers behind the button, the form and the `pull_request` log card.
 * Supabase (JWT) is faked and fetch is replaced per test, like the other divisionCloud tests.
 */

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
	getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
}));

import {
	CLOUD_TIMEOUTS,
	CloudPullRequestInfo,
	DivisionCloudError,
	PULL_REQUEST_LIMITS,
	canOfferPullRequest,
	createPullRequest,
	getPullRequestInfo,
	initialPullRequestForm,
	isPullRequestNotConnected,
	openPullRequestLabel,
	pullRequestActionLabel,
	pullRequestBody,
	pullRequestErrorText,
	pullRequestEventText,
	pullRequestFormInput,
	pullRequestInputIssue,
	pullRequestMode,
	pullRequestReasonText,
	pullRequestResultText,
	pullRequestStateFor,
	toCloudPullRequest,
	toCloudSession,
	toPullRequestEvent,
	toPullRequestInfo,
	validatePullRequestBranch,
} from '../divisionCloud';

const BASE = 'https://api.division.he-ro.jp/api/cloud-sessions';
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

const bodyOf = (call: FetchCall): unknown => JSON.parse(String(call.init.body));

const rawPr = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	number: 12,
	url: 'https://github.com/octo/app/pull/12',
	branch: 'orchestra/fix-login-abc123',
	base: 'main',
	headSha: 'deadbeef',
	title: 'Fix login',
	draft: false,
	createdAt: '2026-10-10T00:00:00.000Z',
	updatedAt: '2026-10-10T01:00:00.000Z',
	...over,
});

const rawSession = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: 's1', title: 'T', prompt: 'p', status: 'idle', model: null, modelLabel: null, projectId: null,
	workspaceName: 'app', workspaceInfo: { fileCount: 1, bytes: 1, skipped: 0, repoFullName: 'octo/app', gitBranch: 'main' },
	summary: null, errorMsg: null, changedFiles: 2, lastSeq: 5,
	createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', startedAt: '2026-10-01T00:00:00.000Z', completedAt: null,
	...over,
});

/** Runs a request against a fetch that never answers and checks it is aborted exactly after `ms`. */
const expectTimeout = async (run: () => Promise<unknown>, ms: number) => {
	jest.useFakeTimers();
	try {
		(globalThis as unknown as { fetch: unknown }).fetch = jest.fn((url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Promise((_, reject) => {
				init.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
			});
		});
		const promise = run();
		const settled = jest.fn();
		promise.then(settled, settled);
		for (let i = 0; i < 10 && calls.length === 0; i++) await Promise.resolve();
		expect(calls).toHaveLength(1);

		await jest.advanceTimersByTimeAsync(ms - 1);
		expect(settled).not.toHaveBeenCalled();
		await jest.advanceTimersByTimeAsync(1);
		await expect(promise).rejects.toMatchObject({ status: 0, message: 'timeout' });
		calls.length = 0;
	} finally {
		jest.useRealTimers();
	}
};

const suggestion = { title: 'Fix login', body: 'Summary\n\n- src/a.ts', branch: 'orchestra/fix-login-abc123', base: 'main' };

beforeEach(() => { calls.length = 0; });

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

describe('pullRequest on the session DTO', () => {
	it('reads a PR and leaves the key out when there is none', () => {
		const s = toCloudSession(rawSession({ pullRequest: rawPr({ draft: true }) }));
		expect(s.pullRequest).toEqual({
			number: 12, url: 'https://github.com/octo/app/pull/12', branch: 'orchestra/fix-login-abc123', base: 'main',
			headSha: 'deadbeef', title: 'Fix login', draft: true,
			createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T01:00:00.000Z',
		});
		expect('pullRequest' in toCloudSession(rawSession())).toBe(false);
		expect('pullRequest' in toCloudSession(rawSession({ pullRequest: null }))).toBe(false);
	});

	it('rejects PRs without a positive number or an https URL', () => {
		expect(toCloudPullRequest(rawPr({ number: 0 }))).toBeNull();
		expect(toCloudPullRequest(rawPr({ number: 'x' }))).toBeNull();
		expect(toCloudPullRequest(rawPr({ number: 1.5 }))).toBeNull();
		expect(toCloudPullRequest(rawPr({ url: 'javascript:alert(1)' }))).toBeNull();
		expect(toCloudPullRequest(rawPr({ url: 'http://github.com/octo/app/pull/12' }))).toBeNull();
		expect(toCloudPullRequest('nope')).toBeNull();
		expect(toCloudPullRequest({ number: 3, url: 'https://github.com/o/r/pull/3' })).toMatchObject({ number: 3, branch: '', draft: false });
	});
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('getPullRequestInfo', () => {
	it('GETs the session pull-request endpoint and reads the response', async () => {
		mockFetch(() => ({ status: 200, body: { pullRequest: null, suggestion, canCreate: true } }));
		const info = await getPullRequestInfo(auth, 's/1');
		expect(calls[0].url).toBe(`${BASE}/s%2F1/pull-request`);
		expect(calls[0].init.method).toBe('GET');
		expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
		expect(info).toEqual({ pullRequest: null, suggestion, canCreate: true });
	});

	it('keeps the reason and code when a PR cannot be created', async () => {
		mockFetch(() => ({
			status: 200,
			body: { pullRequest: null, suggestion, canCreate: false, reason: 'ベースブランチからの変更がありません。', code: 'no_changes' },
		}));
		const info = await getPullRequestInfo(auth, 's1');
		expect(info.canCreate).toBe(false);
		expect(info.reason).toBe('ベースブランチからの変更がありません。');
		expect(info.code).toBe('no_changes');
		expect('pullRequestState' in info).toBe(false);
	});

	it('reads pullRequestState only alongside a PR (unknown values become null)', () => {
		expect(toPullRequestInfo({ pullRequest: rawPr(), pullRequestState: 'merged', suggestion, canCreate: true }).pullRequestState).toBe('merged');
		expect(toPullRequestInfo({ pullRequest: rawPr(), pullRequestState: 'open', suggestion, canCreate: true }).pullRequestState).toBe('open');
		expect(toPullRequestInfo({ pullRequest: rawPr(), pullRequestState: null, suggestion }).pullRequestState).toBeNull();
		expect(toPullRequestInfo({ pullRequest: rawPr(), pullRequestState: 'draft', suggestion }).pullRequestState).toBeNull();
		expect('pullRequestState' in toPullRequestInfo({ pullRequest: null, pullRequestState: 'open', suggestion })).toBe(false);
	});

	it('waits up to 300 s (the server may start a stopped sandbox and diff it)', async () => {
		await expectTimeout(() => getPullRequestInfo(auth, 's1'), CLOUD_TIMEOUTS.pullRequestInfo);
		expect(CLOUD_TIMEOUTS.pullRequestInfo).toBeGreaterThanOrEqual(300_000);
	});

	it('fills in a missing suggestion and treats anything but true as canCreate=false', () => {
		expect(toPullRequestInfo({ canCreate: 'yes', reason: '  ' })).toEqual({
			pullRequest: null,
			suggestion: { title: '', body: '', branch: '', base: '' },
			canCreate: false,
		});
		expect(toPullRequestInfo(null).canCreate).toBe(false);
	});

	it('throws DivisionCloudError with the server code', async () => {
		mockFetch(() => ({ status: 409, body: { error: 'GitHub と連携してください。', code: 'github_not_connected' } }));
		await expect(getPullRequestInfo(auth, 's1')).rejects.toMatchObject({ status: 409, code: 'github_not_connected' });
	});
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe('createPullRequest', () => {
	it('POSTs title, body, branch, base and draft', async () => {
		mockFetch(() => ({ status: 200, body: { pullRequest: rawPr({ draft: true }), updated: true, action: 'created' } }));
		const res = await createPullRequest(auth, 's1', {
			title: '  Fix login  ', body: 'Body', branch: ' orchestra/fix ', base: 'main', draft: true,
		});
		expect(calls[0].url).toBe(`${BASE}/s1/pull-request`);
		expect(calls[0].init.method).toBe('POST');
		expect(bodyOf(calls[0])).toEqual({ title: 'Fix login', body: 'Body', branch: 'orchestra/fix', base: 'main', draft: true });
		expect(res).toEqual({ pullRequest: expect.objectContaining({ number: 12, draft: true }), updated: true, action: 'created' });
	});

	it('waits up to 600 s (commit + push + GitHub API) before timing out', async () => {
		await expectTimeout(() => createPullRequest(auth, 's1', { title: 'x' }), CLOUD_TIMEOUTS.pullRequest);
		expect(CLOUD_TIMEOUTS.pullRequest).toBeGreaterThanOrEqual(300_000);
	});

	it('reads action and falls back to updated when an older server omits it', async () => {
		mockFetch(() => ({ status: 200, body: { pullRequest: rawPr(), updated: false, action: 'unchanged' } }));
		const res = await createPullRequest(auth, 's1', { title: 'Fix login' });
		expect(bodyOf(calls[0])).toEqual({ title: 'Fix login' });
		expect(res).toMatchObject({ updated: false, action: 'unchanged' });

		mockFetch(() => ({ status: 200, body: { pullRequest: rawPr(), updated: true, action: 'updated' } }));
		expect((await createPullRequest(auth, 's1', { title: 'x' })).action).toBe('updated');
		mockFetch(() => ({ status: 200, body: { pullRequest: rawPr(), updated: true } }));
		expect((await createPullRequest(auth, 's1', { title: 'x' })).action).toBe('updated');
		mockFetch(() => ({ status: 200, body: { pullRequest: rawPr(), updated: false, action: 'weird' } }));
		expect((await createPullRequest(auth, 's1', { title: 'x' })).action).toBe('unchanged');
	});

	it('formats the result by action', () => {
		const pr = toCloudPullRequest(rawPr())!;
		expect(pullRequestResultText({ pullRequest: pr, action: 'created' })).toBe('PR #12 を作成しました');
		expect(pullRequestResultText({ pullRequest: pr, action: 'updated' })).toBe('PR #12 を更新しました');
		expect(pullRequestResultText({ pullRequest: pr, action: 'unchanged' })).toBe('変更はありません（PR は最新です）');
	});

	it('does not call the API when the input is invalid', async () => {
		mockFetch(() => ({ status: 200, body: {} }));
		await expect(createPullRequest(auth, 's1', { title: '   ' })).rejects.toThrow('タイトル');
		await expect(createPullRequest(auth, 's1', { title: 'x', branch: '-bad' })).rejects.toThrow('ブランチ');
		expect(calls).toHaveLength(0);
	});

	it('fails when the response has no usable PR', async () => {
		mockFetch(() => ({ status: 200, body: { pullRequest: null, updated: true } }));
		await expect(createPullRequest(auth, 's1', { title: 'x' })).rejects.toBeInstanceOf(DivisionCloudError);
	});

	it('passes the server error and code through', async () => {
		mockFetch(() => ({ status: 409, body: { error: '同じ名前のブランチがあります。', code: 'branch_exists' } }));
		const error = await createPullRequest(auth, 's1', { title: 'x' }).catch(e => e);
		expect(error).toMatchObject({ status: 409, code: 'branch_exists' });
		expect(pullRequestErrorText(error)).toBe('同じ名前のブランチがあります。');
	});
});

// ---------------------------------------------------------------------------
// Validation and body
// ---------------------------------------------------------------------------

describe('PR input validation', () => {
	it('requires a title within the server limit', () => {
		expect(pullRequestInputIssue({ title: '' })).toContain('タイトル');
		expect(pullRequestInputIssue({ title: 'a'.repeat(PULL_REQUEST_LIMITS.title) })).toBeNull();
		expect(pullRequestInputIssue({ title: 'a'.repeat(PULL_REQUEST_LIMITS.title + 1) })).toContain('256');
		expect(pullRequestInputIssue({ title: 'x', body: 'b'.repeat(PULL_REQUEST_LIMITS.body + 1) })).toContain('説明');
	});

	it('checks the head branch like git does (empty = server suggestion)', () => {
		expect(validatePullRequestBranch('')).toBeNull();
		expect(validatePullRequestBranch('orchestra/fix-login-abc123')).toBeNull();
		for (const bad of ['-x', 'a..b', 'a b', 'a/', 'a.', 'a.lock', 'a//b', '.hidden', 'a/.b', 'a~1']) {
			expect(validatePullRequestBranch(bad)).not.toBeNull();
		}
		expect(pullRequestInputIssue({ title: 'x', base: 'bad base' })).not.toBeNull();
	});

	it('leaves out empty optional fields and keeps draft=false', () => {
		expect(pullRequestBody({ title: 'T', body: '  ', branch: '', base: ' ', draft: false })).toEqual({ title: 'T', draft: false });
		expect(pullRequestBody({ title: 'T' })).toEqual({ title: 'T' });
	});
});

// ---------------------------------------------------------------------------
// Button and form helpers
// ---------------------------------------------------------------------------

describe('whether to offer the PR button', () => {
	const info = (over: Record<string, unknown> = {}) => ({ fileCount: 1, bytes: 1, skipped: 0, ...over });

	it('shows it for a GitHub repo session that is not working', () => {
		for (const status of ['idle', 'failed', 'cancelled'] as const) {
			expect(canOfferPullRequest({ status, workspaceInfo: info({ repoFullName: 'octo/app' }) })).toBe(true);
		}
	});

	it('hides it while running / uploading / provisioning', () => {
		for (const status of ['running', 'uploading', 'provisioning'] as const) {
			expect(canOfferPullRequest({ status, workspaceInfo: info({ repoFullName: 'octo/app' }) })).toBe(false);
		}
	});

	it('hides it for URL, PC folder and empty folder sessions', () => {
		expect(canOfferPullRequest({ status: 'idle', workspaceInfo: info({ repoUrl: 'https://github.com/octo/app' }) })).toBe(false);
		expect(canOfferPullRequest({ status: 'idle', workspaceInfo: info({ gitBranch: 'main' }) })).toBe(false);
		expect(canOfferPullRequest({ status: 'idle', workspaceInfo: null })).toBe(false);
		expect(canOfferPullRequest({ status: 'idle', workspaceInfo: info({ repoFullName: '  ' }) })).toBe(false);
	});

	it('labels the buttons by whether a PR exists', () => {
		const pr = toCloudPullRequest(rawPr())!;
		expect(pullRequestActionLabel(null)).toBe('PR を作成');
		expect(pullRequestActionLabel(pr)).toBe('PR を更新');
		expect(pullRequestActionLabel(pr, 'open')).toBe('PR を更新');
		expect(pullRequestActionLabel(pr, null)).toBe('PR を更新');
		expect(pullRequestActionLabel(pr, 'merged')).toBe('新しい PR を作成');
		expect(pullRequestActionLabel(pr, 'closed')).toBe('新しい PR を作成');
		expect(openPullRequestLabel(pr)).toBe('PR #12 を開く');
		expect(pullRequestMode(undefined)).toBe('create');
		expect(pullRequestMode(pr)).toBe('update');
		expect(pullRequestMode(pr, 'open')).toBe('update');
		expect(pullRequestMode(pr, 'merged')).toBe('create');
		expect(pullRequestMode(pr, 'closed')).toBe('create');
	});

	it('uses the GET state only for the same PR number', () => {
		const pr = toCloudPullRequest(rawPr())!;
		const other = toCloudPullRequest(rawPr({ number: 13 }))!;
		expect(pullRequestStateFor(pr, { pullRequest: pr, pullRequestState: 'merged' })).toBe('merged');
		expect(pullRequestStateFor(other, { pullRequest: pr, pullRequestState: 'merged' })).toBeNull();
		expect(pullRequestStateFor(pr, { pullRequest: pr })).toBeNull();
		expect(pullRequestStateFor(null, { pullRequest: pr, pullRequestState: 'open' })).toBeNull();
		expect(pullRequestStateFor(pr, null)).toBeNull();
	});
});

describe('reason shown instead of the button', () => {
	it('prefers the server reason and translates bare codes', () => {
		expect(pullRequestReasonText({ reason: 'エージェントが作業中です。', code: 'session_running' })).toBe('エージェントが作業中です。');
		expect(pullRequestReasonText({ reason: 'no_changes' })).toBe('ベースブランチからの変更がありません。');
		expect(pullRequestReasonText({ code: 'github_not_connected' })).toContain('GitHub と連携');
		expect(pullRequestReasonText({ code: 'session_archived' })).toContain('サンドボックスが削除');
		expect(pullRequestReasonText({ code: 'github_not_configured' })).toContain('未設定');
		expect(pullRequestReasonText({})).toBe('いまは PR を作成できません。');
	});

	it('detects github_not_connected from the code or a bare reason', () => {
		expect(isPullRequestNotConnected({ code: 'github_not_connected', reason: 'GitHub と連携してください' })).toBe(true);
		expect(isPullRequestNotConnected({ reason: 'github_not_connected' })).toBe(true);
		expect(isPullRequestNotConnected({ reason: 'GitHub と連携してください' })).toBe(false);
	});
});

describe('PR form', () => {
	const base: Pick<CloudPullRequestInfo, 'pullRequest' | 'suggestion'> = { pullRequest: null, suggestion };

	it('prefills a new PR from the suggestion', () => {
		expect(initialPullRequestForm(base)).toEqual({ ...suggestion, draft: false });
	});

	it('prefills an open PR from the suggestion (GitHub\'s current values) and keeps its draft state', () => {
		const pr = toCloudPullRequest(rawPr({ title: 'Old', branch: 'orchestra/x', base: 'dev', draft: true }))!;
		const current = { title: 'Edited on GitHub', body: 'GitHub body', branch: 'orchestra/x', base: 'dev' };
		expect(initialPullRequestForm({ pullRequest: pr, pullRequestState: 'open', suggestion: current }))
			.toEqual({ ...current, draft: true });
		// Gaps in the suggestion are filled from the PR
		expect(initialPullRequestForm({ pullRequest: pr, pullRequestState: 'open', suggestion: { title: '', body: '', branch: '', base: '' } }))
			.toEqual({ title: 'Old', body: '', branch: 'orchestra/x', base: 'dev', draft: true });
	});

	it('starts a fresh form (create mode, draft off) after the PR was merged or closed', () => {
		const pr = toCloudPullRequest(rawPr({ title: 'Old', branch: 'orchestra/x', draft: true }))!;
		for (const state of ['merged', 'closed'] as const) {
			expect(initialPullRequestForm({ pullRequest: pr, pullRequestState: state, suggestion })).toEqual({ ...suggestion, draft: false });
		}
	});

	it('sends branch, base and draft only when creating', () => {
		const form = { ...suggestion, draft: true };
		expect(pullRequestFormInput(form, 'create')).toEqual({ ...suggestion, draft: true });
		expect(pullRequestFormInput(form, 'update')).toEqual({ title: suggestion.title, body: suggestion.body });
	});
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('pullRequestErrorText', () => {
	it('uses the server message for PR codes instead of the generic status text', () => {
		expect(pullRequestErrorText(new DivisionCloudError(403, 'push 権限がありません。', 'github_no_push_access'))).toBe('push 権限がありません。');
		expect(pullRequestErrorText(new DivisionCloudError(502, 'GitHub: Validation Failed', 'github_error'))).toBe('GitHub: Validation Failed');
	});

	it('falls back to a Japanese text when only a code came back', () => {
		expect(pullRequestErrorText(new DivisionCloudError(409, 'HTTP 409', 'pr_in_progress'))).toContain('push しています');
		expect(pullRequestErrorText(new DivisionCloudError(409, 'HTTP 409', 'branch_diverged'))).toContain('ほかの push');
		expect(pullRequestErrorText(new DivisionCloudError(409, 'HTTP 409', 'session_archived'))).toContain('サンドボックスが削除');
		expect(pullRequestErrorText(new DivisionCloudError(502, 'HTTP 502', 'sandbox_error'))).toContain('git');
	});

	it('shows the server text for the final error codes', () => {
		const cases: [number, string][] = [
			[409, 'session_archived'], [409, 'branch_diverged'], [409, 'missing_parent'],
			[502, 'sandbox_error'], [503, 'github_not_configured'],
		];
		for (const [status, code] of cases) {
			expect(pullRequestErrorText(new DivisionCloudError(status, `サーバーの説明 ${code}`, code))).toBe(`サーバーの説明 ${code}`);
		}
		expect(pullRequestErrorText(new DivisionCloudError(400, 'タイトルは必須です / ブランチ名が不正です', 'validation')))
			.toBe('タイトルは必須です / ブランチ名が不正です');
	});

	it('uses the shared reconnect text for github_not_connected', () => {
		expect(pullRequestErrorText(new DivisionCloudError(409, 'x', 'github_not_connected'))).toContain('GitHub と連携');
	});

	it('explains a 404 without a code and keeps generic errors', () => {
		expect(pullRequestErrorText(new DivisionCloudError(404, 'HTTP 404'))).toContain('未対応');
		expect(pullRequestErrorText(new DivisionCloudError(401, 'expired'))).toContain('ログイン');
		expect(pullRequestErrorText(new Error('boom'))).toBe('boom');
	});
});

// ---------------------------------------------------------------------------
// Log event
// ---------------------------------------------------------------------------

describe('pull_request event card', () => {
	it('formats created and updated events', () => {
		expect(pullRequestEventText({ number: 12, action: 'created' })).toBe('PR #12 を作成しました');
		expect(pullRequestEventText({ number: 12, action: 'updated' })).toBe('PR #12 を更新しました');
	});

	it('reads the event data defensively', () => {
		expect(toPullRequestEvent({ number: 12, url: 'https://github.com/octo/app/pull/12', branch: 'b', base: 'main', action: 'updated', title: 'T' }))
			.toEqual({ number: 12, url: 'https://github.com/octo/app/pull/12', branch: 'b', base: 'main', action: 'updated', title: 'T' });
		expect(toPullRequestEvent({ number: 3, action: 'weird', url: 'file:///etc/passwd' }))
			.toEqual({ number: 3, url: '', branch: '', base: '', action: 'created', title: '' });
		expect(toPullRequestEvent({ action: 'created' })).toBeNull();
		expect(toPullRequestEvent({ number: -1 })).toBeNull();
	});
});
