/**
 * Orchestra IDE と話す HTTP クライアント。
 *
 * React に依存しないので、そのままユニットテストできる。UI からは
 * ConnectionContext 経由で 1 つのインスタンスを共有する。
 */

import {
	ChatState,
	Connection,
	DivisionProject,
	DivisionState,
	FileEntry,
	KanbanColumn,
	KanbanPriority,
	KanbanState,
	KanbanTask,
	ProviderModels,
	RoleAssignment,
	Snapshot,
	ThreadSummary,
} from './types';

export class OrchestraApiError extends Error {
	readonly status: number;
	readonly detail?: string;

	constructor(status: number, message: string, detail?: string) {
		super(message);
		this.name = 'OrchestraApiError';
		this.status = status;
		this.detail = detail;
	}

	/** ユーザーに出す一言。原因ごとに次の行動が分かる文言にする。 */
	get userMessage(): string {
		switch (this.status) {
			case 0: return 'IDE に接続できません。同じ Wi-Fi にいるか、IDE 側でリモートコントロールが有効かを確認してください。';
			case 401: return 'トークンが一致しません。IDE の設定でトークンを確認してください。';
			case 403: return this.detail ?? 'この操作は IDE 側の設定で無効になっています。';
			case 404: return 'この操作に対応していない IDE です。Orchestra を更新してください。';
			case 503: return 'IDE のウィンドウが応答していません。ウィンドウを開き直してください。';
			case 504: return 'IDE の応答が遅すぎます。処理が終わるまで待ってから再試行してください。';
			default: return this.detail ? `${this.message}: ${this.detail}` : this.message;
		}
	}
}

/** 末尾スラッシュを落とす。'192.168.0.5:39231' のようにスキーム無しでも受ける。 */
export const normalizeBaseUrl = (raw: string): string => {
	const trimmed = raw.trim().replace(/\/+$/, '');
	if (!trimmed) return '';
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	return `http://${trimmed}`;
};

type RequestOptions = {
	method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
	body?: unknown;
	query?: Record<string, string | undefined>;
	/** 既定 15 秒。エージェント実行など長いものは呼び出し側で伸ばす */
	timeoutMs?: number;
	signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 15_000;

export class OrchestraClient {
	private _connection: Connection;
	private _divisionAccessToken: string | null = null;

	constructor(connection: Connection) {
		this._connection = { ...connection, url: normalizeBaseUrl(connection.url) };
	}

	get connection(): Connection { return this._connection; }

	setConnection(connection: Connection): void {
		this._connection = { ...connection, url: normalizeBaseUrl(connection.url) };
	}

	/** Division のログインセッションは SecureStore 側で管理し、接続情報には保存しない。 */
	setDivisionAccessToken(accessToken: string | null | undefined): void {
		this._divisionAccessToken = accessToken || null;
	}

	// -----------------------------------------------------------------------
	// 低レベル
	// -----------------------------------------------------------------------

	private _buildUrl(path: string, query?: Record<string, string | undefined>): string {
		const qs = Object.entries(query ?? {})
			.filter((entry): entry is [string, string] => entry[1] !== undefined)
			.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
			.join('&');
		return `${this._connection.url}${path}${qs ? `?${qs}` : ''}`;
	}

	async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
		const { method = 'GET', body, query, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;

		// React Native の fetch は timeout を持たないので AbortController で打ち切る。
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const onOuterAbort = () => controller.abort();
		signal?.addEventListener('abort', onOuterAbort);

		let response: Response;
		try {
			response = await fetch(this._buildUrl(path, query), {
				method,
				headers: {
					'Content-Type': 'application/json',
					'X-Orchestra-Token': this._connection.token,
					...(this._divisionAccessToken ? { 'X-Division-Access-Token': this._divisionAccessToken } : {}),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: controller.signal,
			});
		} catch (e) {
			const aborted = (e as { name?: string })?.name === 'AbortError';
			throw new OrchestraApiError(0, aborted ? 'request_timeout' : 'network_error',
				e instanceof Error ? e.message : String(e));
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onOuterAbort);
		}

		const text = await response.text();
		let parsed: unknown = null;
		if (text) {
			try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
		}

		if (!response.ok) {
			const errBody = (parsed ?? {}) as { error?: string; detail?: string };
			throw new OrchestraApiError(response.status, errBody.error ?? `http_${response.status}`, errBody.detail);
		}

		return parsed as T;
	}

	// -----------------------------------------------------------------------
	// 接続確認 / 全体状態
	// -----------------------------------------------------------------------

	/** トークン無しで叩ける。相手が Orchestra かどうかの判定に使う。 */
	async ping(): Promise<{ ok: boolean; app: string; protocolVersion: number }> {
		return this.request('/api/ping', { timeoutMs: 5_000 });
	}

	async getSnapshot(signal?: AbortSignal): Promise<Snapshot> {
		return this.request('/api/state', { signal });
	}

	// -----------------------------------------------------------------------
	// カンバン
	// -----------------------------------------------------------------------

	async getKanban(): Promise<KanbanState> {
		return this.request('/api/kanban');
	}

	async reloadKanban(): Promise<void> {
		await this.request('/api/kanban/reload', { method: 'POST' });
	}

	async setBoardTitle(title: string): Promise<void> {
		await this.request('/api/kanban/board', { method: 'PATCH', body: { title } });
	}

	async createTask(input: {
		title: string;
		columnId?: string;
		description?: string;
		labels?: string[];
		priority?: KanbanPriority;
		dueDate?: string;
		assignee?: string;
	}): Promise<KanbanTask> {
		const res = await this.request<{ task: KanbanTask }>('/api/kanban/tasks', { method: 'POST', body: input });
		return res.task;
	}

	async updateTask(taskId: string, patch: Partial<KanbanTask>): Promise<KanbanTask | null> {
		const res = await this.request<{ task: KanbanTask | null }>(`/api/kanban/tasks/${encodeURIComponent(taskId)}`, {
			method: 'PATCH',
			body: patch,
		});
		return res.task;
	}

	async deleteTask(taskId: string): Promise<void> {
		await this.request(`/api/kanban/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
	}

	async moveTask(taskId: string, columnId: string, index: number): Promise<void> {
		await this.request(`/api/kanban/tasks/${encodeURIComponent(taskId)}/move`, {
			method: 'POST',
			body: { columnId, index },
		});
	}

	/** 受け付けられるだけで完了は待たない。進捗は snapshot をポーリングして見る。 */
	async runTask(taskId: string): Promise<void> {
		await this.request(`/api/kanban/tasks/${encodeURIComponent(taskId)}/run`, { method: 'POST' });
	}

	async addComment(taskId: string, body: string): Promise<KanbanTask | null> {
		const res = await this.request<{ task: KanbanTask | null }>(`/api/kanban/tasks/${encodeURIComponent(taskId)}/comments`, {
			method: 'POST',
			body: { body },
		});
		return res.task;
	}

	async addChecklistItem(taskId: string, text: string): Promise<KanbanTask | null> {
		const res = await this.request<{ task: KanbanTask | null }>(`/api/kanban/tasks/${encodeURIComponent(taskId)}/checklist`, {
			method: 'POST',
			body: { text },
		});
		return res.task;
	}

	async updateChecklistItem(taskId: string, itemId: string, patch: { text?: string; done?: boolean }): Promise<KanbanTask | null> {
		const res = await this.request<{ task: KanbanTask | null }>(
			`/api/kanban/tasks/${encodeURIComponent(taskId)}/checklist/${encodeURIComponent(itemId)}`,
			{ method: 'PATCH', body: patch },
		);
		return res.task;
	}

	async deleteChecklistItem(taskId: string, itemId: string): Promise<void> {
		await this.request(`/api/kanban/tasks/${encodeURIComponent(taskId)}/checklist/${encodeURIComponent(itemId)}`, {
			method: 'DELETE',
		});
	}

	async addColumn(title: string, patch?: Partial<KanbanColumn>): Promise<KanbanColumn> {
		const res = await this.request<{ column: KanbanColumn }>('/api/kanban/columns', {
			method: 'POST',
			body: { title, ...patch },
		});
		return res.column;
	}

	async updateColumn(columnId: string, patch: Partial<KanbanColumn>): Promise<void> {
		await this.request(`/api/kanban/columns/${encodeURIComponent(columnId)}`, { method: 'PATCH', body: patch });
	}

	async deleteColumn(columnId: string, moveTasksTo?: string): Promise<void> {
		await this.request(`/api/kanban/columns/${encodeURIComponent(columnId)}`, {
			method: 'DELETE',
			body: { moveTasksTo },
		});
	}

	async setAutoRun(enabled: boolean): Promise<void> {
		await this.request('/api/kanban/auto-run', { method: 'POST', body: { enabled } });
	}

	async runPendingTasks(): Promise<void> {
		await this.request('/api/kanban/run-now', { method: 'POST' });
	}

	async cancelKanbanRun(): Promise<void> {
		await this.request('/api/kanban/cancel', { method: 'POST' });
	}

	// -----------------------------------------------------------------------
	// Division プロジェクト
	// -----------------------------------------------------------------------

	async getProjects(): Promise<DivisionState> {
		return this.request('/api/division/projects');
	}

	async getProviderModels(): Promise<ProviderModels[]> {
		const res = await this.request<{ providers: ProviderModels[] }>('/api/division/models');
		return res.providers;
	}

	async addProject(project: { projectId: string; name: string; agents: RoleAssignment[] }): Promise<DivisionState> {
		return this.request('/api/division/projects', { method: 'POST', body: project });
	}

	async saveProject(projectId: string, patch: Partial<DivisionProject>): Promise<DivisionState> {
		return this.request(`/api/division/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: patch });
	}

	async deleteProject(projectId: string): Promise<DivisionState> {
		return this.request(`/api/division/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
	}

	/** exclusive=true なら「このプロジェクトだけを有効」にする。false なら ON/OFF の切り替え。 */
	async activateProject(projectId: string, exclusive = true): Promise<DivisionState> {
		return this.request(`/api/division/projects/${encodeURIComponent(projectId)}/activate`, {
			method: 'POST',
			body: { exclusive },
		});
	}

	async pullProjectsFromSupabase(projectId?: string): Promise<{ success: boolean; message: string }> {
		return this.request('/api/division/sync/pull', { method: 'POST', body: { projectId }, timeoutMs: 45_000 });
	}

	async pushProjectsToSupabase(): Promise<{ success: boolean; message: string }> {
		return this.request('/api/division/sync/push', { method: 'POST', timeoutMs: 45_000 });
	}

	// -----------------------------------------------------------------------
	// エージェント (チャット)
	// -----------------------------------------------------------------------

	async getChat(): Promise<ChatState> {
		return this.request('/api/chat');
	}

	async getThreads(): Promise<ThreadSummary[]> {
		const res = await this.request<{ threads: ThreadSummary[] }>('/api/chat/threads');
		return res.threads;
	}

	async sendPrompt(message: string, opts?: { newThread?: boolean; threadId?: string }): Promise<{ threadId: string }> {
		return this.request('/api/chat/message', {
			method: 'POST',
			body: { message, newThread: opts?.newThread ?? false, threadId: opts?.threadId },
		});
	}

	async abortAgent(threadId?: string): Promise<ChatState> {
		return this.request('/api/chat/abort', { method: 'POST', body: { threadId } });
	}

	async newThread(): Promise<ChatState> {
		return this.request('/api/chat/new', { method: 'POST' });
	}

	async switchThread(threadId: string): Promise<ChatState> {
		return this.request(`/api/chat/threads/${encodeURIComponent(threadId)}`, { method: 'POST' });
	}

	async approveTool(threadId?: string): Promise<ChatState> {
		return this.request('/api/chat/approve', { method: 'POST', body: { threadId } });
	}

	async rejectTool(threadId?: string): Promise<ChatState> {
		return this.request('/api/chat/reject', { method: 'POST', body: { threadId } });
	}

	// -----------------------------------------------------------------------
	// コマンド / ファイル
	// -----------------------------------------------------------------------

	async listCommands(query?: string): Promise<string[]> {
		const res = await this.request<{ commands: string[] }>('/api/commands', { query: { q: query } });
		return res.commands;
	}

	async runCommand(commandId: string, args: unknown[] = []): Promise<unknown> {
		const res = await this.request<{ result: unknown }>('/api/commands/run', {
			method: 'POST',
			body: { commandId, args },
			timeoutMs: 30_000,
		});
		return res.result;
	}

	async listFiles(path = ''): Promise<{ path: string; children: FileEntry[] }> {
		return this.request('/api/files/list', { query: { path } });
	}

	async openFile(path: string): Promise<void> {
		await this.request('/api/files/open', { method: 'POST', body: { path } });
	}
}
