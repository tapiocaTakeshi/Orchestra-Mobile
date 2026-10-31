/**
 * クラウドエージェントのプロジェクト選び。Division API (GET /api/projects) の読み方と、
 * PC の一覧からの変換・合わせ方・名前の引き当てを確認する。JWT の取得はフェイク、fetch はテストごとに差し替える。
 */

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
	getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
}));

import { DivisionProject } from '../../api/types';
import {
	listServerProjects,
	mergeProjectOptions,
	projectLabel,
	projectOptionsFromPc,
	singleActiveProjectId,
	toProjectOption,
} from '../divisionProjects';

const auth = { userId: 'u1', email: 'a@example.com', accessToken: 'at', refreshToken: 'rt' };

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[] = [];
const respond = (status: number, body: unknown) => {
	(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
	});
};

beforeEach(() => { calls = []; });

describe('listServerProjects', () => {
	it('reads the user\'s projects from the Division API, most recently updated first', async () => {
		respond(200, [
			{ id: 'p1', name: ' Older ', updatedAt: '2026-10-01T00:00:00.000Z', userId: 'u1' },
			{ id: 'p2', name: 'Newer', updatedAt: '2026-10-02T00:00:00.000Z', userId: 'u1' },
		]);
		const projects = await listServerProjects(auth);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('https://api.division.he-ro.io/api/projects');
		expect(calls[0].init.method).toBe('GET');
		expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
		expect(projects).toEqual([
			{ id: 'p2', name: 'Newer', updatedAt: '2026-10-02T00:00:00.000Z' },
			{ id: 'p1', name: 'Older', updatedAt: '2026-10-01T00:00:00.000Z' },
		]);
	});

	it('drops rows without an id and names unnamed projects', async () => {
		respond(200, [{ id: '', name: 'x' }, { name: 'no id' }, null, { id: 'p3', name: '' }]);
		expect(await listServerProjects(auth)).toEqual([{ id: 'p3', name: '名前のないプロジェクト' }]);
	});

	it('treats a non-array body as no projects', async () => {
		respond(200, { error: 'weird' });
		expect(await listServerProjects(auth)).toEqual([]);
	});

	it('turns errors into Japanese messages', async () => {
		respond(500, { error: 'boom' });
		await expect(listServerProjects(auth)).rejects.toThrow('プロジェクトを取得できませんでした: boom');
	});
});

describe('project options', () => {
	const pc = (projectId: string, name: string, isActive = false): DivisionProject => ({ projectId, name, agents: [], isActive });

	it('uses PC projects with an id, active ones first, without duplicates', () => {
		const options = projectOptionsFromPc([pc('', 'No id'), pc('a', 'Alpha'), pc('b', 'Beta', true), pc('a', 'Alpha again'), pc('c', ' ')]);
		expect(options).toEqual([
			{ id: 'b', name: 'Beta', active: true },
			{ id: 'a', name: 'Alpha', active: false },
			{ id: 'c', name: 'c', active: false },
		]);
	});

	it('looks up a project name, falling back to a short id', () => {
		const list = [{ id: 'p1', name: 'Mobile' }];
		expect(projectLabel(list, 'p1')).toBe('Mobile');
		expect(projectLabel(list, '1234567890abcdef')).toBe('プロジェクト 12345678');
		expect(projectLabel(list, null)).toBeNull();
		expect(projectLabel(list, '')).toBeNull();
	});

	it('defaults to the only active project', () => {
		expect(singleActiveProjectId([{ id: 'a', name: 'A', active: true }, { id: 'b', name: 'B' }])).toBe('a');
		expect(singleActiveProjectId([{ id: 'a', name: 'A', active: true }, { id: 'b', name: 'B', active: true }])).toBe('');
		expect(singleActiveProjectId([])).toBe('');
	});

	it('puts PC projects first and adds the Division ones the PC does not have', () => {
		const merged = mergeProjectOptions(
			[{ id: 'b', name: 'Beta', active: true }, { id: 'a', name: 'Alpha (PC)', active: false }],
			[{ id: 'n', name: 'New on the web' }, { id: 'a', name: 'Alpha' }],
		);
		expect(merged).toEqual([
			{ id: 'b', name: 'Beta', active: true },
			{ id: 'a', name: 'Alpha (PC)', active: false },
			{ id: 'n', name: 'New on the web' },
		]);
		expect(mergeProjectOptions([], [{ id: 'n', name: 'N' }])).toEqual([{ id: 'n', name: 'N' }]);
	});

	it('reads a row defensively', () => {
		expect(toProjectOption({ id: ' x ', name: 'N', updatedAt: 5 })).toEqual({ id: 'x', name: 'N' });
		expect(toProjectOption({ id: 3 })).toBeNull();
	});
});
