/**
 * iOS の App 内課金 (StoreKit)。
 *
 * App Store Review Guideline 3.1.1 により、iOS アプリではデジタルの有料サービス
 * (Orchestra Plus とクレジット) を App 内課金で買えるようにし、Stripe の購入画面への
 * 導線は出さない (iOS では管理タブの Stripe まわりを隠す)。
 *
 * 購入の流れ:
 *   1. StoreKit で買う (appAccountToken に Division のユーザー ID を入れる)
 *   2. 取引 ID を Edge Function `apple-iap` に送る。サーバーは取引を Apple の
 *      App Store Server API から読み直し、クレジット / プランを付与する
 *      (Orchestra リポジトリの supabase/functions/apple-iap)
 *   3. 付与できたら StoreKit の取引を finish する。付与に失敗したら finish しない
 *      (次回起動時に StoreKit がもう一度届けてくれるので、取りこぼさない)
 * 更新・解約・返金はサーバーが App Store Server Notifications で受ける。
 *
 * 商品 ID は App Store Connect で作ったものと、サーバーの _shared/appstore.ts の
 * APPLE_PRODUCTS と一致させること。
 */

import { Platform } from 'react-native';

import { DivisionSession, getDivisionAccessToken } from './divisionAuth';
import { DIVISION_FUNCTIONS_BASE_URL } from './divisionAuthConfig';

/** App 内課金を使うのは iOS だけ (Android は Google Play の課金が要るので、今は購入導線を出さない)。 */
export const usesAppStoreBilling = (): boolean => Platform.OS === 'ios';

export type AppStoreProductKind = 'subscription' | 'consumable';

export type AppStoreProductInfo = {
	id: string;
	kind: AppStoreProductKind;
	/** 付与されるクレジット (サブスクリプションは 1 期間ごと) */
	credits: number;
	title: string;
	description: string;
};

export const PLUS_MONTHLY_PRODUCT_ID = 'com.hero.orchestra.plus.monthly';

export const APP_STORE_PRODUCTS: AppStoreProductInfo[] = [
	{
		id: PLUS_MONTHLY_PRODUCT_ID,
		kind: 'subscription',
		credits: 10,
		title: 'Orchestra Plus (1か月)',
		description: 'クラウドエージェントとコストの見積もりが使えるようになり、毎月 10 クレジットが付与されます (付与分はその期間の終わりに失効)。',
	},
	{
		id: 'com.hero.orchestra.credits.20',
		kind: 'consumable',
		credits: 20,
		title: '20 クレジット',
		description: 'AI モデルの利用料に使えるクレジット。有効期限はありません。',
	},
	{
		id: 'com.hero.orchestra.credits.50',
		kind: 'consumable',
		credits: 50,
		title: '50 クレジット',
		description: 'AI モデルの利用料に使えるクレジット。有効期限はありません。',
	},
];

export const SUBSCRIPTION_PRODUCT_IDS = APP_STORE_PRODUCTS.filter(p => p.kind === 'subscription').map(p => p.id);
export const CONSUMABLE_PRODUCT_IDS = APP_STORE_PRODUCTS.filter(p => p.kind === 'consumable').map(p => p.id);

export const appStoreProductInfo = (productId: string): AppStoreProductInfo | undefined =>
	APP_STORE_PRODUCTS.find(p => p.id === productId);

export const isConsumableProduct = (productId: string): boolean => appStoreProductInfo(productId)?.kind === 'consumable';

export class AppStoreVerifyError extends Error {
	constructor(message: string, readonly code: string, readonly status: number) {
		super(message);
		this.name = 'AppStoreVerifyError';
	}
}

export type AppStoreVerifyResult = {
	productId: string;
	type: AppStoreProductKind;
	active?: boolean;
	expiresAt?: string | null;
	creditBalance: number | null;
	plan: string | null;
};

/** `apple-iap` に取引を送り、サーバーで付与してもらう。付与できなければ投げる (取引は finish しないこと)。 */
export const verifyAppStorePurchase = async (
	session: DivisionSession,
	transactionId: string,
	environment?: string | null,
	fetchImpl: typeof fetch = fetch,
): Promise<AppStoreVerifyResult> => {
	if (!transactionId) throw new AppStoreVerifyError('購入の取引 ID がありません。', 'invalid_transaction_id', 0);
	const token = await getDivisionAccessToken(session);
	const res = await fetchImpl(`${DIVISION_FUNCTIONS_BASE_URL}/apple-iap`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({
			transactionId,
			...(environment === 'Sandbox' || environment === 'Production' ? { environment } : {}),
		}),
	});
	const json = (await res.json().catch(() => ({}))) as Record<string, any>;
	if (!res.ok || !json.ok) {
		throw new AppStoreVerifyError(
			typeof json.error === 'string' && json.error ? json.error : `購入の確認に失敗しました (HTTP ${res.status})`,
			typeof json.code === 'string' ? json.code : 'http_error',
			res.status,
		);
	}
	return {
		productId: String(json.productId ?? ''),
		type: json.type === 'subscription' ? 'subscription' : 'consumable',
		...(typeof json.active === 'boolean' ? { active: json.active } : {}),
		...(json.expiresAt !== undefined ? { expiresAt: json.expiresAt ?? null } : {}),
		creditBalance: typeof json.profile?.creditBalance === 'number' ? json.profile.creditBalance : null,
		plan: typeof json.profile?.plan === 'string' ? json.profile.plan : null,
	};
};

/**
 * 付与のあとに StoreKit の取引を終えてよいか。サーバーが「この取引はこのアプリ /
 * このアカウントのものではない」と判定したものは、何度送っても付与されないので終える
 * (終えないと毎回の起動で届き続ける)。一時的な失敗は終えずに次回へ回す。
 */
export const shouldFinishAfterError = (error: unknown): boolean =>
	error instanceof AppStoreVerifyError && ['wrong_bundle', 'unknown_product', 'invalid_transaction_id', 'owned_by_another_user'].includes(error.code);

/** 付与できたときのお知らせ */
export const purchaseSuccessText = (result: AppStoreVerifyResult): string => {
	const info = appStoreProductInfo(result.productId);
	if (result.type === 'subscription') {
		return result.active === false
			? 'サブスクリプションの状態を更新しました。'
			: `${info?.title ?? 'Orchestra Plus'} が有効になりました。`;
	}
	return `${info?.credits ?? ''} クレジットを追加しました。`;
};
