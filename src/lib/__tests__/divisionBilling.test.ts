/**
 * profiles.plan / subscription_status から有料プランかどうかを決める。
 */

jest.mock('../divisionAuth', () => ({ getDivisionSupabase: jest.fn() }));

import { divisionPlanName, isPaidDivisionPlan } from '../divisionBilling';

describe('isPaidDivisionPlan', () => {
	it('treats orchestra_plus (written by the website webhook) as paid', () => {
		expect(isPaidDivisionPlan('orchestra_plus', 'active')).toBe(true);
		expect(isPaidDivisionPlan('orchestra_plus', 'past_due')).toBe(true);
	});

	it('treats the higher tiers (orchestra_pro / orchestra_max) as paid', () => {
		expect(isPaidDivisionPlan('orchestra_pro', 'active')).toBe(true);
		expect(isPaidDivisionPlan('orchestra_max', 'trialing')).toBe(true);
		expect(isPaidDivisionPlan('orchestra_max', 'canceled')).toBe(false);
	});

	it('still accepts the legacy plus value', () => {
		expect(isPaidDivisionPlan('plus', 'active')).toBe(true);
	});

	it('is not paid for free, unknown plans or ended subscriptions', () => {
		expect(isPaidDivisionPlan('free', null)).toBe(false);
		expect(isPaidDivisionPlan(null, null)).toBe(false);
		expect(isPaidDivisionPlan('enterprise_trial', 'active')).toBe(false);
		expect(isPaidDivisionPlan('orchestra_plus', 'canceled')).toBe(false);
		expect(isPaidDivisionPlan('orchestra_plus', 'unpaid')).toBe(false);
	});
});

describe('divisionPlanName', () => {
	it('names each paid tier and falls back to Free', () => {
		expect(divisionPlanName('orchestra_plus')).toBe('Orchestra Plus');
		expect(divisionPlanName('plus')).toBe('Orchestra Plus');
		expect(divisionPlanName('orchestra_pro')).toBe('Orchestra Pro');
		expect(divisionPlanName('orchestra_max')).toBe('Orchestra Max');
		expect(divisionPlanName('free')).toBe('Free');
		expect(divisionPlanName(null)).toBe('Free');
	});
});
