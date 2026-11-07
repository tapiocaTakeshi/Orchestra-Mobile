/**
 * ワークフローの 1 ノードの編集欄 (ロール・指示・システムプロンプト・承認・ループ・並列) と、
 * その後ろへのステップ / ループ / 並列の追加・削除。
 * チャットのワークフロー案 (WorkflowReviewCard) と、Dify 風のキャンバス (WorkflowCanvasEditor) の両方で使う。
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, ChipGroup, IconName, Input, Muted, Row, Toggle } from './ui';
import { colors, fontSize, spacing } from '../theme';
import {
	DEFAULT_WHILE_ITERATIONS, DivisionWorkflow, MAX_LOOP_ITERATIONS, WorkflowNode, WorkflowNodeType, insertAfter, insertLoopAfter, insertParallelAfter,
	newWorkflowId, removeLoop, removeNode, setApprovalAfter, workflowLoops,
} from '../lib/divisionWorkflow';

export const NODE_COLORS: Record<WorkflowNodeType, string> = {
	start: colors.running,
	role: colors.accent,
	approval: colors.warning,
	end: colors.fgFaint,
	loop: '#7a5af8',
	loopEnd: '#7a5af8',
	parallel: colors.success,
};

export const NODE_ICONS: Record<WorkflowNodeType, IconName> = {
	start: 'play', role: 'cpu', approval: 'user-check', end: 'flag', loop: 'repeat', loopEnd: 'corner-down-left', parallel: 'git-merge',
};

export const NODE_TYPE_LABEL: Record<WorkflowNodeType, string> = {
	start: '開始', role: 'ロール', approval: '承認', end: '終了', loop: 'ループ', loopEnd: 'ループ終了', parallel: '並列',
};

const LOOP_KIND_OPTIONS = [
	{ value: 'for', label: 'for (回数)' },
	{ value: 'while', label: 'while (目標まで)' },
] as const;

const clampRounds = (v: string): number => Math.max(1, Math.min(MAX_LOOP_ITERATIONS, Math.round(Number(v)) || 1));

export const nodeTitle = (n: WorkflowNode): string => {
	switch (n.type) {
		case 'role': return n.data.title || n.data.role || 'ロール未選択';
		case 'approval': return n.data.title || '承認';
		case 'start': return '開始';
		case 'end': return '終了';
		case 'loop': return n.data.title || (n.data.loop === 'while' ? 'while ループ' : 'for ループ');
		case 'loopEnd': return n.data.title || 'ループ終了';
		case 'parallel': return n.data.title || '並列';
	}
};

/** ループ・並列ノードの下の行 */
export const nodeSub = (n: WorkflowNode): string => {
	if (n.type === 'loop') return n.data.loop === 'while' ? `目標: ${n.data.goal || '(未設定)'} · 最大${n.data.maxIterations ?? DEFAULT_WHILE_ITERATIONS}回` : `${n.data.count ?? 2} 回くり返す`;
	if (n.type === 'loopEnd') return 'ここまでを繰り返す';
	if (n.type === 'parallel') return '分岐を同時に実行';
	return '';
};

/** 新しいステップに最初に割り振るロール */
export const defaultStepRole = (options: string[], pattern = /^(coder|coding)$/): string => options.find(r => pattern.test(r)) ?? options[0] ?? 'coder';

/** ノードの後ろに足せるロール: プロジェクトのロール + 図にすでにあるロール (leader は除く) */
export const workflowRoleOptions = (workflow: DivisionWorkflow, roleOptions?: string[]): string[] => {
	const set = new Set((roleOptions ?? []).filter(r => r && r !== 'leader'));
	for (const n of workflow.nodes) if (n.type === 'role' && n.data.role) set.add(n.data.role);
	return [...set];
};

export const WorkflowNodeEditor = ({ workflow, selected, options, onChange, onSelect, showAddButtons = true }: {
	workflow: DivisionWorkflow;
	selected: WorkflowNode;
	options: string[];
	onChange: (next: DivisionWorkflow) => void;
	onSelect: (id: string | null) => void;
	/** キャンバスでは「＋」から足せるが、指で押しやすいように既定で出しておく */
	showAddButtons?: boolean;
}) => {
	const patch = (p: Partial<WorkflowNode['data']>) =>
		onChange({ ...workflow, nodes: workflow.nodes.map(n => (n.id === selected.id ? { ...n, data: { ...n.data, ...p } } : n)) });
	const approvalAfter = workflow.edges.some(e => e.source === selected.id && workflow.nodes.find(n => n.id === e.target)?.type === 'approval');

	return (
		<View style={styles.editor}>
			{selected.type === 'role' ? (
				<>
					<Text style={styles.label}>ロール</Text>
					<ChipGroup options={options.map(r => ({ value: r, label: r }))} value={selected.data.role ?? null} onChange={role => patch({ role })} />
					<Text style={styles.label}>ステップ名</Text>
					<Input value={selected.data.title ?? ''} maxLength={120} onChangeText={title => patch({ title })} accessibilityLabel='ステップ名' />
					<Text style={styles.label}>指示</Text>
					<Input value={selected.data.instruction ?? ''} maxLength={4000} multiline onChangeText={instruction => patch({ instruction })} style={styles.multi} accessibilityLabel='指示' />
					<Text style={styles.label}>システムプロンプト (このステップだけ)</Text>
					<Input
						value={selected.data.systemPrompt ?? ''}
						maxLength={8000}
						multiline
						placeholder='例: 出力は箇条書き。既存の API は変えない。'
						onChangeText={systemPrompt => patch({ systemPrompt })}
						style={styles.multi}
						accessibilityLabel='このステップのシステムプロンプト'
					/>
					<Row style={styles.toggleRow}>
						<Text style={styles.toggleText}>このステップの後で承認する</Text>
						<Toggle value={approvalAfter} onValueChange={on => onChange(setApprovalAfter(workflow, selected.id, on))} accessibilityLabel='このステップの後で承認する' />
					</Row>
				</>
			) : selected.type === 'approval' ? (
				<>
					<Text style={styles.label}>承認の名前</Text>
					<Input value={selected.data.title ?? ''} maxLength={120} onChangeText={title => patch({ title })} accessibilityLabel='承認の名前' />
				</>
			) : selected.type === 'loop' ? (
				<>
					<Text style={styles.label}>くり返し方</Text>
					<ChipGroup
						options={LOOP_KIND_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
						value={selected.data.loop ?? 'for'}
						onChange={kind => patch(kind === 'while'
							? { loop: 'while', goal: selected.data.goal ?? '', maxIterations: selected.data.maxIterations ?? DEFAULT_WHILE_ITERATIONS }
							: { loop: 'for', count: selected.data.count ?? 2 })}
					/>
					{selected.data.loop === 'while' ? (
						<>
							<Text style={styles.label}>目標 (達成したらループを抜ける。毎回の前にリーダーが判定)</Text>
							<Input
								value={selected.data.goal ?? ''}
								maxLength={4000}
								multiline
								placeholder='例: テストがすべて通り、画面がデザインどおり'
								onChangeText={goal => patch({ goal })}
								style={styles.multi}
								accessibilityLabel='ループの目標'
							/>
							<Text style={styles.label}>最大回数 (1〜{MAX_LOOP_ITERATIONS})</Text>
							<Input value={String(selected.data.maxIterations ?? DEFAULT_WHILE_ITERATIONS)} keyboardType='number-pad' onChangeText={v => patch({ maxIterations: clampRounds(v) })} accessibilityLabel='最大回数' />
						</>
					) : (
						<>
							<Text style={styles.label}>回数 (1〜{MAX_LOOP_ITERATIONS})</Text>
							<Input value={String(selected.data.count ?? 2)} keyboardType='number-pad' onChangeText={v => patch({ count: clampRounds(v) })} accessibilityLabel='回数' />
						</>
					)}
					<Text style={styles.label}>ループの名前</Text>
					<Input value={selected.data.title ?? ''} maxLength={120} onChangeText={title => patch({ title })} accessibilityLabel='ループの名前' />
					<Muted>このノードと「ループ終了」の間のステップを繰り返します。「次にステップを追加」でループの中にステップを入れます。</Muted>
				</>
			) : selected.type === 'parallel' ? (
				<>
					<Text style={styles.label}>並列の名前</Text>
					<Input value={selected.data.title ?? ''} maxLength={120} onChangeText={title => patch({ title })} accessibilityLabel='並列の名前' />
					<Muted>このノードから出た分岐を同時に実行し、次に分岐が集まる所で合流します。</Muted>
				</>
			) : selected.type === 'loopEnd' ? (
				<Muted>対応する「ループ」からここまでを繰り返します。</Muted>
			) : selected.type === 'start' ? (
				<Muted>ワークフローはここから始まります。右の「＋」から次のブロックを足せます。</Muted>
			) : (
				<Muted>ここでワークフローが終わります。</Muted>
			)}
			<Row style={styles.actions}>
				{showAddButtons && selected.type !== 'end' ? (
					<>
						<Button
							title='次にステップを追加'
							icon='plus'
							variant='secondary'
							size='sm'
							onPress={() => {
								const id = newWorkflowId('step');
								onChange(insertAfter(workflow, selected.id, { id, type: 'role', data: { role: defaultStepRole(options), title: '新しいステップ' } }));
								onSelect(id);
							}}
						/>
						<Button title='for ループ' icon='repeat' variant='secondary' size='sm' onPress={() => onChange(insertLoopAfter(workflow, selected.id, 'for'))} />
						<Button
							title='while ループ (目標)'
							icon='repeat'
							variant='secondary'
							size='sm'
							onPress={() => {
								const next = insertLoopAfter(workflow, selected.id, 'while');
								onChange(next);
								const added = next.nodes.find(n => n.type === 'loop' && !workflow.nodes.some(o => o.id === n.id));
								if (added) onSelect(added.id);
							}}
						/>
						<Button
							title='並列'
							icon='git-merge'
							variant='secondary'
							size='sm'
							onPress={() => onChange(insertParallelAfter(workflow, selected.id, defaultStepRole(options, /^(search|searcher)$/)))}
						/>
					</>
				) : null}
				{selected.type !== 'start' && selected.type !== 'end' ? (
					<Button
						title='削除'
						icon='trash-2'
						variant='ghost'
						size='sm'
						onPress={() => {
							onChange(deleteWorkflowNode(workflow, selected));
							onSelect(null);
						}}
					/>
				) : null}
			</Row>
		</View>
	);
};

/** ノードを消す。ループはループ終了と一緒に消す (中のステップは残る)。開始・終了は消さない。 */
export const deleteWorkflowNode = (workflow: DivisionWorkflow, node: WorkflowNode): DivisionWorkflow => {
	if (node.type === 'start' || node.type === 'end') return workflow;
	const pairOf = node.type === 'loopEnd' ? workflowLoops(workflow).loops.find(l => l.endId === node.id)?.id : undefined;
	return node.type === 'loop' ? removeLoop(workflow, node.id) : pairOf ? removeLoop(workflow, pairOf) : removeNode(workflow, node.id);
};

const styles = StyleSheet.create({
	editor: {
		gap: 6,
		padding: spacing.sm,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
	},
	label: { fontSize: fontSize.xs, color: colors.fgMuted, marginTop: 2 },
	multi: { minHeight: 72, textAlignVertical: 'top' },
	toggleRow: { alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
	toggleText: { fontSize: fontSize.xs, color: colors.fg, flex: 1 },
	actions: { flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 },
});
