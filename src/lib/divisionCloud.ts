/**
 * Division API のクラウドエージェント (クラウドセッション) API。
 *
 * デスクトップの Orchestra の「クラウドエージェント」と同じエンドポイントを叩く。
 * 1 セッション = Daytona のサンドボックス 1 つで、エージェントはサーバー側で動き続ける。
 * 端末は一覧とイベント (seq の続き) をポーリングして眺め、追加の指示・停止・アーカイブを送るだけ。
 *
 *   GET  /api/cloud-sessions                 一覧 (新しい順、アーカイブ済みは除く)
 *   GET  /api/cloud-sessions/:id             詳細
 *   GET  /api/cloud-sessions/:id/events      ?after=<seq> 以降のイベント
 *   POST /api/cloud-sessions                 作成 (サンドボックスを用意するので数分かかることがある)
 *   POST /api/cloud-sessions/:id/start       開始 (repo を渡すとそのリポジトリを clone、無ければ空のフォルダ)
 *   POST /api/cloud-sessions/:id/messages    追加の指示 (止まっていれば再開する)
 *   POST /api/cloud-sessions/:id/stop        停止
 *   POST /api/cloud-sessions/:id/archive     サンドボックスを消して一覧から隠す
 *   GET  /api/cloud-sessions/:id/changes     変更ファイルと unified diff
 *
 * モバイルには手元のワークスペースが無いので、アップロード (/upload) と取り込み (/file) は使わない。
 * 変更を手元に取り込むのは PC の Orchestra の役目で、ここでは差分を読むだけにする。
 *
 * GitHub アカウントの連携 (/api/github/*) は divisionGitHub.ts。同じ request と DivisionCloudError を使う。
 *
 * 後半の純粋関数 (状態の表示名・イベントの結合・ツールの要約・URL の検証など) は UI 非依存なので
 * そのままテストできる。
 */

import { DIVISION_API_BASE_URL } from './divisionAuthConfig';
import { DivisionSession, getDivisionAccessToken, getDivisionSupabase } from './divisionAuth';
import { oneLine } from './format';
import { colors } from '../theme';

// ---------------------------------------------------------------------------
// 型 (Division 側の DTO と同じ形)
// ---------------------------------------------------------------------------

export type CloudSessionStatus = 'provisioning' | 'uploading' | 'running' | 'idle' | 'failed' | 'cancelled';

export type CloudWorkspaceInfo = {
	fileCount: number;
	bytes: number;
	skipped: number;
	gitBranch?: string;
	gitCommit?: string;
	/** Git リポジトリから始めたときの clone 元 */
	repoUrl?: string;
	/** GitHub 連携で選んだリポジトリから始めたときの "owner/name" */
	repoFullName?: string;
};

export type CloudSession = {
	id: string;
	title: string;
	/** 最初の指示 */
	prompt: string;
	status: CloudSessionStatus;
	/** 作成時に指定したモデル (provider/model)。null ならプロジェクトのコーダーの割り当て */
	model: string | null;
	/** 実際に使われたモデルの表示名 (ループが決めた時点で入る) */
	modelLabel: string | null;
	projectId: string | null;
	/** PC から起動したときの手元のフォルダ名 */
	workspaceName: string | null;
	workspaceInfo: CloudWorkspaceInfo | null;
	summary: string | null;
	errorMsg: string | null;
	changedFiles: number;
	lastSeq: number;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	completedAt: string | null;
	/** これまでにかかったモデルの料金 (USD)。一覧と詳細の API だけが返す。無ければ不明 */
	costUsd?: number;
};

export type CloudSessionEventType = 'user' | 'assistant' | 'tool' | 'status' | 'error' | 'done';

export type CloudSessionEvent = {
	seq: number;
	type: CloudSessionEventType;
	/** 種類ごとの中身。user/assistant は { text }, tool は { name, args, ok, output, durationMs } など */
	data: Record<string, unknown>;
	createdAt: string;
};

export type CloudChange = {
	path: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed';
	oldPath?: string;
	/** バイナリは -1 */
	additions: number;
	deletions: number;
	binary: boolean;
};

export type CloudChanges = {
	changes: CloudChange[];
	/** unified diff (サーバー側で約 1.5 MB に切り詰め) */
	patch: string;
	patchTruncated: boolean;
};

/** URL を直接指定した Git リポジトリ (公開リポジトリ。github.com なら連携中のトークンも使われる)。 */
export type CloudRepoUrl = { url: string; branch?: string };
/** GitHub 連携で選んだリポジトリ ("owner/name")。サーバーがユーザーのトークンで clone するので非公開でもよい。 */
export type CloudRepoFullName = { fullName: string; branch?: string };
export type CloudRepo = CloudRepoUrl | CloudRepoFullName;

export const isFullNameRepo = (repo: CloudRepo): repo is CloudRepoFullName =>
	typeof (repo as CloudRepoFullName).fullName === 'string';

// ---------------------------------------------------------------------------
// エラー
// ---------------------------------------------------------------------------

/** サーバーが { error, code } の code で返す、状態コードだけでは分からない理由。 */
export const GITHUB_NOT_CONNECTED = 'github_not_connected';
export const GITHUB_NOT_CONFIGURED = 'github_not_configured';

export class DivisionCloudError extends Error {
	readonly status: number;
	/** サーバーが返した code (例: github_not_connected)。無ければ undefined */
	readonly code: string | undefined;
	constructor(status: number, message: string, code?: string) {
		super(message);
		this.name = 'DivisionCloudError';
		this.status = status;
		this.code = code;
	}

	get userMessage(): string {
		if (this.code === GITHUB_NOT_CONNECTED) {
			return 'GitHub と連携されていないか、連携が解除されています。もう一度「GitHub と連携」してください。';
		}
		if (this.code === GITHUB_NOT_CONFIGURED) {
			return 'サーバー側で GitHub 連携が未設定です。リポジトリの URL を直接入力してください。';
		}
		switch (this.status) {
			case 0:
				return this.message === 'timeout'
					? 'Division API から応答がありませんでした。しばらくしてから一覧を確認してください。'
					: 'Division API に接続できません。通信環境を確認してください。';
			case 400: return `入力内容が正しくありません (${this.message})。`;
			case 401: return 'Division のログインが切れました。もう一度ログインしてください。';
			case 402: return 'クレジットが不足しています。コストページの「管理」からチャージしてください。';
			case 403: return 'クラウドエージェントには Orchestra Plus が必要です。コストページの「管理」からプランを確認してください。';
			case 404: return 'セッションが見つかりません。アーカイブされたか、Division API がクラウドエージェントに未対応です。';
			case 409: return 'いまのセッションの状態では、この操作はできません。';
			case 429: return this.message || '同時に実行できるクラウドエージェントの上限に達しました。';
			case 503:
				return this.message.includes('DAYTONA')
					? 'この Division サーバーではクラウドのサンドボックスが設定されていません (DAYTONA_API_KEY)。'
					: 'Division API が一時的に利用できません。しばらくしてから試してください。';
			default: return this.message;
		}
	}
}

export const cloudErrorText = (e: unknown): string =>
	e instanceof DivisionCloudError ? e.userMessage : e instanceof Error ? e.message : String(e);

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** 作成と開始はサンドボックスの用意や clone を待つので長め。変更の取得も git diff を回すので少し長め。 */
export const CLOUD_TIMEOUTS = {
	default: 30_000,
	launch: 300_000,
	changes: 120_000,
} as const;

/**
 * Division API に送る JWT。
 *
 * 一覧とイベントを数秒おきに取りに行くので、毎回 getDivisionAccessToken (setSession) を呼ぶと
 * 期限切れのたびにログイン時の refresh token で更新しようとしてしまう。Supabase クライアントが
 * 同じユーザーのセッションを持っていれば、そちら (更新済みのトークンを保持している) を使う。
 */
const accessTokenFor = async (session: DivisionSession): Promise<string> => {
	try {
		const { data } = await getDivisionSupabase().auth.getSession();
		const current = data.session;
		if (current?.access_token && current.user?.id === session.userId) return current.access_token;
	} catch {
		// 取れなければ下で setSession からやり直す
	}
	return getDivisionAccessToken(session);
};

export type RequestOptions = {
	method?: 'GET' | 'POST';
	body?: unknown;
	timeoutMs?: number;
	endpoint?: string;
};

/**
 * Division API を叩く。path は '/api/...' から書く。失敗は DivisionCloudError (status 0 = 通信できない / タイムアウト)。
 * GitHub 連携のクライアント (divisionGitHub.ts) もこれを使う。
 */
export const divisionApiRequest = async <T>(session: DivisionSession, path: string, options: RequestOptions = {}): Promise<T> => {
	const accessToken = await accessTokenFor(session).catch((error: unknown) => {
		throw new DivisionCloudError(401, error instanceof Error ? error.message : String(error));
	});

	const base = (options.endpoint || DIVISION_API_BASE_URL).replace(/\/+$/, '');
	const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? CLOUD_TIMEOUTS.default);

	let response: Response;
	try {
		response = await fetch(`${base}${path}`, {
			method,
			headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
			...(method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {}),
			signal: controller.signal,
		});
	} catch (e) {
		throw new DivisionCloudError(0, timedOut ? 'timeout' : e instanceof Error ? e.message : String(e));
	} finally {
		clearTimeout(timer);
	}

	const data = (await response.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
	if (!response.ok) {
		throw new DivisionCloudError(
			response.status,
			typeof data.error === 'string' && data.error ? data.error : `HTTP ${response.status}`,
			typeof data.code === 'string' && data.code ? data.code : undefined,
		);
	}
	return data as T;
};

const request = <T>(session: DivisionSession, path: string, options: RequestOptions = {}): Promise<T> =>
	divisionApiRequest<T>(session, `/api/cloud-sessions${path}`, options);

const idPath = (id: string): string => `/${encodeURIComponent(id)}`;

// ---------------------------------------------------------------------------
// DTO の取り出し (欠けた値で画面が落ちないように)
// ---------------------------------------------------------------------------

const STATUSES: CloudSessionStatus[] = ['provisioning', 'uploading', 'running', 'idle', 'failed', 'cancelled'];

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const strOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const num = (value: unknown, fallback = 0): number => {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
};

const toWorkspaceInfo = (raw: unknown): CloudWorkspaceInfo | null => {
	if (!raw || typeof raw !== 'object') return null;
	const w = raw as Record<string, unknown>;
	return {
		fileCount: num(w.fileCount),
		bytes: num(w.bytes),
		skipped: num(w.skipped),
		...(typeof w.gitBranch === 'string' ? { gitBranch: w.gitBranch } : {}),
		...(typeof w.gitCommit === 'string' ? { gitCommit: w.gitCommit } : {}),
		...(typeof w.repoUrl === 'string' ? { repoUrl: w.repoUrl } : {}),
		...(typeof w.repoFullName === 'string' ? { repoFullName: w.repoFullName } : {}),
	};
};

export const toCloudSession = (raw: unknown): CloudSession => {
	const s = (raw ?? {}) as Record<string, unknown>;
	const status = STATUSES.includes(s.status as CloudSessionStatus) ? s.status as CloudSessionStatus : 'failed';
	return {
		id: str(s.id),
		title: str(s.title) || 'クラウドエージェント',
		prompt: str(s.prompt),
		status,
		model: strOrNull(s.model),
		modelLabel: strOrNull(s.modelLabel),
		projectId: strOrNull(s.projectId),
		workspaceName: strOrNull(s.workspaceName),
		workspaceInfo: toWorkspaceInfo(s.workspaceInfo),
		summary: strOrNull(s.summary),
		errorMsg: strOrNull(s.errorMsg),
		changedFiles: num(s.changedFiles),
		lastSeq: num(s.lastSeq),
		createdAt: str(s.createdAt),
		updatedAt: str(s.updatedAt) || str(s.createdAt),
		startedAt: strOrNull(s.startedAt),
		completedAt: strOrNull(s.completedAt),
		...(typeof s.costUsd === 'number' && Number.isFinite(s.costUsd) && s.costUsd >= 0 ? { costUsd: s.costUsd } : {}),
	};
};

const toEvent = (raw: unknown): CloudSessionEvent => {
	const e = (raw ?? {}) as Record<string, unknown>;
	return {
		seq: num(e.seq),
		type: str(e.type) as CloudSessionEventType,
		data: e.data && typeof e.data === 'object' ? e.data as Record<string, unknown> : {},
		createdAt: str(e.createdAt),
	};
};

const toChange = (raw: unknown): CloudChange => {
	const c = (raw ?? {}) as Record<string, unknown>;
	const status = ['added', 'modified', 'deleted', 'renamed'].includes(c.status as string)
		? c.status as CloudChange['status']
		: 'modified';
	return {
		path: str(c.path),
		status,
		...(typeof c.oldPath === 'string' ? { oldPath: c.oldPath } : {}),
		additions: num(c.additions),
		deletions: num(c.deletions),
		binary: c.binary === true,
	};
};

// ---------------------------------------------------------------------------
// エンドポイント
// ---------------------------------------------------------------------------

export const listCloudSessions = async (session: DivisionSession, limit = 50): Promise<CloudSession[]> => {
	const data = await request<{ sessions?: unknown[] }>(session, `?limit=${limit}`);
	return (data.sessions ?? []).map(toCloudSession);
};

export const getCloudSession = async (session: DivisionSession, id: string): Promise<CloudSession> => {
	const data = await request<{ session?: unknown }>(session, idPath(id));
	return toCloudSession(data.session);
};

/** seq が after より大きいイベントを古い順に返す。セッションの最新状態も一緒に返る。 */
export const fetchCloudEvents = async (
	session: DivisionSession,
	id: string,
	after = 0,
	limit = 500,
): Promise<{ events: CloudSessionEvent[]; session: CloudSession }> => {
	const data = await request<{ events?: unknown[]; session?: unknown }>(
		session, `${idPath(id)}/events?after=${Math.max(0, Math.floor(after))}&limit=${limit}`,
	);
	return { events: (data.events ?? []).map(toEvent), session: toCloudSession(data.session) };
};

export type CreateCloudSessionInput = {
	prompt: string;
	title?: string;
	model?: string;
	projectId?: string;
	workspaceName?: string;
};

/** サンドボックスを用意する (status は uploading で返る)。数分かかることがある。 */
export const createCloudSession = async (session: DivisionSession, input: CreateCloudSessionInput): Promise<CloudSession> => {
	const body: Record<string, string> = { prompt: input.prompt };
	if (input.title?.trim()) body.title = input.title.trim();
	if (input.model?.trim()) body.model = input.model.trim();
	if (input.projectId?.trim()) body.projectId = input.projectId.trim();
	if (input.workspaceName?.trim()) body.workspaceName = input.workspaceName.trim();
	const data = await request<{ session?: unknown }>(session, '', { method: 'POST', body, timeoutMs: CLOUD_TIMEOUTS.launch });
	return toCloudSession(data.session);
};

/** start に送る repo。URL か "owner/name" のどちらか片方と、指定があればブランチ。 */
export const repoBody = (repo: CloudRepo): Record<string, string> => {
	const branch = repo.branch?.trim();
	return {
		...(isFullNameRepo(repo) ? { fullName: repo.fullName.trim() } : { url: repo.url.trim() }),
		...(branch ? { branch } : {}),
	};
};

/**
 * エージェントを動かし始める。repo を渡すとそのリポジトリを clone し、無ければ空のフォルダで始める。
 * { fullName } (GitHub 連携で選んだもの) はサーバーがユーザーの GitHub トークンで clone するので非公開でもよい。
 */
export const startCloudSession = async (session: DivisionSession, id: string, options: { repo?: CloudRepo } = {}): Promise<CloudSession> => {
	const body = options.repo ? { repo: repoBody(options.repo) } : {};
	const data = await request<{ session?: unknown }>(session, `${idPath(id)}/start`, { method: 'POST', body, timeoutMs: CLOUD_TIMEOUTS.launch });
	return toCloudSession(data.session);
};

export const sendCloudMessage = async (session: DivisionSession, id: string, text: string): Promise<CloudSession> => {
	const data = await request<{ session?: unknown }>(session, `${idPath(id)}/messages`, { method: 'POST', body: { text } });
	return toCloudSession(data.session);
};

export const stopCloudSession = async (session: DivisionSession, id: string): Promise<CloudSession> => {
	const data = await request<{ session?: unknown }>(session, `${idPath(id)}/stop`, { method: 'POST', body: {} });
	return toCloudSession(data.session);
};

export const archiveCloudSession = async (session: DivisionSession, id: string): Promise<void> => {
	await request<{ ok?: boolean }>(session, `${idPath(id)}/archive`, { method: 'POST', body: {} });
};

export const fetchCloudChanges = async (session: DivisionSession, id: string): Promise<CloudChanges> => {
	const data = await request<{ changes?: unknown[]; patch?: unknown; patchTruncated?: unknown }>(
		session, `${idPath(id)}/changes`, { timeoutMs: CLOUD_TIMEOUTS.changes },
	);
	return {
		changes: (data.changes ?? []).map(toChange),
		patch: str(data.patch),
		patchTruncated: data.patchTruncated === true,
	};
};

// ---------------------------------------------------------------------------
// 状態の表示
// ---------------------------------------------------------------------------

export const CLOUD_STATUS_LABELS: Record<CloudSessionStatus, string> = {
	provisioning: '準備中',
	uploading: 'アップロード中',
	running: '実行中',
	idle: '待機中',
	failed: '失敗',
	cancelled: '停止',
};

export const cloudStatusLabel = (status: CloudSessionStatus): string => CLOUD_STATUS_LABELS[status] ?? status;

export const cloudStatusColor = (status: CloudSessionStatus): string => {
	switch (status) {
		case 'running': return colors.running;
		case 'idle': return colors.success;
		case 'failed': return colors.danger;
		case 'cancelled': return colors.fgFaint;
		default: return colors.fgMuted;
	}
};

/** サーバー側でまだ何かしている (一覧を速めにポーリングする) 状態。 */
export const isActive = (status: CloudSessionStatus): boolean =>
	status === 'provisioning' || status === 'uploading' || status === 'running';

/** 追加の指示を送れるか。開始前 (サンドボックス用意中) に止めたセッションはサーバーが受け付けない。 */
export const canSendMessage = (session: Pick<CloudSession, 'status' | 'startedAt'>): boolean =>
	['running', 'idle', 'failed', 'cancelled'].includes(session.status) && !!session.startedAt;

/** 一覧のポーリング間隔。動いているセッションがあれば 4 秒、無ければ 20 秒。 */
export const listPollInterval = (sessions: Pick<CloudSession, 'status'>[]): number =>
	sessions.some(s => isActive(s.status)) ? 4_000 : 20_000;

/**
 * 前回と今回の一覧を比べ、動いていた (provisioning/uploading/running) のが
 * 待機中か失敗に変わったセッションを返す。通知を出すのに使う。
 */
export const finishedSessions = (
	previous: ReadonlyMap<string, CloudSessionStatus>,
	next: CloudSession[],
): CloudSession[] =>
	next.filter(s => {
		const before = previous.get(s.id);
		return !!before && isActive(before) && (s.status === 'idle' || s.status === 'failed');
	});

// ---------------------------------------------------------------------------
// 出どころ (リポジトリ / フォルダ) の表示
// ---------------------------------------------------------------------------

/** 'https://github.com/owner/repo.git' → 'github.com/owner/repo' */
export const repoLabel = (url: string): string =>
	url.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').replace(/\.git$/i, '');

/** clone したときのフォルダ名 ('https://github.com/owner/repo.git' → 'repo')。 */
export const repoFolderName = (url: string): string => {
	const parts = repoLabel(url).split('/').filter(Boolean);
	return parts.length > 1 ? parts[parts.length - 1] : '';
};

export type CloudSource = { kind: 'repo' | 'workspace' | 'empty'; label: string };

/** 一覧と詳細の「どこで動いているか」。リポジトリ > PC のフォルダ > 空のフォルダ の順に決める。 */
export const cloudSource = (session: Pick<CloudSession, 'workspaceInfo' | 'workspaceName'>): CloudSource => {
	const info = session.workspaceInfo;
	if (info?.repoFullName) {
		return { kind: 'repo', label: `${info.repoFullName}${info.gitBranch ? ` @ ${info.gitBranch}` : ''}` };
	}
	if (info?.repoUrl) {
		return { kind: 'repo', label: `${repoLabel(info.repoUrl)}${info.gitBranch ? ` @ ${info.gitBranch}` : ''}` };
	}
	if (session.workspaceName) {
		return { kind: 'workspace', label: `${session.workspaceName}${info?.gitBranch ? ` @ ${info.gitBranch}` : ''}` };
	}
	return { kind: 'empty', label: '空のフォルダ' };
};

/** 一覧に出すモデル名。決まる前は指定したモデル、どちらも無ければ既定。 */
export const cloudModelLabel = (session: Pick<CloudSession, 'model' | 'modelLabel'>): string =>
	session.modelLabel || session.model || '既定のモデル';

// ---------------------------------------------------------------------------
// イベント
// ---------------------------------------------------------------------------

/** 差分で取ってきたイベントを seq で重複を除いて結合する (古い順)。 */
export const mergeEvents = (current: CloudSessionEvent[], incoming: CloudSessionEvent[]): CloudSessionEvent[] => {
	if (incoming.length === 0) return current;
	const last = current.length > 0 ? current[current.length - 1].seq : -Infinity;
	// ふつうは続きだけが来るので、並べ直さずに足す。
	if (incoming.every((e, i) => e.seq > last && (i === 0 || e.seq > incoming[i - 1].seq))) return [...current, ...incoming];
	const bySeq = new Map<number, CloudSessionEvent>();
	for (const e of current) bySeq.set(e.seq, e);
	for (const e of incoming) bySeq.set(e.seq, e);
	return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
};

export const lastSeqOf = (events: CloudSessionEvent[]): number =>
	events.reduce((max, e) => (e.seq > max ? e.seq : max), 0);

/** ツールの引数のうち、1 行の要約に出す値の候補 (上から順に探す)。 */
const SUMMARY_KEYS = [
	'command', 'cmd',
	'path', 'file', 'filePath', 'file_path', 'uri', 'target', 'dir', 'directory',
	'pattern', 'query', 'regex', 'glob', 'url',
];

/** ツール呼び出しを 1 行にする。例: `read_file src/a.ts` / `run_command npm test`。 */
export const toolCallSummary = (name: string, args: unknown, max = 80): string => {
	const toolName = name || 'tool';
	if (!args || typeof args !== 'object') return oneLine(toolName, max);
	const record = args as Record<string, unknown>;
	const key = SUMMARY_KEYS.find(k => typeof record[k] === 'string' && (record[k] as string).trim())
		?? Object.keys(record).find(k => typeof record[k] === 'string' && (record[k] as string).trim());
	const value = key ? String(record[key]) : '';
	return oneLine(value ? `${toolName} ${value}` : toolName, max);
};

// ---------------------------------------------------------------------------
// リポジトリ URL / ブランチの検証 (サーバーの repoSchema と同じ条件)
// ---------------------------------------------------------------------------

/** 公開リポジトリの URL として使えなければ理由を返す。使えるなら null。 */
export const validateRepoUrl = (raw: string): string | null => {
	const value = raw.trim();
	if (!value) return 'リポジトリの URL を入力してください。';
	if (value.length > 500) return 'URL が長すぎます。';
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return 'URL の形式が正しくありません。';
	}
	if (url.protocol !== 'https:') return 'https:// で始まる URL を入力してください。';
	if (url.username || url.password) return 'URL にユーザー名やトークンを含めないでください (公開リポジトリのみ対応)。';
	if (/[\s'"`$\\]/.test(value)) return 'URL に使えない文字が含まれています。';
	return null;
};

/** GitHub の "owner/name" として使えなければ理由を返す。使えるなら null。 */
export const validateRepoFullName = (raw: string): string | null => {
	const value = raw.trim();
	if (!value) return 'リポジトリを選んでください。';
	const m = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/.exec(value);
	if (!m || m.slice(1).some(part => part === '.' || part === '..')) return 'リポジトリ名の形式が正しくありません (owner/name)。';
	return null;
};

/** "owner/name" → "name" (形式が違えば空)。 */
export const repoNameOf = (fullName: string): string => {
	const parts = fullName.trim().split('/');
	return parts.length === 2 ? parts[1] : '';
};

/** ブランチ / タグ名として使えなければ理由を返す。空 (既定のブランチ) なら null。 */
export const validateBranch = (raw: string): string | null => {
	const value = raw.trim();
	if (!value) return null;
	if (!/^[A-Za-z0-9._/-]{1,200}$/.test(value) || value.startsWith('-') || value.includes('..')) {
		return 'ブランチ名に使えない文字が含まれています。';
	}
	return null;
};

// ---------------------------------------------------------------------------
// 並列起動
// ---------------------------------------------------------------------------

export const MAX_PARALLEL_SESSIONS = 10;

export type LaunchInput = {
	prompt: string;
	/** 1〜10。同じ指示で別々のサンドボックスを並べて動かす */
	count: number;
	/** 無ければ空のフォルダで始める。{ url } か GitHub 連携で選んだ { fullName } */
	repo?: CloudRepo;
	model?: string;
	title?: string;
	/** Division のプロジェクト ID。指定するとそのプロジェクトの「コーダー」のモデルで動く (model が優先) */
	projectId?: string;
	/** 作成できた時点 (開始の前) で呼ぶ。開始は clone などで数分かかるので、先にセッションを開けるようにする */
	onCreated?: (created: CloudSession, index: number) => void;
};

export type LaunchResult = {
	index: number;
	title: string | undefined;
	/** 作成できたセッション (開始に失敗しても作成済みなら入る) */
	session?: CloudSession;
	error?: string;
};

/** サーバーの titleFrom と同じ (指示の 1 行目、80 文字まで)。 */
const titleFromPrompt = (prompt: string): string => {
	const line = prompt.trim().split('\n')[0].trim();
	return line.length > 80 ? `${line.slice(0, 79)}…` : line || 'クラウドエージェント';
};

/** 並列数が 2 以上なら、題名の末尾に #1..#N を付けて見分けられるようにする。 */
export const launchTitles = (input: Pick<LaunchInput, 'prompt' | 'count' | 'title'>): (string | undefined)[] => {
	const title = input.title?.trim();
	if (input.count <= 1) return [title || undefined];
	const base = (title || titleFromPrompt(input.prompt)).slice(0, 190);
	return Array.from({ length: input.count }, (_, i) => `${base} #${i + 1}`);
};

/**
 * 同じ指示で count 個のセッションを作って開始する。作成 → 開始は各セッションで並行に進め、
 * 1 つが失敗しても残りは続ける。結果は index 順 (成功は session、失敗は error)。
 */
export const launchSessions = async (session: DivisionSession, input: LaunchInput): Promise<LaunchResult[]> => {
	const prompt = input.prompt.trim();
	if (!prompt) throw new Error('指示を入力してください。');
	if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_PARALLEL_SESSIONS) {
		throw new Error(`並列数は 1〜${MAX_PARALLEL_SESSIONS} で指定してください。`);
	}
	const repo = input.repo;
	if (repo) {
		const issue = (isFullNameRepo(repo) ? validateRepoFullName(repo.fullName) : validateRepoUrl(repo.url))
			?? validateBranch(repo.branch ?? '');
		if (issue) throw new Error(issue);
	}

	const titles = launchTitles({ ...input, prompt });
	// workspaceName はリポジトリ名 (clone したときのフォルダ名) にする
	const workspaceName = repo
		? (isFullNameRepo(repo) ? repoNameOf(repo.fullName) : repoFolderName(repo.url)) || undefined
		: undefined;

	return Promise.all(titles.map(async (title, index): Promise<LaunchResult> => {
		let created: CloudSession | undefined;
		try {
			created = await createCloudSession(session, { prompt, title, model: input.model, projectId: input.projectId, workspaceName });
			try { input.onCreated?.(created, index); } catch { /* 通知側の失敗で起動は止めない */ }
			const started = await startCloudSession(session, created.id, { repo });
			return { index, title, session: started };
		} catch (e) {
			return { index, title, ...(created ? { session: created } : {}), error: cloudErrorText(e) };
		}
	}));
};

// ---------------------------------------------------------------------------
// 料金
// ---------------------------------------------------------------------------

export type CloudCostTotal = {
	/** 料金が分かっているセッションの合計 (USD) */
	totalUsd: number;
	/** 料金が分かっているセッション数 */
	known: number;
	/** 料金が返ってこなかった (古いサーバーなど) セッション数 */
	unknown: number;
};

/** 一覧のセッションの料金を合計する。costUsd が無いものは数えずに unknown に入れる。 */
export const sumCloudCosts = (sessions: Pick<CloudSession, 'costUsd'>[]): CloudCostTotal =>
	sessions.reduce<CloudCostTotal>((acc, s) => (
		typeof s.costUsd === 'number' && Number.isFinite(s.costUsd)
			? { ...acc, totalUsd: acc.totalUsd + s.costUsd, known: acc.known + 1 }
			: { ...acc, unknown: acc.unknown + 1 }
	), { totalUsd: 0, known: 0, unknown: 0 });

/** 料金の分かっているセッションを新しい順に最大 limit 件。コストページの「クラウドエージェント」に出す。 */
export const recentCostedSessions = (sessions: CloudSession[], limit = 5): CloudSession[] =>
	sessions
		.filter(s => typeof s.costUsd === 'number')
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
		.slice(0, limit);

// ---------------------------------------------------------------------------
// 差分の表示
// ---------------------------------------------------------------------------

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'context';

const META_LINE = /^(diff --git|index |new file mode|deleted file mode|old mode|new mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|Binary files|GIT binary patch|\\ No newline)/;

/** 1 行の種類。inHunk はハンク (@@) の中か (中なら '+++' も追加行)。 */
export const diffLineKind = (line: string, inHunk = true): DiffLineKind => {
	if (line.startsWith('@@')) return 'hunk';
	if (!inHunk && (line.startsWith('+++') || line.startsWith('---'))) return 'meta';
	if (META_LINE.test(line)) return line.startsWith('\\') || !inHunk ? 'meta' : 'context';
	if (line.startsWith('+')) return 'add';
	if (line.startsWith('-')) return 'del';
	return inHunk ? 'context' : 'meta';
};

/** ファイル 1 つ分の差分の各行に種類を付ける。 */
export const classifyPatchLines = (lines: string[]): DiffLineKind[] => {
	let inHunk = false;
	return lines.map(line => {
		if (line.startsWith('diff --git ')) inHunk = false;
		else if (line.startsWith('@@')) inHunk = true;
		return diffLineKind(line, inHunk);
	});
};

export type PatchSection = { path: string; oldPath?: string; lines: string[]; binary: boolean };

const stripPrefix = (p: string): string => p.replace(/^"?[ab]\//, '').replace(/"$/, '');

/** unified diff をファイルごとに分ける。 */
export const splitPatch = (patch: string): PatchSection[] => {
	if (!patch) return [];
	const sections: PatchSection[] = [];
	let current: PatchSection | null = null;
	// ハンクに入ったら、'+++' で始まる行も追加行として扱う (見出しとしては読まない)。
	let inHunk = false;
	for (const line of patch.split('\n')) {
		if (line.startsWith('diff --git ')) {
			const m = /^diff --git (.+?) (\S+)$/.exec(line);
			current = { path: m ? stripPrefix(m[2]) : '', lines: [line], binary: false };
			if (m && stripPrefix(m[1]) !== current.path) current.oldPath = stripPrefix(m[1]);
			sections.push(current);
			inHunk = false;
			continue;
		}
		if (!current) continue;
		current.lines.push(line);
		if (inHunk) continue;
		if (line.startsWith('@@')) inHunk = true;
		else if (line.startsWith('+++ ') && !line.startsWith('+++ /dev/null')) current.path = stripPrefix(line.slice(4).trim());
		else if (line.startsWith('rename to ')) current.path = line.slice('rename to '.length).trim();
		else if (line.startsWith('GIT binary patch') || line.startsWith('Binary files')) current.binary = true;
	}
	// 末尾の改行で入る空行は落とす
	for (const s of sections) while (s.lines.length > 1 && s.lines[s.lines.length - 1] === '') s.lines.pop();
	return sections;
};

/** 変更ファイルに対応する差分を探す。パスで見つからなければ同じ並び順のものを使う。 */
export const sectionForChange = (sections: PatchSection[], changes: CloudChange[], index: number): PatchSection | null => {
	const change = changes[index];
	if (!change) return null;
	const byPath = sections.find(s => s.path === change.path);
	if (byPath) return byPath;
	return sections.length === changes.length ? sections[index] : null;
};

/** 長すぎる差分は先頭だけにする (描画が重くなるため)。 */
export const truncateLines = (lines: string[], max: number): { lines: string[]; truncated: boolean; hidden: number } =>
	lines.length <= max
		? { lines, truncated: false, hidden: 0 }
		: { lines: lines.slice(0, max), truncated: true, hidden: lines.length - max };
