/**
 * Division Project 承認モード: Leader が計画を図にしたワークフロー案を確認・編集して、
 * 承認 (編集した内容で) / 差し戻し (フィードバックで作り直し) / 中止 する。
 *
 * クラウドセッション (POST /api/cloud-sessions/:id/workflow-proposal) と、
 * PC の IDE (Remote Control の POST /api/chat/workflow) の両方で使う。
 * スマホは横幅が狭いので、図は「列 (同時に進むステップ) を横に並べて横スクロール」で描き、
 * 合流・分岐は各ステップの「← #n」(待つステップ) で示す。
 * 「ワークフローを編集」で Dify のようなキャンバス (WorkflowCanvasEditor) を全画面で開き、保存するとここに反映される。
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorBanner, Icon, Input, Muted, Row } from './ui';
import { colors, fontSize, radius, spacing, withAlpha } from '../theme';
import { DivisionWorkflow, WorkflowNode, layoutWorkflow, workflowErrors, workflowSteps } from '../lib/divisionWorkflow';
import { keepPositions } from '../lib/workflowCanvas';
import { NODE_COLORS, NODE_ICONS, WorkflowNodeEditor, nodeSub, nodeTitle, workflowRoleOptions } from './WorkflowNodeEditor';
import { WorkflowCanvasEditor } from './WorkflowCanvasEditor';

/** 図の列: layoutWorkflow の x ごとにまとめ、上から下へ。 */
export const workflowColumns = (w: DivisionWorkflow): WorkflowNode[][] => {
	const cols = new Map<number, WorkflowNode[]>();
	for (const n of w.nodes) {
		if (!cols.has(n.position.x)) cols.set(n.position.x, []);
		cols.get(n.position.x)!.push(n);
	}
	return [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, col]) => col.sort((a, b) => a.position.y - b.position.y));
};

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
	const [canvasOpen, setCanvasOpen] = useState(false);
	const [feedback, setFeedback] = useState('');
	// キャンバスで自由に置いた位置でも、ここでは列に並べ直して見せる
	const columns = useMemo(() => workflowColumns(layoutWorkflow(workflow)), [workflow]);
	const steps = useMemo(() => workflowSteps(workflow), [workflow]);
	// ループの中のステップは回ごとに並ぶので、最初の番号を出す
	const stepNo = useMemo(() => {
		const m = new Map<string, number>();
		steps.forEach((s, i) => { if (!m.has(s.nodeId)) m.set(s.nodeId, i + 1); });
		return m;
	}, [steps]);
	const errors = useMemo(() => workflowErrors(workflow), [workflow]);
	const selected = workflow.nodes.find(n => n.id === selectedId) ?? null;
	const options = useMemo(() => workflowRoleOptions(workflow, roleOptions), [roleOptions, workflow]);

	// 編集の補助関数は図を並べ直すので、キャンバスで置いた位置を保つ
	const change = (next: DivisionWorkflow) => { setWorkflow(keepPositions(workflow, next)); setEdited(true); };
	/** このステップが待つステップの番号 (2 つ以上 = 合流) */
	const waitsFor = (id: string): number[] => steps.find(s => s.nodeId === id)?.dependsOn.map(d => d + 1) ?? [];

	return (
		<View style={styles.card} accessibilityLabel='ワークフロー案の承認'>
			<View style={styles.header}>
				<Icon name='git-branch' size={15} color={colors.warning} />
				<Text style={[styles.title, styles.flex]}>リーダーのワークフロー案</Text>
				<Button
					title='ワークフローを編集'
					icon='edit-2'
					variant='secondary'
					size='sm'
					disabled={!!busy}
					accessibilityLabel='ワークフローをキャンバスで編集'
					onPress={() => setCanvasOpen(true)}
				/>
			</View>
			{leader ? <Muted>{leader}</Muted> : null}
			<Muted>ステップを押すと編集できます。承認するとこの順で各ロールが実行し、「承認」の所であなたの確認を待ちます。繰り返しは for / while ループ (目標は while ループに書く)、同時に進める作業は並列ノードで組めます。</Muted>

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
										style={[styles.node, { borderColor: active ? colors.fgStrong : withAlpha(NODE_COLORS[n.type], '99') }, (n.type === 'approval' || n.type === 'loopEnd') && styles.nodeApproval]}
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
										) : nodeSub(n) ? <Text style={styles.nodeSub} numberOfLines={2}>{nodeSub(n)}</Text> : null}
									</Pressable>
								);
							})}
						</View>
					</React.Fragment>
				))}
			</ScrollView>

			{selected ? (
				<WorkflowNodeEditor workflow={workflow} selected={selected} options={options} onChange={change} onSelect={setSelectedId} />
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
			{canvasOpen ? (
				<WorkflowCanvasEditor
					workflow={workflow}
					roleOptions={roleOptions}
					onClose={() => setCanvasOpen(false)}
					onSave={next => {
						setWorkflow(next);
						setEdited(true);
						setSelectedId(id => (id && next.nodes.some(n => n.id === id) ? id : null));
						setCanvasOpen(false);
					}}
				/>
			) : null}
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
	flex: { flex: 1 },
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
	multi: { minHeight: 72, textAlignVertical: 'top' },
	actions: { flexWrap: 'wrap', gap: spacing.sm },
});
