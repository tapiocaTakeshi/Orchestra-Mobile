/**
 * Division API の GitHub アカウント連携。
 *
 * クラウドエージェントを始めるときに、URL を打たずに自分のリポジトリ (非公開も含む) を一覧から選べるようにする。
 * トークンは Division のサーバーが持ち、端末には保存しない。clone もサーバーがそのトークンで行う。
 *
 *   GET  /api/github/status       連携の状態 ({ configured, connected, login, avatarUrl, scopes })
 *   POST /api/github/connect      連携を始める。返ってきた URL をブラウザで開き、GitHub で許可してもらう
 *   POST /api/github/disconnect   連携を解除する
 *   GET  /api/github/repos        ?q=<名前の絞り込み>&page=<1〜> 最近 push した順に 50 件ずつ
 *   GET  /api/github/branches     ?repo=<owner/name> ブランチ一覧 (既定のブランチが先頭)
 *
 * 連携はブラウザで完了するので、端末は /status を 2 秒ごと (最大 5 分) と、アプリが前面に戻ったときに
 * 確かめて connected になるのを待つ (watchGitHubConnection)。
 *
 * 失敗は divisionCloud.ts と同じ DivisionCloudError。GitHub 特有の理由は code に入る
 * (409 github_not_connected = 未連携 / トークン失効、503 github_not_configured = サーバーに OAuth アプリが無い)。
 */

import { DivisionSession } from './divisionAuth';
import {
	DivisionCloudError,
	GITHUB_NOT_CONFIGURED,
	GITHUB_NOT_CONNECTED,
	cloudErrorText,
	divisionApiRequest,
	validateRepoFullName,
} from './divisionCloud';

// ---------------------------------------------------------------------------
// 型 (Division 側の DTO と同じ形)
// ---------------------------------------------------------------------------

export type GitHubStatus = {
	/** false = サーバーに GitHub の OAuth アプリが設定されていない (連携できない) */
	configured: boolean;
	connected: boolean;
	login?: string;
	avatarUrl?: string;
	scopes?: string;
};

export type GitHubRepo = {
	/** "owner/name" */
	fullName: string;
	name: string;
	owner: string;
	private: boolean;
	defaultBranch: string;
	description: string | null;
	/** ISO */
	pushedAt: string | null;
	htmlUrl: string;
};

export type GitHubRepoPage = { repos: GitHubRepo[]; hasMore: boolean };

export type GitHubBranches = { branches: string[]; defaultBranch: string };

/** サーバーが連携に対応していない / OAuth アプリが無いときの状態。 */
export const GITHUB_UNAVAILABLE: GitHubStatus = { configured: false, connected: false };

// ---------------------------------------------------------------------------
// DTO の取り出し (欠けた値で画面が落ちないように)
// ---------------------------------------------------------------------------

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const strOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export const toGitHubStatus = (raw: unknown): GitHubStatus => {
	const s = (raw ?? {}) as Record<string, unknown>;
	const configured = s.configured === true;
	return {
		configured,
		connected: configured && s.connected === true,
		...(typeof s.login === 'string' && s.login ? { login: s.login } : {}),
		...(typeof s.avatarUrl === 'string' && s.avatarUrl ? { avatarUrl: s.avatarUrl } : {}),
		...(typeof s.scopes === 'string' ? { scopes: s.scopes } : {}),
	};
};

export const toGitHubRepo = (raw: unknown): GitHubRepo => {
	const r = (raw ?? {}) as Record<string, unknown>;
	const fullName = str(r.fullName);
	const [ownerPart = '', namePart = ''] = fullName.split('/');
	return {
		fullName,
		name: str(r.name) || namePart,
		owner: str(r.owner) || ownerPart,
		private: r.private === true,
		defaultBranch: str(r.defaultBranch),
		description: strOrNull(r.description),
		pushedAt: strOrNull(r.pushedAt),
		htmlUrl: str(r.htmlUrl) || (fullName ? `https://github.com/${fullName}` : ''),
	};
};

// ---------------------------------------------------------------------------
// エンドポイント
// ---------------------------------------------------------------------------

/**
 * 連携の状態。サーバーが GitHub 連携に未対応 (404) か OAuth アプリが未設定 (503 github_not_configured) なら
 * 例外にせず { configured: false } を返す (画面は URL の直接入力だけにする)。
 */
export const getGitHubStatus = async (session: DivisionSession): Promise<GitHubStatus> => {
	try {
		return toGitHubStatus(await divisionApiRequest<unknown>(session, '/api/github/status'));
	} catch (e) {
		if (e instanceof DivisionCloudError && (e.status === 404 || e.code === GITHUB_NOT_CONFIGURED)) return GITHUB_UNAVAILABLE;
		throw e;
	}
};

/** 連携を始める。返す URL をシステムのブラウザで開く (GitHub の認可ページ)。 */
export const startGitHubConnect = async (session: DivisionSession): Promise<string> => {
	const data = await divisionApiRequest<{ url?: unknown }>(session, '/api/github/connect', { method: 'POST', body: {} });
	const url = str(data.url);
	if (!/^https:\/\//i.test(url)) throw new DivisionCloudError(502, 'GitHub の連携ページの URL を受け取れませんでした。');
	return url;
};

export const disconnectGitHub = async (session: DivisionSession): Promise<void> => {
	await divisionApiRequest<{ ok?: boolean }>(session, '/api/github/disconnect', { method: 'POST', body: {} });
};

/** リポジトリ一覧のクエリ文字列。q は空なら付けない。 */
export const repoListQuery = ({ q, page }: { q?: string; page?: number } = {}): string => {
	const params: string[] = [];
	const filter = q?.trim();
	if (filter) params.push(`q=${encodeURIComponent(filter)}`);
	params.push(`page=${Math.max(1, Math.floor(page ?? 1) || 1)}`);
	return `?${params.join('&')}`;
};

/** 自分のリポジトリ (owner / collaborator / organization) を最近 push した順に 50 件ずつ。q で名前を絞る。 */
export const listGitHubRepos = async (
	session: DivisionSession,
	options: { q?: string; page?: number } = {},
): Promise<GitHubRepoPage> => {
	const data = await divisionApiRequest<{ repos?: unknown[]; hasMore?: unknown }>(session, `/api/github/repos${repoListQuery(options)}`);
	return {
		repos: (data.repos ?? []).map(toGitHubRepo).filter(r => !!r.fullName),
		hasMore: data.hasMore === true,
	};
};

/**
 * 「もっと見る」で取った次のページを足す。読んでいるあいだに push されて順番がずれると
 * 同じリポジトリが 2 ページに出ることがあるので、fullName で重複を除く (先に出た方を残す)。
 */
export const mergeRepoPages = (current: GitHubRepo[], next: GitHubRepo[]): GitHubRepo[] => {
	const seen = new Set(current.map(r => r.fullName));
	return [...current, ...next.filter(r => !seen.has(r.fullName) && (seen.add(r.fullName), true))];
};

/** ブランチ一覧 (既定のブランチが先頭)。 */
export const listGitHubBranches = async (session: DivisionSession, fullName: string): Promise<GitHubBranches> => {
	const issue = validateRepoFullName(fullName);
	if (issue) throw new DivisionCloudError(400, issue);
	const data = await divisionApiRequest<{ branches?: unknown[]; defaultBranch?: unknown }>(
		session, `/api/github/branches?repo=${encodeURIComponent(fullName.trim())}`,
	);
	const branches = (data.branches ?? []).filter((b): b is string => typeof b === 'string' && !!b);
	const defaultBranch = str(data.defaultBranch) || branches[0] || '';
	// 既定のブランチを必ず先頭に置く (サーバーがそう返す前提だが、念のため)
	const ordered = defaultBranch ? [defaultBranch, ...branches.filter(b => b !== defaultBranch)] : branches;
	return { branches: ordered, defaultBranch };
};

// ---------------------------------------------------------------------------
// エラー
// ---------------------------------------------------------------------------

/** 未連携 / トークン失効 (409 github_not_connected)。状態を connected=false に戻す合図。 */
export const isGitHubNotConnected = (e: unknown): boolean =>
	e instanceof DivisionCloudError && e.code === GITHUB_NOT_CONNECTED;

/** GitHub の API を呼んだときのエラー文言。404 はセッションではなくサーバーの未対応として扱う。 */
export const githubErrorText = (e: unknown): string => {
	if (e instanceof DivisionCloudError && !e.code && e.status === 404) {
		return 'この Division サーバーは GitHub 連携に未対応です。リポジトリの URL を直接入力してください。';
	}
	if (e instanceof DivisionCloudError && !e.code && e.status === 409) return e.message;
	return cloudErrorText(e);
};

// ---------------------------------------------------------------------------
// 連携の完了待ち
// ---------------------------------------------------------------------------

export const GITHUB_CONNECT_POLL = {
	intervalMs: 2_000,
	timeoutMs: 5 * 60_000,
} as const;

export type GitHubConnectOutcome =
	| { kind: 'connected'; status: GitHubStatus }
	| { kind: 'timeout' }
	| { kind: 'cancelled' };

export type GitHubConnectWatcher = {
	/** 連携できた / 時間切れ / キャンセルのどれかで解決する (reject はしない) */
	result: Promise<GitHubConnectOutcome>;
	/** すぐ確かめる (アプリが前面に戻ったとき)。確認中なら何もしない */
	checkNow: () => void;
	cancel: () => void;
};

/**
 * ブラウザで連携してもらっているあいだ、check (= getGitHubStatus) を intervalMs ごとに呼んで
 * connected になるのを待つ。timeoutMs を過ぎたら timeout。確認の失敗 (通信エラーなど) は無視して続ける。
 * 最初の確認は intervalMs 後 (開いた直後はまだ許可されていないため)。
 */
export const watchGitHubConnection = (
	check: () => Promise<GitHubStatus>,
	options: { intervalMs?: number; timeoutMs?: number; now?: () => number } = {},
): GitHubConnectWatcher => {
	const intervalMs = options.intervalMs ?? GITHUB_CONNECT_POLL.intervalMs;
	const timeoutMs = options.timeoutMs ?? GITHUB_CONNECT_POLL.timeoutMs;
	const now = options.now ?? Date.now;
	const deadline = now() + timeoutMs;

	let done = false;
	let inFlight = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let resolve: (outcome: GitHubConnectOutcome) => void = () => {};
	const result = new Promise<GitHubConnectOutcome>(r => { resolve = r; });

	const finish = (outcome: GitHubConnectOutcome) => {
		if (done) return;
		done = true;
		if (timer) clearTimeout(timer);
		timer = null;
		resolve(outcome);
	};

	const schedule = () => {
		if (done) return;
		if (timer) clearTimeout(timer);
		const wait = Math.min(intervalMs, Math.max(0, deadline - now()));
		timer = setTimeout(() => { timer = null; void tick(); }, wait);
	};

	const tick = async () => {
		if (done || inFlight) return;
		inFlight = true;
		try {
			const status = await check();
			if (!done && status.connected) {
				finish({ kind: 'connected', status });
				return;
			}
		} catch {
			// 一時的な失敗は無視して次の確認を待つ
		} finally {
			inFlight = false;
		}
		if (done) return;
		if (now() >= deadline) finish({ kind: 'timeout' });
		else schedule();
	};

	schedule();
	return {
		result,
		checkNow: () => { if (!done && !inFlight) { if (timer) clearTimeout(timer); timer = null; void tick(); } },
		cancel: () => finish({ kind: 'cancelled' }),
	};
};
