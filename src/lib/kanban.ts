/**
 * カンバンの表示に必要な計算。UI に依存しないのでそのままテストできる。
 *
 * カラム内の並び順は board.tasks の並び順そのもの (IDE 側と同じ規則) なので、
 * ここでは並べ替えず、フィルタしたうえで元の順序を保つ。
 */

import {
	KanbanBoard,
	KanbanColumn,
	KanbanColumnRole,
	KanbanPriority,
	KanbanRunRecord,
	KanbanTask,
} from '../api/types';

export type TaskFilter = {
	/** タイトル・説明・ラベル・担当への部分一致 (大文字小文字を無視) */
	text?: string;
	labels?: string[];
	priorities?: KanbanPriority[];
	/** true なら期限超過のものだけ */
	overdueOnly?: boolean;
};

export const tasksInColumn = (board: KanbanBoard, columnId: string): KanbanTask[] =>
	board.tasks.filter(t => t.columnId === columnId);

export const columnWithRole = (board: KanbanBoard, role: KanbanColumnRole): KanbanColumn | undefined =>
	board.columns.find(c => c.role === role);

export const checklistProgress = (task: KanbanTask): { done: number; total: number } => ({
	done: task.checklist.filter(i => i.done).length,
	total: task.checklist.length,
});

export const latestRun = (task: KanbanTask): KanbanRunRecord | undefined => task.runs[0];

export const todayString = (now: Date = new Date()): string => {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** 期限切れ判定。当日は含めない (IDE 側と同じ規則)。 */
export const isOverdue = (task: KanbanTask, now: Date = new Date()): boolean =>
	!!task.dueDate && task.dueDate < todayString(now);

export const allLabels = (board: KanbanBoard): string[] => {
	const counts = new Map<string, number>();
	for (const task of board.tasks) {
		for (const label of task.labels) counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([label]) => label);
};

export const matchesFilter = (task: KanbanTask, filter: TaskFilter, now: Date = new Date()): boolean => {
	const text = filter.text?.trim().toLowerCase();
	if (text) {
		const haystack = [task.title, task.description, task.assignee, ...task.labels].join('\n').toLowerCase();
		if (!haystack.includes(text)) return false;
	}
	if (filter.labels?.length && !filter.labels.some(l => task.labels.includes(l))) return false;
	if (filter.priorities?.length && !filter.priorities.includes(task.priority)) return false;
	if (filter.overdueOnly && !isOverdue(task, now)) return false;
	return true;
};

export type ColumnView = {
	column: KanbanColumn;
	tasks: KanbanTask[];
	/** フィルタ前の総数。「3 / 12 件」の表示に使う */
	totalCount: number;
	/** WIP 上限を超えているか (上限 0 は無制限) */
	overWipLimit: boolean;
};

export const buildColumnViews = (
	board: KanbanBoard,
	filter: TaskFilter = {},
	now: Date = new Date(),
): ColumnView[] =>
	board.columns.map(column => {
		const all = tasksInColumn(board, column.id);
		const tasks = all.filter(t => matchesFilter(t, filter, now));
		return {
			column,
			tasks,
			totalCount: all.length,
			overWipLimit: column.wipLimit > 0 && all.length > column.wipLimit,
		};
	});

/** ボード全体のサマリ。ホーム画面の見出しに出す。 */
export const boardSummary = (board: KanbanBoard, now: Date = new Date()) => {
	const doneColumnIds = new Set(board.columns.filter(c => c.role === 'done').map(c => c.id));
	const errorColumnIds = new Set(board.columns.filter(c => c.role === 'error').map(c => c.id));
	return {
		total: board.tasks.length,
		done: board.tasks.filter(t => doneColumnIds.has(t.columnId)).length,
		blocked: board.tasks.filter(t => errorColumnIds.has(t.columnId)).length,
		overdue: board.tasks.filter(t => isOverdue(t, now)).length,
	};
};

/** 移動先の候補。今いるカラムは除く。 */
export const moveTargets = (board: KanbanBoard, task: KanbanTask): KanbanColumn[] =>
	board.columns.filter(c => c.id !== task.columnId);

export const priorityLabel = (priority: KanbanPriority): string => {
	switch (priority) {
		case 'urgent': return '最優先';
		case 'high': return '高';
		case 'normal': return '中';
		case 'low': return '低';
	}
};

export const priorityColor = (priority: KanbanPriority): string => {
	switch (priority) {
		case 'urgent': return '#ef4444';
		case 'high': return '#f59e0b';
		case 'normal': return '#3b82f6';
		case 'low': return '#8b95a5';
	}
};
