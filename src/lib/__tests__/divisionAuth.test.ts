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
	const auth: { current: unknown } = { current: null };
	const client = {
		auth: {
			setSession: jest.fn(async (s: { access_token: string }) => { auth.current = { access_token: s.access_token, user: { id: 'u1' } }; return { data: {}, error: null }; }),
			getSession: jest.fn(async () => ({ data: { session: auth.current }, error: null })),
		},
		from: () => builder,
	};
	return {
		createClient: jest.fn(() => client),
		__setRows: (rows: unknown[]) => { state.rows = rows; },
		__setAuth: (s: unknown) => { auth.current = s; },
		__client: client,
	};
});

import { ensureDivisionSupabase, getDivisionAccessToken, listRemoteSessions } from '../divisionAuth';

const { __setRows, __setAuth, __client } = jest.requireMock('@supabase/supabase-js') as {
	__setRows: (rows: unknown[]) => void;
	__setAuth: (s: unknown) => void;
	__client: { auth: { setSession: jest.Mock } };
};

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

describe('ensureDivisionSupabase', () => {
	beforeEach(() => { __client.auth.setSession.mockClear(); });

	it('keeps the session the client already holds (its refresh token is the newest one)', async () => {
		__setAuth({ access_token: 'refreshed-by-supabase', user: { id: 'u1' } });
		await ensureDivisionSupabase(session);
		expect(__client.auth.setSession).not.toHaveBeenCalled();
		await expect(getDivisionAccessToken(session)).resolves.toBe('refreshed-by-supabase');
		expect(__client.auth.setSession).not.toHaveBeenCalled();
	});

	it('puts the stored tokens in only when the client has no session for this user', async () => {
		__setAuth(null);
		await ensureDivisionSupabase(session);
		expect(__client.auth.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
		__client.auth.setSession.mockClear();
		__setAuth({ access_token: 'x', user: { id: 'someone-else' } });
		await ensureDivisionSupabase(session);
		expect(__client.auth.setSession).toHaveBeenCalledTimes(1);
	});
});
