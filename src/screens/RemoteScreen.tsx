/**
 * チャット。PC に繋いでいるときの最初の画面。
 *
 * ここでできること:
 *   - エージェントに指示を出す / 中断する
 *   - ツール実行の承認・却下 (無人だと止まったままになるので、外出先から進められる)
 *   - 左上のメニューから、スレッドの切り替えと各ページ (カンバンなど) への移動
 *
 * 見た目は Claude Code のように飾りを減らしている: エージェントの返答は枠なしの本文、
 * ツールの実行は 1 行 (押すと出力を開く)、承認の確認は入力欄のすぐ上に出す。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { ChatMessage, ThreadSummary } from '../api/types';
import {
	Button,
	ErrorBanner,
	Icon,
	IconButton,
	Loading,
	Muted,
	Screen,
	SectionTitle,
	Sheet,
	useToast,
} from '../components/ui';
import { oneLine, relativeTimeFromIso } from '../lib/format';
import { PageKey, pagesFor } from '../navigation';
import { useApp } from '../state/AppContext';
import { colors, fontSize, radius, spacing } from '../theme';

/** 下端からこれ以上離れたら「最新へ」ボタンを出す。 */
const JUMP_THRESHOLD = 240;

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** 自分の発言だけは右寄せの吹き出しにして、誰の言葉かを一目で分ける。 */
const UserMessage = ({ text }: { text: string }) => (
	<View style={styles.userWrap}>
		<View accessibilityLabel={`あなた: ${text}`} style={styles.userBubble}>
			<Text selectable style={styles.userText}>{text}</Text>
		</View>
	</View>
);

/** ターミナル版の「⎿」に当たる鉤。文字だと端末のフォントに無いことがあるので線で描く。 */
const Elbow = () => <View style={styles.elbow} />;

/** ツールの実行は 1 行だけ出し、押したときに出力を開く。 */
const ToolMessage = ({ name, text }: { name?: string; text: string }) => {
	const [open, setOpen] = useState(false);
	const firstLine = text.split('\n').find(line => line.trim())?.trim() ?? '';
	return (
		<Pressable
			accessibilityRole='button'
			accessibilityState={{ expanded: open }}
			accessibilityLabel={`ツール ${name ?? ''}。${open ? '出力を閉じる' : '出力を見る'}`}
			onPress={() => setOpen(v => !v)}
			style={styles.tool}
		>
			<View style={styles.toolHeader}>
				<View style={styles.toolDot} />
				<Text style={styles.toolName} numberOfLines={1}>{name || 'ツール'}</Text>
			</View>
			<View style={styles.toolResult}>
				<Elbow />
				<Text selectable={open} style={styles.toolText} numberOfLines={open ? undefined : 1}>
					{open ? (text || '(出力なし)') : (firstLine || '(出力なし)')}
				</Text>
			</View>
		</Pressable>
	);
};

const ChatMessageView = ({ message }: { message: ChatMessage }) => {
	switch (message.role) {
		case 'user': return <UserMessage text={message.text || '(内容なし)'} />;
		case 'assistant': return message.text ? <Text selectable style={styles.assistantText}>{message.text}</Text> : null;
		case 'tool': return <ToolMessage name={message.toolName} text={message.text} />;
		case 'interrupted':
			return (
				<View style={styles.toolResult}>
					<Elbow />
					<Text style={styles.noteText}>{message.text || '中断しました'}</Text>
				</View>
			);
		case 'checkpoint':
			return null;
		default:
			return message.text ? <Text style={styles.noteText}>{message.text}</Text> : null;
	}
};

const ThreadRow = ({ thread, active, onPress }: { thread: ThreadSummary; active?: boolean; onPress: () => void }) => (
	<Pressable
		accessibilityRole='button'
		accessibilityState={{ selected: !!active }}
		onPress={onPress}
		style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}
	>
		<View style={styles.flex}>
			<Text style={styles.listTitle} numberOfLines={1}>{oneLine(thread.title)}</Text>
			<Muted>{relativeTimeFromIso(thread.lastModified)} · {thread.messageCount} 件</Muted>
		</View>
		{active ? <Icon name='check' size={18} color={colors.fg} /> : null}
	</Pressable>
);

export const RemoteScreen = ({ onOpenPage }: { onOpenPage: (page: PageKey) => void }) => {
	const { snapshot, error, refresh, isRefreshing, invalidate, client } = useApp();

	const toast = useToast();
	const [draft, setDraft] = useState('');
	const [sheet, setSheet] = useState<'menu' | 'cost' | null>(null);
	const [sending, setSending] = useState(false);
	const [showJump, setShowJump] = useState(false);
	const insets = useSafeAreaInsets();
	const followMessages = useRef(true);
	const lastContent = useRef('');
	const scrollRef = useRef<ScrollView | null>(null);

	const chat = snapshot?.chat ?? null;
	const ide = snapshot?.ide ?? null;
	const lastMessage = chat?.messages[chat.messages.length - 1];
	const contentKey = JSON.stringify([chat?.threadId, chat?.messages.length, lastMessage?.text, chat?.isRunning, chat?.awaitingApproval]);
	useEffect(() => { followMessages.current = true; }, [chat?.threadId]);

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

	const send = useCallback(async () => {
		const message = draft.trim();
		if (!message || !client || sending) return;
		setSending(true);
		try {
			await client.sendPrompt(message);
			setDraft('');
			followMessages.current = true;
			setShowJump(false);
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
	const canSend = !!draft.trim() && !sending;
	const status = isAwaiting
		? { label: '確認待ち', color: colors.warning }
		: isRunning
			? { label: '作業中', color: colors.running }
			: { label: '待機中', color: colors.fgFaint };

	const switchThread = (threadId: string) => {
		setSheet(null);
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

				<View style={styles.header}>
					<IconButton icon='menu' accessibilityLabel='メニュー' onPress={() => setSheet('menu')} />
					<View style={styles.flex}>
						<Text style={styles.workspaceName} numberOfLines={1}>{ide?.workspaceName || '(フォルダ未オープン)'}</Text>
						<View style={styles.statusRow} accessibilityLabel={`状態: ${status.label}`}>
							<View style={[styles.statusDot, { backgroundColor: status.color }]} />
							<Text style={styles.statusText} numberOfLines={1}>
								{status.label} · {snapshot.remoteSession ? 'PC と同期中' : `${ide?.appName} ${ide?.version}`}
							</Text>
						</View>
					</View>
					<IconButton icon='edit' accessibilityLabel='新しいチャット' onPress={() => void act(() => client.newThread(), '新しいチャットを開きました')} />
				</View>

				{chat?.error ? <ErrorBanner message={chat.error} /> : null}

				<View style={styles.flex}>
					<ScrollView
						ref={scrollRef}
						contentContainerStyle={styles.content}
						keyboardShouldPersistTaps='handled'
						keyboardDismissMode='on-drag'
						refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor={colors.fgMuted} />}
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
							if (followMessages.current) scrollRef.current?.scrollToEnd({ animated: false });
						}}
					>
						{hasMessages ? (
							<View style={styles.conversation}>
								{chat!.messages.map((m, i) => <ChatMessageView key={`${i}-${m.role}`} message={m} />)}
								{isRunning && !isAwaiting ? (
									<View style={styles.working} accessibilityLiveRegion='polite'>
										<ActivityIndicator size='small' color={colors.running} />
										<Text style={styles.workingText}>作業中…</Text>
									</View>
								) : null}
							</View>
						) : (
							<View style={styles.greeting}>
								<Text accessibilityRole='header' style={styles.greetingTitle}>エージェントに何をさせますか？</Text>
							</View>
						)}
					</ScrollView>

					{showJump ? (
						<Pressable accessibilityRole='button' accessibilityLabel='最新のメッセージへ移動' onPress={scrollToLatest} style={styles.jumpButton}>
							<Icon name='arrow-down' size={18} color={colors.fg} />
						</Pressable>
					) : null}
				</View>

				{/* 承認の確認は入力欄のすぐ上 (指が届く場所) に出す */}
				{isAwaiting ? (
					<View accessibilityRole='alert' style={styles.approval}>
						<Text style={styles.approvalTitle}>ツールの実行を承認しますか？</Text>
						<Muted>承認するまでエージェントは止まったままです。</Muted>
						<View style={styles.approvalButtons}>
							<Button title='承認して続行' onPress={() => void act(() => client.approveTool(), '承認しました')} style={styles.flex} />
							<Button title='取り消す' variant='secondary' onPress={() => void act(() => client.rejectTool(), '取り消しました')} style={styles.flex} />
						</View>
					</View>
				) : null}

				<View style={styles.composerWrap}>
					<View style={styles.composer}>
						<TextInput
							value={draft}
							onChangeText={setDraft}
							placeholder={isRunning ? 'エージェントが作業中です…' : 'エージェントに指示する…'}
							placeholderTextColor={colors.fgFaint}
							selectionColor={colors.fgMuted}
							accessibilityLabel='エージェントへの指示'
							multiline
							style={styles.composerInput}
						/>
						<View style={styles.composerBar}>
							<Pressable
								accessibilityRole='button'
								accessibilityLabel='コスト調整'
								onPress={() => setSheet('cost')}
								hitSlop={6}
								style={({ pressed }) => [styles.composerChip, pressed && styles.composerChipPressed]}
							>
								<Icon name='bar-chart-2' size={15} color={colors.fgFaint} />
								<Text style={styles.composerChipText}>コスト</Text>
							</Pressable>
							<View style={styles.flex} />
							{isRunning && !isAwaiting && !draft.trim() ? (
								<Pressable
									accessibilityRole='button'
									accessibilityLabel='エージェントを止める'
									onPress={() => void act(() => client.abortAgent(), '中断しました')}
									hitSlop={6}
									style={({ pressed }) => [styles.roundButton, styles.roundButtonOn, pressed && styles.roundButtonPressed]}
								>
									<View style={styles.stopSquare} />
								</Pressable>
							) : (
								<Pressable
									accessibilityRole='button'
									accessibilityLabel='送信'
									accessibilityState={{ disabled: !canSend, busy: sending }}
									disabled={!canSend}
									onPress={() => void send()}
									hitSlop={6}
									style={({ pressed }) => [styles.roundButton, canSend ? styles.roundButtonOn : styles.roundButtonOff, pressed && styles.roundButtonPressed]}
								>
									{sending
										? <ActivityIndicator size='small' color={colors.bg} />
										: <Icon name='arrow-up' size={18} color={canSend ? colors.bg : colors.fgFaint} />}
								</Pressable>
							)}
						</View>
					</View>
				</View>

				{sheet === 'menu' ? (
					<Sheet title='メニュー' onClose={() => setSheet(null)}>
						<ScrollView contentContainerStyle={styles.sheetContent}>
							{pagesFor(true).map(page => (
								<Pressable
									key={page.key}
									accessibilityRole='button'
									onPress={() => { setSheet(null); onOpenPage(page.key); }}
									style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}
								>
									<Icon name={page.icon} size={18} color={colors.fgMuted} />
									<Text style={[styles.listTitle, styles.flex]}>{page.label}</Text>
									<Icon name='chevron-right' size={16} color={colors.fgFaint} />
								</Pressable>
							))}
							{snapshot.threads.length > 0 ? (
								<View style={styles.menuSection}>
									<SectionTitle>最近のチャット</SectionTitle>
									<View>
										{snapshot.threads.map(t => (
											<ThreadRow key={t.threadId} thread={t} active={t.threadId === chat?.threadId} onPress={() => switchThread(t.threadId)} />
										))}
									</View>
								</View>
							) : null}
						</ScrollView>
					</Sheet>
				) : null}

				{sheet === 'cost' ? (
					<Sheet title='コスト調整' eyebrow='入力中の指示' onClose={() => setSheet(null)}>
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
		flexDirection: 'row',
		alignItems: 'center',
		gap: 2,
		paddingHorizontal: spacing.xs,
		paddingVertical: spacing.sm,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.borderStrong,
	},
	workspaceName: { color: colors.fgStrong, fontSize: fontSize.sm + 1, fontWeight: '600' },
	statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, marginTop: 2 },
	statusDot: { width: 7, height: 7, borderRadius: 4 },
	statusText: { color: colors.fgFaint, fontSize: fontSize.xs, flexShrink: 1 },
	content: {
		flexGrow: 1,
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.lg,
		paddingBottom: spacing.xl,
	},
	conversation: { gap: spacing.lg },
	userWrap: { alignItems: 'flex-end' },
	userBubble: {
		maxWidth: '85%',
		borderRadius: 18,
		paddingHorizontal: spacing.md + 2,
		paddingVertical: spacing.sm + 2,
		backgroundColor: colors.bgHover,
	},
	userText: { color: colors.fg, fontSize: fontSize.sm, lineHeight: 22 },
	assistantText: { color: colors.fg, fontSize: fontSize.sm, lineHeight: 25 },
	tool: { gap: 2 },
	toolHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	toolDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.fgFaint },
	toolName: { color: colors.fgMuted, fontFamily: MONO, fontSize: fontSize.xs + 1, flexShrink: 1 },
	toolResult: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingLeft: 2 },
	elbow: {
		width: 9,
		height: 8,
		marginTop: 3,
		marginLeft: 2,
		borderLeftWidth: 1,
		borderBottomWidth: 1,
		borderColor: colors.fgFaint,
	},
	toolText: { flex: 1, color: colors.fgFaint, fontFamily: MONO, fontSize: fontSize.xs, lineHeight: 18 },
	noteText: { color: colors.fgFaint, fontSize: fontSize.xs, lineHeight: 18 },
	working: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	workingText: { color: colors.fgFaint, fontSize: fontSize.xs + 1 },
	greeting: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: spacing.xl },
	greetingTitle: { color: colors.fgMuted, fontSize: fontSize.md, fontWeight: '500' },
	menuSection: { marginTop: spacing.xl, gap: spacing.xs },
	listRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		minHeight: 56,
		paddingVertical: spacing.sm,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	listRowPressed: { opacity: 0.6 },
	listTitle: { color: colors.fg, fontSize: fontSize.sm },
	sheetContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
	jumpButton: {
		position: 'absolute',
		alignSelf: 'center',
		bottom: spacing.md,
		width: 36,
		height: 36,
		borderRadius: 18,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.bgHover,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.borderStrong,
	},
	approval: {
		marginHorizontal: spacing.md,
		marginBottom: spacing.xs,
		padding: spacing.md,
		gap: spacing.xs + 2,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.borderStrong,
	},
	approvalTitle: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600' },
	approvalButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
	composerWrap: {
		paddingHorizontal: spacing.md,
		paddingTop: spacing.xs,
		paddingBottom: spacing.sm,
	},
	composer: {
		borderRadius: 20,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
		paddingHorizontal: spacing.sm,
		paddingTop: spacing.xs,
		paddingBottom: spacing.sm,
	},
	composerInput: {
		minHeight: 40,
		maxHeight: 140,
		paddingHorizontal: spacing.sm,
		paddingTop: spacing.sm,
		paddingBottom: spacing.xs,
		color: colors.fg,
		fontSize: fontSize.sm,
		lineHeight: 21,
		textAlignVertical: 'top',
	},
	composerBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	composerChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		minHeight: 32,
		paddingHorizontal: spacing.sm,
		borderRadius: 16,
	},
	composerChipPressed: { backgroundColor: colors.bgHover },
	composerChipText: { color: colors.fgFaint, fontSize: fontSize.xs },
	roundButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
	roundButtonOn: { backgroundColor: colors.fg },
	roundButtonOff: { backgroundColor: colors.bgHover },
	roundButtonPressed: { opacity: 0.75 },
	stopSquare: { width: 11, height: 11, borderRadius: 2, backgroundColor: colors.bg },
});
