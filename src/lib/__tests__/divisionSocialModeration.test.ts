/**
 * ソーシャルの不適切コンテンツ対策: Edge Function `moderation` への通報・ブロックの送り方、
 * サーバーのエラーの言い換え、フィードからの除外、ブロックの一覧と解除。
 * Supabase はテーブルごとに結果を返すだけのフェイク、fetch はテストごとに差し替える。
 */

type Result = { data: unknown; error: unknown };
type Query = { table: string; ops: [string, ...unknown[]][] };

const tableResults: Record<string, Result> = {};
const queries: Query[] = [];

const makeBuilder = (table: string) => {
	const query: Query = { table, ops: [] };
	queries.push(query);
	const builder: Record<string, unknown> = {};
	for (const op of ['select', 'eq', 'in', 'order', 'limit', 'delete', 'insert', 'update', 'single', 'maybeSingle']) {
		builder[op] = (...args: unknown[]) => { query.ops.push([op, ...args]); return builder; };
	}
	builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
		Promise.resolve(tableResults[table] ?? { data: [], error: null }).then(resolve, reject);
	return builder;
};

const fakeClient = {
	auth: { setSession: jest.fn(async () => ({ data: {}, error: null })) },
	from: jest.fn((table: string) => makeBuilder(table)),
	rpc: jest.fn(),
};

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => fakeClient,
	getDivisionAccessToken: jest.fn(async () => 'fresh-jwt'),
}));

import {
	ModerationError,
	blockUser,
	buildBlockBody,
	buildReportBody,
	describeError,
	isVisibleInFeed,
	listAssignmentPosts,
	listBlockedUsers,
	publishAssignmentPost,
	reportPost,
	unblockUser,
	updateAssignmentPost,
} from '../divisionSocial';
import { AssignmentPost } from '../social';

const session = { userId: 'me', email: 'me@example.com', accessToken: 'at', refreshToken: 'rt' };

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[] = [];
const respond = (status: number, body: unknown) => {
	(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
	});
};
const sentBody = (i = 0) => JSON.parse(String(calls[i].init.body));

beforeEach(() => {
	calls = [];
	queries.length = 0;
	for (const key of Object.keys(tableResults)) delete tableResults[key];
	fakeClient.from.mockClear();
});

const post = (overrides: Partial<AssignmentPost> & { id: string }): AssignmentPost => ({
	authorId: 'other',
	authorName: '作者',
	title: 'コスト重視',
	description: '',
	assignments: [],
	sourceProjectId: null,
	likeCount: 0,
	importCount: 0,
	createdAt: '2026-10-01T00:00:00.000Z',
	updatedAt: '2026-10-01T00:00:00.000Z',
	likedByMe: false,
	mine: false,
	...overrides,
});

describe('describeError', () => {
	it('maps the server objectionable_content error to a friendly message', () => {
		expect(describeError({ code: 'P0001', message: 'objectionable_content' }, '投稿に失敗しました'))
			.toBe('不適切な表現が含まれているため投稿できません。');
	});

	it('keeps the existing mappings and fallback', () => {
		expect(describeError({ code: '42P01', message: 'relation does not exist' }, 'x')).toMatch(/テーブルがまだ作られていません/);
		expect(describeError({ code: '42501', message: 'denied' }, 'x')).toMatch(/権限がありません/);
		expect(describeError({ code: 'XX000', message: 'boom' }, '投稿に失敗しました')).toBe('投稿に失敗しました: boom');
	});
});

describe('request bodies', () => {
	it('builds a report body, trimming and capping the details', () => {
		expect(buildReportBody({ postId: 'p1', reason: 'spam' })).toEqual({ action: 'report', postId: 'p1', reason: 'spam' });
		expect(buildReportBody({ postId: 'p1', reason: 'other', details: '   ' })).toEqual({ action: 'report', postId: 'p1', reason: 'other' });
		expect(buildReportBody({ postId: 'p1', reason: 'hate', details: ' 差別的 ' }).details).toBe('差別的');
		expect(buildReportBody({ postId: 'p1', reason: 'hate', details: 'あ'.repeat(1500) }).details).toHaveLength(1000);
	});

	it('rejects an unknown reason or a missing post', () => {
		expect(() => buildReportBody({ postId: 'p1', reason: 'blocked' as never })).toThrow('通報の理由を選んでください。');
		expect(() => buildReportBody({ postId: '', reason: 'spam' })).toThrow();
	});

	it('builds a block body with the optional post', () => {
		expect(buildBlockBody({ userId: 'u2' })).toEqual({ action: 'block', userId: 'u2' });
		expect(buildBlockBody({ userId: 'u2', postId: 'p1' })).toEqual({ action: 'block', userId: 'u2', postId: 'p1' });
		expect(() => buildBlockBody({ userId: '' })).toThrow();
	});
});

describe('reportPost', () => {
	it('POSTs to the moderation function with a fresh token', async () => {
		respond(200, { ok: true, reportId: 'r1', notified: true });
		await expect(reportPost(session, { postId: 'p1', reason: 'harassment', details: '暴言' })).resolves.toBe('reported');
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('https://wmhrbhcnxglvqwvnbxlt.supabase.co/functions/v1/moderation');
		expect(calls[0].init.method).toBe('POST');
		const headers = calls[0].init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer fresh-jwt');
		expect(headers['Content-Type']).toBe('application/json');
		expect(sentBody()).toEqual({ action: 'report', postId: 'p1', reason: 'harassment', details: '暴言' });
	});

	it('treats already_reported as done', async () => {
		respond(409, { error: 'Already reported', code: 'already_reported' });
		await expect(reportPost(session, { postId: 'p1', reason: 'spam' })).resolves.toBe('already_reported');
	});

	it('explains the other error codes in Japanese', async () => {
		respond(400, { error: 'own post', code: 'cannot_report_own' });
		await expect(reportPost(session, { postId: 'p1', reason: 'spam' })).rejects.toThrow('自分の投稿は通報できません。');

		respond(404, { error: 'not found', code: 'post_not_found' });
		const error = await reportPost(session, { postId: 'p1', reason: 'spam' }).catch(e => e);
		expect(error).toBeInstanceOf(ModerationError);
		expect((error as ModerationError).code).toBe('post_not_found');
		expect((error as ModerationError).status).toBe(404);
	});

	it('falls back to the server message or the status', async () => {
		respond(500, { error: 'database down' });
		await expect(reportPost(session, { postId: 'p1', reason: 'spam' })).rejects.toThrow('database down');
		respond(502, 'not json');
		await expect(reportPost(session, { postId: 'p1', reason: 'spam' })).rejects.toThrow('HTTP 502');
	});

	it('does not call the function for an invalid reason', async () => {
		respond(200, { ok: true });
		await expect(reportPost(session, { postId: 'p1', reason: 'nope' as never })).rejects.toThrow();
		expect(calls).toHaveLength(0);
	});
});

describe('blockUser', () => {
	it('POSTs a block request', async () => {
		respond(200, { ok: true, notified: true });
		await blockUser(session, { userId: 'u2', postId: 'p9' });
		expect(sentBody()).toEqual({ action: 'block', userId: 'u2', postId: 'p9' });
	});

	it('refuses to block yourself without calling the server', async () => {
		respond(200, { ok: true });
		await expect(blockUser(session, { userId: 'me' })).rejects.toThrow('自分自身はブロックできません。');
		expect(calls).toHaveLength(0);
	});

	it('maps cannot_block_self from the server', async () => {
		respond(400, { error: 'self', code: 'cannot_block_self' });
		await expect(blockUser(session, { userId: 'u2' })).rejects.toThrow('自分自身はブロックできません。');
	});
});

describe('feed filtering', () => {
	it('hides reported posts, blocked authors and objectionable posts, but never my own', () => {
		const reported = new Set(['p-reported']);
		const blocked = new Set(['bad-user']);
		expect(isVisibleInFeed(post({ id: 'ok' }), reported, blocked)).toBe(true);
		expect(isVisibleInFeed(post({ id: 'p-reported' }), reported, blocked)).toBe(false);
		expect(isVisibleInFeed(post({ id: 'x', authorId: 'bad-user' }), reported, blocked)).toBe(false);
		expect(isVisibleInFeed(post({ id: 'y', title: 'fuck this' }), reported, blocked)).toBe(false);
		expect(isVisibleInFeed(post({ id: 'z', title: 'classic grape setup' }), reported, blocked)).toBe(true);
		expect(isVisibleInFeed(post({ id: 'p-reported', mine: true, authorId: 'me', title: 'shit' }), reported, blocked)).toBe(true);
	});

	it('drops reported, blocked and objectionable rows from the fetched feed', async () => {
		const row = (id: string, authorId: string, title = 'コスト重視') => ({
			id, authorId, authorName: 'n', title, description: null, assignments: [], sourceProjectId: null,
			likeCount: 0, importCount: 0, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
		});
		tableResults.AssignmentPost = {
			data: [row('a', 'u2'), row('b', 'u3'), row('c', 'blocked'), row('d', 'u2', '死ね'), row('e', 'me', '死ね')],
			error: null,
		};
		tableResults.AssignmentPostLike = { data: [{ postId: 'a' }], error: null };
		tableResults.ContentReport = { data: [{ postId: 'b' }, { postId: null }], error: null };
		tableResults.UserBlock = { data: [{ blockedId: 'blocked' }], error: null };

		const posts = await listAssignmentPosts(session);
		expect(posts.map(p => p.id)).toEqual(['a', 'e']);
		expect(posts[0].likedByMe).toBe(true);
	});

	it('still shows the feed when the report/block tables cannot be read', async () => {
		tableResults.AssignmentPost = {
			data: [{ id: 'a', authorId: 'u2', authorName: null, title: 't', description: null, assignments: [], sourceProjectId: null, likeCount: 0, importCount: 0, createdAt: '', updatedAt: '' }],
			error: null,
		};
		tableResults.ContentReport = { data: null, error: { code: '42P01', message: 'missing' } };
		tableResults.UserBlock = { data: null, error: { code: '42P01', message: 'missing' } };
		expect((await listAssignmentPosts(session)).map(p => p.id)).toEqual(['a']);
	});
});

describe('publish / update validation', () => {
	it('rejects objectionable text before touching the server', async () => {
		await expect(publishAssignmentPost(session, {
			title: 'キモい構成',
			assignments: [{ roleSlug: 'leader', roleName: 'L', providerName: 'p', providerDisplayName: 'P', model: 'm', modelDisplayName: 'm', priority: 0 }],
		})).rejects.toThrow('不適切な表現が含まれているため投稿できません。');
		await expect(updateAssignmentPost(session, 'p1', { description: 'you shit' }))
			.rejects.toThrow('不適切な表現が含まれているため投稿できません。');
		expect(fakeClient.from).not.toHaveBeenCalled();
	});

	it('maps the server error when the trigger rejects an update', async () => {
		tableResults.AssignmentPost = { data: null, error: { code: 'P0001', message: 'objectionable_content' } };
		await expect(updateAssignmentPost(session, 'p1', { title: 'ok title' }))
			.rejects.toThrow('不適切な表現が含まれているため投稿できません。');
	});
});

describe('blocked users', () => {
	it('lists my UserBlock rows, newest first', async () => {
		tableResults.UserBlock = {
			data: [
				{ blockedId: 'u2', blockedName: '佐藤', createdAt: '2026-10-02T00:00:00.000Z' },
				{ blockedId: 'u3', blockedName: null, createdAt: '2026-10-01T00:00:00.000Z' },
				{ blockedId: '', blockedName: 'x', createdAt: '' },
			],
			error: null,
		};
		expect(await listBlockedUsers(session)).toEqual([
			{ userId: 'u2', name: '佐藤', createdAt: '2026-10-02T00:00:00.000Z' },
			{ userId: 'u3', name: null, createdAt: '2026-10-01T00:00:00.000Z' },
		]);
		expect(queries[0].table).toBe('UserBlock');
		expect(queries[0].ops).toContainEqual(['eq', 'blockerId', 'me']);
		expect(queries[0].ops).toContainEqual(['order', 'createdAt', { ascending: false }]);
	});

	it('unblocks by deleting my row directly', async () => {
		tableResults.UserBlock = { data: null, error: null };
		await unblockUser(session, 'u2');
		expect(queries[0].ops).toEqual([['delete'], ['eq', 'blockerId', 'me'], ['eq', 'blockedId', 'u2']]);
	});

	it('surfaces unblock failures', async () => {
		tableResults.UserBlock = { data: null, error: { code: 'XX000', message: 'boom' } };
		await expect(unblockUser(session, 'u2')).rejects.toThrow('ブロックの解除に失敗しました: boom');
	});
});
