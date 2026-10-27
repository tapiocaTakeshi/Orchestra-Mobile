/**
 * Web 版で Stripe から戻ってきたときの受け取りと、Stripe に渡す戻り先。
 */

jest.mock('../divisionAuth', () => ({ getDivisionSupabase: jest.fn() }));

import { billingReturnUrl, takeBillingReturn } from '../divisionBilling';

const replaceState = jest.fn();

const setLocation = (href: string) => {
	const url = new URL(href);
	(globalThis as { window?: unknown }).window = {
		location: { href, origin: url.origin, pathname: url.pathname },
		history: { state: null, replaceState },
	};
};

afterEach(() => {
	delete (globalThis as { window?: unknown }).window;
	replaceState.mockClear();
});

describe('takeBillingReturn', () => {
	it('returns the status and removes it from the URL', () => {
		setLocation('https://tapiocatakeshi.github.io/Orchestra-Mobile/?billing=success&x=1');
		expect(takeBillingReturn()).toBe('success');
		expect(replaceState).toHaveBeenCalledWith(null, '', 'https://tapiocatakeshi.github.io/Orchestra-Mobile/?x=1');
	});

	it('ignores unknown statuses', () => {
		setLocation('https://tapiocatakeshi.github.io/Orchestra-Mobile/?billing=bogus');
		expect(takeBillingReturn()).toBeNull();
	});

	it('does nothing without the parameter', () => {
		setLocation('https://tapiocatakeshi.github.io/Orchestra-Mobile/');
		expect(takeBillingReturn()).toBeNull();
		expect(replaceState).not.toHaveBeenCalled();
	});
});

describe('billingReturnUrl', () => {
	it('is the current page without query', () => {
		setLocation('https://tapiocatakeshi.github.io/Orchestra-Mobile/?billing=cancel');
		expect(billingReturnUrl()).toBe('https://tapiocatakeshi.github.io/Orchestra-Mobile/');
	});

	it('is undefined without a browser window', () => {
		expect(billingReturnUrl()).toBeUndefined();
	});
});
