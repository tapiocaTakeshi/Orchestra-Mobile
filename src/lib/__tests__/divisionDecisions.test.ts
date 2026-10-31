/**
 * Decision Inbox の API クライアントと、表示用の純粋関数を確認する。
 */

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
	getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
}));

import {
	dismissDecision,
	isInboxUnsupported,
	listDecisions,
	markInvestigating,
	openCount,
	primaryOption,
	secondaryOptions,
	toDecision,
} from '../divisionDecisions';
import { DivisionCloudError } from '../divisionCloud';

const BASE = 'https://api.division.he-ro.io/api/decisions';
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
const bodyOf = (call: FetchCall): unknown => (call.init.body ? JSON.parse(call.init.body as string) : undefined);

const rawCi = (over: Record<string, unknown> = {}) => ({
	id: 'd1',
	source: 'signal',
	kind: 'ci_failure',
	status: 'open',
	priority: 'high',
	title: 'CI 失敗: CI (main)',
	summary: 'acme/web の CI が failure で終了しました。',
	recommendation: 'AI に調査させてください。',
	evidence: [{ label: 'ワークフロー実行', url: 'https://github.com/acme/web/actions/runs/1' }, { label: 'bad', url: 'javascript:alert(1)' }, {}],
	risks: ['main が壊れています', 3],
	options: [
		{ id: 'investigate', label: 'AI に調査・修正させる', primary: true },
		{ id: 'open_url', label: 'GitHub で見る', url: 'https://github.com/acme/web/actions/runs/1' },
		{ id: 'open_url', label: 'bad', url: 'http://evil' },
		{ id: 'dismiss', label: '対応不要' },
		{ id: 'nope', label: '?' },
	],
	investigation: { title: 'CI 失敗', prompt: '調べて', repo: { fullName: 'acme/web', branch: 'main' } },
	sessionId: null,
	createdAt: '2026-10-31T00:00:00.000Z',
	...over,
});

beforeEach(() => { calls.length = 0; });

describe('DTO', () => {
	it('keeps only safe links and known options', () => {
		const d = toDecision(rawCi());
		expect(d.evidence).toEqual([{ label: 'ワークフロー実行', url: 'https://github.com/acme/web/actions/runs/1' }, { label: 'bad' }]);
		expect(d.risks).toEqual(['main が壊れています']);
		expect(d.options.map(o => o.id)).toEqual(['investigate', 'open_url', 'dismiss']);
		expect(d.investigation).toEqual({ title: 'CI 失敗', prompt: '調べて', repo: { fullName: 'acme/web', branch: 'main' } });
	});

	it('drops an investigation without a usable repo and falls back on unknown values', () => {
		const d = toDecision(rawCi({ investigation: { prompt: 'x', repo: { fullName: 'not a repo' } }, kind: '?', status: '?', priority: '?' }));
		expect(d.investigation).toBeNull();
		expect([d.kind, d.status, d.priority]).toEqual(['review_changes', 'open', 'medium']);
	});
});

describe('options', () => {
	it('primary is the marked option; investigate needs an investigation', () => {
		const d = toDecision(rawCi());
		expect(primaryOption(d)?.id).toBe('investigate');
		expect(secondaryOptions(d).map(o => o.id)).toEqual(['open_url', 'dismiss']);
		const noPacket = toDecision(rawCi({ investigation: null }));
		expect(primaryOption(noPacket)?.id).toBe('open_url');
		expect(secondaryOptions(noPacket).map(o => o.id)).toEqual(['dismiss']);
	});

	it('items the AI is working on have no buttons', () => {
		const d = toDecision(rawCi({ status: 'in_progress' }));
		expect(primaryOption(d)).toBeNull();
		expect(secondaryOptions(d)).toEqual([]);
		expect(openCount([d, toDecision(rawCi())])).toBe(1);
	});
});

describe('endpoints', () => {
	it('lists, dismisses and marks investigations', async () => {
		mockFetch(url => url.endsWith('/act')
			? { status: 200, body: { decision: rawCi({ status: 'in_progress', sessionId: 's9' }) } }
			: url === BASE
				? { status: 200, body: { headline: '1 件の問題を検出しました。', decisions: [rawCi(), { id: '', title: '' }] } }
				: { status: 200, body: { ok: true } });
		const inbox = await listDecisions(auth);
		expect(inbox.headline).toBe('1 件の問題を検出しました。');
		expect(inbox.decisions).toHaveLength(1);

		await dismissDecision(auth, 'session:abc:changes:1', ' 不要 ');
		expect(calls[1].url).toBe(`${BASE}/session%3Aabc%3Achanges%3A1/dismiss`);
		expect(bodyOf(calls[1])).toEqual({ note: '不要' });

		const d = await markInvestigating(auth, 'd1', 's9');
		expect(bodyOf(calls[2])).toEqual({ action: 'investigate', sessionId: 's9' });
		expect(d.status).toBe('in_progress');
		expect(d.sessionId).toBe('s9');
	});

	it('detects a server without the inbox', () => {
		expect(isInboxUnsupported(new DivisionCloudError(404, 'HTTP 404'))).toBe(true);
		expect(isInboxUnsupported(new DivisionCloudError(404, 'Decision not found'))).toBe(false);
	});
});
