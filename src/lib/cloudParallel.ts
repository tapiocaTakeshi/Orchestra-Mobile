/**
 * クラウドエージェントの会話で、ワークフローの「並列」ノードの分岐をレーンにまとめる (UI 非依存)。
 *
 * plan イベントのタスクには、並列ノードの分岐なら `parallel` (ノードの id) が付く。同じ id が続くタスクが
 * 1 つの並列グループで、会話ではそれらの task / assistant / tool などをグループのカード 1 枚にまとめ、
 * 分岐ごとのレーンに振り分ける (PC の ```division-parallel ブロックと同じ見た目: components/ParallelLog.tsx)。
 * サーバーはサンドボックスを共有するので分岐を順に実行するが、どの分岐がどこまで進んだかを並べて見られる。
 */

import { ChatBlock, ChatItem, CloudPlanTask, CloudSessionEvent, toCloudPlan, toCloudTaskEvent } from './divisionCloud';
import { ParallelLane, ParallelLaneStatus } from './parallelLog';

export type CloudParallelLane = ParallelLane & {
	/** このレーン (分岐) の会話の中身 */
	items: ChatItem[];
	model: string;
};

export type ParallelChatItem = { kind: 'parallel'; key: number; lanes: CloudParallelLane[] };

export type CloudChatItem = ChatItem | ParallelChatItem;

export type CloudChatBlock =
	| Extract<ChatBlock, { kind: 'user' }>
	| { kind: 'agent'; key: number; items: CloudChatItem[] };

/** 並列グループを閉じるイベント (計画・完了・目標のレビューなど、分岐の外のもの) */
const OUTSIDE_TYPES = new Set(['plan', 'done', 'goal', 'review', 'workflow', 'workflow_review', 'pull_request']);

const time = (iso: string): number | undefined => {
	const t = Date.parse(iso);
	return Number.isFinite(t) ? t : undefined;
};

type Group = { id: string; members: CloudPlanTask[]; positions: Map<number, number> };

/**
 * chatBlocks の結果の、並列ノードの分岐をレーンのカードにまとめる。
 * active はセッションがまだ動いているか (止まっていれば、走ったまま終わっていない分岐は「停止」)。
 */
export const groupParallelBranches = (blocks: ChatBlock[], events: CloudSessionEvent[], active: boolean): CloudChatBlock[] => {
	// task イベントの seq → (計画, タスク番号)。計画ごとの並列グループと、分岐の状態。
	const taskOf = new Map<number, { planSeq: number; index: number }>();
	const groupOf = new Map<string, Group>();
	const state = new Map<string, { status: ParallelLaneStatus; startedAt?: number; endedAt?: number }>();
	let planSeq: number | null = null;
	const k = (seq: number, index: number) => `${seq}:${index}`;

	for (const event of events) {
		if (event.type === 'plan') {
			planSeq = event.seq;
			const tasks = toCloudPlan(event.data).tasks;
			for (let i = 0; i < tasks.length;) {
				const id = tasks[i].parallel;
				let j = i + 1;
				while (id && j < tasks.length && tasks[j].parallel === id) j++;
				if (id && j - i > 1) {
					const members = tasks.slice(i, j);
					const group: Group = { id: k(event.seq, tasks[i].index), members, positions: new Map(members.map((t, n) => [t.index, i + n + 1])) };
					for (const t of members) groupOf.set(k(event.seq, t.index), group);
				}
				i = j;
			}
		} else if (event.type === 'task' && planSeq !== null) {
			const task = toCloudTaskEvent(event.data);
			if (!task) continue;
			const key = k(planSeq, task.index);
			taskOf.set(event.seq, { planSeq, index: task.index });
			const prev = state.get(key);
			const at = time(event.createdAt);
			if (task.status === 'start') {
				// 差し戻しでやり直すときは、最初に始まった時刻から数える
				state.set(key, { status: active ? 'running' : 'stopped', startedAt: prev?.startedAt ?? at });
			} else {
				state.set(key, { status: task.status === 'done' ? 'done' : 'error', startedAt: prev?.startedAt ?? at, endedAt: at });
			}
		}
	}

	const makeLanes = (group: Group, planOf: number): CloudParallelLane[] => group.members.map(t => {
		const s = state.get(k(planOf, t.index));
		return {
			key: t.index,
			step: group.positions.get(t.index) ?? 0,
			role: t.roleName,
			title: t.title,
			model: t.model,
			status: s?.status ?? 'waiting',
			...(s?.startedAt !== undefined ? { startedAt: s.startedAt } : {}),
			...(s?.endedAt !== undefined ? { endedAt: s.endedAt } : {}),
			text: '',
			items: [],
		};
	});

	return blocks.map((block): CloudChatBlock => {
		if (block.kind === 'user') return block;
		const items: CloudChatItem[] = [];
		let open: { group: Group; item: ParallelChatItem } | null = null;
		let lane: CloudParallelLane | null = null;
		for (const item of block.items) {
			if (item.kind === 'event' && item.event.type === 'task') {
				const info = taskOf.get(item.event.seq);
				const group = info ? groupOf.get(k(info.planSeq, info.index)) : undefined;
				if (info && group) {
					if (!open || open.group !== group) {
						open = { group, item: { kind: 'parallel', key: item.event.seq, lanes: makeLanes(group, info.planSeq) } };
						items.push(open.item);
					}
					lane = open.item.lanes.find(l => l.key === info.index) ?? null;
					lane?.items.push(item);
					continue;
				}
				open = null;
				lane = null;
				items.push(item);
				continue;
			}
			if (item.kind === 'event' && OUTSIDE_TYPES.has(item.event.type)) {
				open = null;
				lane = null;
			}
			if (lane) lane.items.push(item);
			else items.push(item);
		}
		// レーンの下見の 1 行: その分岐の返答 (なければ最後のツール名)
		for (const it of items) {
			if (it.kind !== 'parallel') continue;
			for (const l of it.lanes) {
				const replies = l.items
					.filter((x): x is Extract<ChatItem, { kind: 'event' }> => x.kind === 'event' && x.event.type === 'assistant')
					.map(x => (typeof x.event.data.text === 'string' ? x.event.data.text : ''))
					.filter(t => t.trim());
				const lastTools = [...l.items].reverse().find((x): x is Extract<ChatItem, { kind: 'tools' }> => x.kind === 'tools');
				const toolName = lastTools ? String(lastTools.events[lastTools.events.length - 1].data.name ?? '') : '';
				l.text = replies.length ? replies.join('\n\n') : toolName ? `🔧 ${toolName}` : '';
			}
		}
		return { kind: 'agent', key: block.key, items };
	});
};
