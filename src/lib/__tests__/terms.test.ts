/**
 * 利用規約の版の判定と、ログイン後にサーバーへ同意を記録する呼び出し。
 */

const rpc = jest.fn();
const setSession = jest.fn(async () => ({ data: {}, error: null }));

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { setSession }, rpc }),
}));

import { TERMS_VERSION } from '../legal';
import { needsTermsAgreement, recordTermsAcceptance } from '../terms';

const session = { userId: 'u1', email: 'a@example.com', accessToken: 'at', refreshToken: 'rt' };

beforeEach(() => { rpc.mockReset(); setSession.mockClear(); });

describe('needsTermsAgreement', () => {
	it('asks when nothing was accepted', () => {
		expect(needsTermsAgreement(null)).toBe(true);
		expect(needsTermsAgreement(undefined)).toBe(true);
		expect(needsTermsAgreement('')).toBe(true);
	});

	it('asks again when an older version was accepted', () => {
		expect(needsTermsAgreement('2020-01-01')).toBe(true);
		expect(needsTermsAgreement('2026-10-26', '2027-01-01')).toBe(true);
	});

	it('does not ask when the current version was accepted', () => {
		expect(needsTermsAgreement(TERMS_VERSION)).toBe(false);
		expect(needsTermsAgreement(` ${TERMS_VERSION} `)).toBe(false);
	});
});

describe('recordTermsAcceptance', () => {
	it('calls accept_terms with the current version as the signed-in user', async () => {
		rpc.mockResolvedValue({ data: null, error: null });
		await expect(recordTermsAcceptance(session)).resolves.toBe(true);
		expect(setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
		expect(rpc).toHaveBeenCalledWith('accept_terms', { p_version: TERMS_VERSION });
	});

	it('reports failure without throwing', async () => {
		rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'missing' } });
		await expect(recordTermsAcceptance(session)).resolves.toBe(false);
		rpc.mockRejectedValue(new Error('offline'));
		await expect(recordTermsAcceptance(session)).resolves.toBe(false);
	});
});
