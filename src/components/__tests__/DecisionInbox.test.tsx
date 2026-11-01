/**
 * DecisionInbox (判断の受信箱) の描画・操作テスト。
 *
 * ホームの主操作 (入力と実行) を押し下げないよう、既定は 1 行のサマリーに畳む。
 * その状態でも「判断が必要」と件数、先頭の題名で気づけること、押すとカードが展開し、
 * 「畳む」で戻せること、却下 (対応不要) で項目が消えること、項目なし・通信エラーでは何も描かないことを確認する。
 * 通信はモック (listDecisions / dismissDecision) で、描画は react-test-renderer。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import type { Decision } from '../../lib/divisionDecisions';

const mockList = jest.fn();
const mockDismiss = jest.fn();
jest.mock('../../lib/divisionDecisions', () => {
	const actual = jest.requireActual('../../lib/divisionDecisions');
	return {
		...actual,
		listDecisions: (...a: unknown[]) => mockList(...a),
		dismissDecision: (...a: unknown[]) => mockDismiss(...a),
	};
});

jest.mock('../ui', () => {
	const actual = jest.requireActual('../ui');
	return { ...actual, useToast: () => ({ show: jest.fn() }) };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DecisionInbox } = require('../DecisionInbox') as typeof import('../DecisionInbox');

const decision = (id: string, title: string, over: Partial<Decision> = {}): Decision => ({
	id,
	source: 'session',
	kind: 'approval',
	status: 'open',
	priority: 'high',
	title,
	summary: `${title}の概要`,
	recommendation: null,
	evidence: [],
	risks: [],
	options: [
		{ id: 'open_session', label: 'セッションを開く', primary: true },
		{ id: 'dismiss', label: '対応不要' },
	],
	investigation: null,
	sessionId: `s-${id}`,
	createdAt: '2025-01-01T00:00:00Z',
	...over,
});

const findTextNode = (root: ReactTestInstance, text: string): ReactTestInstance | undefined =>
	root.findAll(
		n => n.children.length > 0 && n.children.every(c => typeof c === 'string') && n.children.join('') === text,
		{ deep: true },
	)[0];

const findButtonsByLabel = (root: ReactTestInstance, label: string): ReactTestInstance[] =>
	root.findAll(node => {
		if (node.props?.accessibilityLabel !== label || typeof node.props?.onPress !== 'function') return false;
		const parent = node.parent;
		return !(parent?.props?.accessibilityLabel === label && typeof parent.props?.onPress === 'function');
	});

const findRowByTitle = (root: ReactTestInstance, title: string): ReactTestInstance => {
	const t = findTextNode(root, title);
	if (!t) throw new Error(`テキスト「${title}」が見つかりません。`);
	let cur: ReactTestInstance | null = t.parent;
	while (cur) {
		if (typeof cur.props?.onPress === 'function') return cur;
		cur = cur.parent;
	}
	throw new Error(`「${title}」を含む押せる行が見つかりません。`);
};

const press = async (node: ReactTestInstance) => {
	await act(async () => {
		const props = node.props as { onPress?: (e: unknown) => void; onClick?: (e: unknown) => void };
		(props.onPress ?? props.onClick)?.({ stopPropagation: () => undefined, preventDefault: () => undefined });
	});
};

let renderer: ReactTestRenderer | null = null;
const onOpenSession = jest.fn();

const render = async (): Promise<ReactTestRenderer> => {
	await act(async () => {
		renderer = create(
			React.createElement(DecisionInbox, {
				auth: { email: 'me@example.com', accessToken: 't', refreshToken: 'r' } as never,
				refreshKey: 'k',
				onOpenSession,
				onSessionStarted: jest.fn(),
			}),
		);
	});
	return renderer!;
};

afterEach(async () => {
	if (renderer) {
		await act(async () => { renderer!.unmount(); });
		renderer = null;
	}
	jest.clearAllMocks();
});

const summaryLabel = (n: number, title: string) => `判断が必要な項目 ${n} 件。${title}。押して表示する`;

describe('DecisionInbox の畳み・展開', () => {
	it('既定は 1 行のサマリー: 件数と先頭の題名が見え、カード (概要・ボタン) は出ない', async () => {
		mockList.mockResolvedValue({ headline: '2 件', decisions: [decision('a', '承認待ちの変更'), decision('b', '失敗したセッション')] });
		const r = await render();
		expect(findTextNode(r.root, '判断が必要')).toBeTruthy();
		expect(findTextNode(r.root, '2')).toBeTruthy();
		expect(findTextNode(r.root, '承認待ちの変更')).toBeTruthy();
		expect(findTextNode(r.root, '承認待ちの変更の概要')).toBeUndefined();
		expect(findTextNode(r.root, 'セッションを開く')).toBeUndefined();
		expect(findButtonsByLabel(r.root, summaryLabel(2, '承認待ちの変更'))).toHaveLength(1);
	});

	it('サマリーを押すとカードが展開し、「畳む」で元の 1 行に戻る', async () => {
		mockList.mockResolvedValue({ headline: '', decisions: [decision('a', '承認待ちの変更')] });
		const r = await render();
		await press(findButtonsByLabel(r.root, summaryLabel(1, '承認待ちの変更'))[0]);
		expect(findTextNode(r.root, '承認待ちの変更の概要')).toBeTruthy();
		expect(findTextNode(r.root, 'セッションを開く')).toBeTruthy();
		// 展開した状態の主ボタンは従来どおりセッションを開く
		await press(findRowByTitle(r.root, 'セッションを開く'));
		expect(onOpenSession).toHaveBeenCalledWith('s-a');

		await press(findButtonsByLabel(r.root, '判断が必要な項目を畳む')[0]);
		expect(findTextNode(r.root, '承認待ちの変更の概要')).toBeUndefined();
		expect(findButtonsByLabel(r.root, summaryLabel(1, '承認待ちの変更'))).toHaveLength(1);
	});

	it('展開中の「対応不要」で項目が消え、最後の 1 件なら受信箱ごと消える (取り消し手段は維持)', async () => {
		mockList.mockResolvedValue({ headline: '', decisions: [decision('a', '承認待ちの変更')] });
		mockDismiss.mockResolvedValue(undefined);
		const r = await render();
		await press(findButtonsByLabel(r.root, summaryLabel(1, '承認待ちの変更'))[0]);
		await press(findRowByTitle(r.root, '対応不要'));
		expect(mockDismiss).toHaveBeenCalledWith(expect.anything(), 'a');
		expect(findTextNode(r.root, '判断が必要')).toBeUndefined();
	});

	it('4 件以上は展開しても 3 件までで、「ほか N 件を表示」で全件になる', async () => {
		const items = ['a', 'b', 'c', 'd'].map(id => decision(id, `項目${id}`));
		mockList.mockResolvedValue({ headline: '', decisions: items });
		const r = await render();
		await press(findButtonsByLabel(r.root, summaryLabel(4, '項目a'))[0]);
		expect(findTextNode(r.root, '項目cの概要')).toBeTruthy();
		expect(findTextNode(r.root, '項目dの概要')).toBeUndefined();
		await press(findRowByTitle(r.root, 'ほか 1 件を表示'));
		expect(findTextNode(r.root, '項目dの概要')).toBeTruthy();
	});
});

describe('DecisionInbox を出さない場合 (ホームを邪魔しない)', () => {
	it('項目が 0 件なら何も描かない', async () => {
		mockList.mockResolvedValue({ headline: '', decisions: [] });
		const r = await render();
		expect(findTextNode(r.root, '判断が必要')).toBeUndefined();
	});

	it('通信エラーでは出さない (エラーは一覧側が知らせる)', async () => {
		mockList.mockRejectedValue(new Error('network'));
		const r = await render();
		expect(findTextNode(r.root, '判断が必要')).toBeUndefined();
	});
});
