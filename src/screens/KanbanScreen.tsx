/**
 * カンバンのタブ。
 *
 * IDE の .orchestra/kanban.json をそのまま操作する。スマホでは横スワイプで
 * カラムを送り、カードをタップすると詳細 (チェックリスト・コメント・実行履歴) を開く。
 * ドラッグ&ドロップの代わりに、詳細の「移動」で列を選ばせている。
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
	KeyboardAvoidingView,
	NativeScrollEvent,
	NativeSyntheticEvent,
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
import { KANBAN_PRIORITIES, KanbanColumn, KanbanColumnRole, KanbanPriority, KanbanTask } from '../api/types';
import {
	Badge,
	Body,
	Button,
	Card,
	ChipGroup,
	Divider,
	EmptyState,
	ErrorBanner,
	Icon,
	IconButton,
	Input,
	Loading,
	Muted,
	Row,
	Screen,
	SectionTitle,
	Sheet,
	Title,
	confirmAction,
	useToast,
} from '../components/ui';
import { oneLine, relativeTime } from '../lib/format';
import {
	allLabels,
	boardSummary,
	buildColumnViews,
	checklistProgress,
	columnWithRole,
	isOverdue,
	latestRun,
	moveTargets,
	priorityColor,
	priorityLabel,
	todayString,
} from '../lib/kanban';
import { useApp } from '../state/AppContext';
import { colors, fontSize, radius, spacing } from '../theme';

const COLUMN_ROLES: { value: KanbanColumnRole; label: string }[] = [
	{ value: 'none', label: '指定なし' },
	{ value: 'todo', label: 'To Do' },
	{ value: 'in-progress', label: '進行中' },
	{ value: 'done', label: '完了' },
	{ value: 'error', label: 'エラー' },
];

const runStatusLabel = (status: string): string => {
	switch (status) {
		case 'done': return '完了';
		case 'error': return 'エラー';
		case 'timeout': return 'タイムアウト';
		case 'canceled': return 'キャンセル';
		case 'dry-run': return '試行';
		default: return status;
	}
};

/** 画面ごとに同じ書き方をしていた「実行 → 結果をトースト → 取り直し」をまとめる。 */
const useAction = () => {
	const { invalidate } = useApp();
	const toast = useToast();
	return useCallback(async (fn: () => Promise<unknown>, note?: string): Promise<boolean> => {
		try {
			await fn();
			if (note) toast.show(note, 'success');
			invalidate();
			return true;
		} catch (e) {
			toast.show(e instanceof OrchestraApiError ? e.userMessage : String(e), 'error');
			return false;
		}
	}, [invalidate, toast]);
};

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
		<Pressable
			accessibilityRole='button'
			accessibilityLabel={`${task.title}、優先度 ${priorityLabel(task.priority)}${overdue ? '、期限切れ' : ''}`}
			accessibilityHint='タップで詳細を開きます'
			onPress={onPress}
			style={({ pressed }) => [
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
				{isRunning ? <Badge label='実行中' icon='loader' color={colors.running} /> : null}
				{task.dueDate ? (
					<Badge
						label={overdue ? `期限切れ ${task.dueDate}` : task.dueDate}
						icon='calendar'
						color={overdue ? colors.danger : colors.fgMuted}
					/>
				) : null}
				{progress.total > 0 ? (
					<Badge
						label={`${progress.done}/${progress.total}`}
						icon='check-square'
						color={progress.done === progress.total ? colors.success : colors.fgFaint}
					/>
				) : null}
				{task.comments.length > 0 ? <Badge label={`${task.comments.length}`} icon='message-circle' /> : null}
				{task.assignee ? <Badge label={task.assignee} icon='user' /> : null}
				{!task.agentEnabled ? <Badge label='自動実行しない' icon='slash' /> : null}
				{run ? <Badge label={runStatusLabel(run.status)} color={runStatusColor(run.status)} /> : null}
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
	const { snapshot, client } = useApp();
	const act = useAction();
	const [comment, setComment] = useState('');
	const [checklistText, setChecklistText] = useState('');
	const [titleDraft, setTitleDraft] = useState<string | null>(null);
	const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
	const [labelsDraft, setLabelsDraft] = useState<string | null>(null);
	const [dueDraft, setDueDraft] = useState<string | null>(null);
	const [assigneeDraft, setAssigneeDraft] = useState<string | null>(null);

	const board = snapshot?.kanban.board;
	const task = board?.tasks.find(t => t.id === taskId) ?? null;
	const runtime = snapshot?.kanban.runtime;

	if (!task || !board || !client) {
		return (
			<Sheet title='タスク' onClose={onClose}>
				<EmptyState icon='alert-circle' title='タスクが見つかりません' detail='IDE 側で削除された可能性があります。' action={<Button title='閉じる' variant='secondary' onPress={onClose} />} />
			</Sheet>
		);
	}

	const column = board.columns.find(c => c.id === task.columnId);
	const isRunning = runtime?.runningTaskId === task.id;
	const progress = checklistProgress(task);

	const addChecklist = () => {
		const text = checklistText.trim();
		if (!text) return;
		setChecklistText('');
		void act(() => client.addChecklistItem(task.id, text));
	};

	const removeTask = async () => {
		const ok = await confirmAction({
			title: 'タスクを削除しますか？',
			message: `「${oneLine(task.title, 40)}」を削除します。チェックリストやコメントも消え、元に戻せません。`,
			confirmLabel: '削除',
			destructive: true,
		});
		if (!ok) return;
		if (await act(() => client.deleteTask(task.id), 'タスクを削除しました')) onClose();
	};

	return (
		<Sheet title={oneLine(task.title, 60)} eyebrow={column?.title ?? '—'} onClose={onClose}>
			<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
				<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
					<Card>
						<Button
							title={isRunning ? 'エージェントが実行中…' : 'エージェントに実行させる'}
							icon='play'
							disabled={isRunning}
							onPress={() => void act(() => client.runTask(task.id), 'エージェントに投げました')}
						/>
						<Muted>移動先</Muted>
						<View style={styles.chipWrap}>
							{moveTargets(board, task).map(c => (
								<Pressable
									key={c.id}
									accessibilityRole='button'
									accessibilityLabel={`${c.title} へ移動`}
									onPress={() => void act(() => client.moveTask(task.id, c.id, 0), `${c.title} へ移動しました`)}
									style={({ pressed }) => [styles.moveChip, pressed && { backgroundColor: colors.border }]}
								>
									<View style={[styles.columnDot, { backgroundColor: c.color || colors.fgFaint }]} />
									<Text style={styles.moveChipText}>{c.title}</Text>
									<Icon name='arrow-right' size={14} color={colors.fgFaint} />
								</Pressable>
							))}
						</View>
					</Card>

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
						<Input
							value={descriptionDraft ?? task.description}
							onChangeText={setDescriptionDraft}
							onBlur={() => {
								if (descriptionDraft !== null && descriptionDraft !== task.description) {
									void act(() => client.updateTask(task.id, { description: descriptionDraft }), '保存しました');
								}
								setDescriptionDraft(null);
							}}
							placeholder='このタスクで何をするか'
							multiline
						/>

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

						<SectionTitle>ラベル</SectionTitle>
						<Input
							value={labelsDraft ?? task.labels.join(', ')}
							onChangeText={setLabelsDraft}
							onBlur={() => {
								if (labelsDraft !== null) {
									const labels = labelsDraft.split(',').map(l => l.trim()).filter(Boolean);
									if (labels.join('\u0000') !== task.labels.join('\u0000')) {
										void act(() => client.updateTask(task.id, { labels }), '保存しました');
									}
								}
								setLabelsDraft(null);
							}}
							placeholder='カンマ区切り (例: bug, ui)'
							autoCapitalize='none'
						/>

						<Row>
							<View style={styles.flex}>
								<Muted>期限 (YYYY-MM-DD)</Muted>
								<Input
									value={dueDraft ?? task.dueDate}
									onChangeText={setDueDraft}
									onBlur={() => {
										if (dueDraft !== null && dueDraft.trim() !== task.dueDate) {
											void act(() => client.updateTask(task.id, { dueDate: dueDraft.trim() }), '保存しました');
										}
										setDueDraft(null);
									}}
									placeholder='未設定'
									autoCapitalize='none'
								/>
							</View>
							<View style={styles.flex}>
								<Muted>担当</Muted>
								<Input
									value={assigneeDraft ?? task.assignee}
									onChangeText={setAssigneeDraft}
									onBlur={() => {
										if (assigneeDraft !== null && assigneeDraft.trim() !== task.assignee) {
											void act(() => client.updateTask(task.id, { assignee: assigneeDraft.trim() }), '保存しました');
										}
										setAssigneeDraft(null);
									}}
									placeholder='未割り当て'
									autoCapitalize='none'
								/>
							</View>
						</Row>
						<Row>
							<Button
								title='今日を期限にする'
								variant='ghost'
								onPress={() => void act(() => client.updateTask(task.id, { dueDate: todayString() }), '期限を今日にしました')}
							/>
							{task.dueDate ? (
								<Button
									title='期限を外す'
									variant='ghost'
									onPress={() => void act(() => client.updateTask(task.id, { dueDate: '' }), '期限を外しました')}
								/>
							) : null}
						</Row>

						<Muted>更新: {relativeTime(task.updatedAt)} · 入力欄から離れると自動で保存されます</Muted>
					</Card>

					<Card>
						<SectionTitle right={<Badge label={`${progress.done}/${progress.total}`} color={progress.total > 0 && progress.done === progress.total ? colors.success : colors.fgFaint} />}>
							チェックリスト
						</SectionTitle>
						{progress.total > 0 ? (
							<View style={styles.progressTrack}>
								<View style={[styles.progressFill, { width: `${Math.round((progress.done / progress.total) * 100)}%` }]} />
							</View>
						) : null}
						{task.checklist.length === 0 ? <Muted>項目がありません。</Muted> : null}
						{task.checklist.map(item => (
							<View key={item.id} style={styles.checkRow}>
								<Pressable
									accessibilityRole='checkbox'
									accessibilityState={{ checked: item.done }}
									accessibilityLabel={item.text}
									onPress={() => void act(() => client.updateChecklistItem(task.id, item.id, { done: !item.done }))}
									onLongPress={() => void act(() => client.deleteChecklistItem(task.id, item.id), '項目を削除しました')}
									style={styles.checkMain}
								>
									<Icon name={item.done ? 'check-square' : 'square'} size={20} color={item.done ? colors.success : colors.fgMuted} />
									<Text style={[styles.checkText, item.done && styles.checkTextDone]}>{item.text}</Text>
								</Pressable>
								<IconButton
									icon='x'
									color={colors.fgFaint}
									accessibilityLabel={`${item.text} を削除`}
									onPress={() => void act(() => client.deleteChecklistItem(task.id, item.id), '項目を削除しました')}
								/>
							</View>
						))}
						<Row>
							<Input
								value={checklistText}
								onChangeText={setChecklistText}
								placeholder='項目を追加'
								returnKeyType='done'
								onSubmitEditing={addChecklist}
								blurOnSubmit={false}
								style={styles.flex}
							/>
							<Button title='追加' icon='plus' disabled={!checklistText.trim()} onPress={addChecklist} />
						</Row>
					</Card>

					<Card>
						<SectionTitle>コメント</SectionTitle>
						{task.comments.length === 0 ? <Muted>コメントはまだありません。</Muted> : null}
						{task.comments.map(c => (
							<View key={c.id} style={[styles.comment, c.author === 'agent' && styles.commentAgent]}>
								<Muted>{c.author === 'agent' ? 'エージェント' : 'あなた'} · {relativeTime(c.createdAt)}</Muted>
								<Body>{c.body}</Body>
							</View>
						))}
						<Row>
							<Input value={comment} onChangeText={setComment} placeholder='コメントを書く' style={styles.flex} multiline />
						</Row>
						<Button
							title='コメントする'
							icon='message-circle'
							variant='secondary'
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
										<Badge label={runStatusLabel(run.status)} color={runStatusColor(run.status)} />
										<Muted>{relativeTime(run.startedAt)}</Muted>
									</Row>
									{run.error ? <Text style={styles.errorText}>{run.error}</Text> : null}
									{run.summary ? <Body numberOfLines={6}>{run.summary}</Body> : null}
								</View>
							))}
						</Card>
					) : null}

					<Button title='タスクを削除' icon='trash-2' variant='ghost' onPress={() => void removeTask()} style={styles.dangerGhost} />
				</ScrollView>
			</KeyboardAvoidingView>
		</Sheet>
	);
};

const ColumnRow = ({
	column,
	taskCount,
	otherColumns,
	onPatch,
	onDelete,
}: {
	column: KanbanColumn;
	taskCount: number;
	otherColumns: KanbanColumn[];
	onPatch: (patch: Partial<KanbanColumn>) => void;
	onDelete: (moveTasksTo?: string) => void;
}) => {
	const [title, setTitle] = useState<string | null>(null);
	const [wip, setWip] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	return (
		<View style={styles.columnEditor}>
			<Row>
				<View style={[styles.columnDot, { backgroundColor: column.color || colors.fgFaint }]} />
				<Input
					value={title ?? column.title}
					onChangeText={setTitle}
					onBlur={() => {
						if (title !== null && title.trim() && title !== column.title) onPatch({ title: title.trim() });
						setTitle(null);
					}}
					placeholder='カラム名'
					style={styles.flex}
				/>
			</Row>

			<Muted>役割 (自動実行がどの列を見るかを決めます)</Muted>
			<ChipGroup<KanbanColumnRole>
				options={COLUMN_ROLES}
				value={column.role}
				onChange={role => onPatch({ role })}
			/>

			<Row>
				<View style={styles.flex}>
					<Muted>WIP 上限 (0 で無制限)</Muted>
					<Input
						value={wip ?? String(column.wipLimit)}
						onChangeText={setWip}
						onBlur={() => {
							if (wip !== null) {
								const next = Number(wip);
								if (Number.isInteger(next) && next >= 0 && next !== column.wipLimit) onPatch({ wipLimit: next });
							}
							setWip(null);
						}}
						keyboardType='numeric'
						accessibilityLabel={`${column.title} の WIP 上限`}
					/>
				</View>
				<View style={styles.flex}>
					<Muted>タスク数</Muted>
					<Body>{taskCount} 件</Body>
				</View>
			</Row>

			{confirmDelete ? (
				<View style={styles.deleteBox}>
					<Muted>
						{taskCount > 0
							? 'このカラムのタスクをどこへ移しますか？'
							: 'このカラムを削除します。'}
					</Muted>
					{taskCount > 0 ? (
						<View style={styles.chipWrap}>
							{otherColumns.map(c => (
								<Button key={c.id} title={`${c.title} へ移す`} variant='secondary' onPress={() => onDelete(c.id)} />
							))}
						</View>
					) : (
						<Button title='削除する' variant='danger' onPress={() => onDelete()} />
					)}
					<Button title='やめる' variant='ghost' onPress={() => setConfirmDelete(false)} />
				</View>
			) : (
				<Button title='このカラムを削除' variant='ghost' onPress={() => setConfirmDelete(true)} />
			)}
		</View>
	);
};

/** ボードそのものの設定 (タイトル・カラム構成)。カードではなく列を触りたいとき用。 */
const BoardSettings = ({ onClose }: { onClose: () => void }) => {
	const { snapshot, client } = useApp();
	const act = useAction();
	const [boardTitle, setBoardTitle] = useState<string | null>(null);
	const [newColumn, setNewColumn] = useState('');

	const board = snapshot?.kanban.board;
	const runtime = snapshot?.kanban.runtime;

	if (!board || !client) return null;

	const addColumn = () => {
		const title = newColumn.trim();
		if (!title) return;
		setNewColumn('');
		void act(() => client.addColumn(title), 'カラムを追加しました');
	};

	return (
		<Sheet title='ボードの設定' onClose={onClose}>
			<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps='handled'>
				<Card>
					<SectionTitle>ボード名</SectionTitle>
					<Input
						value={boardTitle ?? board.title}
						onChangeText={setBoardTitle}
						onBlur={() => {
							if (boardTitle !== null && boardTitle.trim() && boardTitle !== board.title) {
								void act(() => client.setBoardTitle(boardTitle.trim()), '保存しました');
							}
							setBoardTitle(null);
						}}
						placeholder='ボード名'
					/>
					<Muted>
						{runtime?.source.kind === 'file' ? `保存先: ${runtime.source.path}` : '保存先: IDE 内のストレージ'}
					</Muted>
					<Button
						title='ファイルから読み直す'
						variant='secondary'
						onPress={() => void act(() => client.reloadKanban(), '読み直しました')}
					/>
				</Card>

				<Card>
					<SectionTitle right={<Badge label={`${board.columns.length} 列`} />}>カラム</SectionTitle>
					{board.columns.map(column => (
						<ColumnRow
							key={column.id}
							column={column}
							taskCount={board.tasks.filter(t => t.columnId === column.id).length}
							otherColumns={board.columns.filter(c => c.id !== column.id)}
							onPatch={patch => void act(() => client.updateColumn(column.id, patch), '保存しました')}
							onDelete={moveTasksTo => void act(() => client.deleteColumn(column.id, moveTasksTo), 'カラムを削除しました')}
						/>
					))}
				</Card>

				<Card>
					<SectionTitle>カラムを追加</SectionTitle>
					<Row>
						<Input
							value={newColumn}
							onChangeText={setNewColumn}
							placeholder='カラム名'
							returnKeyType='done'
							onSubmitEditing={addColumn}
							style={styles.flex}
						/>
						<Button title='追加' icon='plus' disabled={!newColumn.trim()} onPress={addColumn} />
					</Row>
				</Card>
			</ScrollView>
		</Sheet>
	);
};

export const KanbanScreen = () => {
	const { snapshot, error, refresh, isRefreshing, client } = useApp();
	const act = useAction();
	const { width } = useWindowDimensions();
	const boardRef = useRef<ScrollView | null>(null);

	const [filterText, setFilterText] = useState('');
	const [openTaskId, setOpenTaskId] = useState<string | null>(null);
	const [newTaskTitle, setNewTaskTitle] = useState('');
	const [activeColumn, setActiveColumn] = useState(0);
	const [showFilters, setShowFilters] = useState(false);
	const [showSettings, setShowSettings] = useState(false);
	const [priorityFilter, setPriorityFilter] = useState<KanbanPriority[]>([]);
	const [labelFilter, setLabelFilter] = useState<string[]>([]);
	const [overdueOnly, setOverdueOnly] = useState(false);

	const board = snapshot?.kanban.board ?? null;
	const runtime = snapshot?.kanban.runtime ?? null;

	const views = useMemo(
		() => (board
			? buildColumnViews(board, {
				text: filterText,
				priorities: priorityFilter.length ? priorityFilter : undefined,
				labels: labelFilter.length ? labelFilter : undefined,
				overdueOnly,
			})
			: []),
		[board, filterText, priorityFilter, labelFilter, overdueOnly],
	);
	const summary = useMemo(() => (board ? boardSummary(board) : null), [board]);
	const labels = useMemo(() => (board ? allLabels(board) : []), [board]);
	const filterCount = priorityFilter.length + labelFilter.length + (overdueOnly ? 1 : 0);

	/** チップは複数選べるようにしたいので、ChipGroup ではなく自前で ON/OFF する。 */
	const toggleIn = <T,>(list: T[], value: T): T[] =>
		list.includes(value) ? list.filter(v => v !== value) : [...list, value];

	// 画面幅に対して少し狭くして、隣のカラムの端が見えるようにする (横に続くと分かる)。
	const columnWidth = Math.min(320, Math.max(240, width * 0.82));
	const columnStride = columnWidth + spacing.md;

	const onBoardScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
		const index = Math.round(e.nativeEvent.contentOffset.x / columnStride);
		setActiveColumn(prev => (prev === index ? prev : index));
	}, [columnStride]);

	const jumpToColumn = useCallback((index: number) => {
		setActiveColumn(index);
		boardRef.current?.scrollTo({ x: index * columnStride, animated: true });
	}, [columnStride]);

	if (!snapshot || !client || !board || !runtime || !summary) {
		return (
			<Screen>
				{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
				<Loading label='ボードを読み込んでいます…' />
			</Screen>
		);
	}

	const todoColumn = columnWithRole(board, 'todo');

	const addTask = () => {
		const title = newTaskTitle.trim();
		if (!title) return;
		setNewTaskTitle('');
		void act(() => client.createTask({ title, columnId: todoColumn?.id }), `${todoColumn?.title ?? 'ボード'} に追加しました`);
	};

	return (
		<Screen>
			{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

			<View style={styles.boardHeader}>
				<Row style={styles.spread}>
					<View style={styles.flex}>
						<Title>{board.title}</Title>
						<Muted numberOfLines={1}>
							{summary.total} 件 · 完了 {summary.done}
							{summary.blocked > 0 ? ` · 停滞 ${summary.blocked}` : ''}
							{summary.overdue > 0 ? ` · 期限切れ ${summary.overdue}` : ''}
						</Muted>
					</View>
					<IconButton icon='settings' accessibilityLabel='ボードの設定' onPress={() => setShowSettings(true)} />
				</Row>

				<View style={styles.runBar}>
					<Icon name='repeat' size={16} color={runtime.autoRunEnabled ? colors.accentText : colors.fgFaint} />
					<Text style={styles.runBarLabel}>自動実行</Text>
					<Switch
						value={runtime.autoRunEnabled}
						onValueChange={v => void act(() => client.setAutoRun(v), v ? '自動実行を開始しました' : '自動実行を停止しました')}
						trackColor={{ true: colors.accent, false: colors.border }}
						accessibilityLabel='自動実行'
					/>
					<View style={styles.flex} />
					{runtime.isRunning
						? <Button title='中断' icon='square' size='sm' variant='danger' onPress={() => void act(() => client.cancelKanbanRun(), '中断しました')} />
						: <Button title='今すぐ実行' icon='play' size='sm' variant='secondary' onPress={() => void act(() => client.runPendingTasks(), '実行を開始しました')} />}
				</View>

				<Row>
					<Input
						value={filterText}
						onChangeText={setFilterText}
						placeholder='タスクを検索'
						style={styles.flex}
						autoCapitalize='none'
						returnKeyType='search'
						clearButtonMode='while-editing'
					/>
					<IconButton
						icon='filter'
						accessibilityLabel='絞り込み'
						active={showFilters || filterCount > 0}
						badge={filterCount}
						onPress={() => setShowFilters(v => !v)}
					/>
				</Row>

				{showFilters ? (
					<View style={styles.filterPanel}>
						<Muted>優先度</Muted>
						<View style={styles.chipWrap}>
							{KANBAN_PRIORITIES.map(p => {
								const selected = priorityFilter.includes(p);
								return (
									<Pressable
										key={p}
										accessibilityRole='button'
										accessibilityState={{ selected }}
										onPress={() => setPriorityFilter(prev => toggleIn(prev, p))}
										style={[styles.filterChip, selected && { borderColor: priorityColor(p), backgroundColor: `${priorityColor(p)}22` }]}
									>
										<Text style={[styles.filterChipText, selected && { color: colors.fg }]}>{priorityLabel(p)}</Text>
									</Pressable>
								);
							})}
						</View>

						{labels.length > 0 ? (
							<>
								<Muted>ラベル</Muted>
								<View style={styles.chipWrap}>
									{labels.map(label => {
										const selected = labelFilter.includes(label);
										return (
											<Pressable
												key={label}
												accessibilityRole='button'
												accessibilityState={{ selected }}
												onPress={() => setLabelFilter(prev => toggleIn(prev, label))}
												style={[styles.filterChip, selected && styles.filterChipOn]}
											>
												<Text style={[styles.filterChipText, selected && { color: colors.fg }]}>{label}</Text>
											</Pressable>
										);
									})}
								</View>
							</>
						) : null}

						<Row style={styles.spread}>
							<Muted>期限切れだけ表示</Muted>
							<Switch
								value={overdueOnly}
								onValueChange={setOverdueOnly}
								trackColor={{ true: colors.accent, false: colors.border }}
							/>
						</Row>
						{filterCount > 0 ? (
							<Button
								title='絞り込みを解除'
								variant='ghost'
								onPress={() => { setPriorityFilter([]); setLabelFilter([]); setOverdueOnly(false); }}
							/>
						) : null}
					</View>
				) : null}

				{runtime.awaitingApproval ? (
					<ErrorBanner tone='warning' message='エージェントがツールの承認待ちです。「リモート」タブから承認してください。' style={styles.inlineBanner} />
				) : null}
				{runtime.lastError ? <ErrorBanner message={runtime.lastError} style={styles.inlineBanner} /> : null}
			</View>

			{views.length > 1 ? (
				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					contentContainerStyle={styles.columnTabs}
					style={styles.columnTabsBar}
				>
					{views.map((view, index) => {
						const selected = index === activeColumn;
						return (
							<Pressable
								key={view.column.id}
								accessibilityRole='tab'
								accessibilityState={{ selected }}
								accessibilityLabel={`${view.column.title}、${view.tasks.length} 件`}
								onPress={() => jumpToColumn(index)}
								style={[styles.columnTab, selected && styles.columnTabActive]}
							>
								<View style={[styles.columnDot, { backgroundColor: view.column.color || colors.fgFaint }]} />
								<Text style={[styles.columnTabText, selected && styles.columnTabTextActive]} numberOfLines={1}>{view.column.title}</Text>
								<Text style={[styles.columnTabCount, view.overWipLimit && { color: colors.warning }]}>{view.tasks.length}</Text>
							</Pressable>
						);
					})}
				</ScrollView>
			) : null}

			<ScrollView
				ref={boardRef}
				horizontal
				pagingEnabled={false}
				snapToInterval={columnStride}
				snapToAlignment='start'
				decelerationRate='fast'
				disableIntervalMomentum
				showsHorizontalScrollIndicator={false}
				scrollEventThrottle={32}
				onScroll={onBoardScroll}
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
						{view.overWipLimit ? <Badge label='WIP 上限を超えています' icon='alert-triangle' color={colors.warning} /> : null}

						<Divider />

						<ScrollView nestedScrollEnabled contentContainerStyle={styles.columnScroll} showsVerticalScrollIndicator={false}>
							{view.tasks.length === 0
								? <EmptyState icon={view.totalCount > 0 ? 'filter' : 'inbox'} title={view.totalCount > 0 ? '条件に合うタスクなし' : 'タスクなし'} />
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
						placeholder={`タスクを追加 (${todoColumn?.title ?? 'To Do'} に入ります)`}
						returnKeyType='done'
						onSubmitEditing={addTask}
						blurOnSubmit={false}
						style={styles.flex}
					/>
					<Button title='追加' icon='plus' disabled={!newTaskTitle.trim()} onPress={addTask} />
				</Row>
			</View>

			{openTaskId ? <TaskDetail taskId={openTaskId} onClose={() => setOpenTaskId(null)} /> : null}
			{showSettings ? <BoardSettings onClose={() => setShowSettings(false)} /> : null}
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
	runBar: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		paddingLeft: spacing.md,
		paddingRight: spacing.xs,
		paddingVertical: spacing.xs,
		minHeight: 52,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
	},
	runBarLabel: { color: colors.fg, fontSize: fontSize.xs + 1, fontWeight: '600' },
	inlineBanner: { margin: 0 },
	columnTabsBar: { flexGrow: 0, flexShrink: 0 },
	columnTabs: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 2, gap: spacing.xs, alignItems: 'center' },
	columnTab: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs + 2,
		minHeight: 36,
		maxWidth: 200,
		paddingHorizontal: spacing.md,
		borderRadius: 18,
		borderWidth: 1,
		borderColor: colors.border,
	},
	columnTabActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
	columnTabText: { color: colors.fgMuted, fontSize: fontSize.xs, fontWeight: '600', flexShrink: 1 },
	columnTabTextActive: { color: colors.fg },
	columnTabCount: { color: colors.fgFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
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
		padding: spacing.md,
		gap: spacing.sm,
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
		lineHeight: 23,
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
	moveChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs + 2,
		minHeight: 44,
		paddingHorizontal: spacing.md,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.borderStrong,
		backgroundColor: colors.bgInput,
	},
	moveChipText: { color: colors.fg, fontSize: fontSize.xs + 1, fontWeight: '600' },
	progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
	progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.success },
	checkRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
	},
	checkMain: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		minHeight: 44,
	},
	checkText: {
		color: colors.fg,
		fontSize: fontSize.sm,
		lineHeight: 22,
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
	commentAgent: { borderLeftColor: colors.running },
	dangerGhost: { alignSelf: 'center' },
	runRow: {
		gap: spacing.xs,
		borderTopWidth: 1,
		borderTopColor: colors.border,
		paddingTop: spacing.sm,
	},
	warnText: {
		color: colors.warning,
		fontSize: fontSize.xs,
	},
	errorText: {
		color: colors.danger,
		fontSize: fontSize.xs,
	},
	filterPanel: {
		gap: spacing.xs,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.sm,
		padding: spacing.md,
		backgroundColor: colors.bgElevated,
	},
	filterChip: {
		minHeight: 40,
		justifyContent: 'center',
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.lg,
		paddingHorizontal: spacing.md,
	},
	filterChipOn: {
		borderColor: colors.accent,
		backgroundColor: colors.accentSoft,
	},
	filterChipText: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
	columnEditor: {
		gap: spacing.xs,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.sm,
		padding: spacing.md,
	},
	deleteBox: {
		gap: spacing.xs,
		borderWidth: 1,
		borderColor: colors.danger,
		borderRadius: radius.sm,
		padding: spacing.sm,
	},
});

