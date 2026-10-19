/**
 * RemoteScreen (PC のチャットの遠隔操作) の回帰テスト。
 *  - エージェントの返答を Markdown として描く (記号のまま出さない)
 *  - 目標ループの切り替え (自動 ⇄ 毎回確認)。古い IDE / Division API 以外では出さない
 *  - 「毎回確認」で止まったときは、ツールの承認ではなく次のラウンドへ進むか聞く
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer, ReactTestRendererJSON } from 'react-test-renderer';

import type { ChatState, Snapshot } from '../../api/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockClient = {
	sendPrompt: jest.fn(),
	setGoalLoopMode: jest.fn(),
	approveTool: jest.fn(),
	rejectTool: jest.fn(),
	newThread: jest.fn(),
	abortAgent: jest.fn(),
	switchThread: jest.fn(),
};
let mockSnapshot: Snapshot;
const mockInvalidate = jest.fn();
const mockToast = jest.fn();

jest.mock('../../state/AppContext', () => ({
	useApp: () => ({ snapshot: mockSnapshot, error: null, refresh: jest.fn(), isRefreshing: false, invalidate: mockInvalidate, client: mockClient }),
}));
jest.mock('../TuningScreen', () => ({ TuningScreen: () => null }));
// TextInput (react-native-web) は node 環境で document を参照するので、入力欄は軽量スタブにする
jest.mock('react-native', () => {
	const actual = jest.requireActual('react-native');
	const ReactActual = jest.requireActual('react');
	return { ...actual, TextInput: (props: object) => ReactActual.createElement('input-stub', props) };
});
jest.mock('../../components/ui', () => {
	const actual = jest.requireActual('../../components/ui');
	return { ...actual, useToast: () => ({ show: mockToast }) };
});

import { RemoteScreen } from '../RemoteScreen';

const snapshotWith = (chat: Partial<ChatState>): Snapshot => ({
	ide: { protocolVersion: 1, appName: 'Orchestra', version: '1.0.0', workspaceName: 'ws', workspaceFolders: [], uiLanguage: 'ja' },
	division: { projects: [], activeProjectIds: [], configPath: null, hasProject: false },
	kanban: {} as Snapshot['kanban'],
	chat: { threadId: 't1', messages: [], isRunning: false, awaitingApproval: false, ...chat },
	threads: [],
	remoteSession: null,
	revision: 1,
	generatedAt: 0,
});

const render = async () => {
	let tree!: ReactTestRenderer;
	await act(async () => { tree = create(<RemoteScreen onOpenPage={jest.fn()} />); });
	return tree;
};

/** 画面に出ている文字 (入れ子の太字なども含む) を | でつないで返す */
const textsOf = (tree: ReactTestRenderer) => {
	const leaves: string[] = [];
	const walk = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null) => {
		if (node === null) return;
		if (typeof node === 'string') leaves.push(node);
		else if (Array.isArray(node)) node.forEach(walk);
		else (node.children ?? []).forEach(walk);
	};
	walk(tree.toJSON());
	return leaves.join('|');
};

const byLabel = (tree: ReactTestRenderer, pattern: RegExp): ReactTestInstance =>
	tree.root.find(n => typeof n.props.accessibilityLabel === 'string' && pattern.test(n.props.accessibilityLabel) && typeof n.props.onPress === 'function');

beforeEach(() => {
	jest.clearAllMocks();
	Object.values(mockClient).forEach(fn => fn.mockResolvedValue({}));
});

describe('RemoteScreen', () => {
	it('返答の Markdown を記号のまま出さない', async () => {
		mockSnapshot = snapshotWith({ messages: [{ role: 'assistant', text: '## 🎯 目標\n\n**ログインを直す**\n\n1. テストが通る' }] });
		const tree = await render();
		const texts = textsOf(tree);
		expect(texts).toContain('🎯 目標');
		expect(texts).toContain('ログインを直す');
		expect(texts).not.toContain('**');
		expect(texts).not.toContain('##');
	});

	it('ループの切り替えで IDE の設定を変える', async () => {
		mockSnapshot = snapshotWith({ goalLoopMode: 'auto' });
		const tree = await render();
		expect(textsOf(tree)).toContain('自動');
		await act(async () => { byLabel(tree, /^目標ループ: 自動/).props.onPress(); });
		expect(mockClient.setGoalLoopMode).toHaveBeenCalledWith('confirm');
		expect(mockInvalidate).toHaveBeenCalled();
	});

	it('Division API 以外 / 古い IDE ではループを出さない', async () => {
		mockSnapshot = snapshotWith({ goalLoopMode: null });
		const tree = await render();
		expect(() => byLabel(tree, /^目標ループ/)).toThrow();
	});

	it('「毎回確認」で止まったら、次のラウンドへ進むか聞く', async () => {
		mockSnapshot = snapshotWith({
			isRunning: true,
			awaitingApproval: true,
			goalLoopMode: 'confirm',
			pendingReview: { flowRole: 'goal-loop', title: '目標はまだ達成されていません', content: '満たせていない条件:\n- テストが通る', completed: 1, total: 5 },
		});
		const tree = await render();
		const texts = textsOf(tree);
		expect(texts).toContain('🎯 目標はまだ達成されていません（ラウンド 1 / 5 完了）');
		expect(texts).toContain('次のラウンドへ進む');
		expect(texts).not.toContain('ツールの実行を承認しますか？');
		const next = tree.root.find(n => n.props.title === '次のラウンドへ進む' && typeof n.props.onPress === 'function');
		await act(async () => { next.props.onPress(); });
		expect(mockClient.approveTool).toHaveBeenCalled();
		expect(mockToast).toHaveBeenCalledWith('次のラウンドに進みました', 'success');
	});
});
