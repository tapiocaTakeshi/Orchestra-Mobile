/**
 * iOS の App 内課金: Edge Function `apple-iap` への送り方、エラーの扱い (finish してよいか)、
 * 商品カタログ。StoreKit そのもの (expo-iap) はここでは触らない。
 */

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../divisionAuth', () => ({
	getDivisionAccessToken: jest.fn(async () => 'fresh-jwt'),
}));

import {
	APP_STORE_PRODUCTS,
	AppStoreVerifyError,
	CONSUMABLE_PRODUCT_IDS,
	SUBSCRIPTION_PRODUCT_IDS,
	isConsumableProduct,
	purchaseSuccessText,
	shouldFinishAfterError,
	usesAppStoreBilling,
	verifyAppStorePurchase,
} from '../appStorePurchases';
import { DIVISION_FUNCTIONS_BASE_URL } from '../divisionAuthConfig';

const session = { userId: 'u-1', email: 'a@example.com', accessToken: 'old', refreshToken: 'r' };

const fakeFetch = (status: number, body: unknown) => {
	const fn = jest.fn(async (_url: string, _init?: RequestInit) => ({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	}));
	return fn as unknown as typeof fetch & typeof fn;
};

describe('catalog', () => {
	test('product ids match the server (supabase/functions/_shared/appstore.ts)', () => {
		expect(SUBSCRIPTION_PRODUCT_IDS).toEqual(['com.hero.orchestra.plus.monthly']);
		expect(CONSUMABLE_PRODUCT_IDS).toEqual(['com.hero.orchestra.credits.20', 'com.hero.orchestra.credits.50']);
		expect(APP_STORE_PRODUCTS.map(p => p.credits)).toEqual([10, 20, 50]);
	});

	test('consumables vs subscription', () => {
		expect(isConsumableProduct('com.hero.orchestra.credits.20')).toBe(true);
		expect(isConsumableProduct('com.hero.orchestra.plus.monthly')).toBe(false);
		expect(isConsumableProduct('unknown')).toBe(false);
	});

	test('App Store billing is used on iOS', () => {
		expect(usesAppStoreBilling()).toBe(true);
	});
});

describe('verifyAppStorePurchase', () => {
	test('posts the transaction id (and a known environment) with a fresh token', async () => {
		const f = fakeFetch(200, { ok: true, productId: 'com.hero.orchestra.credits.20', type: 'consumable', profile: { creditBalance: 25.5, plan: 'free' } });
		const result = await verifyAppStorePurchase(session, '2000000123', 'Sandbox', f);
		expect(f).toHaveBeenCalledTimes(1);
		const [url, init] = f.mock.calls[0];
		expect(url).toBe(`${DIVISION_FUNCTIONS_BASE_URL}/apple-iap`);
		expect(init?.method).toBe('POST');
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer fresh-jwt');
		expect(JSON.parse(String(init?.body))).toEqual({ transactionId: '2000000123', environment: 'Sandbox' });
		expect(result).toEqual({ productId: 'com.hero.orchestra.credits.20', type: 'consumable', creditBalance: 25.5, plan: 'free' });
	});

	test('omits an unknown environment', async () => {
		const f = fakeFetch(200, { ok: true, productId: 'com.hero.orchestra.plus.monthly', type: 'subscription', active: true, expiresAt: '2026-11-26T00:00:00Z', profile: { plan: 'orchestra_plus', creditBalance: 10 } });
		const result = await verifyAppStorePurchase(session, '1', 'Xcode', f);
		expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ transactionId: '1' });
		expect(result.active).toBe(true);
		expect(result.expiresAt).toBe('2026-11-26T00:00:00Z');
		expect(purchaseSuccessText(result)).toBe('Orchestra Plus (1か月) が有効になりました。');
	});

	test('server errors keep their message and code', async () => {
		const f = fakeFetch(409, { error: 'この購入は別の Division アカウントに紐づいています。', code: 'owned_by_another_user' });
		const err = await verifyAppStorePurchase(session, '9', null, f).catch(e => e);
		expect(err).toBeInstanceOf(AppStoreVerifyError);
		expect(err.message).toBe('この購入は別の Division アカウントに紐づいています。');
		expect(err.code).toBe('owned_by_another_user');
		expect(err.status).toBe(409);
	});

	test('a missing transaction id is rejected before any request', async () => {
		const f = fakeFetch(200, {});
		await expect(verifyAppStorePurchase(session, '', null, f)).rejects.toBeInstanceOf(AppStoreVerifyError);
		expect(f).not.toHaveBeenCalled();
	});
});

describe('shouldFinishAfterError', () => {
	test('permanent rejections finish the StoreKit transaction', () => {
		for (const code of ['wrong_bundle', 'unknown_product', 'invalid_transaction_id', 'owned_by_another_user']) {
			expect(shouldFinishAfterError(new AppStoreVerifyError('x', code, 400))).toBe(true);
		}
	});

	test('temporary failures keep it for StoreKit to redeliver', () => {
		expect(shouldFinishAfterError(new AppStoreVerifyError('x', 'apple_api_failed', 502))).toBe(false);
		expect(shouldFinishAfterError(new AppStoreVerifyError('x', 'internal', 500))).toBe(false);
		expect(shouldFinishAfterError(new Error('network'))).toBe(false);
	});
});

test('purchaseSuccessText for a credit pack', () => {
	expect(purchaseSuccessText({ productId: 'com.hero.orchestra.credits.50', type: 'consumable', creditBalance: 50, plan: 'free' })).toBe('50 クレジットを追加しました。');
});
