/**
 * Division Project をモデルにしたクラウドエージェント。作成の body (model: 'division-project' + projectId)、
 * モデルの選択肢の組み立て、plan / task イベントからの計画の進み具合を確認する。
 * Supabase (JWT の取得) はフェイクに差し替え、fetch はテストごとに差し替える。
 */

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
	getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
}));

import {
	CloudModelSelection,
	CloudSessionEvent,
	DEFAULT_MODEL_LABEL,
	DIVISION_PROJECT_MODEL,
	applyModelOption,
	cloudModelLabel,
	cloudModelOptions,
	createCloudSession,
	createSessionBody,
	divisionTimeline,
	isDivisionProjectModel,
	launchModelFields,
	launchSessions,
	modelOptionKey,
	modelSelectionIssue,
	taskHeaderLabel,
	toCloudPlan,
	toCloudTaskEvent,
	toModelSelection,
} from '../divisionCloud';

const BASE = 'https://api.division.he-ro.jp/api/cloud-sessions';
const auth = { userId: 'u1', email: 'a@example.com', accessToken: 'at', refreshToken: 'rt' };

type FetchCall = { url: string; init: RequestInit };
const calls: FetchCall[] = [];

const rawSession = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: 's1', title: 'T', prompt: 'p', status: 'uploading', model: null, modelLabel: null, projectId: null,
	workspaceName: null, workspaceInfo: null, summary: null, errorMsg: null, changedFiles: 0, lastSeq: 0,
	createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', startedAt: null, completedAt: null,
	...over,
});

const mockFetch = (impl: (url: string, init: RequestInit) => { status: number; body: unknown }) => {
	(globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		const { status, body } = impl(url, init);
		return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
	});
};

const bodyOf = (call: FetchCall): unknown => JSON.parse(String(call.init.body));

beforeEach(() => { calls.length = 0; });

// ---------------------------------------------------------------------------
// 作成
// ---------------------------------------------------------------------------

describe('create body for division-project', () => {
	it('sends model and projectId together', () => {
		expect(createSessionBody({ prompt: 'p', model: ' division-project ', projectId: ' proj-1 ' }))
			.toEqual({ prompt: 'p', model: DIVISION_PROJECT_MODEL, projectId: 'proj-1' });
	});

	it('rejects division-project without a projectId', () => {
		expect(() => createSessionBody({ prompt: 'p', model: DIVISION_PROJECT_MODEL })).toThrow('プロジェクト');
		expect(() => createSessionBody({ prompt: 'p', model: DIVISION_PROJECT_MODEL, projectId: '  ' })).toThrow('プロジェクト');
	});

	it('keeps other models and the default unchanged', () => {
		expect(createSessionBody({ prompt: 'p', model: 'anthropic/claude' })).toEqual({ prompt: 'p', model: 'anthropic/claude' });
		expect(createSessionBody({ prompt: 'p', projectId: 'proj-1' })).toEqual({ prompt: 'p', projectId: 'proj-1' });
	});

	it('posts the division body and does not call the API when invalid', async () => {
		mockFetch(() => ({ status: 201, body: { session: rawSession({ model: DIVISION_PROJECT_MODEL, projectId: 'proj-1' }) } }));
		const s = await createCloudSession(auth, { prompt: 'Build it', model: DIVISION_PROJECT_MODEL, projectId: 'proj-1' });
		expect(calls[0].url).toBe(BASE);
		expect(bodyOf(calls[0])).toEqual({ prompt: 'Build it', model: 'division-project', projectId: 'proj-1' });
		expect(cloudModelLabel(s)).toBe('Division Project');

		calls.length = 0;
		await expect(createCloudSession(auth, { prompt: 'x', model: DIVISION_PROJECT_MODEL })).rejects.toThrow('プロジェクト');
		expect(calls).toHaveLength(0);
	});

	it('launchSessions sends model + projectId on every create and validates first', async () => {
		mockFetch(url => (url === BASE
			? { status: 201, body: { session: rawSession({ id: 'd1' }) } }
			: { status: 200, body: { session: rawSession({ id: 'd1', status: 'running' }) } }));
		const results = await launchSessions(auth, { prompt: 'p', count: 2, model: DIVISION_PROJECT_MODEL, projectId: 'proj-9' });
		expect(results.every(r => !r.error)).toBe(true);
		const creates = calls.filter(c => c.url === BASE);
		expect(creates).toHaveLength(2);
		for (const c of creates) expect(bodyOf(c)).toMatchObject({ model: 'division-project', projectId: 'proj-9' });

		calls.length = 0;
		await expect(launchSessions(auth, { prompt: 'p', count: 1, model: DIVISION_PROJECT_MODEL })).rejects.toThrow('プロジェクト');
		expect(calls).toHaveLength(0);
	});

	it('labels the session with the server label once it is resolved', () => {
		expect(isDivisionProjectModel('division-project')).toBe(true);
		expect(isDivisionProjectModel('anthropic/claude')).toBe(false);
		expect(isDivisionProjectModel(null)).toBe(false);
		expect(cloudModelLabel({ model: DIVISION_PROJECT_MODEL, modelLabel: 'Division Project · Shop' })).toBe('Division Project · Shop');
		expect(cloudModelLabel({ model: null, modelLabel: null })).toBe('既定のモデル');
	});
});

// ---------------------------------------------------------------------------
// モデルの選択
// ---------------------------------------------------------------------------

describe('model picker options', () => {
	const projects = [
		{ id: 'p1', name: 'Shop', active: true },
		{ id: 'p2', name: 'Blog' },
	];

	it('lists Division Projects first, then the default, then manual input', () => {
		const options = cloudModelOptions(projects);
		expect(options.map(o => o.key)).toEqual(['division:p1', 'division:p2', 'default', 'custom']);
		expect(options[0]).toMatchObject({ mode: 'division', label: 'Division Project · Shop', projectId: 'p1', active: true });
		expect(options[1].active).toBeUndefined();
		expect(options[2].label).toBe(DEFAULT_MODEL_LABEL);
		expect(cloudModelOptions([]).map(o => o.key)).toEqual(['default', 'custom']);
	});

	it('keeps a selected project that is no longer listed visible', () => {
		const options = cloudModelOptions(projects, 'gone-1234567890');
		expect(options[0]).toMatchObject({ key: 'division:gone-1234567890', label: 'Division Project · プロジェクト gone-123' });
		expect(cloudModelOptions(projects, 'p2').filter(o => o.key === 'division:p2')).toHaveLength(1);
	});

	it('picking an option sets the mode and, for a Division Project, the project', () => {
		const start: CloudModelSelection = { mode: 'custom', model: 'a/b', projectId: 'p2' };
		const [shop] = cloudModelOptions(projects);
		const division = applyModelOption(start, shop);
		expect(division).toEqual({ mode: 'division', model: 'a/b', projectId: 'p1' });
		expect(modelOptionKey(division)).toBe('division:p1');
		const def = applyModelOption(division, cloudModelOptions(projects).find(o => o.mode === 'default')!);
		expect(def).toEqual({ mode: 'default', model: 'a/b', projectId: 'p1' });
		expect(modelOptionKey(def)).toBe('default');
	});

	it('builds the launch fields for each mode', () => {
		expect(launchModelFields({ mode: 'division', model: 'ignored', projectId: ' p1 ' })).toEqual({ model: 'division-project', projectId: 'p1' });
		expect(launchModelFields({ mode: 'default', model: 'ignored', projectId: 'p1' })).toEqual({ projectId: 'p1' });
		expect(launchModelFields({ mode: 'default', model: '', projectId: '' })).toEqual({});
		expect(launchModelFields({ mode: 'custom', model: ' a/b ', projectId: '' })).toEqual({ model: 'a/b' });
		expect(launchModelFields({ mode: 'custom', model: '  ', projectId: 'p2' })).toEqual({ projectId: 'p2' });
	});

	it('requires a project for a Division Project (also when typed by hand)', () => {
		expect(modelSelectionIssue({ mode: 'division', model: '', projectId: '' })).toContain('プロジェクト');
		expect(modelSelectionIssue({ mode: 'custom', model: 'division-project', projectId: '' })).toContain('プロジェクト');
		expect(modelSelectionIssue({ mode: 'custom', model: 'division-project', projectId: 'p1' })).toBeNull();
		expect(modelSelectionIssue({ mode: 'division', model: '', projectId: 'p1' })).toBeNull();
		expect(modelSelectionIssue({ mode: 'default', model: '', projectId: '' })).toBeNull();
	});

	it('reads back a stored selection only when it is valid', () => {
		expect(toModelSelection({ mode: 'division', projectId: 'p1' })).toEqual({ mode: 'division', model: '', projectId: 'p1' });
		expect(toModelSelection({ mode: 'custom', model: 'a/b', projectId: 3 })).toEqual({ mode: 'custom', model: 'a/b', projectId: '' });
		expect(toModelSelection({ mode: 'division', projectId: '' })).toBeNull();
		expect(toModelSelection({ mode: 'other' })).toBeNull();
		expect(toModelSelection(null)).toBeNull();
		expect(toModelSelection('division')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 計画とタスク
// ---------------------------------------------------------------------------

let seq = 0;
const ev = (type: string, data: Record<string, unknown> = {}): CloudSessionEvent =>
	({ seq: ++seq, type: type as CloudSessionEvent['type'], data, createdAt: '' });

const planTasks = [
	{ index: 0, role: 'designer', roleName: '設計', title: '設計する', instruction: 'i0', model: 'OpenAI · gpt' },
	{ index: 1, role: 'coder', roleName: '実装', title: 'API を足す', instruction: 'i1', model: 'Anthropic · claude-opus' },
	{ index: 2, role: 'tester', roleName: 'テスト', title: 'テストを書く', instruction: 'i2', model: 'Google · gemini' },
	{ index: 3, role: 'reviewer', roleName: 'レビュー', title: '見直す', instruction: 'i3', model: 'Anthropic · claude-sonnet' },
];
const task = (index: number, status: string, summary?: string) => {
	const t = planTasks[index];
	return ev('task', { index, role: t.role, roleName: t.roleName, title: t.title, model: t.model, status, ...(summary ? { summary } : {}) });
};

beforeEach(() => { seq = 0; });

describe('plan progress', () => {
	it('marks done, failed, running and pending tasks from later task events', () => {
		const plan = ev('plan', { tasks: planTasks, leaderModel: 'Anthropic · claude-opus' });
		const events = [
			ev('user', { text: 'build' }),
			plan,
			task(0, 'start'),
			ev('assistant', { text: 'designing', role: 'designer' }),
			task(0, 'done', '設計しました'),
			task(1, 'start'),
			task(1, 'failed', 'テストが通らない'),
			task(2, 'start'),
			ev('tool', { name: 'run', ok: true }),
		];
		const timeline = divisionTimeline(events, true);
		const progress = timeline.plans.get(plan.seq)!;
		expect(progress.leaderModel).toBe('Anthropic · claude-opus');
		expect(progress.items.map(i => i.state)).toEqual(['done', 'failed', 'running', 'pending']);
		expect(progress.items[0].summary).toBe('設計しました');
		expect(progress.done).toBe(1);
		expect(progress.failed).toBe(1);
		expect(timeline.taskPositions.get(events[7].seq)).toEqual({ position: 3, total: 4 });
		expect(timeline.roleNames.get('coder')).toBe('実装');
	});

	it('shows a started task as interrupted once the session stopped', () => {
		const plan = ev('plan', { tasks: planTasks, leaderModel: '' });
		const events = [plan, task(0, 'done'), task(1, 'start'), ev('status', { status: 'cancelled' })];
		expect(divisionTimeline(events, false).plans.get(plan.seq)!.items.map(i => i.state))
			.toEqual(['done', 'interrupted', 'pending', 'pending']);
	});

	it('uses the latest event for a retried task', () => {
		const plan = ev('plan', { tasks: planTasks });
		const events = [plan, task(0, 'failed'), task(0, 'start')];
		expect(divisionTimeline(events, true).plans.get(plan.seq)!.items[0].state).toBe('running');
		events.push(task(0, 'done'));
		expect(divisionTimeline(events, true).plans.get(plan.seq)!.items[0].state).toBe('done');
	});

	it('keeps each plan separate (a follow-up starts a new plan)', () => {
		const first = ev('plan', { tasks: planTasks.slice(0, 2) });
		const events: CloudSessionEvent[] = [first, task(0, 'done'), task(1, 'done'), ev('done', { summary: 'ok' })];
		const second = ev('plan', { tasks: [planTasks[1]] });
		events.push(ev('user', { text: 'more' }), second, task(1, 'start'));
		const timeline = divisionTimeline(events, true);
		expect(timeline.plans.get(first.seq)!.items.map(i => i.state)).toEqual(['done', 'done']);
		expect(timeline.plans.get(second.seq)!.items.map(i => i.state)).toEqual(['running']);
		expect(timeline.taskPositions.get(events[events.length - 1].seq)).toEqual({ position: 1, total: 1 });
	});

	it('ignores unknown event types, malformed data and tasks without a plan', () => {
		const events = [
			ev('task', { index: 0, status: 'start', role: 'coder', roleName: '実装' }),
			ev('future_thing', { anything: true }),
			ev('plan', { tasks: 'nope' }),
			ev('task', { index: 'x', status: 'done' }),
			ev('task', { index: 0, status: 'weird' }),
		];
		const timeline = divisionTimeline(events, true);
		expect(timeline.plans.get(3)).toEqual({ leaderModel: '', items: [], done: 0, failed: 0 });
		expect(timeline.taskPositions.size).toBe(0);
		expect(timeline.roleNames.get('coder')).toBe('実装');
		expect(divisionTimeline([], false).plans.size).toBe(0);
	});

	it('normalizes plan and task data defensively', () => {
		expect(toCloudPlan({ tasks: [null, { role: 'coder', title: 'T' }], leaderModel: 5 })).toEqual({
			leaderModel: '',
			tasks: [
				{ index: 0, role: '', roleName: '担当', title: '', instruction: '', model: '' },
				{ index: 1, role: 'coder', roleName: 'coder', title: 'T', instruction: '', model: '' },
			],
		});
		expect(toCloudTaskEvent({ index: 1, status: 'done', role: 'coder', summary: '  ' }))
			.toEqual({ index: 1, role: 'coder', roleName: 'coder', title: '', model: '', status: 'done' });
		expect(toCloudTaskEvent({ status: 'done' })).toBeNull();
	});

	it('formats the task header like the desktop', () => {
		const t = { roleName: '実装', model: 'Anthropic · claude-opus', title: 'API を足す' };
		expect(taskHeaderLabel(t, { position: 2, total: 4 })).toBe('2/4 · 実装 (Anthropic · claude-opus) — API を足す');
		expect(taskHeaderLabel({ roleName: '実装', model: '', title: '' })).toBe('実装');
	});
});
