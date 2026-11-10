/**
 * 承認待ちの帯 (FR-018) の回帰テスト。
 * 読み上げ名・押せる枠 (高さ 44)・形のあるアイコン・押したときの遷移を確認する。
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import { APPROVAL_BAR_LABEL, ApprovalBar } from '../ApprovalBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderer: ReactTestRenderer | null = null;

const render = async (onPress: () => void): Promise<ReactTestInstance> => {
	await act(async () => { renderer = create(<ApprovalBar onPress={onPress} />); });
	return renderer!.root;
};

afterEach(async () => {
	if (renderer) {
		await act(async () => { renderer!.unmount(); });
		renderer = null;
	}
});

const isBar = (n: ReactTestInstance | null) => n?.props?.accessibilityLabel === APPROVAL_BAR_LABEL && typeof n.props?.onPress === 'function';
const barOf = (root: ReactTestInstance) => root.findAll(n => isBar(n) && !isBar(n.parent))[0];

describe('ApprovalBar 承認待ちの帯 (FR-018)', () => {
	it('ボタンとして「確認待ち」と行き先を読み上げ、押せる枠は高さ 44 以上', async () => {
		const root = await render(jest.fn());
		const bar = barOf(root);
		expect(bar).toBeDefined();
		expect(APPROVAL_BAR_LABEL).toBe('ツールの実行が確認待ちです。チャットへ');
		expect(bar.props.accessibilityRole).toBe('button');
		const style = StyleSheet.flatten(bar.props.style) as { minHeight?: number };
		expect(style.minHeight).toBeGreaterThanOrEqual(44);
	});

	it('状態は色だけでなく形のあるアイコンで示し、押すとチャットへ移る処理を呼ぶ', async () => {
		const onPress = jest.fn();
		const root = await render(onPress);
		const icons = root.findAll(n => typeof n.props?.name === 'string' && typeof n.props?.size === 'number').map(n => n.props.name as string);
		expect(icons).toContain('pause-circle');
		await act(async () => { barOf(root).props.onPress(); });
		expect(onPress).toHaveBeenCalledTimes(1);
	});
});
