/**
 * 実際の HTTP サーバを立てて、クライアントが IDE 側の契約どおりに喋るかを確かめる。
 *
 * サーバは IDE の remoteControlChannel + remoteControlService が返すものを最小限に
 * 真似ている (トークン検証・パス・メソッド・レスポンス形)。ここが通れば、
 * アプリ側の URL 組み立てとレスポンスの取り出しは IDE と噛み合う。
 */

import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';

import { OrchestraApiError, OrchestraClient } from '../client';

const TOKEN = 'integration-token';

type Handler = (body: any, query: URLSearchParams) => { status: number; body: unknown };

const routes: Record<string, Handler> = {
	'GET /api/ping': () => ({ status: 200, body: { ok: true, app: 'Orchestra', protocolVersion: 1, requiresToken: true } }),
	'GET /api/state': () => ({
		status: 200,
		body: {
			ide: { protocolVersion: 1, appName: 'Orchestra', version: '1.0.0', workspaceName: 'demo', workspaceFolders: ['/w'], uiLanguage: 'ja' },
			division: { projects: [], activeProjectIds: [], configPath: '/w/.division/projects.json', hasProject: false },
			kanban: { board: { version: 1, title: 'B', columns: [], tasks: [], updatedAt: 0 }, runtime: { autoRunEnabled: false } },
			chat: { threadId: 'th1', messages: [], isRunning: false, awaitingApproval: false },
			threads: [],
			revision: 3,
			generatedAt: 1,
		},
	}),
	'POST /api/kanban/tasks': (body) => ({ status: 201, body: { task: { id: 'new', title: body.title, columnId: body.columnId } } }),
	'POST /api/kanban/tasks/t1/run': () => ({ status: 202, body: { accepted: true, taskId: 't1' } }),
	'POST /api/kanban/tasks/t1/checklist': (body) => ({ status: 201, body: { task: { id: 't1', added: body.text } } }),
	'DELETE /api/kanban/tasks/t1/checklist/c1': () => ({ status: 200, body: { deleted: 'c1' } }),
	'POST /api/kanban/auto-run': (body) => ({ status: 200, body: { autoRunEnabled: body.enabled } }),
	'POST /api/division/projects/p1/activate': (body) => ({ status: 200, body: { activeProjectIds: body.exclusive ? ['p1'] : ['p0', 'p1'] } }),
	'POST /api/chat/message': (body) => ({ status: 202, body: { accepted: true, threadId: body.newThread ? 'th2' : 'th1' } }),
	'GET /api/files/list': (_body, query) => ({ status: 200, body: { path: `/w/${query.get('path') ?? ''}`, children: [] } }),
	'POST /api/kanban/tasks/locked': () => ({ status: 403, body: { error: 'forbidden', detail: 'カンバンの編集 は IDE 側の設定で無効になっています' } }),
};

let server: Server;
let client: OrchestraClient;

const readBody = (req: IncomingMessage): Promise<string> =>
	new Promise(resolve => {
		let raw = '';
		req.on('data', chunk => { raw += chunk; });
		req.on('end', () => resolve(raw));
	});

beforeAll(async () => {
	server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const path = url.pathname.replace(/\/+$/, '') || '/';
		const key = `${req.method} ${path}`;

		if (path !== '/api/ping' && req.headers['x-orchestra-token'] !== TOKEN) {
			res.writeHead(401, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'unauthorized' }));
			return;
		}

		const raw = await readBody(req);
		const handler = routes[key];
		if (!handler) {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'not_found', detail: path }));
			return;
		}

		const { status, body } = handler(raw ? JSON.parse(raw) : {}, url.searchParams);
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(body));
	});

	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	client = new OrchestraClient({ url: `http://127.0.0.1:${port}`, token: TOKEN, label: 'test' });
});

afterAll(async () => {
	await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('client ↔ IDE contract', () => {
	it('pings without a token and reads the protocol version', async () => {
		await expect(client.ping()).resolves.toMatchObject({ ok: true, protocolVersion: 1 });
	});

	it('reads a full snapshot', async () => {
		const snapshot = await client.getSnapshot();
		expect(snapshot.revision).toBe(3);
		expect(snapshot.ide.workspaceName).toBe('demo');
		expect(snapshot.chat.threadId).toBe('th1');
	});

	it('creates a kanban task in the requested column', async () => {
		await expect(client.createTask({ title: 'phone task', columnId: 'todo' }))
			.resolves.toEqual({ id: 'new', title: 'phone task', columnId: 'todo' });
	});

	it('accepts a fire-and-forget task run (202)', async () => {
		await expect(client.runTask('t1')).resolves.toBeUndefined();
	});

	it('adds and deletes checklist items', async () => {
		await expect(client.addChecklistItem('t1', 'step 1')).resolves.toEqual({ id: 't1', added: 'step 1' });
		await expect(client.deleteChecklistItem('t1', 'c1')).resolves.toBeUndefined();
	});

	it('toggles kanban auto-run', async () => {
		await expect(client.setAutoRun(true)).resolves.toBeUndefined();
	});

	it('activates a division project exclusively or additively', async () => {
		await expect(client.activateProject('p1')).resolves.toEqual({ activeProjectIds: ['p1'] });
		await expect(client.activateProject('p1', false)).resolves.toEqual({ activeProjectIds: ['p0', 'p1'] });
	});

	it('sends prompts to the existing or a new thread', async () => {
		await expect(client.sendPrompt('hi')).resolves.toEqual({ accepted: true, threadId: 'th1' });
		await expect(client.sendPrompt('hi', { newThread: true })).resolves.toEqual({ accepted: true, threadId: 'th2' });
	});

	it('passes the path through as a query param when listing files', async () => {
		await expect(client.listFiles('src/app')).resolves.toEqual({ path: '/w/src/app', children: [] });
	});

	it('surfaces a permission denial with the IDE detail text', async () => {
		expect.assertions(2);
		try {
			await client.request('/api/kanban/tasks/locked', { method: 'POST' });
		} catch (e) {
			expect((e as OrchestraApiError).status).toBe(403);
			expect((e as OrchestraApiError).userMessage).toContain('IDE 側の設定で無効');
		}
	});

	it('rejects a bad token', async () => {
		const bad = new OrchestraClient({ ...client.connection, token: 'nope' });
		await expect(bad.getSnapshot()).rejects.toMatchObject({ status: 401 });
	});

	it('reports an unreachable IDE as a network error', async () => {
		const dead = new OrchestraClient({ url: 'http://127.0.0.1:1', token: TOKEN, label: 'dead' });
		await expect(dead.ping()).rejects.toMatchObject({ status: 0 });
	});
});
