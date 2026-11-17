/**
 * Jev でプロジェクトを作る API (POST /api/routing/project) のクライアント。
 * 送る中身 (プロンプト・3 つの値・名前)・認証・応答の読み取り・エラー文言を確かめる。
 */

const mockGetToken = jest.fn();
jest.mock('../divisionAuth', () => ({
	getDivisionAccessToken: (...args: unknown[]) => mockGetToken(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const routing = require('../divisionRouting') as typeof import('../divisionRouting');

const session = { userId: 'u1', email: 'me@example.com', accessToken: 'stale', refreshToken: 'r' };
const sliders = { effort: 'high' as const, maxCostUsd: 0.2, minPerformance: 85 };

const planResponse = {
	project: { id: 'p-new', name: 'コンパイラを書く' },
	plan: {
		sliders,
		picks: { coder: 'anthropic/claude-opus-5' },
		totals: { costUsd: 0.2, performance: 90.4 },
		jev: { model: 'jev-latest', costUsd: 0.0012 },
		assignments: [
			{ roleSlug: 'leader', roleName: 'Leader', providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'deepseek-flash', modelName: 'deepseek-flash', rank: 9, score: 82.5, effort: null, costUsd: 0.0024, status: 'ok' },
			{ roleSlug: 'coder', roleName: 'Coder', providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-opus-5', modelName: 'Claude Opus 5', rank: 1, score: 98.3, effort: 'high', costUsd: 0.19, status: 'ok' },
			{ roleSlug: 'reviewer', roleName: 'Reviewer', providerId: 'google', providerName: 'Gemini', modelId: 'gemini-3.8-flash', modelName: 'gemini-3.8-flash', rank: 5, score: 89.1, effort: 'weird', costUsd: 0.01, status: 'below-performance' },
		],
	},
};

const realFetch = global.fetch;
let calls: { url: string; init: RequestInit }[] = [];
const respond = (status: number, body: unknown) => {
	global.fetch = jest.fn(async (url: string, init: RequestInit) => {
		calls.push({ url: String(url), init });
		return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
	}) as unknown as typeof fetch;
};

beforeEach(() => {
	calls = [];
	mockGetToken.mockReset().mockResolvedValue('fresh-token');
});
afterAll(() => { global.fetch = realFetch; });

test('プロンプトと 3 つの値を Bearer で送り、応答を読み取る', async () => {
	respond(201, planResponse);
	const result = await routing.createProjectWithJev(session, { goal: '  コンパイラを書く\n最適化も  ', sliders, name: '' });

	expect(calls).toHaveLength(1);
	expect(calls[0].url).toBe('https://api.division.he-ro.io/api/routing/project');
	expect(calls[0].init.method).toBe('POST');
	expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer fresh-token');
	// 名前が空ならプロンプトの 1 行目
	expect(JSON.parse(String(calls[0].init.body))).toEqual({ goal: 'コンパイラを書く\n最適化も', sliders, name: 'コンパイラを書く' });

	expect(result.projectId).toBe('p-new');
	expect(result.projectName).toBe('コンパイラを書く');
	expect(result.totalCostUsd).toBe(0.2);
	expect(result.jevCostUsd).toBe(0.0012);
	expect(result.assignments.map(a => [a.roleSlug, a.pickedByJev, a.effort, a.status])).toEqual([
		['leader', false, null, 'ok'],
		['coder', true, 'high', 'ok'],
		['reviewer', false, null, 'below-performance'], // 知らないエフォートは捨てる
	]);
});

test('roles は指定したときだけ送る', async () => {
	respond(201, planResponse);
	await routing.createProjectWithJev(session, { goal: 'x', sliders });
	expect('roles' in JSON.parse(String(calls[0].init.body))).toBe(false);
	await routing.createProjectWithJev(session, { goal: 'x', sliders, roles: ['leader', 'coder'] });
	expect(JSON.parse(String(calls[1].init.body)).roles).toEqual(['leader', 'coder']);
	expect(routing.JEV_STANDARD_ROLES).toEqual(['leader', 'searcher', 'file-searcher', 'researcher', 'writer', 'designer', 'coder', 'reviewer']);
});

test('名前を指定したらそれを送る。空のプロンプトは送らない', async () => {
	respond(201, planResponse);
	await routing.createProjectWithJev(session, { goal: 'x', sliders, name: ' 勉強会 ' });
	expect(JSON.parse(String(calls[0].init.body)).name).toBe('勉強会');
	await expect(routing.createProjectWithJev(session, { goal: '   ', sliders })).rejects.toThrow('プロンプトを入力してください');
	expect(calls).toHaveLength(1);
});

test('クレジット不足・プラン外は分かる文言にする', async () => {
	respond(402, { error: 'Insufficient credits' });
	const credit = await routing.createProjectWithJev(session, { goal: 'x', sliders }).catch(e => e);
	expect(credit).toBeInstanceOf(routing.DivisionRoutingError);
	expect(credit.userMessage).toContain('クレジットが不足');

	respond(403, { error: 'Orchestra Plus subscription required' });
	const plan = await routing.createProjectWithJev(session, { goal: 'x', sliders }).catch(e => e);
	expect(plan.userMessage).toContain('Plus');
});

test('defaultJevProjectName は空行を飛ばし、長い行を切る', () => {
	expect(routing.defaultJevProjectName('\n\n  勉強会  \n2 行目')).toBe('勉強会');
	expect(routing.defaultJevProjectName('あ'.repeat(70))).toBe(`${'あ'.repeat(60)}…`);
	expect(routing.defaultJevProjectName('')).toBe('');
});
