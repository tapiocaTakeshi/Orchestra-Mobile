/**
 * Orchestra IDE のリモートコントロール API の型。
 *
 * IDE 側の `src/vs/workbench/contrib/void/common/remoteControlTypes.ts` と
 * `kanbanServiceTypes.ts` に対応する。PROTOCOL_VERSION が食い違ったときは
 * アプリ側で警告を出す (どちらかを更新すれば直る)。
 */

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// カンバン
// ---------------------------------------------------------------------------

export type KanbanColumnRole = 'none' | 'todo' | 'in-progress' | 'done' | 'error';

export type KanbanPriority = 'urgent' | 'high' | 'normal' | 'low';

export const KANBAN_PRIORITIES: KanbanPriority[] = ['urgent', 'high', 'normal', 'low'];

export type KanbanChecklistItem = {
	id: string;
	text: string;
	done: boolean;
};

export type KanbanComment = {
	id: string;
	author: 'user' | 'agent';
	body: string;
	createdAt: number;
};

export type KanbanRunStatus = 'done' | 'error' | 'timeout' | 'canceled' | 'dry-run';

export type KanbanRunRecord = {
	status: KanbanRunStatus;
	startedAt: number;
	endedAt: number;
	threadId?: string;
	error?: string;
	summary?: string;
};

export type KanbanTask = {
	id: string;
	columnId: string;
	title: string;
	description: string;
	labels: string[];
	priority: KanbanPriority;
	dueDate: string;
	assignee: string;
	checklist: KanbanChecklistItem[];
	comments: KanbanComment[];
	agentEnabled: boolean;
	createdAt: number;
	updatedAt: number;
	runs: KanbanRunRecord[];
};

export type KanbanColumn = {
	id: string;
	title: string;
	role: KanbanColumnRole;
	wipLimit: number;
	color: string;
};

export type KanbanBoard = {
	version: 1;
	title: string;
	columns: KanbanColumn[];
	tasks: KanbanTask[];
	updatedAt: number;
};

export type KanbanRuntime = {
	isLoaded: boolean;
	source: { kind: 'file'; path: string } | { kind: 'storage' };
	isPolling: boolean;
	isRunning: boolean;
	awaitingApproval: boolean;
	runningTaskId: string | null;
	queuedTaskIds: string[];
	lastPolledAt: number | null;
	lastError?: string;
	autoRunEnabled: boolean;
};

export type KanbanState = {
	board: KanbanBoard;
	runtime: KanbanRuntime;
};

// ---------------------------------------------------------------------------
// Division プロジェクト
// ---------------------------------------------------------------------------

export type RoleAssignment = {
	role: string;
	provider: string;
	model: string;
};

export type DivisionProject = {
	projectId: string;
	name: string;
	agents: RoleAssignment[];
	isActive: boolean;
};

export type DivisionState = {
	projects: DivisionProject[];
	activeProjectIds: string[];
	configPath: string | null;
	hasProject: boolean;
};

export type ProviderModels = {
	provider: string;
	models: string[];
};

// ---------------------------------------------------------------------------
// IDE / チャット
// ---------------------------------------------------------------------------

export type IdeInfo = {
	protocolVersion: number;
	appName: string;
	version: string;
	workspaceName: string;
	workspaceFolders: string[];
	uiLanguage: string;
};

export type ChatMessage = {
	role: 'user' | 'assistant' | 'tool' | 'system' | 'checkpoint' | 'interrupted';
	text: string;
	toolName?: string;
};

export type ChatState = {
	threadId: string;
	messages: ChatMessage[];
	isRunning: boolean;
	awaitingApproval: boolean;
	error?: string;
};

export type ThreadSummary = {
	threadId: string;
	title: string;
	lastModified: string;
	messageCount: number;
};

/** GET /api/state */
export type Snapshot = {
	ide: IdeInfo;
	division: DivisionState;
	kanban: KanbanState;
	chat: ChatState;
	threads: ThreadSummary[];
	revision: number;
	generatedAt: number;
};

// ---------------------------------------------------------------------------
// 接続情報
// ---------------------------------------------------------------------------

export type Connection = {
	/** 例: http://192.168.0.12:39231 (末尾スラッシュなし) */
	url: string;
	token: string;
	/** 接続先を見分けるためのラベル。ペアリング時のワークスペース名を入れる */
	label: string;
};

export type FileEntry = {
	name: string;
	isDirectory: boolean;
	path: string;
};
