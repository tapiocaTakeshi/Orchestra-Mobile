/**
 * verifyAndConnect (ping → プロトコル確認 → state → connect) の分岐を、実際の HTTP サーバで確認する。
 * integration.test.ts と同じ「Node の http サーバで IDE を模す」方式。
 */

import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';

import {
	NOT_ACCOUNT_SESSION_MESSAGE,
	connectionsForAccount,
	findAccountSession,
	isAccountMismatch,
	verifyAndConnect,
} from '../connect';
import { OrchestraApiError } from '../../api/client';
import { Connection } from '../../api/types';

const TOKEN = 'connect-test-token';
/** PC 側でログインしているアカウントの JWT。これ以外は 403 account_mismatch にする (デスクトップと同じ)。 */
const ACCOUNT_JWT = 'account-jwt';
const ACCOUNT = { accessToken: ACCOUNT_JWT, sessions: [{ token: TOKEN }] };

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
			if (req.headers['x-division-access-token'] !== ACCOUNT_JWT) {
				send(403, { error: 'account_mismatch', detail: '同じ Division アカウントでログインしてください。' });
				return;
			}
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

		const result = await verifyAndConnect(candidate, async (c) => { connected.push(c); }, ACCOUNT);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.connection.label).toBe('demo-workspace');
			expect(result.warning).toBeUndefined();
		}
		expect(connected).toHaveLength(1);
	});

	it('keeps a caller-provided label instead of overwriting it', async () => {
		const candidate: Connection = { url: baseUrl, token: TOKEN, label: 'My PC' };
		const result = await verifyAndConnect(candidate, async () => { }, ACCOUNT);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.connection.label).toBe('My PC');
	});

	it('warns but still connects when the protocol version does not match', async () => {
		protocolVersionToReturn = 99;
		const candidate: Connection = { url: baseUrl, token: TOKEN, label: '' };
		const connected: Connection[] = [];

		const result = await verifyAndConnect(candidate, async (c) => { connected.push(c); }, ACCOUNT);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.warning).toContain('v99');
		expect(connected).toHaveLength(1);
	});

	it('fails with a readable message on a wrong token (401)', async () => {
		// RemoteSession に古いトークンが残っていて、PC 側ではもう変わっている場合
		const candidate: Connection = { url: baseUrl, token: 'wrong-token', label: '' };
		const result = await verifyAndConnect(candidate, async () => { }, { accessToken: ACCOUNT_JWT, sessions: [{ token: 'wrong-token' }] });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toContain('トークンが一致しません');
	});

	it('fails with a readable message when the IDE is unreachable', async () => {
		const candidate: Connection = { url: 'http://127.0.0.1:1', token: TOKEN, label: '' };
		const result = await verifyAndConnect(candidate, async () => { }, ACCOUNT);
		expect(result.ok).toBe(false);
	});

	it('refuses a PC that is not one of the account\'s sessions, without contacting it', async () => {
		// ペアリングリンクや手入力で、別アカウントの PC を指定された場合
		const candidate: Connection = { url: 'http://127.0.0.1:1', token: 'someone-elses-token', label: '' };
		const connected: Connection[] = [];
		const result = await verifyAndConnect(candidate, async (c) => { connected.push(c); }, ACCOUNT);
		expect(result).toEqual({ ok: false, message: NOT_ACCOUNT_SESSION_MESSAGE });
		expect(connected).toHaveLength(0);
	});

	it('refuses when the PC reports that it belongs to another account (403 account_mismatch)', async () => {
		const candidate: Connection = { url: baseUrl, token: TOKEN, label: '' };
		const connected: Connection[] = [];
		const result = await verifyAndConnect(candidate, async (c) => { connected.push(c); }, { accessToken: 'other-account-jwt', sessions: [{ token: TOKEN }] });
		expect(result).toEqual({ ok: false, message: NOT_ACCOUNT_SESSION_MESSAGE });
		expect(connected).toHaveLength(0);
	});
});

describe('account scoping helpers', () => {
	it('matches a candidate to the account session with the same pairing token', () => {
		const sessions = [{ id: 'a', token: 't1' }, { id: 'b', token: 't2' }];
		expect(findAccountSession({ token: 't2' }, sessions)?.id).toBe('b');
		expect(findAccountSession({ token: 't3' }, sessions)).toBeUndefined();
		// 空のトークン同士を「一致」とはみなさない
		expect(findAccountSession({ token: '' }, [{ token: '' }])).toBeUndefined();
	});

	it('only lists saved connections that were made by the signed-in account', () => {
		const saved: Connection[] = [
			{ url: 'http://a', token: 'x', label: 'A', ownerUserId: 'user-1' },
			{ url: 'http://b', token: 'y', label: 'B', ownerUserId: 'user-2' },
			{ url: 'http://c', token: 'z', label: '保存元が分からない古い接続' },
		];
		expect(connectionsForAccount(saved, 'user-1').map(c => c.label)).toEqual(['A']);
		expect(connectionsForAccount(saved, null)).toEqual([]);
	});

	it('recognises the desktop\'s account_mismatch rejection', () => {
		expect(isAccountMismatch(new OrchestraApiError(403, 'account_mismatch', '同じ Division アカウントでログインしてください。'))).toBe(true);
		expect(isAccountMismatch(new OrchestraApiError(403, 'forbidden'))).toBe(false);
		expect(isAccountMismatch(new OrchestraApiError(401, 'invalid_token'))).toBe(false);
	});
});
