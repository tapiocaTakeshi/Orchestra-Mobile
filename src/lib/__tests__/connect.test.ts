/**
 * verifyAndConnect (ping → プロトコル確認 → state → connect) の分岐を、実際の HTTP サーバで確認する。
 * integration.test.ts と同じ「Node の http サーバで IDE を模す」方式。
 */

import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';

import { verifyAndConnect } from '../connect';
import { Connection } from '../../api/types';

const TOKEN = 'connect-test-token';

let server: Server;
let baseUrl: string;
let protocolVersionToReturn = 1;

const snapshotBody = {
	ide: { protocolVersion: 1, appName: 'Orchestra', version: '1.0.0', workspaceName: 'demo-workspace', workspaceFolders: ['/w'], uiLanguage: 'ja' },
	division: { projects: [], activeProjectIds: [], configPath: null, hasProject: false },
	kanban: { board: { version: 1, title: '', columns: [], tasks: [], updatedAt: 0 }, runtime: { autoRunEnabled: false } },
	chat: { threadId: '', messages: [], isRunning: false, awaitingApproval: false },
	threads: [],
	revision: 1,
	generatedAt: 1,
};

beforeAll(async () => {
	server = createServer((req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const send = (status: number, body: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(body));
		};

		if (url.pathname === '/api/ping') {
			send(200, { ok: true, app: 'Orchestra', protocolVersion: protocolVersionToReturn, requiresToken: true });
			return;
		}
		if (url.pathname === '/api/state') {
			if (req.headers['x-orchestra-token'] !== TOKEN) { send(401, { error: 'unauthorized' }); return; }
			send(200, snapshotBody);
			return;
		}
		send(404, { error: 'not_found' });
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
	await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
	protocolVersionToReturn = 1;
});

describe('verifyAndConnect', () => {
	it('connects and fills in the label from the workspace name when the caller left it blank', async () => {
		const candidate: Connection = { url: baseUrl, token: TOKEN, label: '' };
		const connected: Connection[] = [];

		const result = await verifyAndConnect(candidate, async (c) => { connected.push(c); });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.connection.label).toBe('demo-workspace');
			expect(result.warning).toBeUndefined();
		}
		expect(connected).toHaveLength(1);
	});

	it('keeps a caller-provided label instead of overwriting it', async () => {
		const candidate: Connection = { url: baseUrl, token: TOKEN, label: 'My PC' };
		const result = await verifyAndConnect(candidate, async () => { });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.connection.label).toBe('My PC');
	});

	it('warns but still connects when the protocol version does not match', async () => {
		protocolVersionToReturn = 99;
		const candidate: Connection = { url: baseUrl, token: TOKEN, label: '' };
		const connected: Connection[] = [];

		const result = await verifyAndConnect(candidate, async (c) => { connected.push(c); });

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.warning).toContain('v99');
		expect(connected).toHaveLength(1);
	});

	it('fails with a readable message on a wrong token (401)', async () => {
		const candidate: Connection = { url: baseUrl, token: 'wrong-token', label: '' };
		const result = await verifyAndConnect(candidate, async () => { });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain('トークンが一致しません');
	});

	it('fails with a readable message when the IDE is unreachable', async () => {
		const candidate: Connection = { url: 'http://127.0.0.1:1', token: TOKEN, label: '' };
		const result = await verifyAndConnect(candidate, async () => { });
		expect(result.ok).toBe(false);
	});
});
