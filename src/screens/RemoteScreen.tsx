/**
 * リモートコントロールのタブ。
 *
 * ここでできること:
 *   - エージェントに指示を出す / 中断する
 *   - ツール実行の承認・却下 (無人だと止まったままになるので、外出先から進められる)
 *   - スレッドの切り替え
 *   - よく使うエディタ操作 (保存・ウィンドウ再読み込みなど) をワンタップで実行
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TuningScreen } from './TuningScreen';
import { OrchestraApiError } from '../api/client';
import { ChatMessage } from '../api/types';
import {
	Badge,
	Body,
	Button,
	Card,
	Divider,
	EmptyState,
	ErrorBanner,
	Input,
	Icon,
	IconName,
	Loading,
	Muted,
	Row,
	Screen,
	SectionTitle,
	Sheet,
	useToast,
} from '../components/ui';
import { oneLine, relativeTimeFromIso } from '../lib/format';
import { useApp } from '../state/AppContext';
import { colors, fontSize, radius, spacing } from '../theme';

/** ワンタップで出せるエディタ操作。allowCommands がオフでも通るものを先に置く。 */
const QUICK_COMMANDS: { id: string; label: string; icon: IconName }[] = [
	{ id: 'workbench.action.files.saveAll', label: 'すべて保存', icon: 'save' },
	{ id: 'void.kanban.runNext', label: 'カンバンの次のタスクを実行', icon: 'play' },
	{ id: 'void.kanban.toggleAutoRun', label: 'カンバン自動実行の切替', icon: 'repeat' },
	{ id: 'workbench.action.terminal.new', label: 'ターミナルを開く', icon: 'terminal' },
	{ id: 'workbench.action.reloadWindow', label: 'ウィンドウを再読み込み', icon: 'refresh-cw' },
];

/** ツール出力はログが長くなりがちなので、この行数を超えたら畳んでおく。 */
const COLLAPSED_LINES = 6;
/** 下端からこれ以上離れたら「最新へ」ボタンを出す。 */
const JUMP_THRESHOLD = 240;

const roleStyle = (role: ChatMessage['role']) => {
	switch (role) {
		case 'user': return { backgroundColor: colors.accentSoft, align: 'flex-end' as const, label: 'あなた' };
		case 'assistant': return { backgroundColor: colors.bgElevated, align: 'flex-start' as const, label: 'エージェント' };
		case 'tool': return { backgroundColor: '#161d18', align: 'flex-start' as const, label: 'ツール' };
		case 'interrupted': return { backgroundColor: '#2a1e14', align: 'flex-start' as const, label: '中断' };
		default: return { backgroundColor: '#1a1a22', align: 'flex-start' as const, label: 'システム' };
	}
};

const MessageBubble = ({ message }: { message: ChatMessage }) => {
	const style = roleStyle(message.role);
	const text = message.text || '(内容なし)';
	// 会話の本文は全文、ツールやシステムの出力は長ければ畳む。
	const collapsible = (message.role === 'tool' || message.role === 'system')
		&& (text.split('\n').length > COLLAPSED_LINES || text.length > 400);
	const [expanded, setExpanded] = useState(false);
	const collapsed = collapsible && !expanded;

	return (
		<View style={[styles.bubbleWrap, { alignItems: style.align }]}>
			<View style={[styles.bubble, { backgroundColor: style.backgroundColor }, message.role === 'user' && styles.bubbleUser]}>
				<Text style={styles.bubbleRole}>
					{style.label}{message.toolName ? ` · ${message.toolName}` : ''}
				</Text>
				<Text
					selectable
					style={[styles.bubbleText, (message.role === 'tool' || message.role === 'system') && styles.bubbleTextMono]}
					numberOfLines={collapsed ? COLLAPSED_LINES : undefined}
				>
					{text}
				</Text>
				{collapsible ? (
					<Pressable
						accessibilityRole='button'
						accessibilityState={{ expanded }}
						onPress={() => setExpanded(v => !v)}
						style={styles.expandButton}
					>
						<Text style={styles.link}>{expanded ? '折りたたむ' : '全文を表示'}</Text>
						<Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.accentText} />
					</Pressable>
				) : null}
			</View>
		</View>
	);
};

export const RemoteScreen = () => {
	const { snapshot, error, refresh, isRefreshing, invalidate, client } = useApp();

	const toast = useToast();
	const [draft, setDraft] = useState('');
	const [showCostTuning, setShowCostTuning] = useState(false);
	const [sending, setSending] = useState(false);
	const [showThreads, setShowThreads] = useState(false);
	const [showQuickActions, setShowQuickActions] = useState(false);
	const [showJump, setShowJump] = useState(false);
	const insets = useSafeAreaInsets();
	const followMessages = useRef(true);
	const lastContent = useRef('');
	const scrollRef = useRef<ScrollView | null>(null);

	const chat = snapshot?.chat ?? null;
	const ide = snapshot?.ide ?? null;
	const lastMessage = chat?.messages[chat.messages.length - 1];
	const contentKey = JSON.stringify([chat?.threadId, chat?.messages.length, lastMessage?.text]);
	useEffect(() => { followMessages.current = true; }, [chat?.threadId]);

	const runningLabel = useMemo(() => {
		if (!chat) return '';
		if (chat.awaitingApproval) return 'ツールの承認待ち';
		if (chat.isRunning) return '実行中';
		return '待機中';
	}, [chat]);

	const act = useCallback(async (fn: () => Promise<unknown>, successNote?: string) => {
		try {
			await fn();
			if (successNote) toast.show(successNote, 'success');
			invalidate();
		} catch (e) {
			toast.show(e instanceof OrchestraApiError ? e.userMessage : String(e), 'error');
		}
	}, [invalidate, toast]);

	const scrollToLatest = useCallback(() => {
		followMessages.current = true;
		setShowJump(false);
		scrollRef.current?.scrollToEnd({ animated: true });
	}, []);

	const send = useCallback(async (newThread: boolean) => {
		const message = draft.trim();
		if (!message || !client || sending) return;
		setSending(true);
		try {
			await client.sendPrompt(message, { newThread });
			setDraft('');
			followMessages.current = true;
			setShowJump(false);
			if (newThread) toast.show('新しいスレッドで送信しました', 'success');
			invalidate();
		} catch (e) {
			toast.show(e instanceof OrchestraApiError ? e.userMessage : String(e), 'error');
		} finally {
			setSending(false);
		}
	}, [draft, client, invalidate, sending, toast]);

	if (!snapshot || !client) {
		return (
			<Screen>
				{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}
				<Loading label='IDE の状態を取得しています…' />
			</Screen>
		);
	}

	return (
		<Screen>
			<KeyboardAvoidingView
				style={styles.flex}
				behavior={Platform.OS === 'ios' ? 'padding' : undefined}
				keyboardVerticalOffset={insets.top}
			>
				{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

				<View style={styles.statusBar}>
					<View style={styles.flex}>
						<Text style={styles.workspaceName} numberOfLines={1}>{ide?.workspaceName || '(フォルダ未オープン)'}</Text>
						<Muted numberOfLines={1}>{ide?.appName} {ide?.version}</Muted>
					</View>
					<Badge
						label={runningLabel}
						icon={chat?.awaitingApproval ? 'alert-triangle' : chat?.isRunning ? 'loader' : 'pause-circle'}
						color={chat?.awaitingApproval ? colors.warning : chat?.isRunning ? colors.running : colors.fgFaint}
					/>
				</View>

				{chat?.awaitingApproval ? (
					<View accessibilityRole='alert' style={styles.approvalCard}>
						<Row>
							<Icon name='shield' size={18} color={colors.warning} />
							<Text style={styles.approvalTitle}>ツールの実行が承認待ちです</Text>
						</Row>
						<Muted>内容を確認して、続行するか却下してください。承認するまでエージェントは止まったままです。</Muted>
						<Row>
							<Button title='承認して続行' icon='check' onPress={() => void act(() => client.approveTool(), '承認しました')} style={styles.flex} />
							<Button title='却下' icon='x' variant='secondary' onPress={() => void act(() => client.rejectTool(), '却下しました')} />
						</Row>
					</View>
				) : null}

				{chat?.error ? <ErrorBanner message={chat.error} /> : null}

				<View style={styles.toolbar}>
					<Pressable
						accessibilityRole='button'
						accessibilityState={{ expanded: showThreads }}
						onPress={() => { setShowThreads(v => !v); setShowQuickActions(false); scrollRef.current?.scrollTo({ y: 0, animated: false }); }}
						style={[styles.toolbarButton, showThreads && styles.toolbarButtonActive]}
					>
						<Icon name='list' size={16} color={showThreads ? colors.accentText : colors.fgMuted} />
						<Text style={[styles.toolbarText, showThreads && styles.toolbarTextActive]}>スレッド {snapshot.threads.length}</Text>
						<Icon name={showThreads ? 'chevron-up' : 'chevron-down'} size={14} color={colors.fgFaint} />
					</Pressable>
					<Pressable
						accessibilityRole='button'
						accessibilityState={{ expanded: showQuickActions }}
						onPress={() => { setShowQuickActions(v => !v); setShowThreads(false); scrollRef.current?.scrollTo({ y: 0, animated: false }); }}
						style={[styles.toolbarButton, showQuickActions && styles.toolbarButtonActive]}
					>
						<Icon name='zap' size={16} color={showQuickActions ? colors.accentText : colors.fgMuted} />
						<Text style={[styles.toolbarText, showQuickActions && styles.toolbarTextActive]}>クイック操作</Text>
						<Icon name={showQuickActions ? 'chevron-up' : 'chevron-down'} size={14} color={colors.fgFaint} />
					</Pressable>
				</View>
				<View style={styles.flex}>
					<ScrollView
						ref={scrollRef}
						contentContainerStyle={styles.content}
						keyboardShouldPersistTaps='handled'
						keyboardDismissMode='on-drag'
						refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
						scrollEventThrottle={16}
						onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
							const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
							followMessages.current = distance < 80;
							const nextShowJump = distance > JUMP_THRESHOLD;
							setShowJump(prev => (prev === nextShowJump ? prev : nextShowJump));
						}}
						onContentSizeChange={() => {
							if (lastContent.current === contentKey) return;
							lastContent.current = contentKey;
							if (followMessages.current && !showThreads && !showQuickActions) scrollRef.current?.scrollToEnd({ animated: false });
						}}
					>
						{showThreads ? (
							<View style={styles.threadList}>
								{snapshot.threads.length === 0
									? <Muted>スレッドがありません。</Muted>
									: snapshot.threads.map(t => {
										const active = t.threadId === chat?.threadId;
										return (
											<Pressable
												key={t.threadId}
												accessibilityRole='button'
												onPress={() => {
													setShowThreads(false);
													if (!active) void act(() => client.switchThread(t.threadId), 'スレッドを切り替えました');
												}}
												accessibilityState={{ selected: active }}
												style={({ pressed }) => [styles.threadRow, active && styles.threadRowActive, pressed && { opacity: 0.8 }]}
											>
												<View style={styles.flex}>
													<Body numberOfLines={1}>{oneLine(t.title)}</Body>
													<Muted>{relativeTimeFromIso(t.lastModified)} · {t.messageCount} 件</Muted>
												</View>
												{active ? <Icon name='check' size={18} color={colors.accentText} /> : null}
											</Pressable>
										);
									})}
								<Button
									title='新しいスレッド'
									icon='plus'
									variant='secondary'
									onPress={() => { setShowThreads(false); void act(() => client.newThread(), '新しいスレッドを開きました'); }}
								/>
								<Divider />
							</View>
						) : null}

						{showQuickActions ? (
							<Card>
								<SectionTitle>クイック操作</SectionTitle>
								<View style={styles.quickGrid}>
									{QUICK_COMMANDS.map(cmd => (
										<Pressable
											key={cmd.id}
											accessibilityRole='button'
											onPress={() => {
												setShowQuickActions(false);
												void act(() => client.runCommand(cmd.id), `${cmd.label} を実行しました`);
											}}
											style={({ pressed }) => [styles.quickRow, pressed && { backgroundColor: colors.border }]}
										>
											<Icon name={cmd.icon} size={18} color={colors.accentText} />
											<Text style={styles.quickText}>{cmd.label}</Text>
											<Icon name='chevron-right' size={16} color={colors.fgFaint} />
										</Pressable>
									))}
								</View>
							</Card>
						) : null}
						<View style={styles.conversation}>
							{chat && chat.messages.length > 0
								? chat.messages.map((m, i) => <MessageBubble key={`${i}-${m.role}`} message={m} />)
								: <EmptyState icon='message-circle' title='まだ会話がありません' detail='下の入力欄から指示を送ると、この IDE のエージェントが動き出します。' />}
						</View>
					</ScrollView>

					{showJump && !showThreads && !showQuickActions ? (
						<Pressable accessibilityRole='button' accessibilityLabel='最新のメッセージへ移動' onPress={scrollToLatest} style={styles.jumpButton}>
							<Icon name='arrow-down' size={16} color={colors.fg} />
							<Text style={styles.jumpText}>最新へ</Text>
						</Pressable>
					) : null}
				</View>

				<View style={styles.composer}>
					<View style={styles.composerRow}>
						<Input
							value={draft}
							onChangeText={setDraft}
							placeholder='エージェントへの指示を入力…'
							multiline
							style={styles.composerInput}
						/>
						<Pressable
							accessibilityRole='button'
							accessibilityLabel='送信'
							accessibilityState={{ disabled: !draft.trim() || sending, busy: sending }}
							disabled={!draft.trim() || sending}
							onPress={() => void send(false)}
							style={({ pressed }) => [
								styles.sendButton,
								pressed && { backgroundColor: colors.accentPressed },
								(!draft.trim() || sending) && styles.sendButtonDisabled,
							]}
						>
							{sending ? <ActivityIndicator color='#ffffff' size='small' /> : <Icon name='send' size={20} color='#ffffff' />}
						</Pressable>
					</View>
					<View style={styles.composerActions}>
						<Button
							title='コストを見積もる'
							icon='bar-chart-2'
							variant='ghost'
							size='sm'
							onPress={() => setShowCostTuning(true)}
						/>
						{chat?.isRunning ? (
							<Button
								title='中断'
								icon='square'
								variant='danger'
								size='sm'
								onPress={() => void act(() => client.abortAgent(), '中断しました')}
							/>
						) : (
							<Button
								title='新しいスレッドで送信'
								icon='plus-circle'
								variant='ghost'
								size='sm'
								disabled={sending || !draft.trim()}
								onPress={() => void send(true)}
							/>
						)}
					</View>
				</View>

				{showCostTuning ? (
					<Sheet title='コストを見積もる' eyebrow='入力中の指示' onClose={() => setShowCostTuning(false)}>
						<TuningScreen composerPrompt={draft} />
					</Sheet>
				) : null}
			</KeyboardAvoidingView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	statusBar: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.md,
		paddingBottom: spacing.sm,
	},
	workspaceName: { color: colors.fg, fontSize: fontSize.md, fontWeight: '700' },
	approvalCard: {
		marginHorizontal: spacing.lg,
		marginBottom: spacing.sm,
		padding: spacing.md,
		gap: spacing.sm,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.warning,
		backgroundColor: '#2a2110',
	},
	approvalTitle: { color: colors.fg, fontSize: fontSize.sm, fontWeight: '700', flexShrink: 1 },
	toolbar: {
		flexDirection: 'row',
		gap: spacing.sm,
		paddingHorizontal: spacing.lg,
		paddingBottom: spacing.sm,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	toolbarButton: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs + 2,
		minHeight: 40,
		paddingHorizontal: spacing.md,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
	},
	toolbarButtonActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
	toolbarText: { color: colors.fgMuted, fontSize: fontSize.xs + 1, fontWeight: '600' },
	toolbarTextActive: { color: colors.fg },
	conversation: { gap: spacing.md, flexGrow: 1 },
	flex: { flex: 1 },
	content: {
		flexGrow: 1,
		padding: spacing.lg,
		gap: spacing.lg,
		paddingBottom: spacing.xl,
	},
	bubbleWrap: {
		width: '100%',
		marginBottom: spacing.sm,
	},
	bubble: {
		maxWidth: '92%',
		borderRadius: radius.md,
		padding: spacing.md,
		borderWidth: 1,
		borderColor: colors.border,
		gap: 2,
	},
	bubbleUser: { borderColor: '#2a3f80', borderBottomRightRadius: 4 },
	bubbleRole: {
		color: colors.fgFaint,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
	bubbleText: {
		color: colors.fg,
		fontSize: fontSize.sm,
		lineHeight: 24,
	},
	bubbleTextMono: {
		fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
		fontSize: fontSize.xs + 1,
		lineHeight: 20,
		color: colors.fgMuted,
	},
	expandButton: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		minHeight: 36,
		alignSelf: 'flex-start',
	},
	threadList: {
		gap: spacing.xs,
		marginBottom: spacing.sm,
	},
	threadRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		minHeight: 56,
		padding: spacing.sm + 2,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.border,
	},
	threadRowActive: {
		borderColor: colors.accent,
		backgroundColor: colors.accentSoft,
	},
	quickGrid: {
		gap: 2,
	},
	quickRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		minHeight: 48,
		paddingHorizontal: spacing.sm,
		borderRadius: radius.sm,
	},
	quickText: { color: colors.fg, fontSize: fontSize.sm, flex: 1 },
	jumpButton: {
		position: 'absolute',
		alignSelf: 'center',
		bottom: spacing.md,
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		minHeight: 36,
		paddingHorizontal: spacing.md,
		borderRadius: 18,
		backgroundColor: colors.borderStrong,
		shadowColor: '#000000',
		shadowOpacity: 0.3,
		shadowRadius: 8,
		shadowOffset: { width: 0, height: 3 },
		elevation: 4,
	},
	jumpText: { color: colors.fg, fontSize: fontSize.xs, fontWeight: '600' },
	composer: {
		borderTopWidth: 1,
		borderTopColor: colors.border,
		paddingHorizontal: spacing.md,
		paddingTop: spacing.sm,
		paddingBottom: spacing.xs,
		gap: spacing.xs,
		backgroundColor: colors.bg,
	},
	composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
	composerInput: {
		flex: 1,
		minHeight: 48,
		maxHeight: 140,
	},
	sendButton: {
		width: 48,
		height: 48,
		borderRadius: radius.md,
		backgroundColor: colors.accent,
		alignItems: 'center',
		justifyContent: 'center',
	},
	sendButtonDisabled: { opacity: 0.35 },
	composerActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
	link: {
		color: colors.accentText,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
});
