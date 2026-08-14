import { KanbanBoard, KanbanTask } from '../../api/types';
import {
	allLabels,
	boardSummary,
	buildColumnViews,
	checklistProgress,
	columnWithRole,
	isOverdue,
	matchesFilter,
	moveTargets,
	tasksInColumn,
} from '../kanban';

const task = (overrides: Partial<KanbanTask> & { id: string; columnId: string }): KanbanTask => ({
	title: 'task',
	description: '',
	labels: [],
	priority: 'normal',
	dueDate: '',
	assignee: '',
	checklist: [],
	comments: [],
	agentEnabled: true,
	createdAt: 0,
	updatedAt: 0,
	runs: [],
	...overrides,
});

const board: KanbanBoard = {
	version: 1,
	title: 'Board',
	columns: [
		{ id: 'todo', title: 'To Do', role: 'todo', wipLimit: 0, color: '#3b82f6' },
		{ id: 'wip', title: 'In Progress', role: 'in-progress', wipLimit: 1, color: '#f59e0b' },
		{ id: 'done', title: 'Done', role: 'done', wipLimit: 0, color: '#10b981' },
		{ id: 'blocked', title: 'Blocked', role: 'error', wipLimit: 0, color: '#ef4444' },
	],
	tasks: [
		task({ id: 'a', columnId: 'todo', title: 'Fix login', labels: ['bug'], priority: 'urgent', dueDate: '2026-01-01' }),
		task({ id: 'b', columnId: 'todo', title: 'Write docs', labels: ['docs'], assignee: 'yuya' }),
		task({ id: 'c', columnId: 'wip', title: 'Refactor api', labels: ['bug', 'core'] }),
		task({ id: 'd', columnId: 'wip', title: 'Second wip item' }),
		task({ id: 'e', columnId: 'done', title: 'Ship v1' }),
		task({ id: 'f', columnId: 'blocked', title: 'Waiting on review' }),
	],
	updatedAt: 0,
};

const NOW = new Date('2026-02-01T10:00:00Z');

describe('column helpers', () => {
	it('keeps the board order inside a column', () => {
		expect(tasksInColumn(board, 'todo').map(t => t.id)).toEqual(['a', 'b']);
	});

	it('finds a column by its execution role', () => {
		expect(columnWithRole(board, 'todo')?.id).toBe('todo');
		expect(columnWithRole(board, 'none')).toBeUndefined();
	});

	it('excludes the current column from move targets', () => {
		const t = board.tasks[0];
		expect(moveTargets(board, t).map(c => c.id)).toEqual(['wip', 'done', 'blocked']);
	});
});

describe('matchesFilter', () => {
	it('matches title, labels and assignee case-insensitively', () => {
		expect(matchesFilter(board.tasks[0], { text: 'LOGIN' }, NOW)).toBe(true);
		expect(matchesFilter(board.tasks[0], { text: 'bug' }, NOW)).toBe(true);
		expect(matchesFilter(board.tasks[1], { text: 'yuya' }, NOW)).toBe(true);
		expect(matchesFilter(board.tasks[1], { text: 'login' }, NOW)).toBe(false);
	});

	it('filters by label, priority and overdue', () => {
		expect(matchesFilter(board.tasks[0], { labels: ['bug'] }, NOW)).toBe(true);
		expect(matchesFilter(board.tasks[1], { labels: ['bug'] }, NOW)).toBe(false);
		expect(matchesFilter(board.tasks[0], { priorities: ['urgent'] }, NOW)).toBe(true);
		expect(matchesFilter(board.tasks[1], { priorities: ['urgent'] }, NOW)).toBe(false);
		expect(matchesFilter(board.tasks[0], { overdueOnly: true }, NOW)).toBe(true);
		expect(matchesFilter(board.tasks[1], { overdueOnly: true }, NOW)).toBe(false);
	});
});

describe('isOverdue', () => {
	it('treats today as not overdue', () => {
		expect(isOverdue(task({ id: 'x', columnId: 'todo', dueDate: '2026-02-01' }), NOW)).toBe(false);
		expect(isOverdue(task({ id: 'x', columnId: 'todo', dueDate: '2026-01-31' }), NOW)).toBe(true);
		expect(isOverdue(task({ id: 'x', columnId: 'todo', dueDate: '' }), NOW)).toBe(false);
	});
});

describe('buildColumnViews', () => {
	it('reports filtered and total counts per column', () => {
		const views = buildColumnViews(board, { text: 'bug' }, NOW);
		const todo = views.find(v => v.column.id === 'todo');
		expect(todo?.tasks.map(t => t.id)).toEqual(['a']);
		expect(todo?.totalCount).toBe(2);
	});

	it('flags a column over its WIP limit regardless of the filter', () => {
		const views = buildColumnViews(board, { text: 'nothing matches' }, NOW);
		expect(views.find(v => v.column.id === 'wip')?.overWipLimit).toBe(true);
		expect(views.find(v => v.column.id === 'todo')?.overWipLimit).toBe(false);
	});
});

describe('boardSummary', () => {
	it('counts done, blocked and overdue tasks by column role', () => {
		expect(boardSummary(board, NOW)).toEqual({ total: 6, done: 1, blocked: 1, overdue: 1 });
	});
});

describe('checklistProgress and allLabels', () => {
	it('counts completed checklist items', () => {
		const t = task({
			id: 'x',
			columnId: 'todo',
			checklist: [
				{ id: '1', text: 'a', done: true },
				{ id: '2', text: 'b', done: false },
			],
		});
		expect(checklistProgress(t)).toEqual({ done: 1, total: 2 });
	});

	it('sorts labels by usage', () => {
		expect(allLabels(board)).toEqual(['bug', 'core', 'docs']);
	});
});
