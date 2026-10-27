/**
 * profiles.plan / subscription_status から有料プランかどうかを決める。
 */

jest.mock('../divisionAuth', () => ({ getDivisionSupabase: jest.fn() }));

import { isPaidDivisionPlan } from '../divisionBilling';

describe('isPaidDivisionPlan', () => {
	it('treats orchestra_plus (written by the website webhook) as paid', () => {
		expect(isPaidDivisionPlan('orchestra_plus', 'active')).toBe(true);
		expect(isPaidDivisionPlan('orchestra_plus', 'past_due')).toBe(true);
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
