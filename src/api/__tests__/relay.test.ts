/**
 * 外出先からの中継 (relayCodec / relay / OrchestraClient の切り替え) のテスト。
 *
 * Supabase の代わりに、同じプロセスの中で PC 役が返事をする偽のチャンネルを使う。
 * PC 役は Node の crypto / zlib で IDE 側 (orchestraMobileRelay.ts) と同じ手順を踏み、
 * スマホ側の noble / fflate 実装と中身が食い違わないことも確かめる。
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import { deflateRawSync, inflateRawSync } from 'zlib';

import { OrchestraClient } from '../client';
import { RelayChannelFactory, setRelayChannelFactory } from '../relay';
import {
	RELAY_CHUNK_CHARS,
	RelayAssembler,
	RelayRequest,
	deriveRelayKeys,
	fromBase64,
	openRelayMessage,
	sealRelayMessage,
	splitRelayMessage,
	toBase64,
} from '../relayCodec';

const TOKEN = 'relay-test-token-0123456789abcdefghijklmnop';
const ACCOUNT_JWT = 'account-jwt';

// --- IDE 側と同じ手順 (Node の crypto) ---------------------------------------

const SALT = Buffer.from('orchestra-remote-relay');
const pcKey = (token: string) => Buffer.from(hkdfSync('sha256', Buffer.from(token), SALT, Buffer.from('key'), 32));
const pcTopic = (token: string) => `orchestra-remote-${Buffer.from(hkdfSync('sha256', Buffer.from(token), SALT, Buffer.from('topic'), 16)).toString('hex')}`;

const pcSeal = (key: Buffer, kind: string, message: unknown): string => {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(Buffer.from(kind));
	const encrypted = Buffer.concat([cipher.update(deflateRawSync(Buffer.from(JSON.stringify(message)))), cipher.final()]);
	return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64');
};

const pcOpen = <T>(key: Buffer, kind: string, sealed: string): T => {
	const raw = Buffer.from(sealed, 'base64');
	const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
	decipher.setAAD(Buffer.from(kind));
	decipher.setAuthTag(raw.subarray(raw.length - 16));
	const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
	return JSON.parse(inflateRawSync(plain).toString('utf8')) as T;
};

/** PC 役の偽チャンネル。届いたリクエストを handler に渡して、暗号化した返事を返す。 */
const fakePc = (handler: (req: RelayRequest) => { status: number; body: unknown }) => {
	const received: RelayRequest[] = [];
	const topics: string[] = [];
	const factory: RelayChannelFactory = (topic, onResponseChunk) => {
		topics.push(topic);
		const key = pcKey(TOKEN);
		const assembler = new RelayAssembler();
		return {
			ready: Promise.resolve(),
			send: async (_event, payload) => {
				const message = assembler.add(payload);
				if (!message) return;
				const req = pcOpen<RelayRequest>(key, 'req', message.sealed);
				received.push(req);
				const sealed = pcSeal(key, 'res', { id: req.id, ...handler(req) });
				// 非同期に返す (実際の broadcast と同じく send の後で届く)
				setTimeout(() => splitRelayMessage(req.id, sealed).forEach(onResponseChunk), 0);
			},
			close: () => undefined,
		};
	};
	return { factory, received, topics };
};

describe('relayCodec', () => {
	it('derives the same key and channel as the desktop', () => {
		const keys = deriveRelayKeys(TOKEN);
		expect(Buffer.from(keys.key).equals(pcKey(TOKEN))).toBe(true);
		expect(keys.topic).toBe(pcTopic(TOKEN));
		expect(deriveRelayKeys('another-token').topic).not.toBe(keys.topic);
	});

	it('encodes base64 like Buffer', () => {
		for (const length of [0, 1, 2, 3, 4, 5, 255]) {
			const bytes = new Uint8Array(randomBytes(length));
			expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
			expect(Buffer.from(fromBase64(toBase64(bytes))).equals(Buffer.from(bytes))).toBe(true);
		}
	});

	it('opens what the desktop sealed and the other way round', () => {
		const { key } = deriveRelayKeys(TOKEN);
		const message = { id: 'x', status: 200, body: { text: 'こんにちは', list: [1, 2, 3] } };
		expect(openRelayMessage(key, 'res', pcSeal(pcKey(TOKEN), 'res', message))).toEqual(message);
		expect(pcOpen(pcKey(TOKEN), 'req', sealRelayMessage(key, 'req', message))).toEqual(message);
	});

	it('rejects a message sealed with another token or for the other direction', () => {
		const { key } = deriveRelayKeys(TOKEN);
		const sealed = sealRelayMessage(deriveRelayKeys('another-token').key, 'res', { id: 'x' });
		expect(() => openRelayMessage(key, 'res', sealed)).toThrow();
		// 自分が送ったリクエストを返事として受け取らない
		expect(() => openRelayMessage(key, 'res', sealRelayMessage(key, 'req', { id: 'x' }))).toThrow();
	});

	it('splits large messages and reassembles them in any order', () => {
		const sealed = 'a'.repeat(RELAY_CHUNK_CHARS * 2 + 10);
		const chunks = splitRelayMessage('m', sealed);
		expect(chunks).toHaveLength(3);
		const assembler = new RelayAssembler();
		expect(assembler.add(chunks[2])).toBeUndefined();
		expect(assembler.add(chunks[0])).toBeUndefined();
		expect(assembler.add(chunks[0])).toBeUndefined();
		expect(assembler.add(chunks[1])).toEqual({ id: 'm', sealed });
		expect(assembler.add({ id: 'bad' })).toBeUndefined();
	});
});

describe('OrchestraClient over the relay', () => {
	let restore: () => void = () => undefined;
	afterEach(() => restore());

	// LAN の URL には繋がらない (外出先と同じ状態)
	const unreachable = { url: 'http://127.0.0.1:1', token: TOKEN, label: 'pc' };

	it('falls back to the relay when the PC is not reachable on the LAN', async () => {
		const pc = fakePc(req => req.path === '/api/state'
			? { status: 200, body: { revision: 7, big: 'x'.repeat(300_000) } }
			: { status: 404, body: { error: 'not_found' } });
		restore = setRelayChannelFactory(pc.factory);

		const client = new OrchestraClient(unreachable, { relay: true });
		client.setDivisionAccessToken(ACCOUNT_JWT);
		const snapshot = await client.getSnapshot() as unknown as { revision: number; big: string };

		expect(snapshot.revision).toBe(7);
		expect(snapshot.big).toHaveLength(300_000);
		expect(client.route).toBe('relay');
		expect(pc.topics).toEqual([pcTopic(TOKEN)]);
		expect(pc.received[0]).toMatchObject({ method: 'GET', path: '/api/state', token: TOKEN, accessToken: ACCOUNT_JWT });
		expect(Math.abs(pc.received[0].sentAt - Date.now())).toBeLessThan(5_000);
	});

	it('sends bodies and query strings, and turns error replies into OrchestraApiError', async () => {
		const pc = fakePc(req => req.path === '/api/chat/message'
			? { status: 409, body: { error: 'agent_busy', detail: '実行中です' } }
			: { status: 200, body: { commands: [req.query.q] } });
		restore = setRelayChannelFactory(pc.factory);

		const client = new OrchestraClient(unreachable, { relay: true });
		client.setDivisionAccessToken(ACCOUNT_JWT);
		expect(await client.listCommands('kanban run')).toEqual(['kanban run']);
		await expect(client.sendPrompt('やあ')).rejects.toMatchObject({ status: 409, message: 'agent_busy', detail: '実行中です' });
		expect(pc.received[1]).toMatchObject({ method: 'POST', path: '/api/chat/message', body: { message: 'やあ' } });
	});

	it('does not use the relay without a Division session or when it is turned off', async () => {
		const pc = fakePc(() => ({ status: 200, body: {} }));
		restore = setRelayChannelFactory(pc.factory);

		const signedOut = new OrchestraClient(unreachable, { relay: true });
		await expect(signedOut.getSnapshot()).rejects.toMatchObject({ status: 0 });

		const lanOnly = new OrchestraClient(unreachable);
		lanOnly.setDivisionAccessToken(ACCOUNT_JWT);
		await expect(lanOnly.getSnapshot()).rejects.toMatchObject({ status: 0 });
		expect(pc.received).toHaveLength(0);
	});

	it('reports a relay that cannot be joined as a connection failure', async () => {
		restore = setRelayChannelFactory(() => ({
			ready: Promise.reject(new Error('CHANNEL_ERROR')),
			send: async () => undefined,
			close: () => undefined,
		}));
		const client = new OrchestraClient(unreachable, { relay: true });
		client.setDivisionAccessToken(ACCOUNT_JWT);
		await expect(client.getSnapshot()).rejects.toMatchObject({ status: 0, message: 'relay_unavailable' });
	});

	it('times out when the PC does not answer over the relay', async () => {
		restore = setRelayChannelFactory(() => ({ ready: Promise.resolve(), send: async () => undefined, close: () => undefined }));
		const client = new OrchestraClient(unreachable, { relay: true });
		client.setDivisionAccessToken(ACCOUNT_JWT);
		await expect(client.request('/api/state', { timeoutMs: 50 })).rejects.toMatchObject({ status: 0, message: 'request_timeout' });
	});
});
