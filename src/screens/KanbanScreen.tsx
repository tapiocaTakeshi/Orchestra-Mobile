/**
 * カンバンのタブ。
 *
 * IDE の .orchestra/kanban.json をそのまま操作する。スマホでは横スワイプで
 * カラムを送り、カードをタップすると詳細 (チェックリスト・コメント・実行履歴) を開く。
 * ドラッグ&ドロップの代わりに、詳細の「移動」で列を選ばせている。
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Switch,
	Text,
	View,
	useWindowDimensions,
} from 'react-native';

import { OrchestraApiError } from '../api/client';
import { KANBAN_PRIORITIES, KanbanPriority, KanbanTask } from '../api/types';
import {
	Badge,
	Body,
	Button,
	Card,
	ChipGroup,
	Divider,
	EmptyState,
	ErrorBanner,
	Input,
	Loading,
	Muted,
	Row,
	Screen,
	SectionTitle,
	Title,
} from '../components/ui';
import { oneLine, relativeTime } from '../lib/format';
import {
	boardSummary,
	buildColumnViews,
	checklistProgress,
	columnWithRole,
	isOverdue,
	latestRun,
	moveTargets,
	priorityColor,
	priorityLabel,
} from '../lib/kanban';
import { useApp } from '../state/AppContext';
import { colors, fontSize, radius, spacing } from '../theme';

const runStatusColor = (status: string): string => {
	switch (status) {
		case 'done': return colors.success;
		case 'error':
		case 'timeout': return colors.danger;
		case 'canceled': return colors.fgFaint;
		default: return colors.warning;
	}
};

const TaskCard = ({ task, isRunning, onPress }: { task: KanbanTask; isRunning: boolean; onPress: () => void }) => {
	const progress = checklistProgress(task);
	const run = latestRun(task);
	const overdue = isOverdue(task);

	return (
		<Pressable accessibilityRole='button' onPress={onPress} style={({ pressed }) => [
			styles.taskCard,
			isRunning && styles.taskCardRunning,
			pressed && { opacity: 0.8 },
		]}>
			<Row style={styles.spread}>
				<View style={[styles.priorityBar, { backgroundColor: priorityColor(task.priority) }]} />
				<View style={styles.flex}>
					<Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
					{task.description ? <Muted numberOfLines={2}>{oneLine(task.description, 90)}</Muted> : null}
				</View>
			</Row>

			<View style={styles.taskMetaRow}>
				{isRunning ? <Badge label='実行中' color={colors.running} /> : null}
				{overdue ? <Badge label={`期限 ${task.dueDate}`} color={colors.danger} /> : null}
				{progress.total > 0 ? <Badge label={`☑ ${progress.done}/${progress.total}`} /> : null}
				{task.comments.length > 0 ? <Badge label={`💬 ${task.comments.length}`} /> : null}
				{!task.agentEnabled ? <Badge label='自動実行しない' /> : null}
				{run ? <Badge label={run.status} color={runStatusColor(run.status)} /> : null}
			</View>

			{task.labels.length > 0 ? (
				<View style={styles.taskMetaRow}>
					{task.labels.slice(0, 3).map(l => <Badge key={l} label={l} color={colors.fgMuted} />)}
				</View>
			) : null}
		</Pressable>
	);
};

const TaskDetail = ({ taskId, onClose }: { taskId: string; onClose: () => void }) => {
	const { snapshot, invalidate, client } = useApp();
	const [comment, setComment] = useState('');
	const [checklistText, setChecklistText] = useState('');
	const [notice, setNotice] = useState<string | null>(null);
	const [titleDraft, setTitleDraft] = useState<string | null>(null);

	const board = snapshot?.kanban.board;
	const task = board?.tasks.find(t => t.id === taskId) ?? null;
	const runtime = snapshot?.kanban.runtime;

	const act = useCallback(async (fn: () => Promise<unknown>, note?: string) => {
		setNotice(null);
		try {
			await fn();
			if (note) setNotice(note);
			invalidate();
		} catch (e) {
			setNotice(e instanceof OrchestraApiError ? e.userMessage : String(e));
		}
	}, [invalidate]);

	if (!task || !board || !client) {
		return (
			<Modal animationType='slide' presentationStyle='pageSheet' onRequestClose={onClose}>
				<Screen>
					<EmptyState title='タスクが見つかりません' detail='IDE 側で削除された可能性があります。' />
					<Button title='閉じる' onPress={onClose} />
				</Screen>
			</Modal>
		);
	}

	const column = board.columns.find(c => c.id === task.columnId);
	const isRunning = runtime?.runningTaskId === task.id;

	return (
		<Modal animationType='slide' presentationStyle='pageSheet' onRequestClose={onClose}>
			<Screen>
				<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
					<View style={styles.modalHeader}>
						<View style={styles.flex}>
							<Muted>{column?.title ?? '—'}</Muted>
							<Title>{oneLine(task.title, 40)}</Title>
						</View>
						<Pressable accessibilityRole='button' onPress={onClose}>
							<Text style={styles.link}>閉じる</Text>
						</Pressable>
					</View>

					<ScrollView contentContainerStyle={styles.content}>
						<Card>
							<SectionTitle>タイトル</SectionTitle>
							<Input
								value={titleDraft ?? task.title}
								onChangeText={setTitleDraft}
								onBlur={() => {
									if (titleDraft !== null && titleDraft.trim() && titleDraft !== task.title) {
										void act(() => client.updateTask(task.id, { title: titleDraft.trim() }), '保存しました');
									}
									setTitleDraft(null);
								}}
								placeholder='タスク名'
							/>

							<SectionTitle>説明</SectionTitle>
							<Body>{task.description || '(説明なし)'}</Body>

							<SectionTitle>優先度</SectionTitle>
							<ChipGroup<KanbanPriority>
								options={KANBAN_PRIORITIES.map(p => ({ value: p, label: priorityLabel(p), color: priorityColor(p) }))}
								value={task.priority}
								onChange={p => void act(() => client.updateTask(task.id, { priority: p }))}
							/>

							<Row style={styles.spread}>
								<Muted>自動実行の対象にする</Muted>
								<Switch
									value={task.agentEnabled}
									onValueChange={v => void act(() => client.updateTask(task.id, { agentEnabled: v }))}
									trackColor={{ true: colors.accent, false: colors.border }}
								/>
							</Row>

							<Muted>期限: {task.dueDate || '未設定'} · 担当: {task.assignee || '未割り当て'}</Muted>
							<Muted>更新: {relativeTime(task.updatedAt)}</Muted>
						</Card>

						<Card>
							<SectionTitle>移動</SectionTitle>
							<View style={styles.chipWrap}>
								{moveTargets(board, task).map(c => (
									<Button
										key={c.id}
										title={c.title}
										variant='secondary'
										onPress={() => void act(() => client.moveTask(task.id, c.id, 0), `${c.title} へ移動しました`)}
									/>
								))}
							</View>
						</Card>

						<Card>
							<SectionTitle right={<Badge label={`${checklistProgress(task).done}/${checklistProgress(task).total}`} />}>
								チェックリスト
							</SectionTitle>
							{task.checklist.length === 0 ? <Muted>項目がありません。</Muted> : null}
							{task.checklist.map(item => (
								<Pressable
									key={item.id}
									accessibilityRole='checkbox'
									accessibilityState={{ checked: item.done }}
									onPress={() => void act(() => client.updateChecklistItem(task.id, item.id, { done: !item.done }))}
									onLongPress={() => void act(() => client.deleteChecklistItem(task.id, item.id), '削除しました')}
									style={styles.checkRow}
								>
									<Text style={styles.checkBox}>{item.done ? '☑' : '☐'}</Text>
									<Text style={[styles.checkText, item.done && styles.checkTextDone]}>{item.text}</Text>
								</Pressable>
							))}
							<Row>
								<Input
									value={checklistText}
									onChangeText={setChecklistText}
									placeholder='項目を追加'
									style={styles.flex}
								/>
								<Button
									title='追加'
									disabled={!checklistText.trim()}
									onPress={() => {
										const text = checklistText.trim();
										setChecklistText('');
										void act(() => client.addChecklistItem(task.id, text));
									}}
								/>
							</Row>
							<Muted>長押しで削除できます。</Muted>
						</Card>

						<Card>
							<SectionTitle>コメント</SectionTitle>
							{task.comments.length === 0 ? <Muted>コメントはまだありません。</Muted> : null}
							{task.comments.map(c => (
								<View key={c.id} style={styles.comment}>
									<Muted>{c.author === 'agent' ? 'エージェント' : 'あなた'} · {relativeTime(c.createdAt)}</Muted>
									<Body>{c.body}</Body>
								</View>
							))}
							<Row>
								<Input value={comment} onChangeText={setComment} placeholder='コメントを書く' style={styles.flex} multiline />
							</Row>
							<Button
								title='コメントする'
								disabled={!comment.trim()}
								onPress={() => {
									const body = comment.trim();
									setComment('');
									void act(() => client.addComment(task.id, body));
								}}
							/>
						</Card>

						{task.runs.length > 0 ? (
							<Card>
								<SectionTitle>実行履歴</SectionTitle>
								{task.runs.map((run, i) => (
									<View key={`${run.startedAt}-${i}`} style={styles.runRow}>
										<Row style={styles.spread}>
											<Badge label={run.status} color={runStatusColor(run.status)} />
											<Muted>{relativeTime(run.startedAt)}</Muted>
										</Row>
										{run.error ? <Text style={styles.errorText}>{run.error}</Text> : null}
										{run.summary ? <Body numberOfLines={6}>{run.summary}</Body> : null}
									</View>
								))}
							</Card>
						) : null}

						<Button
							title={isRunning ? '実行中…' : 'このタスクをエージェントに実行させる'
							}
							disabled={isRunning}
							onPress={() => void act(() => client.runTask(task.id), 'エージェントに投げました')}
						/>
						<Button
							title='タスクを削除'
							variant='danger'
							onPress={() => void act(() => client.deleteTask(task.id), '削除しました').then(onClose)}
						/>

						{notice ? <Text style={styles.notice}>{notice}</Text> : null}
					</ScrollView>
				</KeyboardAvoidingView>
			</Screen>
		</Modal>
	);
};

export const KanbanScreen = () => {
	const { snapshot, error, refresh, isRefreshing, invalidate, client } = useApp();
	const { width } = useWindowDimensions();

	const [filterText, setFilterText] = useState('');
	const [openTaskId, setOpenTaskId] = useState<string | null>(null);
	const [newTaskTitle, setNewTaskTitle] = useState('');
	const [notice, setNotice] = useState<string | null>(null);

	const board = snapshot?.kanban.board ?? null;
	const runtime = snapshot?.kanban.runtime ?? null;

	const views = useMemo(
		() => (board ? buildColumnViews(board, { text: filterText }) : []),
		[board, filterText],
	);
	const summary = useMemo(() => (board ? boardSummary(board) : null), [board]);

	const act = useCallback(async (fn: () => Promise<unknown>, note?: string) => {
		setNotice(null);
		try {
			await fn();
			if (note) setNotice(note);
			invalidate();
		} catch (e) {
			setNotice(e instanceof OrchestraApiError ? e.userMessage : String(e));
		}
	}, [invalidate]);

	if (!snapshot || !client || !board || !runtime || !summary) {
		return (
			<Screen>
				{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
				<Loading label='ボードを読み込んでいます…' />
			</Screen>
		);
	}

	// 画面幅に対して少し狭くして、隣のカラムの端が見えるようにする (横に続くと分かる)。
	const columnWidth = Math.min(320, Math.max(240, width * 0.82));
	const todoColumnId = columnWithRole(board, 'todo')?.id;

	return (
		<Screen>
			{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

			<View style={styles.boardHeader}>
				<Row style={styles.spread}>
					<View style={styles.flex}>
						<Title>{board.title}</Title>
						<Muted>
							{summary.total} 件 · 完了 {summary.done} · 停滞 {summary.blocked} · 期限超過 {summary.overdue}
						</Muted>
					</View>
					<View style={styles.autoRun}>
						<Muted>自動実行</Muted>
						<Switch
							value={runtime.autoRunEnabled}
							onValueChange={v => void act(() => client.setAutoRun(v), v ? '自動実行を開始しました' : '自動実行を停止しました')}
							trackColor={{ true: colors.accent, false: colors.border }}
						/>
					</View>
				</Row>

				<Row>
					<Input
						value={filterText}
						onChangeText={setFilterText}
						placeholder='タスクを検索'
						style={styles.flex}
						autoCapitalize='none'
					/>
					{runtime.isRunning
						? <Button title='中断' variant='danger' onPress={() => void act(() => client.cancelKanbanRun(), '中断しました')} />
						: <Button title='今すぐ実行' variant='secondary' onPress={() => void act(() => client.runPendingTasks(), '実行を開始しました')} />}
				</Row>

				{runtime.awaitingApproval ? (
					<Text style={styles.warnText}>エージェントがツールの承認待ちです。「リモート」タブから承認してください。</Text>
				) : null}
				{runtime.lastError ? <Text style={styles.errorText}>{runtime.lastError}</Text> : null}
			</View>

			<ScrollView
				horizontal
				pagingEnabled={false}
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.boardScroll}
				refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
			>
				{views.map(view => (
					<View key={view.column.id} style={[styles.column, { width: columnWidth }]}>
						<Row style={styles.spread}>
							<Row>
								<View style={[styles.columnDot, { backgroundColor: view.column.color || colors.fgFaint }]} />
								<Text style={styles.columnTitle}>{view.column.title}</Text>
							</Row>
							<Muted>
								{view.tasks.length === view.totalCount ? `${view.totalCount}` : `${view.tasks.length}/${view.totalCount}`}
								{view.column.wipLimit > 0 ? ` / 上限 ${view.column.wipLimit}` : ''}
							</Muted>
						</Row>
						{view.overWipLimit ? <Text style={styles.warnText}>WIP 上限を超えています。</Text> : null}

						<Divider />

						<ScrollView contentContainerStyle={styles.columnScroll} showsVerticalScrollIndicator={false}>
							{view.tasks.length === 0
								? <EmptyState title='タスクなし' />
								: view.tasks.map(task => (
									<TaskCard
										key={task.id}
										task={task}
										isRunning={runtime.runningTaskId === task.id}
										onPress={() => setOpenTaskId(task.id)}
									/>
								))}
						</ScrollView>
					</View>
				))}
			</ScrollView>

			<View style={styles.composer}>
				<Row>
					<Input
						value={newTaskTitle}
						onChangeText={setNewTaskTitle}
						placeholder='タスクを追加 (To Do に入ります)'
						style={styles.flex}
					/>
					<Button
						title='追加'
						disabled={!newTaskTitle.trim()}
						onPress={() => {
							const title = newTaskTitle.trim();
							setNewTaskTitle('');
							void act(() => client.createTask({ title, columnId: todoColumnId }), '追加しました');
						}}
					/>
				</Row>
				{notice ? <Text style={styles.notice}>{notice}</Text> : null}
			</View>

			{openTaskId ? <TaskDetail taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	spread: { justifyContent: 'space-between' },
	boardHeader: {
		padding: spacing.md,
		gap: spacing.sm,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	autoRun: {
		alignItems: 'center',
		gap: 2,
	},
	boardScroll: {
		padding: spacing.md,
		gap: spacing.md,
	},
	column: {
		backgroundColor: colors.bgElevated,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.md,
		padding: spacing.sm,
		maxHeight: '100%',
	},
	columnScroll: {
		gap: spacing.sm,
		paddingBottom: spacing.md,
	},
	columnDot: {
		width: 10,
		height: 10,
		borderRadius: 5,
	},
	columnTitle: {
		color: colors.fg,
		fontSize: fontSize.md,
		fontWeight: '600',
	},
	taskCard: {
		backgroundColor: colors.bg,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.sm,
		padding: spacing.sm,
		gap: spacing.xs,
	},
	taskCardRunning: {
		borderColor: colors.running,
	},
	priorityBar: {
		width: 3,
		alignSelf: 'stretch',
		borderRadius: 2,
		marginRight: spacing.xs,
	},
	taskTitle: {
		color: colors.fg,
		fontSize: fontSize.sm,
		fontWeight: '600',
	},
	taskMetaRow: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
	},
	composer: {
		borderTopWidth: 1,
		borderTopColor: colors.border,
		padding: spacing.md,
		gap: spacing.xs,
		backgroundColor: colors.bg,
	},
	modalHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		padding: spacing.lg,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
		gap: spacing.sm,
	},
	content: {
		padding: spacing.md,
		gap: spacing.md,
		paddingBottom: spacing.xl,
	},
	chipWrap: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
	},
	checkRow: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: spacing.sm,
		paddingVertical: spacing.xs,
	},
	checkBox: {
		color: colors.accent,
		fontSize: fontSize.md,
	},
	checkText: {
		color: colors.fg,
		fontSize: fontSize.sm,
		flex: 1,
	},
	checkTextDone: {
		color: colors.fgFaint,
		textDecorationLine: 'line-through',
	},
	comment: {
		borderLeftWidth: 2,
		borderLeftColor: colors.border,
		paddingLeft: spacing.sm,
		gap: 2,
	},
	runRow: {
		gap: spacing.xs,
		borderTopWidth: 1,
		borderTopColor: colors.border,
		paddingTop: spacing.sm,
	},
	link: {
		color: colors.accent,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
	notice: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
		textAlign: 'center',
	},
	warnText: {
		color: colors.warning,
		fontSize: fontSize.xs,
	},
	errorText: {
		color: colors.danger,
		fontSize: fontSize.xs,
	},
});
