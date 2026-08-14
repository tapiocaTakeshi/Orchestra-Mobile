import { normalizeBaseUrl, OrchestraApiError, OrchestraClient } from '../client';

type FetchCall = { url: string; init: RequestInit };

const calls: FetchCall[] = [];

const mockFetch = (impl: (url: string, init: RequestInit) => { status: number; body: unknown }) => {
	(globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		const { status, body } = impl(url, init);
		return {
			ok: status >= 200 && status < 300,
			status,
			text: async () => (body === undefined ? '' : JSON.stringify(body)),
		} as unknown as Response;
	});
};

const client = () => new OrchestraClient({ url: 'http://10.0.0.5:39231', token: 'tok', label: 'test' });

beforeEach(() => {
	calls.length = 0;
});

describe('normalizeBaseUrl', () => {
	it('adds a scheme and strips trailing slashes', () => {
		expect(normalizeBaseUrl('10.0.0.5:39231/')).toBe('http://10.0.0.5:39231');
		expect(normalizeBaseUrl(' https://box:39231// ')).toBe('https://box:39231');
		expect(normalizeBaseUrl('   ')).toBe('');
	});
});

describe('request', () => {
	it('sends the token header and encodes the path', async () => {
		mockFetch(() => ({ status: 200, body: { task: { id: 'a b' } } }));
		await client().updateTask('a b', { title: 'x' });

		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('http://10.0.0.5:39231/api/kanban/tasks/a%20b');
		expect(calls[0].init.method).toBe('PATCH');
		expect((calls[0].init.headers as Record<string, string>)['X-Orchestra-Token']).toBe('tok');
		expect(calls[0].init.body).toBe(JSON.stringify({ title: 'x' }));
	});

	it('appends defined query params only', async () => {
		mockFetch(() => ({ status: 200, body: { commands: [] } }));
		await client().listCommands(undefined);
		expect(calls[0].url).toBe('http://10.0.0.5:39231/api/commands');

		await client().listCommands('kanban run');
		expect(calls[1].url).toBe('http://10.0.0.5:39231/api/commands?q=kanban%20run');
	});

	it('turns an error body into an OrchestraApiError with a readable message', async () => {
		mockFetch(() => ({ status: 403, body: { error: 'forbidden', detail: 'カンバンの編集 は無効です' } }));

		await expect(client().createTask({ title: 'x' })).rejects.toMatchObject({
			status: 403,
			message: 'forbidden',
			detail: 'カンバンの編集 は無効です',
		});

		try {
			await client().createTask({ title: 'x' });
		} catch (e) {
			expect((e as OrchestraApiError).userMessage).toBe('カンバンの編集 は無効です');
		}
	});

	it('reports a network failure as status 0', async () => {
		(globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => { throw new Error('connection refused'); });

		await expect(client().getSnapshot()).rejects.toMatchObject({ status: 0, message: 'network_error' });
	});

	it('does not choke on a non-JSON body', async () => {
		(globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => 'not json',
		} as unknown as Response));

		await expect(client().getSnapshot()).resolves.toEqual({ raw: 'not json' });
	});
});

describe('endpoints', () => {
	it('unwraps the task from a create response', async () => {
		mockFetch(() => ({ status: 201, body: { task: { id: 't1', title: 'hello' } } }));
		const task = await client().createTask({ title: 'hello', columnId: 'todo' });
		expect(task).toEqual({ id: 't1', title: 'hello' });
		expect(calls[0].init.body).toBe(JSON.stringify({ title: 'hello', columnId: 'todo' }));
	});

	it('posts a move with the target column and index', async () => {
		mockFetch(() => ({ status: 200, body: {} }));
		await client().moveTask('t1', 'done', 2);
		expect(calls[0].url).toBe('http://10.0.0.5:39231/api/kanban/tasks/t1/move');
		expect(calls[0].init.body).toBe(JSON.stringify({ columnId: 'done', index: 2 }));
	});

	it('activates a project exclusively by default', async () => {
		mockFetch(() => ({ status: 200, body: { projects: [], activeProjectIds: [] } }));
		await client().activateProject('p1');
		expect(calls[0].url).toBe('http://10.0.0.5:39231/api/division/projects/p1/activate');
		expect(calls[0].init.body).toBe(JSON.stringify({ exclusive: true }));
	});

	it('sends a prompt without opening a new thread unless asked', async () => {
		mockFetch(() => ({ status: 202, body: { threadId: 'th1' } }));
		await client().sendPrompt('build it');
		expect(calls[0].init.body).toBe(JSON.stringify({ message: 'build it', newThread: false }));

		await client().sendPrompt('build it', { newThread: true });
		expect(calls[1].init.body).toBe(JSON.stringify({ message: 'build it', newThread: true }));
	});

	it('unwraps provider models', async () => {
		mockFetch(() => ({ status: 200, body: { providers: [{ provider: 'anthropic', models: ['claude-opus-4-6'] }] } }));
		await expect(client().getProviderModels()).resolves.toEqual([
			{ provider: 'anthropic', models: ['claude-opus-4-6'] },
		]);
	});
});
