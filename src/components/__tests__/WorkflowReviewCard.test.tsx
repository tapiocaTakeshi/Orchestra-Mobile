/**
 * チャットのワークフロー案: 「ワークフローを編集」で Dify 風のキャンバスが開き、
 * そこで保存した内容が「編集して承認」で送られること。
 */

import React from 'react';
import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { DivisionWorkflow, normalizeWorkflow } from '../../lib/divisionWorkflow';
import { WorkflowReviewCard } from '../WorkflowReviewCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// TextInput (react-native-web) は node 環境で document を参照するので軽量スタブに、
// Modal はポータルを使うので中身をそのまま描く
jest.mock('react-native', () => {
	const actual = jest.requireActual('react-native');
	const ReactActual = jest.requireActual('react');
	return {
		...actual,
		TextInput: (props: object) => ReactActual.createElement('input-stub', props),
		Modal: ({ children }: { children: React.ReactNode }) => children,
	};
});

const draft = (): DivisionWorkflow => normalizeWorkflow({
	version: 1, enabled: true,
	nodes: [
		{ id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
		{ id: 's1', type: 'role', position: { x: 0, y: 0 }, data: { role: 'researcher', title: '調査' } },
		{ id: 'end', type: 'end', position: { x: 0, y: 0 }, data: {} },
	],
	edges: [{ id: 'e1', source: 'start', target: 's1' }, { id: 'e2', source: 's1', target: 'end' }],
})!;

const byLabel = (root: ReactTestInstance, label: string) =>
	root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];

describe('WorkflowReviewCard', () => {
	it('opens the canvas editor from the edit button and approves what was saved there', async () => {
		const onApprove = jest.fn();
		let r!: ReactTestRenderer;
		await act(async () => {
			r = create(<WorkflowReviewCard workflow={draft()} roleOptions={['researcher', 'coder']} onApprove={onApprove} onRevise={jest.fn()} />);
		});
		expect(r.root.findAll(n => n.props.accessibilityLabel === 'ワークフローのキャンバス')).toHaveLength(0);

		await act(async () => { byLabel(r.root, 'ワークフローをキャンバスで編集').props.onPress(); });
		expect(r.root.findAll(n => n.props.accessibilityLabel === 'ワークフローのキャンバス').length).toBeGreaterThan(0);
		// the cards are drawn on the canvas
		expect(r.root.findAll(n => n.props.accessibilityLabel === 'ロール: 調査').length).toBeGreaterThan(0);

		// tidy up (a change), then save
		await act(async () => { byLabel(r.root, '整列 (自動レイアウト)').props.onPress(); });
		await act(async () => { byLabel(r.root, '保存').props.onPress(); });
		expect(r.root.findAll(n => n.props.accessibilityLabel === 'ワークフローのキャンバス')).toHaveLength(0);

		await act(async () => { byLabel(r.root, '編集して承認').props.onPress(); });
		expect(onApprove).toHaveBeenCalledTimes(1);
		const sent = onApprove.mock.calls[0][0] as DivisionWorkflow;
		expect(sent.nodes.map(n => n.id)).toEqual(['start', 's1', 'end']);
	});
});
