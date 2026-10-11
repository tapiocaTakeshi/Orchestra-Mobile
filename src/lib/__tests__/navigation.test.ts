/**
 * ページの重なり (ページの中から別のページを開いたとき) を確認する。
 */

import { canOpenPage, pushPage } from '../../navigation';

describe('pushPage', () => {
	it('stacks a page opened from another page', () => {
		expect(pushPage(['cloud'], 'kanban')).toEqual(['cloud', 'kanban']);
		expect(pushPage([], 'cloud')).toEqual(['cloud']);
	});

	it('goes back to the page when it is already in the stack', () => {
		expect(pushPage(['cloud', 'kanban'], 'cloud')).toEqual(['cloud']);
		expect(pushPage(['cloud', 'tuning', 'kanban'], 'tuning')).toEqual(['cloud', 'tuning']);
	});
});

describe('canOpenPage', () => {
	it('keeps kanban and projects behind the PC connection, but not cost or cloud', () => {
		expect(canOpenPage('kanban', false)).toBe(false);
		expect(canOpenPage('projects', false)).toBe(false);
		expect(canOpenPage('tuning', false)).toBe(true);
		expect(canOpenPage('cloud', false)).toBe(true);
		expect(canOpenPage('kanban', true)).toBe(true);
	});
});
