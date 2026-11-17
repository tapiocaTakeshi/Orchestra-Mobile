/**
 * コストのタブの「作成」(JevProjectCreator) の回帰テスト。
 * スライダーで決めた値とプロンプトが Jev に送られ、結果が出て、ソーシャルに共有できることを確かめる。
 * ネットワークを伴う createProjectWithJev / publishAssignmentPost はモックにする。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockCreate = jest.fn();
const mockPublish = jest.fn();

jest.mock('../../lib/divisionRouting', () => ({
	...jest.requireActual('../../lib/divisionRouting'),
	createProjectWithJev: (...args: unknown[]) => mockCreate(...args),
}));
// react-native-web の TextInput は DOM (document) を要るので、入力欄だけ軽いスタブにする
jest.mock('../ui', () => {
	const actual = jest.requireActual('../ui');
	const ReactActual = jest.requireActual('react');
	return { ...actual, Input: (props: Record<string, unknown>) => ReactActual.createElement('TextInputStub', props) };
});
jest.mock('../../lib/divisionSocial', () => ({
	publishAssignmentPost: (...args: unknown[]) => mockPublish(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JevProjectCreator } = require('../JevProjectCreator') as typeof import('../JevProjectCreator');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ToastProvider } = require('../ui') as typeof import('../ui');

const session = { userId: 'u1', email: 'me@example.com', accessToken: 'a', refreshToken: 'r' };

const result = {
	projectId: 'p-new',
	projectName: 'コンパイラを書く',
	sliders: { effort: 'max', maxCostUsd: 0.2, minPerformance: 90 },
	totalCostUsd: 0.2,
	averageScore: 90.4,
	jevCostUsd: 0.0012,
	assignments: [
		{ roleSlug: 'leader', roleName: 'Leader', providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'deepseek-flash', modelName: 'deepseek-flash', rank: 9, score: 82.5, effort: null, costUsd: 0.0024, status: 'ok', pickedByJev: false },
		{ roleSlug: 'coder', roleName: 'Coder', providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-opus-5', modelName: 'Claude Opus 5', rank: 1, score: 98.3, effort: 'max', costUsd: 0.19, status: 'below-performance', pickedByJev: true },
	],
};

const texts = (root: ReactTestInstance): string =>
	root.findAll(n => n.children.length > 0 && n.children.every(c => typeof c === 'string'), { deep: true })
		.map(n => n.children.join('')).join('\n');

/** 文字列から祖先を辿り、押せる要素を返す */
const pressable = (root: ReactTestInstance, text: string): ReactTestInstance => {
	const leaf = root.findAll(n => n.children.length > 0 && n.children.every(c => typeof c === 'string') && n.children.join('') === text, { deep: true })[0];
	if (!leaf) throw new Error(`「${text}」が見つかりません`);
	let cur: ReactTestInstance | null = leaf.parent;
	while (cur) { if (typeof cur.props?.onPress === 'function') return cur; cur = cur.parent; }
	throw new Error(`「${text}」のボタンが見つかりません`);
};
/** その題のボタン (ui の Button) が押せない状態か */
const isDisabled = (root: ReactTestInstance, title: string): boolean => {
	const button = root.findAll(n => n.props?.title === title && 'disabled' in (n.props ?? {}), { deep: true })[0];
	if (!button) throw new Error(`ボタン「${title}」が見つかりません`);
	return !!button.props.disabled;
};
const byLabel = (root: ReactTestInstance, label: string, prop: string) =>
	root.findAll(n => n.props?.accessibilityLabel === label && typeof n.props?.[prop] === 'function', { deep: true })[0];

let renderer: ReactTestRenderer;
beforeEach(async () => {
	mockCreate.mockReset().mockResolvedValue(result);
	mockPublish.mockReset().mockResolvedValue({ id: 'post-1' });
	await act(async () => {
		renderer = create(<ToastProvider><JevProjectCreator session={session} /></ToastProvider>);
	});
});
afterEach(() => { act(() => renderer.unmount()); });

test('プロンプトと、スライダーで決めた 3 つの値を Jev に送る', async () => {
	const root = renderer.root;
	// プロンプトが空のうちは送れない
	expect(isDisabled(root, 'Jev に送って作る')).toBe(true);

	await act(async () => { byLabel(root, 'プロンプト', 'onChangeText').props.onChangeText('コンパイラを書く'); });
	// エフォート: ふつう → 最大 (+ を 3 回)、コスト: $0.05 → $0.2 (+ を 2 回)、性能: 70 → 90 (+ を 4 回)
	for (let i = 0; i < 3; i++) await act(async () => { byLabel(root, 'エフォートを上げる', 'onPress').props.onPress(); });
	for (let i = 0; i < 2; i++) await act(async () => { byLabel(root, 'コスト (1 ロール 1 回あたりの上限)を上げる', 'onPress').props.onPress(); });
	for (let i = 0; i < 4; i++) await act(async () => { byLabel(root, '性能 (ランキングのスコアの下限)を上げる', 'onPress').props.onPress(); });
	expect(isDisabled(root, 'Jev に送って作る')).toBe(false);
	expect(texts(root)).toContain('最大');
	expect(texts(root)).toContain('最高性能（90 以上）');

	await act(async () => { pressable(root, 'Jev に送って作る').props.onPress(); });
	expect(mockCreate).toHaveBeenCalledWith(session, {
		goal: 'コンパイラを書く',
		sliders: { effort: 'max', maxCostUsd: 0.2, minPerformance: 90 },
		name: '',
	});

	const shown = texts(root);
	expect(shown).toContain('「コンパイラを書く」を作成しました');
	expect(shown).toContain('Claude Opus 5 · Anthropic');
	expect(shown).toContain('Jev が選択 · #1 · スコア 98.3 · 最大');
	expect(shown).toContain('上限内に性能の下限を満たすモデルがないため');
	expect(texts(root)).toContain('もう一度 Jev に送って作る');
});

test('作ったプロジェクトをソーシャルに共有する (プロバイダー id とエフォートも載せる)', async () => {
	const root = renderer.root;
	await act(async () => { byLabel(root, 'プロンプト', 'onChangeText').props.onChangeText('コンパイラを書く\n最適化も'); });
	await act(async () => { pressable(root, 'Jev に送って作る').props.onPress(); });
	await act(async () => { pressable(root, 'ソーシャルに共有').props.onPress(); });

	expect(mockPublish).toHaveBeenCalledTimes(1);
	const [, post] = mockPublish.mock.calls[0];
	expect(post.title).toBe('コンパイラを書く');
	expect(post.description).toBe('コンパイラを書く\n最適化も');
	expect(post.sourceProjectId).toBe('p-new');
	expect(post.assignments[1]).toMatchObject({ roleSlug: 'coder', providerId: 'anthropic', model: 'claude-opus-5', effort: 'max', priority: 1 });
	expect(post.assignments[0].effort).toBeUndefined();
	expect(texts(root)).toContain('ソーシャルに共有しました');
});

test('失敗したら理由を出す', async () => {
	const { DivisionRoutingError } = jest.requireActual('../../lib/divisionRouting');
	mockCreate.mockRejectedValueOnce(new DivisionRoutingError(402, 'Insufficient credits'));
	const root = renderer.root;
	await act(async () => { byLabel(root, 'プロンプト', 'onChangeText').props.onChangeText('x'); });
	await act(async () => { pressable(root, 'Jev に送って作る').props.onPress(); });
	expect(texts(root)).toContain('クレジットが不足しています。管理タブからクレジットを確認してください。');
});

test('ロールは最初は標準ロール全部 (roles を送らない)。外すと残したロールだけを送る', async () => {
	const root = renderer.root;
	const chip = (label: string) => root.findAll(n => n.props?.accessibilityRole === 'checkbox' && n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function', { deep: true })[0];
	// リーダーは外せない
	expect(chip('リーダー').props.disabled).toBe(true);
	expect(chip('コーダー').props.accessibilityState.checked).toBe(true);

	await act(async () => { byLabel(root, 'プロンプト', 'onChangeText').props.onChangeText('webサイトを作る'); });
	await act(async () => { pressable(root, 'Jev に送って作る').props.onPress(); });
	expect(mockCreate.mock.calls[0][1].roles).toBeUndefined();
	expect(texts(root)).toContain('標準のロールを全部入れます。動画制作などの追加ロールは、目的に要れば Jev が足します。');

	await act(async () => { chip('ファイルサーチャー').props.onPress(); });
	await act(async () => { chip('リーダー').props.onPress(); }); // 押しても外れない
	expect(texts(root)).toContain('選んだロールだけで作ります。');
	await act(async () => { pressable(root, 'もう一度 Jev に送って作る').props.onPress(); });
	expect(mockCreate.mock.calls[1][1].roles).toEqual(['leader', 'searcher', 'researcher', 'writer', 'designer', 'coder', 'reviewer']);
});
