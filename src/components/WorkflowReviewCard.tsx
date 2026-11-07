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
	DEFAULT_WHILE_ITERATIONS, DivisionWorkflow, MAX_LOOP_ITERATIONS, WorkflowNode, insertAfter, insertLoopAfter, insertParallelAfter, layoutWorkflow,
	newWorkflowId, removeLoop, removeNode, setApprovalAfter, workflowErrors, workflowLoops, workflowSteps,
} from '../lib/divisionWorkflow';

const NODE_COLORS: Record<WorkflowNode['type'], string> = {
	start: colors.running,
	role: colors.accent,
	approval: colors.warning,
	end: colors.fgFaint,
	loop: '#8b5cf6',
	loopEnd: '#8b5cf6',
	parallel: colors.success,
};
const NODE_ICONS: Record<WorkflowNode['type'], IconName> = {
	start: 'play', role: 'cpu', approval: 'user-check', end: 'flag', loop: 'repeat', loopEnd: 'corner-down-left', parallel: 'git-merge',
};

const LOOP_KIND_OPTIONS = [
	{ value: 'for', label: 'for (回数)' },
	{ value: 'while', label: 'while (目標まで)' },
] as const;

const clampRounds = (v: string): number => Math.max(1, Math.min(MAX_LOOP_ITERATIONS, Math.round(Number(v)) || 1));

/** 図の列: layoutWorkflow の x ごとにまとめ、上から下へ。 */
export const workflowColumns = (w: DivisionWorkflow): WorkflowNode[][] => {
	const cols = new Map<number, WorkflowNode[]>();
	for (const n of w.nodes) {
		if (!cols.has(n.position.x)) cols.set(n.position.x, []);
		cols.get(n.position.x)!.push(n);
	}
	return [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, col]) => col.sort((a, b) => a.position.y - b.position.y));
};

const nodeTitle = (n: WorkflowNode): string => {
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
const nodeSub = (n: WorkflowNode): string => {
	if (n.type === 'loop') return n.data.loop === 'while' ? `目標: ${n.data.goal || '(未設定)'} · 最大${n.data.maxIterations ?? DEFAULT_WHILE_ITERATIONS}回` : `${n.data.count ?? 2} 回くり返す`;
	if (n.type === 'loopEnd') return 'ここまでを繰り返す';
	if (n.type === 'parallel') return '分岐を同時に実行';
	return '';
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
	const [feedback, setFeedback] = useState('');
	const columns = useMemo(() => workflowColumns(workflow), [workflow]);
	const steps = useMemo(() => workflowSteps(workflow), [workflow]);
	// ループの中のステップは回ごとに並ぶので、最初の番号を出す
	const stepNo = useMemo(() => {
		const m = new Map<string, number>();
		steps.forEach((s, i) => { if (!m.has(s.nodeId)) m.set(s.nodeId, i + 1); });
		return m;
	}, [steps]);
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
						{selected.type !== 'end' ? (
							<>
								<Button title='for ループ' icon='repeat' variant='secondary' size='sm' onPress={() => change(insertLoopAfter(workflow, selected.id, 'for'))} />
								<Button
									title='while ループ (目標)'
									icon='repeat'
									variant='secondary'
									size='sm'
									onPress={() => {
										const next = insertLoopAfter(workflow, selected.id, 'while');
										change(next);
										const added = next.nodes.find(n => n.type === 'loop' && !workflow.nodes.some(o => o.id === n.id));
										if (added) setSelectedId(added.id);
									}}
								/>
								<Button
									title='並列'
									icon='git-merge'
									variant='secondary'
									size='sm'
									onPress={() => change(insertParallelAfter(workflow, selected.id, options.find(r => /^(search|searcher)$/.test(r)) ?? options[0] ?? 'coder'))}
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
									// ループはループ終了と一緒に消す (中のステップは残る)
									const pairOf = selected.type === 'loopEnd' ? workflowLoops(workflow).loops.find(l => l.endId === selected.id)?.id : undefined;
									change(selected.type === 'loop' ? removeLoop(workflow, selected.id) : pairOf ? removeLoop(workflow, pairOf) : removeNode(workflow, selected.id));
									setSelectedId(null);
								}}
							/>
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
