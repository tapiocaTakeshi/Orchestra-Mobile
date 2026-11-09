/**
 * クラウドの会話で、ワークフローの並列ノードの分岐をレーンにまとめる。
 */

import { chatBlocks, CloudSessionEvent } from '../divisionCloud';
import { groupParallelBranches, ParallelChatItem } from '../cloudParallel';

let seq = 0;
const ev = (type: CloudSessionEvent['type'], data: Record<string, unknown>, at = seq): CloudSessionEvent =>
	({ seq: ++seq, type, data, createdAt: new Date(Date.UTC(2026, 10, 9, 0, 0, at)).toISOString() } as CloudSessionEvent);

const plan = (tasks: object[]) => ev('plan', { tasks, leaderModel: 'L' });
const task = (index: number, status: string, extra: object = {}) => ev('task', { index, role: ['leader', 'searcher', 'designer', 'writer'][index], roleName: ['リーダー', '調査', 'デザイン', '仕様'][index], status, ...extra });

describe('groupParallelBranches', () => {
	beforeEach(() => { seq = 0; });

	const events = () => [
		ev('user', { text: 'アプリを作って' }),
		plan([
			{ index: 0, role: 'leader', roleName: 'リーダー', title: '計画' },
			{ index: 1, role: 'searcher', roleName: '調査', title: '市場を調べる', parallel: 'p1' },
			{ index: 2, role: 'designer', roleName: 'デザイン', title: '画面', parallel: 'p1' },
			{ index: 3, role: 'writer', roleName: '仕様', title: '仕様を書く' },
		]),
		task(0, 'start'), ev('assistant', { text: '計画です' }), task(0, 'done', { summary: 'ok' }),
		task(1, 'start'), ev('tool', { name: 'web_search' }), ev('assistant', { text: '調査の結論' }), task(1, 'done', { summary: 'ok' }),
		task(2, 'start'), ev('assistant', { text: 'デザイン中' }),
	];

	it('puts the branches of one parallel node into one card, each in its lane', () => {
		const evs = events();
		const blocks = groupParallelBranches(chatBlocks(evs), evs, true);
		const agent = blocks[1] as Extract<typeof blocks[number], { kind: 'agent' }>;
		const kinds = agent.items.map(i => (i.kind === 'event' ? i.event.type : i.kind));
		// plan, leader's task (start, reply, done), then one parallel card
		expect(kinds).toEqual(['plan', 'task', 'assistant', 'task', 'parallel']);
		const card = agent.items[4] as ParallelChatItem;
		expect(card.lanes.map(l => [l.key, l.step, l.role, l.title, l.status])).toEqual([
			[1, 2, '調査', '市場を調べる', 'done'],
			[2, 3, 'デザイン', '画面', 'running'],
		]);
		expect(card.lanes[0].items.map(i => (i.kind === 'event' ? i.event.type : i.kind))).toEqual(['task', 'tools', 'assistant', 'task']);
		expect(card.lanes[0].text).toBe('調査の結論');
		expect(card.lanes[0].endedAt! - card.lanes[0].startedAt!).toBe(3000);
		expect(card.lanes[1].text).toBe('デザイン中');
	});

	it('a branch that has not started waits; the next step after the group is outside the card', () => {
		const evs = [...events(), task(2, 'done'), task(3, 'start'), ev('assistant', { text: '仕様' })];
		const blocks = groupParallelBranches(chatBlocks(evs), evs, true);
		const agent = blocks[1] as Extract<typeof blocks[number], { kind: 'agent' }>;
		const kinds = agent.items.map(i => (i.kind === 'event' ? i.event.type : i.kind));
		expect(kinds.slice(-3)).toEqual(['parallel', 'task', 'assistant']);

		const early = events().slice(0, 5); // before the first branch starts
		const none = groupParallelBranches(chatBlocks(early), early, true);
		expect((none[1] as { items: { kind: string }[] }).items.some(i => i.kind === 'parallel')).toBe(false);
	});

	it('when the session has stopped, a branch still marked running is shown as stopped', () => {
		const evs = events();
		const blocks = groupParallelBranches(chatBlocks(evs), evs, false);
		const card = (blocks[1] as { items: unknown[] }).items[4] as ParallelChatItem;
		expect(card.lanes[1].status).toBe('stopped');
	});

	it('without parallel branches nothing changes', () => {
		const evs = [ev('user', { text: 'x' }), plan([{ index: 0, role: 'coder', title: 'a' }, { index: 1, role: 'reviewer', title: 'b' }]), task(0, 'start'), task(0, 'done')];
		expect(groupParallelBranches(chatBlocks(evs), evs, true)).toEqual(chatBlocks(evs));
	});
});

describe('groupParallelBranches with branches running at the same time', () => {
	beforeEach(() => { seq = 0; });

	it('sorts interleaved events into their branch by taskIndex, tools too', () => {
		const evs = [
			ev('user', { text: 'x' }),
			plan([
				{ index: 1, role: 'searcher', roleName: '調査', title: 'A', parallel: 'p1' },
				{ index: 2, role: 'designer', roleName: 'デザイン', title: 'B', parallel: 'p1' },
			]),
			task(1, 'start', { parallel: 'p1' }), task(2, 'start', { parallel: 'p1' }),
			ev('assistant', { text: '調べます', taskIndex: 1 }),
			ev('tool', { name: 'web_search', taskIndex: 1 }),
			ev('tool', { name: 'write_file', taskIndex: 2 }),
			ev('tool', { name: 'web_fetch', taskIndex: 1 }),
			ev('assistant', { text: '描きました', taskIndex: 2 }),
			task(2, 'done'),
			ev('assistant', { text: '調べました', taskIndex: 1 }),
			task(1, 'done'),
		];
		const blocks = groupParallelBranches(chatBlocks(evs), evs, true);
		const items = (blocks[1] as { items: { kind: string }[] }).items;
		expect(items.map(i => i.kind)).toEqual(['event', 'parallel']);
		const [a, b] = (items[1] as ParallelChatItem).lanes;
		const shape = (l: typeof a) => l.items.map(i => (i.kind === 'tools' ? `tools:${i.events.map(e => e.data.name).join('+')}` : `${i.event.type}`));
		expect(shape(a)).toEqual(['task', 'assistant', 'tools:web_search+web_fetch', 'assistant', 'task']);
		expect(shape(b)).toEqual(['task', 'tools:write_file', 'assistant', 'task']);
		expect(a.text).toBe('調べます\n\n調べました');
		expect(b.text).toBe('描きました');
		expect([a.status, b.status]).toEqual(['done', 'done']);
	});
});
