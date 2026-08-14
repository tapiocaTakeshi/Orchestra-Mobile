/**
 * listRemoteSessions のフィルタリング (古いハートビートの除外) を確認する。
 * @supabase/supabase-js はネットワークを叩く実物を使わず、最小限のフェイクに差し替える。
 */

jest.mock('@supabase/supabase-js', () => {
	const state: { rows: unknown[] } = { rows: [] };
	const builder: any = {
		select: () => builder,
		eq: () => builder,
		order: async () => ({ data: state.rows, error: null }),
	};
	const client = {
		auth: { setSession: jest.fn(async () => ({ data: {}, error: null })) },
		from: () => builder,
	};
	return {
		createClient: jest.fn(() => client),
		__setRows: (rows: unknown[]) => { state.rows = rows; },
	};
});

import { listRemoteSessions } from '../divisionAuth';

const { __setRows } = jest.requireMock('@supabase/supabase-js') as { __setRows: (rows: unknown[]) => void };

const session = { userId: 'u1', email: 'a@example.com', accessToken: 'at', refreshToken: 'rt' };

const isoAgo = (ms: number): string => new Date(Date.now() - ms).toISOString();

describe('listRemoteSessions', () => {
	it('keeps rows heartbeated within the window and drops stale ones', async () => {
		__setRows([
			{ id: 'fresh', deviceLabel: 'PC-A', lanUrl: 'http://10.0.0.2:39231', token: 't1', protocolVersion: 1, lastSeenAt: isoAgo(5_000) },
			{ id: 'stale', deviceLabel: 'PC-B', lanUrl: 'http://10.0.0.3:39231', token: 't2', protocolVersion: 1, lastSeenAt: isoAgo(10 * 60 * 1000) },
		]);

		const rows = await listRemoteSessions(session, 2 * 60 * 1000);
		expect(rows.map(r => r.id)).toEqual(['fresh']);
	});

	it('returns an empty array when there are no rows', async () => {
		__setRows([]);
		await expect(listRemoteSessions(session)).resolves.toEqual([]);
	});

	it('drops rows with a missing or unparseable lastSeenAt', async () => {
		__setRows([
			{ id: 'bad', deviceLabel: 'PC-C', lanUrl: 'http://10.0.0.4:39231', token: 't3', protocolVersion: 1, lastSeenAt: 'not-a-date' },
		]);
		await expect(listRemoteSessions(session)).resolves.toEqual([]);
	});
});
