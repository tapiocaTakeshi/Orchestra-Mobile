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
 *   POST /api/cloud-sessions/:id/messages    追加の指示 (止まっていれば再開する)。{ continueGoal: true } で目標ループの次のラウンドへ
 *   POST /api/cloud-sessions/:id/stop        停止
 *   POST /api/cloud-sessions/:id/archive     サンドボックスを消して一覧から隠す
 *   GET  /api/cloud-sessions/:id/changes     変更ファイルと unified diff
 *   GET  /api/cloud-sessions/:id/pull-request  PR の状態と作成フォームの初期値 (GitHub のリポジトリから始めたセッションだけ)
 *   POST /api/cloud-sessions/:id/pull-request  PR を作成 / 既存の PR に push して更新
 *
 * モバイルには手元のワークスペースが無いので、アップロード (/upload) と取り込み (/file) は使わない。
 * 変更を手元に取り込むのは PC の Orchestra の役目で、ここでは差分を読むだけにする。
 *
 * GitHub アカウントの連携 (/api/github/*) は divisionGitHub.ts。同じ request と DivisionCloudError を使う。
 *
 * モデルに 'division-project' (DIVISION_PROJECT_MODEL) と projectId を渡すと、セッションは Division Project
 * (マルチエージェント) として動く: リーダーの計画 (plan イベント) → 役割ごとのタスク (task イベント、間の assistant に role)
 * → まとめ (done)。計画ごとのタスクの状態は divisionTimeline で組み立てる。
 *
 * 目標ループ (作成時の goalLoop。既定 'auto'): 作業の前にリーダーが目標と達成条件を立て (goal イベント)、
 * ラウンドごとにレビュアーが確かめて (review イベント)、目標を達成するまで作業を繰り返す。
 * 'confirm' は未達のラウンドごとに止まり、continueGoal で次のラウンドへ進む。
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
	/** The PR opened from this session (GitHub-repo sessions only). Absent = no PR yet */
	pullRequest?: CloudPullRequest | null;
	/** 目標ループ。古いサーバー・セッションには無い (= 'off') */
	goalLoop: CloudGoalLoopMode;
	/** 目標ループのラウンド数の上限 (無ければ null) */
	goalMaxRounds: number | null;
};

/**
 * 目標ループ (PC の Orchestra の「ループ」と同じ):
 *   auto    … 目標を達成するまで、未達なら自動で次のラウンドへ進む
 *   confirm … 未達のラウンドが終わるたびに止まり、「次のラウンドへ進む」を待つ
 *   off     … 目標を立てずに 1 回だけ作業する
 */
export type CloudGoalLoopMode = 'auto' | 'confirm' | 'off';
export const DEFAULT_GOAL_LOOP: CloudGoalLoopMode = 'off';
export const isGoalLoopMode = (v: unknown): v is CloudGoalLoopMode => v === 'auto' || v === 'confirm' || v === 'off';
export const GOAL_LOOP_LABELS: Record<CloudGoalLoopMode, string> = { auto: '自動', confirm: '毎回確認', off: 'オフ' };
export const GOAL_LOOP_HINTS: Record<CloudGoalLoopMode, string> = {
	auto: '目標を達成するまで、未達なら自動で次のラウンドに進みます',
	confirm: '未達のラウンドが終わるたびに止まり、続けるかを確認します',
	off: '目標を立てずに 1 回だけ作業します',
};

/** A pull request opened from a session (same shape as Division's PullRequestInfo). */
export type CloudPullRequest = {
	number: number;
	/** html URL on github.com */
	url: string;
	/** Head branch the session's work was pushed to */
	branch: string;
	base: string;
	headSha: string;
	title: string;
	draft: boolean;
	createdAt: string;
	updatedAt: string;
};

/**
 * plan / task は Division Project をモデルにしたセッション (model: 'division-project') だけが出す。
 * サーバーが将来ほかの種類を足しても、知らない種類は画面で読み飛ばす (toEvent は文字列をそのまま通す)。
 */
export type CloudSessionEventType =
	| 'user' | 'assistant' | 'tool' | 'status' | 'error' | 'done' | 'plan' | 'task'
	// 目標ループ: goal は { goal, criteria, maxRounds, mode, model }、review は { round, status: 'start' | 'done', ... } (toCloudGoal / toCloudReview)
	| 'goal' | 'review'
	// data: { number, url, branch, base, action: 'created' | 'updated', title } (see toPullRequestEvent)
	| 'pull_request';

export type CloudSessionEvent = {
	seq: number;
	type: CloudSessionEventType;
	/**
	 * 種類ごとの中身。user/assistant は { text } (Division Project では assistant に role も付く)、
	 * tool は { name, args, ok, output, durationMs }、plan は { tasks, leaderModel }、task は { index, role, status, ... } など
	 */
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
	// GET .../pull-request may start a stopped sandbox and diff it (~3 min)
	pullRequestInfo: 300_000,
	// POST .../pull-request commits the workspace, pushes it and calls the GitHub API (~10 min at worst)
	pullRequest: 600_000,
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
	method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
			...(method !== 'GET' ? { body: JSON.stringify(options.body ?? {}) } : {}),
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

/** Reads a PR DTO. Returns null when it is missing or has no usable number / https URL. */
export const toCloudPullRequest = (raw: unknown): CloudPullRequest | null => {
	if (!raw || typeof raw !== 'object') return null;
	const p = raw as Record<string, unknown>;
	const number = num(p.number, Number.NaN);
	const url = str(p.url).trim();
	if (!Number.isInteger(number) || number <= 0 || !/^https:\/\//i.test(url)) return null;
	return {
		number,
		url,
		branch: str(p.branch),
		base: str(p.base),
		headSha: str(p.headSha),
		title: str(p.title),
		draft: p.draft === true,
		createdAt: str(p.createdAt),
		updatedAt: str(p.updatedAt) || str(p.createdAt),
	};
};

export const toCloudSession = (raw: unknown): CloudSession => {
	const s = (raw ?? {}) as Record<string, unknown>;
	const pullRequest = toCloudPullRequest(s.pullRequest);
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
		...(pullRequest ? { pullRequest } : {}),
		goalLoop: isGoalLoopMode(s.goalLoop) ? s.goalLoop : 'off',
		goalMaxRounds: typeof s.goalMaxRounds === 'number' && Number.isFinite(s.goalMaxRounds) ? s.goalMaxRounds : null,
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
	/** provider/model か DIVISION_PROJECT_MODEL。空ならプロジェクトのコーダーの割り当て */
	model?: string;
	projectId?: string;
	workspaceName?: string;
	/** 省略時はサーバーの既定 ('auto') */
	goalLoop?: CloudGoalLoopMode;
};

/**
 * モデルに指定すると、そのセッションは Division Project (マルチエージェント) として動く。
 * プロジェクトのリーダーが役割ごとのタスクに分け、各タスクをその役割に割り当てたモデルがサンドボックスで進め、
 * 最後にまとめる。projectId が必須 (無いとサーバーは 400)。
 */
export const DIVISION_PROJECT_MODEL = 'division-project';

export const isDivisionProjectModel = (model: string | null | undefined): boolean =>
	(model ?? '').trim() === DIVISION_PROJECT_MODEL;

/** モデルとプロジェクトの組み合わせが送れなければ理由を返す。送れるなら null。 */
export const modelInputIssue = (model: string | undefined, projectId: string | undefined): string | null =>
	isDivisionProjectModel(model) && !projectId?.trim()
		? 'Division Project をモデルにするときは、プロジェクトを選んでください。'
		: null;

/** POST /api/cloud-sessions の body。空の値は送らない。Division Project なのにプロジェクトが無ければ投げる。 */
export const createSessionBody = (input: CreateCloudSessionInput): Record<string, string> => {
	const issue = modelInputIssue(input.model, input.projectId);
	if (issue) throw new Error(issue);
	const body: Record<string, string> = { prompt: input.prompt };
	if (input.title?.trim()) body.title = input.title.trim();
	if (input.model?.trim()) body.model = input.model.trim();
	if (input.projectId?.trim()) body.projectId = input.projectId.trim();
	if (input.workspaceName?.trim()) body.workspaceName = input.workspaceName.trim();
	if (isGoalLoopMode(input.goalLoop)) body.goalLoop = input.goalLoop;
	return body;
};

/** サンドボックスを用意する (status は uploading で返る)。数分かかることがある。 */
export const createCloudSession = async (session: DivisionSession, input: CreateCloudSessionInput): Promise<CloudSession> => {
	const body = createSessionBody(input);
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

/** POST .../messages の body。continueGoal なら text は空でもよい (書いてあれば次のラウンドへの追加の指示)。 */
export const messageBody = (text: string, options: { continueGoal?: boolean } = {}): Record<string, unknown> => {
	const trimmed = text.trim();
	if (options.continueGoal) return { continueGoal: true, ...(trimmed ? { text: trimmed } : {}) };
	return { text: trimmed };
};

export const sendCloudMessage = async (session: DivisionSession, id: string, text: string, options: { continueGoal?: boolean } = {}): Promise<CloudSession> => {
	const data = await request<{ session?: unknown }>(session, `${idPath(id)}/messages`, { method: 'POST', body: messageBody(text, options) });
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

/**
 * 一覧に出すモデル名。決まる前は指定したモデル、どちらも無ければ既定。
 * Division Project は決まると "Division Project · <プロジェクト名>" がサーバーから入る。
 */
export const cloudModelLabel = (session: Pick<CloudSession, 'model' | 'modelLabel'>): string =>
	session.modelLabel || (isDivisionProjectModel(session.model) ? 'Division Project' : session.model) || '既定のモデル';

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

/** ツール呼び出しの名前と、要約に出す引数 (1 行に畳んだもの。無ければ空)。 */
export const toolCallParts = (name: string, args: unknown, max = 80): { name: string; arg: string } => {
	const toolName = oneLine(name || 'tool', max);
	if (!args || typeof args !== 'object') return { name: toolName, arg: '' };
	const record = args as Record<string, unknown>;
	const key = SUMMARY_KEYS.find(k => typeof record[k] === 'string' && (record[k] as string).trim())
		?? Object.keys(record).find(k => typeof record[k] === 'string' && (record[k] as string).trim());
	return { name: toolName, arg: key ? oneLine(String(record[key]), max) : '' };
};

/** ツール呼び出しを 1 行にする。例: `read_file src/a.ts` / `run_command npm test`。 */
export const toolCallSummary = (name: string, args: unknown, max = 80): string => {
	const parts = toolCallParts(name, args, max);
	return oneLine(parts.arg ? `${parts.name} ${parts.arg}` : parts.name, max);
};

/**
 * ツールの出力を Claude Code の「⎿ 1 行目 … +N 行」のように畳む。
 * 先頭の空行は飛ばし、残りの行数 (末尾の空行は数えない) を more に入れる。
 */
export const outputPreview = (output: string, max = 120): { first: string; more: number } => {
	const lines = output.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
	const start = lines.findIndex(line => line.trim() !== '');
	if (start < 0) return { first: '', more: 0 };
	return { first: oneLine(lines[start], max), more: lines.length - start - 1 };
};

/** チャットの 1 吹き出し分。指示はそれだけで 1 つ、それ以外は次の指示までをエージェントの 1 回の返答にまとめる。 */
export type ChatBlock =
	| { kind: 'user'; event: CloudSessionEvent }
	| { kind: 'agent'; key: number; items: ChatItem[] };

/** エージェントの返答の中身。続けて実行したツールは 1 つにまとめて畳む。 */
export type ChatItem =
	| { kind: 'event'; event: CloudSessionEvent }
	| { kind: 'tools'; key: number; events: CloudSessionEvent[] };

/** ログをチャットの吹き出しの並びにする (古い順)。 */
export const chatBlocks = (events: CloudSessionEvent[]): ChatBlock[] => {
	const blocks: ChatBlock[] = [];
	let agent: Extract<ChatBlock, { kind: 'agent' }> | null = null;
	for (const event of events) {
		if (event.type === 'user') {
			agent = null;
			blocks.push({ kind: 'user', event });
			continue;
		}
		if (!agent) {
			agent = { kind: 'agent', key: event.seq, items: [] };
			blocks.push(agent);
		}
		const last = agent.items[agent.items.length - 1];
		if (event.type === 'tool') {
			if (last?.kind === 'tools') last.events.push(event);
			else agent.items.push({ kind: 'tools', key: event.seq, events: [event] });
		} else {
			agent.items.push({ kind: 'event', event });
		}
	}
	return blocks;
};

// ---------------------------------------------------------------------------
// Division Project の計画とタスク (plan / task イベント)
// ---------------------------------------------------------------------------

export type CloudPlanTask = {
	index: number;
	/** 役割のスラッグ (例: coder) */
	role: string;
	/** 役割の表示名 (例: 実装) */
	roleName: string;
	title: string;
	instruction: string;
	/** "Provider · modelId" */
	model: string;
};

export type CloudPlan = { tasks: CloudPlanTask[]; leaderModel: string };

export type CloudTaskStatus = 'start' | 'done' | 'failed';

export type CloudTaskEvent = {
	index: number;
	role: string;
	roleName: string;
	title: string;
	model: string;
	status: CloudTaskStatus;
	summary?: string;
};

/** 欠けた値で落ちないように plan の data を取り出す。tasks が配列でなければ空の計画。 */
export const toCloudPlan = (data: Record<string, unknown>): CloudPlan => {
	const rawTasks = Array.isArray(data.tasks) ? data.tasks : [];
	const tasks = rawTasks.map((raw, i): CloudPlanTask => {
		const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
		const role = str(t.role);
		return {
			index: typeof t.index === 'number' && Number.isFinite(t.index) ? t.index : i,
			role,
			roleName: str(t.roleName) || role || '担当',
			title: str(t.title),
			instruction: str(t.instruction),
			model: str(t.model),
		};
	});
	return { tasks, leaderModel: str(data.leaderModel) };
};

/** task の data を取り出す。index か status が無ければ null (表示しない)。 */
export const toCloudTaskEvent = (data: Record<string, unknown>): CloudTaskEvent | null => {
	const status = data.status;
	if (typeof data.index !== 'number' || !Number.isFinite(data.index)) return null;
	if (status !== 'start' && status !== 'done' && status !== 'failed') return null;
	const role = str(data.role);
	return {
		index: data.index,
		role,
		roleName: str(data.roleName) || role || '担当',
		title: str(data.title),
		model: str(data.model),
		status,
		...(typeof data.summary === 'string' && data.summary.trim() ? { summary: data.summary.trim() } : {}),
	};
};

// ---------------------------------------------------------------------------
// 目標ループ (goal / review イベント)
// ---------------------------------------------------------------------------

export type CloudGoal = { goal: string; criteria: string[]; maxRounds: number | null; mode: CloudGoalLoopMode; model: string };

export const toCloudGoal = (data: Record<string, unknown>): CloudGoal => ({
	goal: str(data.goal),
	criteria: (Array.isArray(data.criteria) ? data.criteria : []).filter((c): c is string => typeof c === 'string' && !!c.trim()),
	maxRounds: typeof data.maxRounds === 'number' && Number.isFinite(data.maxRounds) ? data.maxRounds : null,
	mode: data.mode === 'confirm' ? 'confirm' : 'auto',
	model: str(data.model),
});

export type CloudReviewCriterion = { index: number; text: string; met: boolean; reason: string };
export type CloudReviewNext = 'continue' | 'achieved' | 'limit' | 'paused';

export type CloudReview =
	| { status: 'start'; round: number; model: string; role: string }
	| { status: 'done'; round: number; model: string; role: string; achieved: boolean; criteria: CloudReviewCriterion[]; summary: string; next: CloudReviewNext; maxRounds: number | null };

/** review の data を取り出す。status が分からなければ null (表示しない)。 */
export const toCloudReview = (data: Record<string, unknown>): CloudReview | null => {
	const round = typeof data.round === 'number' && data.round >= 1 ? data.round : 1;
	const base = { round, model: str(data.model), role: str(data.role) };
	if (data.status === 'start') return { status: 'start', ...base };
	if (data.status !== 'done') return null;
	const criteria = (Array.isArray(data.criteria) ? data.criteria : [])
		.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
		.map((c, i): CloudReviewCriterion => ({ index: typeof c.index === 'number' ? c.index : i + 1, text: str(c.text), met: c.met === true, reason: str(c.reason) }));
	const next = (['continue', 'achieved', 'limit', 'paused'] as const).find(n => n === data.next) ?? 'limit';
	return {
		status: 'done',
		...base,
		achieved: data.achieved === true,
		criteria,
		summary: str(data.summary),
		next,
		maxRounds: typeof data.maxRounds === 'number' && Number.isFinite(data.maxRounds) ? data.maxRounds : null,
	};
};

/** レビューの結果の一文 (例: 「未達のため、ラウンド 2/5 に進みます」)。 */
export const reviewOutcomeLabel = (review: Extract<CloudReview, { status: 'done' }>): string => {
	const max = review.maxRounds ?? '?';
	switch (review.next) {
		case 'achieved': return `目標を達成しました (ラウンド ${review.round})`;
		case 'continue': return `未達のため、ラウンド ${review.round + 1}/${max} に進みます`;
		case 'paused': return `目標はまだ達成されていません (ラウンド ${review.round}/${max} 完了)`;
		default: return `上限の ${review.round} ラウンドで未達のまま終了しました`;
	}
};

/**
 * 「次のラウンドへ進む」を出すレビューの seq: 最後のレビューが paused で、そのあとにユーザーの発言や新しい目標が無い。無ければ null。
 */
export const pausedReviewSeq = (events: CloudSessionEvent[]): number | null => {
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i];
		if (e.type === 'user' || e.type === 'goal') return null;
		if (e.type === 'review' && e.data.status === 'done') return e.data.next === 'paused' ? e.seq : null;
	}
	return null;
};

/**
 * 計画の各タスクの状態。
 *   pending     … まだ始まっていない
 *   running     … 始まって、まだ終わっていない (セッションが動いているあいだだけ)
 *   done/failed … 終わった
 *   interrupted … 始まったが、終わる前にセッションが止まった (停止・失敗)
 */
export type PlanTaskState = 'pending' | 'running' | 'done' | 'failed' | 'interrupted';

export type PlanItem = CloudPlanTask & { state: PlanTaskState; summary?: string };

export type PlanProgress = {
	leaderModel: string;
	items: PlanItem[];
	done: number;
	failed: number;
};

export type DivisionTimeline = {
	/** plan イベントの seq → その計画の進み具合 */
	plans: Map<number, PlanProgress>;
	/** task イベントの seq → 「何番目 / 全部で何個」(計画に見つからなければ入らない) */
	taskPositions: Map<number, { position: number; total: number }>;
	/** 役割のスラッグ → 表示名 (assistant の role に名前を付ける) */
	roleNames: Map<string, string>;
};

/**
 * イベントの列から、各計画のタスクの状態を組み立てる。task イベントは直前の plan に属する
 * (次の plan が来たら、それ以降は新しい計画)。同じタスクの task が何度か来たら最後のものを使う。
 * active はセッションがまだ動いているか。止まっていれば、始まったまま終わっていないタスクは interrupted にする。
 */
export const divisionTimeline = (events: CloudSessionEvent[], active: boolean): DivisionTimeline => {
	const plans = new Map<number, PlanProgress>();
	const taskPositions = new Map<number, { position: number; total: number }>();
	const roleNames = new Map<string, string>();

	let currentSeq: number | null = null;
	let currentPlan: CloudPlan | null = null;
	let states = new Map<number, { state: PlanTaskState; summary?: string }>();

	const finish = () => {
		if (currentSeq === null || !currentPlan) return;
		const items = currentPlan.tasks.map((task): PlanItem => {
			const s = states.get(task.index);
			const state: PlanTaskState = !s ? 'pending' : s.state === 'running' && !active ? 'interrupted' : s.state;
			return { ...task, state, ...(s?.summary ? { summary: s.summary } : {}) };
		});
		plans.set(currentSeq, {
			leaderModel: currentPlan.leaderModel,
			items,
			done: items.filter(i => i.state === 'done').length,
			failed: items.filter(i => i.state === 'failed').length,
		});
	};

	for (const event of events) {
		if (event.type === 'plan') {
			finish();
			currentSeq = event.seq;
			currentPlan = toCloudPlan(event.data);
			states = new Map();
			for (const t of currentPlan.tasks) if (t.role) roleNames.set(t.role, t.roleName);
		} else if (event.type === 'task') {
			const task = toCloudTaskEvent(event.data);
			if (!task) continue;
			if (task.role) roleNames.set(task.role, task.roleName);
			if (!currentPlan) continue;
			const position = currentPlan.tasks.findIndex(t => t.index === task.index);
			if (position < 0) continue;
			taskPositions.set(event.seq, { position: position + 1, total: currentPlan.tasks.length });
			states.set(task.index, {
				state: task.status === 'start' ? 'running' : task.status,
				...(task.summary ? { summary: task.summary } : {}),
			});
		}
	}
	finish();
	return { plans, taskPositions, roleNames };
};

/** タスクの見出し。例: "2/4 · 実装 (Anthropic · claude-opus) — API を足す" */
export const taskHeaderLabel = (task: Pick<CloudTaskEvent, 'roleName' | 'model' | 'title'>, position?: { position: number; total: number }): string => {
	const head = position ? `${position.position}/${position.total} · ` : '';
	const model = task.model ? ` (${task.model})` : '';
	const title = task.title ? ` — ${task.title}` : '';
	return `${head}${task.roleName}${model}${title}`;
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
// Pull requests (sessions started from a GitHub repo only)
// ---------------------------------------------------------------------------

/** Prefill values the server suggests for the PR form. */
export type CloudPullRequestSuggestion = { title: string; body: string; branch: string; base: string };

/** State of the session's PR on GitHub. */
export type CloudPullRequestState = 'open' | 'closed' | 'merged';

const PULL_REQUEST_STATES: CloudPullRequestState[] = ['open', 'closed', 'merged'];

/** Response of GET /api/cloud-sessions/:id/pull-request. */
export type CloudPullRequestInfo = {
	pullRequest: CloudPullRequest | null;
	/**
	 * Only meaningful when pullRequest is set; null = GitHub could not be read.
	 * merged / closed: the suggestion is a fresh one and the next POST opens a new PR.
	 * open: the suggestion holds the PR's current title / body / branch / base on GitHub.
	 */
	pullRequestState?: CloudPullRequestState | null;
	suggestion: CloudPullRequestSuggestion;
	/** false = the button is replaced by `reason` */
	canCreate: boolean;
	/** Japanese text explaining why a PR cannot be created / updated right now */
	reason?: string;
	/** Machine-readable reason, sent with every reason (e.g. github_not_connected) */
	code?: string;
};

export type CreatePullRequestInput = {
	title: string;
	body?: string;
	/** Head branch. Only used when the session has no PR yet; empty = the server's suggestion */
	branch?: string;
	base?: string;
	draft?: boolean;
};

export type CreatePullRequestAction = 'created' | 'updated' | 'unchanged';

export type CreatePullRequestResult = {
	pullRequest: CloudPullRequest;
	/** true = a commit was pushed, a PR was created, or the title / body were patched */
	updated: boolean;
	/** What happened ("unchanged" = the PR is already up to date) */
	action: CreatePullRequestAction;
};

export const PULL_REQUEST_LIMITS = { title: 256, body: 60_000 } as const;

/**
 * Japanese fallbacks for the `code` values of the pull-request endpoints. The server's own `error` /
 * `reason` text wins when it sends one; these are used when it only sends a code.
 */
export const PULL_REQUEST_REASONS: Record<string, string> = {
	not_github_repo: 'GitHub のリポジトリから始めたセッションだけ PR を作成できます。',
	[GITHUB_NOT_CONNECTED]: 'GitHub と連携されていないか、連携が解除されています。「GitHub と連携」してください。',
	session_running: 'エージェントの作業中は PR を作成できません。終わるまでお待ちください。',
	no_changes: 'ベースブランチからの変更がありません。',
	pr_in_progress: 'ほかの操作で PR に push しています。少し待ってから試してください。',
	branch_exists: '同じ名前のブランチがすでにリモートにあります。ブランチ名を変えてください。',
	github_no_push_access: 'このリポジトリに push する権限がありません。',
	github_error: 'GitHub でエラーが発生しました。しばらくしてから試してください。',
	github_not_configured: 'サーバー側で GitHub 連携が未設定のため、PR を作成できません。',
	session_archived: 'サンドボックスが削除されているため、PR を作成できません。',
	sandbox_error: 'サンドボックスで git の操作に失敗しました。しばらくしてから試してください。',
	branch_diverged: 'PR のブランチにほかの push があるため更新できません。GitHub で確認してください。',
	missing_parent: '前回の PR のコミットがサンドボックスに見つからないため更新できません。',
	validation: '入力内容が正しくありません。',
};

/** Reads the GET response defensively (a missing suggestion becomes empty strings). */
export const toPullRequestInfo = (raw: unknown): CloudPullRequestInfo => {
	const r = (raw ?? {}) as Record<string, unknown>;
	const s = (r.suggestion && typeof r.suggestion === 'object' ? r.suggestion : {}) as Record<string, unknown>;
	const reason = str(r.reason).trim();
	const code = str(r.code).trim();
	const pullRequest = toCloudPullRequest(r.pullRequest);
	return {
		pullRequest,
		suggestion: { title: str(s.title), body: str(s.body), branch: str(s.branch), base: str(s.base) },
		canCreate: r.canCreate === true,
		...(pullRequest
			? { pullRequestState: PULL_REQUEST_STATES.includes(r.pullRequestState as CloudPullRequestState) ? r.pullRequestState as CloudPullRequestState : null }
			: {}),
		...(reason ? { reason } : {}),
		...(code ? { code } : {}),
	};
};

/** PR state and form suggestion for a session. */
export const getPullRequestInfo = async (session: DivisionSession, id: string): Promise<CloudPullRequestInfo> =>
	toPullRequestInfo(await request<unknown>(session, `${idPath(id)}/pull-request`, { timeoutMs: CLOUD_TIMEOUTS.pullRequestInfo }));

/**
 * Whether a branch name can be used as the PR's head branch (git ref rules on top of validateBranch).
 * Empty is fine: the server then uses its suggestion.
 */
export const validatePullRequestBranch = (raw: string): string | null => {
	const value = raw.trim();
	if (!value) return null;
	const issue = validateBranch(value);
	if (issue) return issue;
	if (value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock') || value.includes('//') || /(^|\/)\./.test(value)) {
		return 'ブランチ名の形式が正しくありません (git のブランチ名として使えません)。';
	}
	return null;
};

/** Returns why the input cannot be sent, or null when it is valid (same limits as the server). */
export const pullRequestInputIssue = (input: CreatePullRequestInput): string | null => {
	const title = input.title.trim();
	if (!title) return 'タイトルを入力してください。';
	if (title.length > PULL_REQUEST_LIMITS.title) return `タイトルは ${PULL_REQUEST_LIMITS.title} 文字以内にしてください。`;
	if ((input.body ?? '').length > PULL_REQUEST_LIMITS.body) {
		return `説明は ${PULL_REQUEST_LIMITS.body.toLocaleString('en-US')} 文字以内にしてください。`;
	}
	return validatePullRequestBranch(input.branch ?? '') ?? validateBranch(input.base ?? '');
};

/** POST body. Empty optional values are left out. Throws when the input is invalid. */
export const pullRequestBody = (input: CreatePullRequestInput): Record<string, string | boolean> => {
	const issue = pullRequestInputIssue(input);
	if (issue) throw new Error(issue);
	const body: Record<string, string | boolean> = { title: input.title.trim() };
	if (input.body?.trim()) body.body = input.body.trim();
	if (input.branch?.trim()) body.branch = input.branch.trim();
	if (input.base?.trim()) body.base = input.base.trim();
	if (typeof input.draft === 'boolean') body.draft = input.draft;
	return body;
};

/**
 * Creates the PR, or pushes the current workspace to the existing PR and updates its title / body.
 * Validates first and does not call the API when the input is invalid.
 */
export const createPullRequest = async (
	session: DivisionSession,
	id: string,
	input: CreatePullRequestInput,
): Promise<CreatePullRequestResult> => {
	const body = pullRequestBody(input);
	const data = await request<{ pullRequest?: unknown; updated?: unknown; action?: unknown }>(
		session, `${idPath(id)}/pull-request`, { method: 'POST', body, timeoutMs: CLOUD_TIMEOUTS.pullRequest },
	);
	const pullRequest = toCloudPullRequest(data.pullRequest);
	if (!pullRequest) throw new DivisionCloudError(502, 'PR の情報を受け取れませんでした。');
	const updated = data.updated !== false;
	const action: CreatePullRequestAction = data.action === 'created' || data.action === 'updated' || data.action === 'unchanged'
		? data.action
		// Older servers sent only `updated`
		: updated ? 'updated' : 'unchanged';
	return { pullRequest, updated, action };
};

/** Error text for the pull-request endpoints: prefers the server's Japanese `error` over generic status text. */
export const pullRequestErrorText = (e: unknown): string => {
	if (!(e instanceof DivisionCloudError)) return cloudErrorText(e);
	const serverText = e.message && !/^HTTP \d+$/.test(e.message) && e.message !== 'timeout' ? e.message : '';
	if (e.code === GITHUB_NOT_CONNECTED) return e.userMessage;
	if (e.code) return serverText || PULL_REQUEST_REASONS[e.code] || e.userMessage;
	if (e.status === 404) return 'PR を作成できません (セッションが見つからないか、Division サーバーが PR の作成に未対応です)。';
	if (e.status === 409 && serverText) return serverText;
	return e.userMessage;
};

/** Whether a session offers the PR button: started from a GitHub repo and not working right now. */
export const canOfferPullRequest = (session: Pick<CloudSession, 'workspaceInfo' | 'status'>): boolean =>
	!!session.workspaceInfo?.repoFullName?.trim() && !isActive(session.status);

/** The GET says GitHub is not connected (offer the "GitHub と連携" flow). */
export const isPullRequestNotConnected = (info: Pick<CloudPullRequestInfo, 'code' | 'reason'>): boolean =>
	info.code === GITHUB_NOT_CONNECTED || info.reason === GITHUB_NOT_CONNECTED;

/** Text shown instead of the button when canCreate is false. A bare code is turned into Japanese. */
export const pullRequestReasonText = (info: Pick<CloudPullRequestInfo, 'code' | 'reason'>): string => {
	const reason = info.reason?.trim();
	if (reason && PULL_REQUEST_REASONS[reason]) return PULL_REQUEST_REASONS[reason];
	if (reason) return reason;
	return (info.code && PULL_REQUEST_REASONS[info.code]) || 'いまは PR を作成できません。';
};

export type PullRequestMode = 'create' | 'update';

/** A merged / closed PR cannot be updated: the next POST opens a new PR. */
export const isPullRequestFinished = (state: CloudPullRequestState | null | undefined): boolean =>
	state === 'merged' || state === 'closed';

/** 'update' only while the PR is open (or its state is unknown); otherwise a new PR is created. */
export const pullRequestMode = (pr: CloudPullRequest | null | undefined, state?: CloudPullRequestState | null): PullRequestMode =>
	pr && !isPullRequestFinished(state) ? 'update' : 'create';

/** "PR を作成" before a PR exists, "PR を更新" while it is open, "新しい PR を作成" once merged / closed. */
export const pullRequestActionLabel = (pr: CloudPullRequest | null | undefined, state?: CloudPullRequestState | null): string =>
	!pr ? 'PR を作成' : isPullRequestFinished(state) ? '新しい PR を作成' : 'PR を更新';

export const PULL_REQUEST_STATE_LABELS: Record<CloudPullRequestState, string> = {
	open: 'オープン',
	merged: 'マージ済み',
	closed: 'クローズ済み',
};

/**
 * The state of `pr` from a GET result. The session DTO can be newer than the GET, so the state is only
 * used when it belongs to the same PR number; otherwise it is unknown (null).
 */
export const pullRequestStateFor = (
	pr: Pick<CloudPullRequest, 'number'> | null | undefined,
	info: Pick<CloudPullRequestInfo, 'pullRequest' | 'pullRequestState'> | null | undefined,
): CloudPullRequestState | null =>
	pr && info?.pullRequest?.number === pr.number ? info.pullRequestState ?? null : null;

export const openPullRequestLabel = (pr: Pick<CloudPullRequest, 'number'>): string => `PR #${pr.number} を開く`;

/** Values edited in the PR form. */
export type PullRequestForm = { title: string; body: string; branch: string; base: string; draft: boolean };

/**
 * Prefills the form from the suggestion. While a PR is open the suggestion holds its current values on GitHub
 * (the PR's own fields fill any gap); after merge / close it is a fresh suggestion for a new PR.
 */
export const initialPullRequestForm = (
	info: Pick<CloudPullRequestInfo, 'pullRequest' | 'suggestion' | 'pullRequestState'>,
): PullRequestForm => {
	const s = info.suggestion;
	const pr = pullRequestMode(info.pullRequest, info.pullRequestState) === 'update' ? info.pullRequest : null;
	return {
		title: s.title || pr?.title || '',
		body: s.body,
		branch: s.branch || pr?.branch || '',
		base: s.base || pr?.base || '',
		draft: pr?.draft ?? false,
	};
};

/** Result text after a POST: "PR #n を作成しました" / "PR #n を更新しました" / "変更はありません（PR は最新です）". */
export const pullRequestResultText = (result: Pick<CreatePullRequestResult, 'action' | 'pullRequest'>): string =>
	result.action === 'unchanged'
		? '変更はありません（PR は最新です）'
		: pullRequestEventText({ number: result.pullRequest.number, action: result.action });

/** What the form sends. Updating an existing PR only changes title / body (branch, base and draft are fixed). */
export const pullRequestFormInput = (form: PullRequestForm, mode: PullRequestMode): CreatePullRequestInput =>
	mode === 'create'
		? { title: form.title, body: form.body, branch: form.branch, base: form.base, draft: form.draft }
		: { title: form.title, body: form.body };

/** Data of a `pull_request` event. */
export type CloudPullRequestEvent = {
	number: number;
	/** Empty when the server did not send a usable https URL (the card is then not tappable) */
	url: string;
	branch: string;
	base: string;
	action: 'created' | 'updated';
	title: string;
};

/** Reads a `pull_request` event's data. Returns null when it has no PR number (not rendered). */
export const toPullRequestEvent = (data: Record<string, unknown>): CloudPullRequestEvent | null => {
	const number = num(data.number, Number.NaN);
	if (!Number.isInteger(number) || number <= 0) return null;
	const url = str(data.url).trim();
	return {
		number,
		url: /^https:\/\//i.test(url) ? url : '',
		branch: str(data.branch),
		base: str(data.base),
		action: data.action === 'updated' ? 'updated' : 'created',
		title: str(data.title),
	};
};

/** "PR #12 を作成しました" / "PR #12 を更新しました" */
export const pullRequestEventText = (event: Pick<CloudPullRequestEvent, 'number' | 'action'>): string =>
	`PR #${event.number} を${event.action === 'updated' ? '更新' : '作成'}しました`;

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
	/** provider/model か DIVISION_PROJECT_MODEL (このときは projectId が必須) */
	model?: string;
	title?: string;
	/** Division のプロジェクト ID。指定するとそのプロジェクトの「コーダー」のモデルで動く (model が優先) */
	projectId?: string;
	/** 目標ループ。省略時はサーバーの既定 */
	goalLoop?: CloudGoalLoopMode;
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
	const modelIssue = modelInputIssue(input.model, input.projectId);
	if (modelIssue) throw new Error(modelIssue);

	const titles = launchTitles({ ...input, prompt });
	// workspaceName はリポジトリ名 (clone したときのフォルダ名) にする
	const workspaceName = repo
		? (isFullNameRepo(repo) ? repoNameOf(repo.fullName) : repoFolderName(repo.url)) || undefined
		: undefined;

	return Promise.all(titles.map(async (title, index): Promise<LaunchResult> => {
		let created: CloudSession | undefined;
		try {
			created = await createCloudSession(session, { prompt, title, model: input.model, projectId: input.projectId, workspaceName, goalLoop: input.goalLoop });
			try { input.onCreated?.(created, index); } catch { /* 通知側の失敗で起動は止めない */ }
			const started = await startCloudSession(session, created.id, { repo });
			return { index, title, session: started };
		} catch (e) {
			return { index, title, ...(created ? { session: created } : {}), error: cloudErrorText(e) };
		}
	}));
};

// ---------------------------------------------------------------------------
// モデルの選択 (新しいセッションのシート)
// ---------------------------------------------------------------------------

/**
 * モデルの選び方。デスクトップのモデルの選択と同じく Division Project を先頭に置く。
 *   division … Division Project (マルチエージェント)。model = 'division-project' と、そのプロジェクトの projectId を送る
 *   default  … 既定。model を送らない (プロジェクトを選んでいればそのコーダー、無ければサーバーの既定)
 *   custom   … provider/model を直接入力 (上級者向け)
 */
export type CloudModelMode = 'division' | 'default' | 'custom';

export type CloudModelSelection = {
	mode: CloudModelMode;
	/** custom のときのモデル */
	model: string;
	/** division ではモデルにした Division Project、それ以外では「プロジェクト」で選んだもの (空なら指定なし) */
	projectId: string;
};

export type CloudModelOption = {
	/** 選択中かを比べるキー (division:<id> / default / custom) */
	key: string;
	mode: CloudModelMode;
	label: string;
	detail?: string;
	/** division のときのプロジェクト ID */
	projectId?: string;
	/** PC で有効なプロジェクト */
	active?: boolean;
};

export const DEFAULT_MODEL_LABEL = '既定 (プロジェクトの coder ロール)';
export const CUSTOM_MODEL_LABEL = 'モデルを直接指定';

export const modelOptionKey = (selection: Pick<CloudModelSelection, 'mode' | 'projectId'>): string =>
	selection.mode === 'division' ? `division:${selection.projectId}` : selection.mode;

/**
 * モデルの選択肢。プロジェクトごとの "Division Project · <名前>" (一覧の順)、既定、直接指定の順。
 * selectedProjectId (いま division で選んでいるもの) が一覧に無ければ、見失わないよう先頭に足す。
 */
export const cloudModelOptions = (
	projects: { id: string; name: string; active?: boolean }[],
	selectedProjectId?: string,
): CloudModelOption[] => {
	const division: CloudModelOption[] = projects.map(p => ({
		key: `division:${p.id}`,
		mode: 'division',
		label: `Division Project · ${p.name}`,
		detail: 'リーダーが役割ごとに分担し、各役割のモデルが順に進めます',
		projectId: p.id,
		...(p.active ? { active: true } : {}),
	}));
	const missing = selectedProjectId?.trim();
	if (missing && !projects.some(p => p.id === missing)) {
		division.unshift({
			key: `division:${missing}`,
			mode: 'division',
			label: `Division Project · プロジェクト ${missing.slice(0, 8)}`,
			detail: '一覧に見つかりません (削除されたか、別のアカウントのプロジェクトです)',
			projectId: missing,
		});
	}
	return [
		...division,
		{ key: 'default', mode: 'default', label: DEFAULT_MODEL_LABEL, detail: 'プロジェクトを選べばその coder、無ければサーバーの既定' },
		{ key: 'custom', mode: 'custom', label: CUSTOM_MODEL_LABEL, detail: 'provider/model を入力 (上級者向け)' },
	];
};

/** 選択肢を選んだあとの選択。division はそのプロジェクトにし、ほかはプロジェクトとモデルの入力を残す。 */
export const applyModelOption = (current: CloudModelSelection, option: CloudModelOption): CloudModelSelection =>
	option.mode === 'division'
		? { ...current, mode: 'division', projectId: option.projectId ?? '' }
		: { ...current, mode: option.mode };

/** 起動に送る model と projectId。 */
export const launchModelFields = (selection: CloudModelSelection): { model?: string; projectId?: string } => {
	const projectId = selection.projectId.trim() || undefined;
	switch (selection.mode) {
		case 'division':
			return { model: DIVISION_PROJECT_MODEL, ...(projectId ? { projectId } : {}) };
		case 'custom': {
			const model = selection.model.trim() || undefined;
			return { ...(model ? { model } : {}), ...(projectId ? { projectId } : {}) };
		}
		default:
			return projectId ? { projectId } : {};
	}
};

/** 起動できない理由 (Division Project なのにプロジェクトが無いなど)。起動できるなら null。 */
export const modelSelectionIssue = (selection: CloudModelSelection): string | null => {
	const fields = launchModelFields(selection);
	return modelInputIssue(fields.model, fields.projectId);
};

/** 保存しておいた選択を読み戻す。形が違えば null。 */
export const toModelSelection = (raw: unknown): CloudModelSelection | null => {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (r.mode !== 'division' && r.mode !== 'default' && r.mode !== 'custom') return null;
	const selection: CloudModelSelection = {
		mode: r.mode,
		model: typeof r.model === 'string' ? r.model : '',
		projectId: typeof r.projectId === 'string' ? r.projectId : '',
	};
	return modelSelectionIssue(selection) ? null : selection;
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
