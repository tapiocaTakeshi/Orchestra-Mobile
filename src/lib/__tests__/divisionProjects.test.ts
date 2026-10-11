/**
 * クラウドエージェントのプロジェクト選び。Supabase への問い合わせの形 (デスクトップと同じ条件) と、
 * PC の一覧からの変換・名前の引き当てを確認する。Supabase クライアントはフェイクに差し替える。
 */

type Call = { method: string; args: unknown[] };

const fake = {
	calls: [] as Call[],
	setSessionCalls: [] as unknown[],
	currentSession: null as unknown,
	result: { data: [] as unknown[] | null, error: null as { code?: string; message: string } | null },
};

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => {
		const builder: Record<string, unknown> = {};
		for (const method of ['select', 'or', 'order']) {
			builder[method] = (...args: unknown[]) => {
				fake.calls.push({ method, args });
				return method === 'order' ? Promise.resolve(fake.result) : builder;
			};
		}
		return {
			auth: {
				getSession: async () => ({ data: { session: fake.currentSession } }),
				setSession: async (value: unknown) => { fake.setSessionCalls.push(value); return { data: {}, error: null }; },
			},
			from: (table: string) => { fake.calls.push({ method: 'from', args: [table] }); return builder; },
		};
	},
}));

import { DivisionProject } from '../../api/types';
import {
	listSupabaseProjects,
	ownedProjectFilter,
	projectLabel,
	projectOptionsFromPc,
	singleActiveProjectId,
	toProjectOption,
} from '../divisionProjects';

const auth = { userId: 'u1', email: 'a@example.com', accessToken: 'at', refreshToken: 'rt' };

beforeEach(() => {
	fake.calls = [];
	fake.setSessionCalls = [];
	fake.currentSession = null;
	fake.result = { data: [], error: null };
});

describe('listSupabaseProjects', () => {
	it('queries the user\'s own projects like the desktop does', async () => {
		fake.result = {
			data: [
				{ id: 'p2', name: 'Newer', updatedAt: '2026-10-02T00:00:00.000Z' },
				{ id: 'p1', name: ' Older ', updatedAt: '2026-10-01T00:00:00.000Z' },
			],
			error: null,
		};
		const projects = await listSupabaseProjects(auth);
		// GET /rest/v1/Project?or=(ownerId.eq.u1,userId.eq.u1)&select=id,name,updatedAt&order=updatedAt.desc
		expect(fake.calls).toEqual([
			{ method: 'from', args: ['Project'] },
			{ method: 'select', args: ['id,name,updatedAt'] },
			{ method: 'or', args: ['ownerId.eq.u1,userId.eq.u1'] },
			{ method: 'order', args: ['updatedAt', { ascending: false }] },
		]);
		expect(projects).toEqual([
			{ id: 'p2', name: 'Newer', updatedAt: '2026-10-02T00:00:00.000Z' },
			{ id: 'p1', name: 'Older', updatedAt: '2026-10-01T00:00:00.000Z' },
		]);
	});

	it('sets the user\'s JWT session first unless the client already holds it', async () => {
		await listSupabaseProjects(auth);
		expect(fake.setSessionCalls).toEqual([{ access_token: 'at', refresh_token: 'rt' }]);

		fake.setSessionCalls = [];
		fake.currentSession = { access_token: 'fresh', user: { id: 'u1' } };
		await listSupabaseProjects(auth);
		expect(fake.setSessionCalls).toEqual([]);

		fake.currentSession = { access_token: 'other', user: { id: 'someone-else' } };
		await listSupabaseProjects(auth);
		expect(fake.setSessionCalls).toHaveLength(1);
	});

	it('drops rows without an id and names unnamed projects', async () => {
		fake.result = { data: [{ id: '', name: 'x' }, { name: 'no id' }, { id: 'p3', name: '' }], error: null };
		expect(await listSupabaseProjects(auth)).toEqual([{ id: 'p3', name: '名前のないプロジェクト' }]);
	});

	it('turns errors into Japanese messages', async () => {
		fake.result = { data: null, error: { code: '42501', message: 'permission denied' } };
		await expect(listSupabaseProjects(auth)).rejects.toThrow('権限');
		fake.result = { data: null, error: { code: 'XX', message: 'boom' } };
		await expect(listSupabaseProjects(auth)).rejects.toThrow('プロジェクトを取得できませんでした: boom');
	});

	it('builds the owner filter for both columns', () => {
		expect(ownedProjectFilter('abc')).toBe('ownerId.eq.abc,userId.eq.abc');
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

	it('reads a row defensively', () => {
		expect(toProjectOption({ id: ' x ', name: 'N', updatedAt: 5 })).toEqual({ id: 'x', name: 'N' });
		expect(toProjectOption({ id: 3 })).toBeNull();
	});
});
