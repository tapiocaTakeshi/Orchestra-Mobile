/**
 * ワークフローの「並列」ノードのチャットログ (UI 非依存)。
 *
 * 並列の分岐は同時に動くので、1 本の文章には並べられない。PC (Orchestra) は実行中のメッセージに
 *
 *   ```division-parallel
 *   {"v":1,"lanes":[{ "key", "step", "role", "title", "status", "startedAt", "endedAt", "text" }]}
 *   ```
 *
 * のブロックを置き、分岐が書くたびに作り直す。電話はこれを分岐ごとのレーン (状態と経過時間つき) として描く。
 * JSON は 1 行なので、分岐の中の ``` でブロックが閉じることはない。
 * 形は Orchestra の src/vs/workbench/contrib/void/common/parallelLog.ts と同じ。
 */

export const PARALLEL_LOG_LANG = 'division-parallel';

export type ParallelLaneStatus = 'waiting' | 'running' | 'done' | 'error' | 'stopped';

export type ParallelLane = {
	key: number;
	step: number;
	role: string;
	title: string;
	status: ParallelLaneStatus;
	startedAt?: number;
	endedAt?: number;
	/** 分岐自身のログ (Markdown) */
	text: string;
};

export type ParallelLog = { v: 1; lanes: ParallelLane[] };

const STATUSES: readonly ParallelLaneStatus[] = ['waiting', 'running', 'done', 'error', 'stopped'];

/** ブロックの中身をレーンに戻す。並列のログでなければ null。 */
export const decodeParallelLog = (body: string): ParallelLog | null => {
	let data: unknown;
	try { data = JSON.parse(body.trim()); } catch { return null; }
	if (!data || typeof data !== 'object' || !Array.isArray((data as { lanes?: unknown }).lanes)) return null;
	const lanes: ParallelLane[] = [];
	for (const l of (data as { lanes: unknown[] }).lanes) {
		if (!l || typeof l !== 'object') continue;
		const o = l as Record<string, unknown>;
		const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : undefined);
		lanes.push({
			key: num(o.key) ?? lanes.length,
			step: num(o.step) ?? 0,
			role: typeof o.role === 'string' ? o.role : '',
			title: typeof o.title === 'string' ? o.title : '',
			status: STATUSES.includes(o.status as ParallelLaneStatus) ? (o.status as ParallelLaneStatus) : 'waiting',
			startedAt: num(o.startedAt),
			endedAt: num(o.endedAt),
			text: typeof o.text === 'string' ? o.text : '',
		});
	}
	return lanes.length ? { v: 1, lanes } : null;
};

export const isParallelLaneActive = (s: ParallelLaneStatus): boolean => s === 'waiting' || s === 'running';

export const parallelLogCounts = (log: ParallelLog) => ({
	total: log.lanes.length,
	done: log.lanes.filter(l => l.status === 'done').length,
	error: log.lanes.filter(l => l.status === 'error').length,
	active: log.lanes.filter(l => isParallelLaneActive(l.status)).length,
});

/** "8s" / "1m 05s" / "1h 02m" */
export const formatLaneElapsed = (ms: number): string => {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

/** レーンが動いた時間 (動いている間は今まで)。始まる前は undefined。 */
export const laneElapsedMs = (lane: ParallelLane, now: number): number | undefined =>
	lane.startedAt === undefined ? undefined : (lane.endedAt ?? (isParallelLaneActive(lane.status) ? now : lane.startedAt)) - lane.startedAt;

/** レーンのログの最後の行 (記号を外した 1 行の下見) */
export const laneLastLine = (lane: ParallelLane, max = 60): string => {
	const lines = lane.text.split('\n').map(s => s.replace(/[#>*_`|]/g, '').trim()).filter(Boolean);
	const last = lines[lines.length - 1] || '';
	return last.length > max ? `${last.slice(0, max - 1)}…` : last;
};

/** 既定で開くレーン: 動いている最初の分岐 (なければ最初の分岐) */
export const defaultLaneKey = (log: ParallelLog): number =>
	(log.lanes.find(l => l.status === 'running') ?? log.lanes[0]).key;
