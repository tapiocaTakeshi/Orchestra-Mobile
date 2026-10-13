/**
 * PC に繋いでいないときのプロジェクト管理。Division API の応答の変換と、送る内容を確認する。
 */

const requests: { path: string; options?: { method?: string; body?: unknown } }[] = [];
const responses = new Map<string, unknown>();

jest.mock('../divisionCloud', () => ({
	divisionApiRequest: async (_session: unknown, path: string, options?: { method?: string; body?: unknown }) => {
		requests.push({ path, options });
		const key = `${options?.method ?? 'GET'} ${path}`;
		if (!responses.has(key)) throw new Error(`unexpected ${key}`);
		return responses.get(key);
	},
}));

import {
	createCloudProject,
	deleteCloudProject,
	listCloudProjects,
	modelFromConfig,
	saveCloudAssignments,
	toAgents,
	toAssignmentsBody,
	toCloudProject,
	toProviderModels,
} from '../divisionCloudProjects';

const session = { userId: 'u1', accessToken: 'a', refreshToken: 'r' } as never;

beforeEach(() => {
	requests.length = 0;
	responses.clear();
});

describe('modelFromConfig', () => {
	it('reads JSON configs and legacy plain model ids', () => {
		expect(modelFromConfig('{"model":"claude-opus-5-5"}')).toBe('claude-opus-5-5');
		expect(modelFromConfig('gpt-5.4')).toBe('gpt-5.4');
		expect(modelFromConfig('{broken')).toBe('');
		expect(modelFromConfig(null)).toBe('');
	});
});

describe('toAgents', () => {
	it('orders by priority and keeps one assignment per role', () => {
		expect(toAgents([
			{ roleId: 'coder', providerId: 'openai', priority: 1, config: '{"model":"gpt-6"}' },
			{ roleId: 'leader', providerId: 'anthropic', priority: 5, config: null, provider: { modelId: 'claude-opus-5-5' } },
			{ role: { slug: 'coder' }, roleId: 'x', providerId: 'anthropic', priority: 3, config: '{"model":"claude-fable-5-1"}' },
			{ roleId: '', providerId: 'openai' },
		])).toEqual([
			{ role: 'leader', provider: 'anthropic', model: 'claude-opus-5-5' },
			{ role: 'coder', provider: 'anthropic', model: 'claude-fable-5-1' },
		]);
		expect(toAgents(undefined)).toEqual([]);
	});
});

describe('toCloudProject / toProviderModels', () => {
	it('drops rows without an id and names unnamed projects', () => {
		expect(toCloudProject({ id: '' })).toBeNull();
		expect(toCloudProject({ id: 'p1', name: ' ' })).toEqual({ projectId: 'p1', name: '名前のないプロジェクト', agents: [], isActive: false });
	});

	it('keeps providers that have models', () => {
		expect(toProviderModels({
			providers: [
				{ id: 'anthropic', models: [{ modelId: 'claude-opus-5-5' }, { modelId: 3 }] },
				{ id: 'empty', models: [] },
			],
		})).toEqual([{ provider: 'anthropic', models: ['claude-opus-5-5'] }]);
		expect(toProviderModels(null)).toEqual([]);
	});
});

describe('toAssignmentsBody', () => {
	it('skips duplicates and rows without a provider', () => {
		expect(toAssignmentsBody([
			{ role: 'coder', provider: 'anthropic', model: ' claude-opus-5-5 ' },
			{ role: 'coder', provider: 'openai', model: 'gpt-6' },
			{ role: 'writer', provider: '', model: '' },
		])).toEqual({ assignments: [{ role: 'coder', provider: 'anthropic', model: 'claude-opus-5-5' }] });
	});
});

describe('API calls', () => {
	it('lists projects with their assignments', async () => {
		responses.set('GET /api/projects', [{ id: 'p1', name: 'Main' }, { id: 'p2', name: 'Broken' }]);
		responses.set('GET /api/projects/p1', { id: 'p1', name: 'Main', assignments: [{ roleId: 'coder', providerId: 'anthropic', config: 'claude-opus-5-5' }] });
		const projects = await listCloudProjects(session);
		expect(projects).toEqual([
			{ projectId: 'p1', name: 'Main', agents: [{ role: 'coder', provider: 'anthropic', model: 'claude-opus-5-5' }], isActive: false },
			// 詳細が読めなくても一覧には残す
			{ projectId: 'p2', name: 'Broken', agents: [], isActive: false },
		]);
	});

	it('creates a project and copies the assignments', async () => {
		responses.set('POST /api/projects', { id: 'new', name: 'New' });
		responses.set('PUT /api/projects/new/assignments', { id: 'new', name: 'New', assignments: [{ roleId: 'coder', providerId: 'anthropic', config: '{"model":"m"}' }] });
		const project = await createCloudProject(session, ' New ', [{ role: 'coder', provider: 'anthropic', model: 'm' }]);
		expect(requests.map(r => [r.options?.method, r.path, r.options?.body])).toEqual([
			['POST', '/api/projects', { name: 'New' }],
			['PUT', '/api/projects/new/assignments', { assignments: [{ role: 'coder', provider: 'anthropic', model: 'm' }] }],
		]);
		expect(project.agents).toEqual([{ role: 'coder', provider: 'anthropic', model: 'm' }]);
	});

	it('does not send assignments for a project created without any', async () => {
		responses.set('POST /api/projects', { id: 'new', name: 'New' });
		await createCloudProject(session, 'New');
		expect(requests).toHaveLength(1);
	});

	it('saves assignments and deletes projects with encoded ids', async () => {
		responses.set('PUT /api/projects/a%2Fb/assignments', { id: 'a/b', name: 'X', assignments: [] });
		responses.set('DELETE /api/projects/a%2Fb', {});
		await saveCloudAssignments(session, 'a/b', []);
		await deleteCloudProject(session, 'a/b');
		expect(requests.map(r => r.path)).toEqual(['/api/projects/a%2Fb/assignments', '/api/projects/a%2Fb']);
	});
});
