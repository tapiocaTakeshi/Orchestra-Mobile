/**
 * クラウドエージェントの assistant イベントに付く、Web 検索したサイトの読み取りと表記。
 */

jest.mock('../divisionAuth', () => ({
	getDivisionSupabase: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
	getDivisionAccessToken: jest.fn(async () => 'jwt-token'),
}));

import { searchedSitesOf, siteLabel } from '../divisionCloud';

describe('searchedSitesOf', () => {
	it('returns the http(s) URLs in order, without duplicates', () => {
		expect(searchedSitesOf({ searchedSites: ['https://a.example/1', 'https://a.example/1', 'http://b.example/', 'ftp://x', 3, null] }))
			.toEqual(['https://a.example/1', 'http://b.example/']);
	});

	it('is empty when the event has none', () => {
		expect(searchedSitesOf({ text: 'hi' })).toEqual([]);
		expect(searchedSitesOf({ searchedSites: 'https://a.example' })).toEqual([]);
		expect(searchedSitesOf(undefined)).toEqual([]);
	});
});

describe('siteLabel', () => {
	it('shows host and path, without scheme, www, query or trailing slash', () => {
		expect(siteLabel('https://www.example.com/docs/page/?q=1#top')).toBe('example.com/docs/page');
		expect(siteLabel('https://example.com/')).toBe('example.com');
		expect(siteLabel('not a url')).toBe('not a url');
	});
});
