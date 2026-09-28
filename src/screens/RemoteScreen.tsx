/**
 * リモートコントロールのタブ。
 *
 * ここでできること:
 *   - エージェントに指示を出す / 中断する
 *   - ツール実行の承認・却下 (無人だと止まったままになるので、外出先から進められる)
 *   - スレッドの切り替え
 *   - よく使うエディタ操作 (保存・ウィンドウ再読み込みなど) をワンタップで実行
 *
 * 見た目はデスクトップのエージェント欄 (SidebarChat) に合わせている:
 * 自分の発言は右寄せの吹き出し、エージェントの返答は左端がゴールドのカード、
 * ツールの実行は 1 行の見出しだけ出して、押すと中身を開く。
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
	TextInput,
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
	ErrorBanner,
	Icon,
	IconName,
	Loading,
	Muted,
	Screen,
	SectionTitle,
	Sheet,
	useToast,
} from '../components/ui';
import { oneLine, relativeTimeFromIso } from '../lib/format';
import { useApp } from '../state/AppContext';
import { colors, fontSize, radius, spacing, withAlpha } from '../theme';

/** ワンタップで出せるエディタ操作。allowCommands がオフでも通るものを先に置く。 */
const QUICK_COMMANDS: { id: string; label: string; icon: IconName }[] = [
	{ id: 'workbench.action.files.saveAll', label: 'すべて保存', icon: 'save' },
	{ id: 'void.kanban.runNext', label: 'カンバンの次のタスクを実行', icon: 'play' },
	{ id: 'void.kanban.toggleAutoRun', label: 'カンバン自動実行の切替', icon: 'repeat' },
	{ id: 'workbench.action.terminal.new', label: 'ターミナルを開く', icon: 'terminal' },
	{ id: 'workbench.action.reloadWindow', label: 'ウィンドウを再読み込み', icon: 'refresh-cw' },
];

/** 下端からこれ以上離れたら「最新へ」ボタンを出す。 */
const JUMP_THRESHOLD = 240;
/** 最初の画面に並べる過去のスレッドの数。 */
const PAST_THREADS_ON_LANDING = 5;

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** 自分の発言。デスクトップと同じ右寄せの吹き出し (右上だけ角を小さくする)。 */
const UserMessage = ({ text }: { text: string }) => (
	<View style={styles.userWrap}>
		<View accessibilityLabel={`あなた: ${text}`} style={styles.userBubble}>
			<Text selectable style={styles.userText}>{text}</Text>
		</View>
	</View>
);

/** エージェントの返答。生成中は左端と枠をゴールドで光らせる。 */
const AssistantMessage = ({ text, streaming }: { text: string; streaming: boolean }) => (
	<View style={[styles.assistantCard, streaming && styles.assistantCardStreaming]}>
		<View style={styles.assistantHeader}>
			<Icon name='cpu' size={13} color={streaming ? colors.accentText : colors.fgFaint} />
			<Text style={styles.assistantLabel}>エージェント</Text>
			{streaming ? <ActivityIndicator size='small' color={colors.accentText} /> : null}
		</View>
		<Text selectable style={styles.assistantText}>{text}</Text>
	</View>
);

/** ツールの実行。デスクトップと同じく見出し 1 行で出し、押したときだけ中身を開く。 */
const ToolMessage = ({ name, text }: { name?: string; text: string }) => {
	const [open, setOpen] = useState(false);
	return (
		<View>
			<Pressable
				accessibilityRole='button'
				accessibilityState={{ expanded: open }}
				accessibilityLabel={`ツール ${name ?? ''}。${open ? '閉じる' : '中身を見る'}`}
				onPress={() => setOpen(v => !v)}
				style={styles.toolHeader}
			>
				<Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={colors.fgFaint} />
				<Text style={styles.toolTitle}>ツール</Text>
				{name ? <Text style={styles.toolName} numberOfLines={1}>{name}</Text> : null}
			</Pressable>
			{open ? (
				<View style={styles.toolBody}>
					<Text selectable style={styles.toolText}>{text || '(出力なし)'}</Text>
				</View>
			) : null}
		</View>
	);
};

const ChatMessageView = ({ message, streaming }: { message: ChatMessage; streaming: boolean }) => {
	switch (message.role) {
		case 'user': return <UserMessage text={message.text || '(内容なし)'} />;
		case 'assistant': return <AssistantMessage text={message.text || '(内容なし)'} streaming={streaming} />;
		case 'tool': return <ToolMessage name={message.toolName} text={message.text} />;
		case 'interrupted':
			return (
				<View style={styles.noteRow}>
					<Icon name='slash' size={13} color={colors.fgFaint} />
					<Text style={styles.noteText}>{message.text || '中断しました'}</Text>
				</View>
			);
		case 'checkpoint':
			return (
				<View style={styles.checkpoint}>
					<View style={styles.checkpointLine} />
					<Text style={styles.noteText}>チェックポイント</Text>
					<View style={styles.checkpointLine} />
				</View>
			);
		default:
			return message.text ? <Text style={styles.systemText}>{message.text}</Text> : null;
	}
};

/** 入力欄の下の小さなボタン (デスクトップの ComposerChip)。 */
const ComposerChip = ({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) => (
	<Pressable
		accessibilityRole='button'
		accessibilityState={{ disabled: !!disabled }}
		disabled={disabled}
		onPress={onPress}
		hitSlop={4}
		style={({ pressed }) => [styles.composerChip, pressed && styles.composerChipPressed, disabled && { opacity: 0.4 }]}
	>
		<Icon name={icon} size={14} color={colors.fgFaint} />
		<Text style={styles.composerChipText}>{label}</Text>
	</Pressable>
);

/** 送信・停止の丸ボタン。デスクトップと同じく文字色で塗った丸に地の色のアイコン。 */
const RoundButton = ({ icon, label, onPress, disabled, busy, outline }: {
	icon: IconName;
	label: string;
	onPress: () => void;
	disabled?: boolean;
	busy?: boolean;
	outline?: boolean;
}) => (
	<Pressable
		accessibilityRole='button'
		accessibilityLabel={label}
		accessibilityState={{ disabled: !!disabled, busy: !!busy }}
		disabled={disabled || busy}
		onPress={onPress}
		hitSlop={6}
		style={({ pressed }) => [
			styles.roundButton,
			outline ? styles.roundButtonOutline : disabled ? styles.roundButtonDisabled : styles.roundButtonFilled,
			pressed && { transform: [{ scale: 0.94 }] },
		]}
	>
		{busy
			? <ActivityIndicator size='small' color={colors.bgInput} />
			: <Icon name={icon} size={18} color={outline ? colors.fgMuted : disabled ? colors.fgFaint : colors.bgInput} />}
	</Pressable>
);

export const RemoteScreen = () => {
	const { snapshot, error, refresh, isRefreshing, invalidate, client } = useApp();

	const toast = useToast();
	const [draft, setDraft] = useState('');
	const [showCostTuning, setShowCostTuning] = useState(false);
	const [sending, setSending] = useState(false);
	const [showThreads, setShowThreads] = useState(false);
	const [showQuickActions, setShowQuickActions] = useState(false);
	const [showJump, setShowJump] = useState(false);
	const [composerFocused, setComposerFocused] = useState(false);
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
		if (chat.awaitingApproval) return '確認待ち';
		if (chat.isRunning) return '作業中';
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

	const isRunning = !!chat?.isRunning;
	const isAwaiting = !!chat?.awaitingApproval;
	const hasMessages = !!chat && chat.messages.length > 0;
	const pastThreads = snapshot.threads.filter(t => t.threadId !== chat?.threadId).slice(0, PAST_THREADS_ON_LANDING);
	const canSend = !!draft.trim() && !sending;
	const placeholder = isAwaiting
		? '確認待ちです。上のカードで、どうするか選んでください'
		: isRunning
			? 'エージェントが作業中です…'
			: '例:「シンプルな TODO アプリを作って動かして」「落ちているテストを直して」';

	const switchThread = (threadId: string) => {
		setShowThreads(false);
		if (threadId !== chat?.threadId) void act(() => client.switchThread(threadId), 'スレッドを切り替えました');
	};

	return (
		<Screen>
			<KeyboardAvoidingView
				style={styles.flex}
				behavior={Platform.OS === 'ios' ? 'padding' : undefined}
				keyboardVerticalOffset={insets.top}
			>
				{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

				{/* デスクトップのタイトルバーに当たる帯 */}
				<View style={styles.header}>
					<View style={styles.headerRow}>
						<View style={styles.flex}>
							<Text style={styles.workspaceName} numberOfLines={1}>{ide?.workspaceName || '(フォルダ未オープン)'}</Text>
							<Muted numberOfLines={1}>{ide?.appName} {ide?.version}</Muted>
						</View>
						<Badge
							label={runningLabel}
							icon={isAwaiting ? 'alert-circle' : isRunning ? 'loader' : 'pause-circle'}
							color={isAwaiting ? colors.warning : isRunning ? colors.running : colors.fgFaint}
						/>
					</View>
					<View style={styles.toolbar}>
						<Pressable
							accessibilityRole='button'
							accessibilityState={{ expanded: showThreads }}
							onPress={() => { setShowThreads(v => !v); setShowQuickActions(false); scrollRef.current?.scrollTo({ y: 0, animated: false }); }}
							style={[styles.toolbarButton, showThreads && styles.toolbarButtonActive]}
						>
							<Icon name='clock' size={15} color={showThreads ? colors.fgStrong : colors.fgFaint} />
							<Text style={[styles.toolbarText, showThreads && styles.toolbarTextActive]}>履歴 {snapshot.threads.length}</Text>
						</Pressable>
						<Pressable
							accessibilityRole='button'
							accessibilityState={{ expanded: showQuickActions }}
							onPress={() => { setShowQuickActions(v => !v); setShowThreads(false); scrollRef.current?.scrollTo({ y: 0, animated: false }); }}
							style={[styles.toolbarButton, showQuickActions && styles.toolbarButtonActive]}
						>
							<Icon name='zap' size={15} color={showQuickActions ? colors.fgStrong : colors.fgFaint} />
							<Text style={[styles.toolbarText, showQuickActions && styles.toolbarTextActive]}>クイック操作</Text>
						</Pressable>
						<View style={styles.flex} />
						<Pressable
							accessibilityRole='button'
							accessibilityLabel='新しいチャット'
							onPress={() => void act(() => client.newThread(), '新しいスレッドを開きました')}
							style={({ pressed }) => [styles.toolbarIcon, pressed && styles.toolbarButtonActive]}
						>
							<Icon name='plus' size={18} color={colors.fgMuted} />
						</Pressable>
					</View>
				</View>

				{isAwaiting ? (
					<View accessibilityRole='alert' style={styles.approvalCard}>
						<View style={styles.approvalTitleRow}>
							<View style={styles.awaitingDot} />
							<Text style={styles.approvalTitle}>ツールの実行が確認待ちです</Text>
						</View>
						<Muted>内容を確認して、続行するか取り消してください。承認するまでエージェントは止まったままです。</Muted>
						<View style={styles.approvalButtons}>
							<Button title='承認して続行' icon='check' onPress={() => void act(() => client.approveTool(), '承認しました')} style={styles.flex} />
							<Button title='取り消す' variant='secondary' onPress={() => void act(() => client.rejectTool(), '取り消しました')} />
						</View>
					</View>
				) : null}

				{chat?.error ? <ErrorBanner message={chat.error} /> : null}

				<View style={styles.flex}>
					<ScrollView
						ref={scrollRef}
						contentContainerStyle={styles.content}
						keyboardShouldPersistTaps='handled'
						keyboardDismissMode='on-drag'
						refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor={colors.accentText} />}
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
								<SectionTitle>過去のチャット</SectionTitle>
								{snapshot.threads.length === 0
									? <Muted>スレッドがありません。</Muted>
									: snapshot.threads.map(t => {
										const active = t.threadId === chat?.threadId;
										return (
											<Pressable
												key={t.threadId}
												accessibilityRole='button'
												onPress={() => switchThread(t.threadId)}
												accessibilityState={{ selected: active }}
												style={({ pressed }) => [styles.threadRow, active && styles.threadRowActive, pressed && styles.threadRowPressed]}
											>
												<View style={styles.flex}>
													<Body numberOfLines={1}>{oneLine(t.title)}</Body>
													<Muted>{relativeTimeFromIso(t.lastModified)} · {t.messageCount} 件</Muted>
												</View>
												{active ? <Icon name='check' size={18} color={colors.accentText} /> : null}
											</Pressable>
										);
									})}
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
											style={({ pressed }) => [styles.quickRow, pressed && { backgroundColor: colors.bgHover }]}
										>
											<Icon name={cmd.icon} size={18} color={colors.fgMuted} />
											<Text style={styles.quickText}>{cmd.label}</Text>
											<Icon name='chevron-right' size={16} color={colors.fgFaint} />
										</Pressable>
									))}
								</View>
							</Card>
						) : null}

						{hasMessages ? (
							<View style={styles.conversation}>
								{chat!.messages.map((m, i) => (
									<ChatMessageView
										key={`${i}-${m.role}`}
										message={m}
										streaming={isRunning && m.role === 'assistant' && i === chat!.messages.length - 1}
									/>
								))}
							</View>
						) : (
							// デスクトップのエージェントモードの最初の画面と同じ一言
							<View style={styles.greeting}>
								<View style={styles.greetingTitleRow}>
									<Icon name='cpu' size={20} color={colors.fgMuted} />
									<Text accessibilityRole='header' style={styles.greetingTitle}>エージェントに何をさせますか？</Text>
								</View>
								<Text style={styles.greetingHint}>
									やってほしいことを自分の言葉で書いてください。エージェントがファイル編集・コマンド実行・結果の確認まで自分で進めます。
								</Text>
								{pastThreads.length > 0 && !showThreads ? (
									<View style={styles.pastThreads}>
										<SectionTitle>過去のチャット</SectionTitle>
										{pastThreads.map(t => (
											<Pressable
												key={t.threadId}
												accessibilityRole='button'
												onPress={() => switchThread(t.threadId)}
												style={({ pressed }) => [styles.threadRow, pressed && styles.threadRowPressed]}
											>
												<Icon name='message-square' size={15} color={colors.fgFaint} />
												<View style={styles.flex}>
													<Body numberOfLines={1}>{oneLine(t.title)}</Body>
													<Muted>{relativeTimeFromIso(t.lastModified)} · {t.messageCount} 件</Muted>
												</View>
											</Pressable>
										))}
									</View>
								) : null}
							</View>
						)}
					</ScrollView>

					{showJump && !showThreads && !showQuickActions ? (
						<Pressable accessibilityRole='button' accessibilityLabel='最新のメッセージへ移動' onPress={scrollToLatest} style={styles.jumpButton}>
							<Icon name='arrow-down' size={16} color={colors.fg} />
							<Text style={styles.jumpText}>最新へ</Text>
						</Pressable>
					) : null}
				</View>

				{/* デスクトップの入力欄 (VoidChatArea): 角丸の箱の中に本文、下段に小さなボタンと丸い送信ボタン */}
				<View style={styles.composerWrap}>
					<View style={[styles.composer, composerFocused && styles.composerFocused]}>
						<TextInput
							value={draft}
							onChangeText={setDraft}
							placeholder={placeholder}
							placeholderTextColor={colors.fgFaint}
							selectionColor={colors.accentText}
							accessibilityLabel='エージェントへの指示'
							multiline
							onFocus={() => setComposerFocused(true)}
							onBlur={() => setComposerFocused(false)}
							style={styles.composerInput}
						/>
						<View style={styles.composerBar}>
							<View style={styles.composerChips}>
								<ComposerChip icon='bar-chart-2' label='コスト調整' onPress={() => setShowCostTuning(true)} />
								{!isRunning ? (
									<ComposerChip icon='plus' label='新しいスレッドで送信' disabled={!canSend} onPress={() => void send(true)} />
								) : null}
							</View>
							{isAwaiting ? (
								<View accessibilityRole='text' style={styles.awaitingBadge}>
									<View style={styles.awaitingDot} />
									<Text style={styles.awaitingText}>確認待ち</Text>
								</View>
							) : null}
							{isRunning && !isAwaiting ? (
								<>
									{draft.trim() ? <RoundButton icon='arrow-up' label='送信' outline busy={sending} onPress={() => void send(false)} /> : null}
									<RoundButton icon='square' label='エージェントを止める' onPress={() => void act(() => client.abortAgent(), '中断しました')} />
								</>
							) : null}
							{!isRunning && !isAwaiting ? (
								<RoundButton icon='arrow-up' label='送信' disabled={!canSend} busy={sending} onPress={() => void send(false)} />
							) : null}
						</View>
					</View>
				</View>

				{showCostTuning ? (
					<Sheet title='コスト調整' eyebrow='入力中の指示' onClose={() => setShowCostTuning(false)}>
						<TuningScreen composerPrompt={draft} />
					</Sheet>
				) : null}
			</KeyboardAvoidingView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	header: {
		backgroundColor: colors.bgElevated,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.md,
		paddingBottom: spacing.sm,
		gap: spacing.sm,
	},
	headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	workspaceName: { color: colors.fgStrong, fontSize: fontSize.md, fontWeight: '600' },
	toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
	toolbarButton: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs + 2,
		minHeight: 36,
		paddingHorizontal: spacing.sm + 2,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: 'transparent',
	},
	toolbarButtonActive: { backgroundColor: colors.bgHover, borderColor: colors.border },
	toolbarIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
	toolbarText: { color: colors.fgFaint, fontSize: fontSize.xs + 1, fontWeight: '600' },
	toolbarTextActive: { color: colors.fgStrong },
	approvalCard: {
		marginHorizontal: spacing.md,
		marginTop: spacing.md,
		padding: spacing.md,
		gap: spacing.sm,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: withAlpha(colors.warning, '4d'),
		borderLeftWidth: 3,
		borderLeftColor: colors.warning,
		backgroundColor: colors.bgElevated,
	},
	approvalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	approvalTitle: { color: colors.fgStrong, fontSize: fontSize.sm - 1, fontWeight: '600', flexShrink: 1 },
	approvalButtons: { flexDirection: 'row', gap: spacing.sm },
	awaitingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.warning },
	conversation: { gap: spacing.md, flexGrow: 1 },
	content: {
		flexGrow: 1,
		paddingHorizontal: spacing.md,
		paddingTop: spacing.md,
		paddingBottom: spacing.lg,
		gap: spacing.md,
	},
	userWrap: { alignItems: 'flex-end', marginTop: spacing.sm },
	userBubble: {
		maxWidth: '88%',
		borderRadius: 16,
		borderTopRightRadius: 6,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		// color-mix(fg 8%, bg-2) / border: color-mix(fg 10%, transparent)
		backgroundColor: '#242220',
		borderWidth: 1,
		borderColor: withAlpha(colors.fg, '1a'),
	},
	userText: { color: colors.fg, fontSize: fontSize.sm, lineHeight: 22 },
	assistantCard: {
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.border,
		borderLeftWidth: 3,
		borderLeftColor: withAlpha(colors.accentText, '8c'),
		backgroundColor: withAlpha(colors.bgElevated, '99'),
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm + 2,
		gap: spacing.xs,
	},
	assistantCardStreaming: {
		borderColor: withAlpha(colors.accentText, '66'),
		borderLeftColor: colors.accentText,
	},
	assistantHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
	assistantLabel: { color: colors.fgMuted, fontSize: fontSize.xs, fontWeight: '600', flex: 1 },
	assistantText: { color: colors.fg, fontSize: fontSize.sm, lineHeight: 24 },
	toolHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, minHeight: 32 },
	toolTitle: { color: colors.fgFaint, fontSize: fontSize.xs + 1 },
	toolName: { color: colors.fgFaint, fontSize: fontSize.xs, opacity: 0.8, flexShrink: 1 },
	toolBody: {
		marginTop: spacing.xs,
		marginLeft: spacing.lg,
		padding: spacing.sm + 2,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgInput,
	},
	toolText: { color: colors.fgMuted, fontFamily: MONO, fontSize: fontSize.xs, lineHeight: 18 },
	noteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
	noteText: { color: colors.fgFaint, fontSize: fontSize.xs },
	checkpoint: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	checkpointLine: { flex: 1, height: 1, backgroundColor: colors.border },
	systemText: { color: colors.fgFaint, fontSize: fontSize.xs, lineHeight: 18 },
	greeting: { paddingTop: spacing.xl, gap: spacing.xs },
	greetingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	greetingTitle: { color: colors.fgStrong, fontSize: fontSize.lg - 2, fontWeight: '600', flexShrink: 1 },
	greetingHint: { color: colors.fgFaint, fontSize: fontSize.xs + 1, lineHeight: 21 },
	pastThreads: { marginTop: spacing.xl, gap: spacing.xs },
	threadList: {
		gap: spacing.xs,
	},
	threadRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm + 2,
		minHeight: 56,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
	},
	threadRowActive: {
		borderColor: colors.selectedBorder,
		backgroundColor: colors.accentSoft,
	},
	threadRowPressed: { backgroundColor: colors.bgHover },
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
		backgroundColor: colors.bgHover,
		borderWidth: 1,
		borderColor: colors.borderStrong,
		shadowColor: '#000000',
		shadowOpacity: 0.4,
		shadowRadius: 8,
		shadowOffset: { width: 0, height: 3 },
		elevation: 4,
	},
	jumpText: { color: colors.fg, fontSize: fontSize.xs, fontWeight: '600' },
	composerWrap: {
		paddingHorizontal: spacing.sm,
		paddingTop: spacing.xs,
		paddingBottom: spacing.sm,
		backgroundColor: colors.bg,
	},
	composer: {
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgInput,
		padding: spacing.sm,
	},
	composerFocused: { borderColor: withAlpha(colors.accentText, '99') },
	composerInput: {
		minHeight: 44,
		maxHeight: 140,
		paddingHorizontal: spacing.xs,
		paddingTop: spacing.xs,
		paddingBottom: spacing.xs,
		color: colors.fg,
		fontSize: fontSize.sm,
		lineHeight: 21,
		textAlignVertical: 'top',
	},
	composerBar: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		marginTop: spacing.xs + 2,
		paddingTop: spacing.xs + 2,
		borderTopWidth: 1,
		borderTopColor: withAlpha(colors.border, '99'),
	},
	composerChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
	composerChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		minHeight: 32,
		paddingHorizontal: spacing.sm,
		borderRadius: radius.sm,
	},
	composerChipPressed: { backgroundColor: withAlpha(colors.fg, '14') },
	composerChipText: { color: colors.fgFaint, fontSize: fontSize.xs },
	roundButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
	roundButtonFilled: {
		backgroundColor: colors.fg,
		shadowColor: colors.fg,
		shadowOpacity: 0.25,
		shadowRadius: 6,
		shadowOffset: { width: 0, height: 2 },
	},
	roundButtonDisabled: { backgroundColor: withAlpha(colors.fg, '1f') },
	roundButtonOutline: { borderWidth: 1, borderColor: colors.borderStrong },
	awaitingBadge: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs + 2,
		paddingHorizontal: spacing.sm,
		paddingVertical: 3,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: colors.border,
	},
	awaitingText: { color: colors.fgMuted, fontSize: fontSize.xs },
});
