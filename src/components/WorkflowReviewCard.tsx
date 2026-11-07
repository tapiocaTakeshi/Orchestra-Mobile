/**
 * Division Project 承認モード: Leader が計画を図にしたワークフロー案を確認・編集して、
 * 承認 (編集した内容で) / 差し戻し (フィードバックで作り直し) / 中止 する。
 *
 * クラウドセッション (POST /api/cloud-sessions/:id/workflow-proposal) と、
 * PC の IDE (Remote Control の POST /api/chat/workflow) の両方で使う。
 * スマホは横幅が狭いので、図は「列 (同時に進むステップ) を横に並べて横スクロール」で描き、
 * 合流・分岐は各ステップの「← #n」(待つステップ) で示す。
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ChipGroup, ErrorBanner, Icon, IconName, Input, Muted, Row, Toggle } from './ui';
import { colors, fontSize, radius, spacing, withAlpha } from '../theme';
import {
	DivisionWorkflow, WorkflowNode, insertAfter, layoutWorkflow, newWorkflowId, removeNode, setApprovalAfter, workflowErrors, workflowSteps,
} from '../lib/divisionWorkflow';

const NODE_COLORS: Record<WorkflowNode['type'], string> = {
	start: colors.running,
	role: colors.accent,
	approval: colors.warning,
	end: colors.fgFaint,
};
const NODE_ICONS: Record<WorkflowNode['type'], IconName> = { start: 'play', role: 'cpu', approval: 'user-check', end: 'flag' };

/** 図の列: layoutWorkflow の x ごとにまとめ、上から下へ。 */
export const workflowColumns = (w: DivisionWorkflow): WorkflowNode[][] => {
	const cols = new Map<number, WorkflowNode[]>();
	for (const n of w.nodes) {
		if (!cols.has(n.position.x)) cols.set(n.position.x, []);
		cols.get(n.position.x)!.push(n);
	}
	return [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, col]) => col.sort((a, b) => a.position.y - b.position.y));
};

const nodeTitle = (n: WorkflowNode): string =>
	n.type === 'role' ? (n.data.title || n.data.role || 'ロール未選択') : n.type === 'approval' ? (n.data.title || '承認') : n.type === 'start' ? '開始' : '終了';

export const WorkflowReviewCard = ({ workflow: initial, leader, roleOptions, busy, error, onApprove, onRevise, onReject }: {
	workflow: DivisionWorkflow;
	leader?: string;
	/** ステップに割り振れるロール (プロジェクトのロール) */
	roleOptions?: string[];
	busy?: 'approve' | 'revise' | 'reject' | null;
	error?: string | null;
	/** workflow は図を編集したときだけ渡す */
	onApprove: (workflow?: DivisionWorkflow) => void;
	onRevise: (feedback: string) => void;
	onReject?: () => void;
}) => {
	const [workflow, setWorkflow] = useState<DivisionWorkflow>(() => layoutWorkflow(initial));
	const [edited, setEdited] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [feedback, setFeedback] = useState('');
	const columns = useMemo(() => workflowColumns(workflow), [workflow]);
	const steps = useMemo(() => workflowSteps(workflow), [workflow]);
	const stepNo = useMemo(() => new Map(steps.map((s, i) => [s.nodeId, i + 1])), [steps]);
	const errors = useMemo(() => workflowErrors(workflow), [workflow]);
	const selected = workflow.nodes.find(n => n.id === selectedId) ?? null;
	const options = useMemo(() => {
		const set = new Set((roleOptions ?? []).filter(r => r && r !== 'leader'));
		for (const n of workflow.nodes) if (n.type === 'role' && n.data.role) set.add(n.data.role);
		return [...set];
	}, [roleOptions, workflow]);

	const change = (next: DivisionWorkflow) => { setWorkflow(next); setEdited(true); };
	const patch = (p: Partial<WorkflowNode['data']>) => {
		if (!selected) return;
		change({ ...workflow, nodes: workflow.nodes.map(n => (n.id === selected.id ? { ...n, data: { ...n.data, ...p } } : n)) });
	};
	const approvalAfter = (id: string) => workflow.edges.some(e => e.source === id && workflow.nodes.find(n => n.id === e.target)?.type === 'approval');
	/** このステップが待つステップの番号 (2 つ以上 = 合流) */
	const waitsFor = (id: string): number[] => steps.find(s => s.nodeId === id)?.dependsOn.map(d => d + 1) ?? [];

	return (
		<View style={styles.card} accessibilityLabel='ワークフロー案の承認'>
			<View style={styles.header}>
				<Icon name='git-branch' size={15} color={colors.warning} />
				<Text style={styles.title}>リーダーのワークフロー案</Text>
			</View>
			{leader ? <Muted>{leader}</Muted> : null}
			<Muted>ステップを押すと編集できます。承認するとこの順で各ロールが実行し、「承認」の所であなたの確認を待ちます。</Muted>

			<ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.diagram}>
				{columns.map((col, ci) => (
					<React.Fragment key={ci}>
						{ci > 0 ? <View style={styles.arrow}><Icon name='chevron-right' size={16} color={colors.fgFaint} /></View> : null}
						<View style={styles.column}>
							{col.map(n => {
								const active = n.id === selectedId;
								const deps = waitsFor(n.id);
								return (
									<Pressable
										key={n.id}
										accessibilityRole='button'
										accessibilityLabel={`${nodeTitle(n)} を編集`}
										onPress={() => setSelectedId(active ? null : n.id)}
										style={[styles.node, { borderColor: active ? colors.fgStrong : withAlpha(NODE_COLORS[n.type], '99') }, n.type === 'approval' && styles.nodeApproval]}
									>
										<Row style={styles.nodeHead}>
											<View style={[styles.nodeIcon, { backgroundColor: NODE_COLORS[n.type] }]}><Icon name={NODE_ICONS[n.type]} size={11} color='#fff' /></View>
											<Text style={styles.nodeTitle} numberOfLines={1}>{nodeTitle(n)}</Text>
											{stepNo.has(n.id) ? <Text style={styles.nodeNo}>#{stepNo.get(n.id)}</Text> : null}
										</Row>
										{n.type === 'role' ? (
											<Text style={styles.nodeSub} numberOfLines={1}>
												{n.data.role}{n.data.systemPrompt ? ' · SP' : ''}{deps.length > 1 ? `  ← #${deps.join(', #')}` : ''}
											</Text>
										) : null}
									</Pressable>
								);
							})}
						</View>
					</React.Fragment>
				))}
			</ScrollView>

			{selected ? (
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
								<Toggle value={approvalAfter(selected.id)} onValueChange={on => change(setApprovalAfter(workflow, selected.id, on))} accessibilityLabel='このステップの後で承認する' />
							</Row>
						</>
					) : selected.type === 'approval' ? (
						<>
							<Text style={styles.label}>承認の名前</Text>
							<Input value={selected.data.title ?? ''} maxLength={120} onChangeText={title => patch({ title })} accessibilityLabel='承認の名前' />
						</>
					) : null}
					<Row style={styles.actions}>
						{selected.type !== 'end' ? (
							<Button
								title='次にステップを追加'
								icon='plus'
								variant='secondary'
								size='sm'
								onPress={() => {
									const id = newWorkflowId('step');
									change(insertAfter(workflow, selected.id, { id, type: 'role', data: { role: options.find(r => /^(coder|coding)$/.test(r)) ?? options[0] ?? 'coder', title: '新しいステップ' } }));
									setSelectedId(id);
								}}
							/>
						) : null}
						{selected.type === 'role' || selected.type === 'approval' ? (
							<Button title='削除' icon='trash-2' variant='ghost' size='sm' onPress={() => { change(removeNode(workflow, selected.id)); setSelectedId(null); }} />
						) : null}
					</Row>
				</View>
			) : null}

			{errors.length ? <ErrorBanner message={errors.join(' ')} tone='warning' /> : null}
			<Input
				value={feedback}
				onChangeText={setFeedback}
				multiline
				editable={!busy}
				placeholder='差し戻すときのフィードバック (どう直してほしいか)'
				accessibilityLabel='差し戻しのフィードバック'
				style={styles.multi}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<Row style={styles.actions}>
				<Button
					title={edited ? '編集して承認' : '承認して実行'}
					icon='check'
					size='sm'
					loading={busy === 'approve'}
					disabled={!!busy || errors.length > 0}
					onPress={() => onApprove(edited ? workflow : undefined)}
				/>
				<Button
					title='差し戻す'
					icon='corner-up-left'
					variant='secondary'
					size='sm'
					loading={busy === 'revise'}
					disabled={!!busy || !feedback.trim()}
					onPress={() => onRevise(feedback.trim())}
				/>
				{onReject ? <Button title='中止' icon='x' variant='ghost' size='sm' loading={busy === 'reject'} disabled={!!busy} onPress={onReject} /> : null}
			</Row>
		</View>
	);
};

const styles = StyleSheet.create({
	card: {
		gap: spacing.sm,
		padding: spacing.md,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: withAlpha(colors.warning, '55'),
		backgroundColor: withAlpha(colors.warning, '0d'),
	},
	header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	title: { fontSize: fontSize.sm, fontWeight: '600', color: colors.fgStrong },
	diagram: { alignItems: 'center', paddingVertical: spacing.sm, gap: 2 },
	arrow: { paddingHorizontal: 2 },
	column: { gap: spacing.sm },
	node: {
		width: 150,
		paddingHorizontal: spacing.sm,
		paddingVertical: 6,
		borderRadius: radius.sm,
		borderWidth: 1.5,
		backgroundColor: colors.bgElevated,
		gap: 2,
	},
	nodeApproval: { borderStyle: 'dashed' },
	nodeHead: { alignItems: 'center', gap: 6 },
	nodeIcon: { width: 18, height: 18, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
	nodeTitle: { flex: 1, fontSize: fontSize.xs, fontWeight: '600', color: colors.fgStrong },
	nodeNo: { fontSize: 11, color: colors.fgFaint },
	nodeSub: { fontSize: 11, color: colors.fgFaint },
	editor: {
		gap: 6,
		padding: spacing.sm,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
	},
	label: { fontSize: fontSize.xs, color: colors.fgMuted, marginTop: 2 },
	multi: { minHeight: 72, textAlignVertical: 'top' },
	toggleRow: { alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
	toggleText: { fontSize: fontSize.xs, color: colors.fg, flex: 1 },
	actions: { flexWrap: 'wrap', gap: spacing.sm },
});
