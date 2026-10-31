/**
 * Division API の Decision Inbox (判断の受信箱)。
 *
 * セッションを横断して「人間の判断が要るもの」だけを 1 つの一覧にまとめる。
 *   - クラウドセッション由来 … 承認待ち / 変更の確認待ち (PR 前) / 失敗。サーバーがセッションの状態から毎回組み立てる
 *   - 検出された摩擦 (Friction Detector) … 監視しているリポジトリの CI 失敗・修正依頼。
 *     調査用のプロンプト (Context Packet) とリポジトリが付いていて、ワンタップで AI に調査させられる
 *
 *   GET  /api/decisions                 { headline, decisions }
 *   POST /api/decisions/:id/dismiss     対応不要として閉じる
 *   POST /api/decisions/:id/act         { action: 'investigate', sessionId } 調査用セッションを起動したことを記録 (対応中になる)
 *   POST /api/decisions/:id/resolve     対応済みにする
 *
 * PR の作成・承認は既存のクラウドセッションの画面で行う (外部への変更は必ず明示的な操作にする)。
 */

import { DivisionSession } from './divisionAuth';
import { CloudRepoFullName, DivisionCloudError, cloudErrorText, divisionApiRequest } from './divisionCloud';
import { colors } from '../theme';

// ---------------------------------------------------------------------------
// 型 (Division 側の DTO と同じ形)
// ---------------------------------------------------------------------------

export type DecisionKind = 'approval' | 'review_changes' | 'session_failed' | 'ci_failure' | 'changes_requested';
export type DecisionStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed';
export type DecisionPriority = 'low' | 'medium' | 'high';
export type DecisionOptionId = 'open_session' | 'create_pr' | 'investigate' | 'open_url' | 'dismiss';

export type DecisionOption = { id: DecisionOptionId; label: string; primary?: boolean; url?: string };
export type DecisionEvidence = { label: string; url?: string; detail?: string };
export type DecisionInvestigation = { title: string; prompt: string; repo: CloudRepoFullName };

export type Decision = {
	id: string;
	source: 'session' | 'signal';
	kind: DecisionKind;
	status: DecisionStatus;
	priority: DecisionPriority;
	title: string;
	summary: string;
	recommendation: string | null;
	evidence: DecisionEvidence[];
	risks: string[];
	options: DecisionOption[];
	investigation: DecisionInvestigation | null;
	sessionId: string | null;
	createdAt: string;
};

export type DecisionInbox = { headline: string; decisions: Decision[] };

// ---------------------------------------------------------------------------
// DTO の取り出し (欠けた値で画面が落ちないように)
// ---------------------------------------------------------------------------

const KINDS: DecisionKind[] = ['approval', 'review_changes', 'session_failed', 'ci_failure', 'changes_requested'];
const STATUSES: DecisionStatus[] = ['open', 'in_progress', 'resolved', 'dismissed'];
const PRIORITIES: DecisionPriority[] = ['low', 'medium', 'high'];
const OPTION_IDS: DecisionOptionId[] = ['open_session', 'create_pr', 'investigate', 'open_url', 'dismiss'];

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const isHttpsUrl = (value: unknown): value is string => typeof value === 'string' && /^https:\/\/\S+$/i.test(value);

const toOption = (raw: unknown): DecisionOption | null => {
	const o = (raw ?? {}) as Record<string, unknown>;
	if (!OPTION_IDS.includes(o.id as DecisionOptionId)) return null;
	// 開く URL は https だけ (サーバーが返したものでも、それ以外は押せないようにする)
	if (o.id === 'open_url' && !isHttpsUrl(o.url)) return null;
	return {
		id: o.id as DecisionOptionId,
		label: str(o.label) || String(o.id),
		...(o.primary === true ? { primary: true } : {}),
		...(isHttpsUrl(o.url) ? { url: o.url } : {}),
	};
};

const toInvestigation = (raw: unknown): DecisionInvestigation | null => {
	const i = (raw ?? {}) as Record<string, unknown>;
	const repo = (i.repo ?? {}) as Record<string, unknown>;
	if (!str(i.prompt).trim() || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(str(repo.fullName))) return null;
	return {
		title: str(i.title),
		prompt: str(i.prompt),
		repo: { fullName: str(repo.fullName), ...(str(repo.branch) ? { branch: str(repo.branch) } : {}) },
	};
};

export const toDecision = (raw: unknown): Decision => {
	const d = (raw ?? {}) as Record<string, unknown>;
	const evidence = Array.isArray(d.evidence) ? d.evidence : [];
	return {
		id: str(d.id),
		source: d.source === 'signal' ? 'signal' : 'session',
		kind: KINDS.includes(d.kind as DecisionKind) ? (d.kind as DecisionKind) : 'review_changes',
		status: STATUSES.includes(d.status as DecisionStatus) ? (d.status as DecisionStatus) : 'open',
		priority: PRIORITIES.includes(d.priority as DecisionPriority) ? (d.priority as DecisionPriority) : 'medium',
		title: str(d.title),
		summary: str(d.summary),
		recommendation: str(d.recommendation) || null,
		evidence: evidence
			.map(e => (e ?? {}) as Record<string, unknown>)
			.filter(e => !!str(e.label))
			.map(e => ({
				label: str(e.label),
				...(isHttpsUrl(e.url) ? { url: e.url } : {}),
				...(str(e.detail) ? { detail: str(e.detail) } : {}),
			})),
		risks: Array.isArray(d.risks) ? d.risks.filter((r): r is string => typeof r === 'string' && !!r) : [],
		options: (Array.isArray(d.options) ? d.options : []).map(toOption).filter((o): o is DecisionOption => !!o),
		investigation: toInvestigation(d.investigation),
		sessionId: str(d.sessionId) || null,
		createdAt: str(d.createdAt),
	};
};

// ---------------------------------------------------------------------------
// 表示用の純粋関数
// ---------------------------------------------------------------------------

export const DECISION_KIND_LABELS: Record<DecisionKind, string> = {
	approval: '承認',
	review_changes: '変更の確認',
	session_failed: '停止',
	ci_failure: 'CI 失敗',
	changes_requested: '修正依頼',
};

export const decisionColor = (d: Pick<Decision, 'status' | 'priority'>): string => {
	if (d.status === 'in_progress') return colors.running;
	if (d.priority === 'high') return colors.danger;
	if (d.priority === 'medium') return colors.warning;
	return colors.fgFaint;
};

/** カードの主ボタン。対応中のものは押させない (AI が動いているので結果を待つ)。 */
export const primaryOption = (d: Decision): DecisionOption | null => {
	if (d.status !== 'open') return null;
	const usable = d.options.filter(o => o.id !== 'investigate' || !!d.investigation);
	return usable.find(o => o.primary) ?? usable.find(o => o.id !== 'dismiss') ?? null;
};

export const secondaryOptions = (d: Decision): DecisionOption[] => {
	const primary = primaryOption(d);
	if (d.status !== 'open') return [];
	return d.options.filter(o => o !== primary && o.id !== primary?.id && (o.id !== 'investigate' || !!d.investigation));
};

/** 受信箱のバッジの数 (まだ誰も手を付けていないもの)。 */
export const openCount = (decisions: Decision[]): number => decisions.filter(d => d.status === 'open').length;

// ---------------------------------------------------------------------------
// エンドポイント
// ---------------------------------------------------------------------------

const base = '/api/decisions';
const idPath = (id: string): string => `${base}/${encodeURIComponent(id)}`;

export const listDecisions = async (session: DivisionSession): Promise<DecisionInbox> => {
	const data = await divisionApiRequest<{ headline?: unknown; decisions?: unknown[] }>(session, base);
	return {
		headline: str(data.headline),
		decisions: (data.decisions ?? []).map(toDecision).filter(d => !!d.id && !!d.title),
	};
};

export const dismissDecision = async (session: DivisionSession, id: string, note?: string): Promise<void> => {
	await divisionApiRequest<{ ok?: boolean }>(session, `${idPath(id)}/dismiss`, { method: 'POST', body: note?.trim() ? { note: note.trim() } : {} });
};

export const resolveDecision = async (session: DivisionSession, id: string, note?: string): Promise<void> => {
	await divisionApiRequest<{ ok?: boolean }>(session, `${idPath(id)}/resolve`, { method: 'POST', body: note?.trim() ? { note: note.trim() } : {} });
};

/** 調査用のクラウドセッションを起動したあとに呼ぶ。項目は「AI が対応中」になる。 */
export const markInvestigating = async (session: DivisionSession, id: string, sessionId: string): Promise<Decision> => {
	const data = await divisionApiRequest<{ decision?: unknown }>(session, `${idPath(id)}/act`, {
		method: 'POST',
		body: { action: 'investigate', sessionId },
	});
	return toDecision(data.decision);
};

/** サーバーが Decision Inbox に未対応 (404) なら true。そのときは受信箱を出さない。 */
export const isInboxUnsupported = (e: unknown): boolean =>
	e instanceof DivisionCloudError && e.status === 404 && /HTTP 404/.test(e.message);

export const decisionErrorText = (e: unknown): string => cloudErrorText(e);
