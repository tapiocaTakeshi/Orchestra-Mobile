/**
 * プラン・クレジット残高まわり (チューニングタブの「管理」側)。
 *
 * IDE 側の void-login-tsx/divisionBilling.ts と同じテーブル・Edge Function を
 * 使う。支払いそのものはアプリ内では行わず、Stripe の Checkout / Billing Portal を
 * 既定ブラウザで開く。
 */

import { DivisionSession, getDivisionSupabase } from './divisionAuth';
import {
	DIVISION_CREDIT_TRANSACTION_TABLE,
	DIVISION_FUNCTIONS_BASE_URL,
	DIVISION_PROFILES_TABLE,
} from './divisionAuthConfig';

export type DivisionPlanId = 'free' | 'plus';

export const isPaidDivisionPlan = (
	plan: DivisionPlanId,
	subscriptionStatus: string | null,
): boolean => {
	if (plan === 'free') return false;
	// Stripe may leave a paid plan in past_due while it is still recoverable.
	// Canceled/incomplete subscriptions must not be treated as paid.
	return !['canceled', 'incomplete', 'incomplete_expired', 'unpaid'].includes(subscriptionStatus ?? '');
};

export const DIVISION_PLANS: {
	id: DivisionPlanId;
	name: string;
	priceLabel: string;
	features: string[];
}[] = [
	{ id: 'free', name: 'Free', priceLabel: '¥0 / 月', features: ['基本機能', '個人利用向け'] },
	{ id: 'plus', name: 'Plus', priceLabel: '¥3,000 / 月', features: ['利用上限アップ', '優先サポート'] },
];

export type DivisionProfile = {
	plan: DivisionPlanId;
	isPaid: boolean;
	displayName: string;
	subscriptionStatus: string | null;
	currentPeriodEnd: string | null;
	creditBalance: number;
	creditUsed: number;
	purchasedCreditBalance: number;
	subscriptionCreditBalance: number;
	subscriptionCreditsExpireAt: string | null;
	autoCharge: boolean;
	autoChargeThreshold: number;
	autoChargeAmount: number;
	hasStripeCustomer: boolean;
};

export type CreditTransaction = {
	id: string;
	type: string;
	amount: number;
	balanceAfter: number;
	createdAt: string;
};

const PROFILE_COLUMNS = [
	'plan', 'full_name', 'email', 'subscription_status', 'current_period_end',
	'credit_balance', 'credit_used', 'purchased_credit_balance', 'subscription_credit_balance',
	'subscription_credits_expire_at', 'auto_charge', 'auto_charge_threshold', 'auto_charge_amount',
	'stripe_customer_id',
].join(', ');

const num = (value: unknown, fallback = 0): number => {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
};

const withSession = async (session: DivisionSession) => {
	const sb = getDivisionSupabase();
	await sb.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken });
	return sb;
};

export const fetchDivisionProfile = async (session: DivisionSession): Promise<DivisionProfile> => {
	const sb = await withSession(session);
	const { data, error } = await sb
		.from(DIVISION_PROFILES_TABLE)
		.select(PROFILE_COLUMNS)
		.eq('id', session.userId)
		.maybeSingle();

	if (error) throw new Error(`アカウント情報の取得に失敗しました: ${error.message}`);
	if (!data) throw new Error('アカウント情報が見つかりませんでした。');

	const row = data as unknown as Record<string, unknown>;
	return {
		plan: (row.plan as DivisionPlanId) ?? 'free',
		isPaid: isPaidDivisionPlan(
			(row.plan as DivisionPlanId) ?? 'free',
			(row.subscription_status as string) ?? null,
		),
		displayName: (row.full_name as string)?.trim() || (row.email as string) || session.email,
		subscriptionStatus: (row.subscription_status as string) ?? null,
		currentPeriodEnd: (row.current_period_end as string) ?? null,
		creditBalance: num(row.credit_balance),
		creditUsed: num(row.credit_used),
		purchasedCreditBalance: num(row.purchased_credit_balance),
		subscriptionCreditBalance: num(row.subscription_credit_balance),
		subscriptionCreditsExpireAt: (row.subscription_credits_expire_at as string) ?? null,
		autoCharge: !!row.auto_charge,
		autoChargeThreshold: num(row.auto_charge_threshold, 5),
		autoChargeAmount: num(row.auto_charge_amount, 20),
		hasStripeCustomer: !!row.stripe_customer_id,
	};
};

/** 自動チャージの設定。profiles は自分の行だけ更新できる。 */
export const saveAutoChargeSettings = async (
	session: DivisionSession,
	settings: { autoCharge: boolean; threshold: number; amount: number },
): Promise<void> => {
	if (!(settings.threshold >= 0) || !(settings.amount > 0)) {
		throw new Error('しきい値は 0 以上、チャージ額は 0 より大きい値にしてください。');
	}
	const sb = await withSession(session);
	const { error } = await sb
		.from(DIVISION_PROFILES_TABLE)
		.update({
			auto_charge: settings.autoCharge,
			auto_charge_threshold: settings.threshold,
			auto_charge_amount: settings.amount,
			updated_at: new Date().toISOString(),
		})
		.eq('id', session.userId);
	if (error) throw new Error(`自動チャージ設定の保存に失敗しました: ${error.message}`);
};

export const listCreditTransactions = async (
	session: DivisionSession,
	limit = 30,
): Promise<CreditTransaction[]> => {
	const sb = await withSession(session);
	const { data, error } = await sb
		.from(DIVISION_CREDIT_TRANSACTION_TABLE)
		.select('id, transaction_type, amount, balance_after, created_at')
		.eq('user_id', session.userId)
		.order('created_at', { ascending: false })
		.limit(limit);

	if (error) throw new Error(`クレジット履歴の取得に失敗しました: ${error.message}`);

	return (data ?? []).map(row => {
		const r = row as Record<string, unknown>;
		return {
			id: String(r.id),
			type: String(r.transaction_type ?? ''),
			amount: num(r.amount),
			balanceAfter: num(r.balance_after),
			createdAt: String(r.created_at ?? ''),
		};
	});
};

const callBillingFunction = async (
	path: string,
	accessToken: string,
	body?: unknown,
): Promise<string> => {
	const res = await fetch(`${DIVISION_FUNCTIONS_BASE_URL}/${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
		body: JSON.stringify(body ?? {}),
	});
	const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
	if (!res.ok || !json.url) throw new Error(json.error || `リクエストに失敗しました (HTTP ${res.status})`);
	return json.url;
};

/** プラン変更 (Stripe Checkout) の URL。ブラウザで開く。 */
export const createCheckoutUrl = (
	session: DivisionSession,
	planId: Exclude<DivisionPlanId, 'free'>,
): Promise<string> => callBillingFunction('create-checkout-session', session.accessToken, { planId });

/** 支払い方法の変更・解約 (Stripe Billing Portal) の URL。 */
export const createPortalUrl = (session: DivisionSession): Promise<string> =>
	callBillingFunction('create-billing-portal-session', session.accessToken);
