/**
 * プラン・クレジット残高まわり (チューニングタブの「管理」側)。
 *
 * IDE 側の void-login-tsx/divisionBilling.ts と同じテーブル・Edge Function を
 * 使う。アプリでは残高・プラン・履歴を見せるだけで、課金はしない。Plus の申し込み・
 * クレジットの購入・支払い方法・自動チャージは Division の Web サイト
 * (https://division.he-ro.jp/dashboard) で管理する。ネイティブアプリ (iOS / Android) では
 * そのサイトへの導線も出さない (App Store Guideline 3.1.1)。Web 版だけリンクを出す。
 */

import { Platform } from 'react-native';

import { DivisionSession, getDivisionSupabase } from './divisionAuth';
import {
	DIVISION_CREDIT_TRANSACTION_TABLE,
	DIVISION_PROFILES_TABLE,
} from './divisionAuthConfig';

/** Division の Web サイトのダッシュボード (プラン・クレジットの管理) */
export const DIVISION_DASHBOARD_PLAN_URL = 'https://division.he-ro.jp/dashboard?tab=plan';
export const DIVISION_DASHBOARD_CREDITS_URL = 'https://division.he-ro.jp/dashboard?tab=credits';

/** この端末で購入・管理の導線 (Web サイトへのリンク) を出すか。ネイティブアプリでは出さない。 */
export const allowsPurchases = (): boolean => Platform.OS === 'web';

/**
 * profiles.plan の値。Web サイト (division-hp) の Stripe Webhook が `orchestra_plus` を書く。
 * `plus` は古い Edge Function が書いていた値で、残っていても有料として扱う。
 */
export type DivisionPlanId = 'free' | 'orchestra_plus' | 'plus';

const PAID_PLANS: string[] = ['orchestra_plus', 'plus'];

export const isPaidDivisionPlan = (
	plan: string | null,
	subscriptionStatus: string | null,
): boolean => {
	if (!plan || !PAID_PLANS.includes(plan)) return false;
	// Stripe may leave a paid plan in past_due while it is still recoverable.
	// Canceled/incomplete subscriptions must not be treated as paid.
	return !['canceled', 'incomplete', 'incomplete_expired', 'unpaid'].includes(subscriptionStatus ?? '');
};

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
