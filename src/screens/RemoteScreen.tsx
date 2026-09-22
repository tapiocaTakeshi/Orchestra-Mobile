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
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';

import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

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
	Loading,
	Muted,
	Row,
	Screen,
	SectionTitle,
} from '../components/ui';
import { oneLine, relativeTimeFromIso } from '../lib/format';
import { useApp } from '../state/AppContext';
import { colors, fontSize, radius, spacing } from '../theme';

/** ワンタップで出せるエディタ操作。allowCommands がオフでも通るものを先に置く。 */
const QUICK_COMMANDS: { id: string; label: string }[] = [
	{ id: 'workbench.action.files.saveAll', label: 'すべて保存' },
	{ id: 'void.kanban.runNext', label: 'カンバンの次のタスクを実行' },
	{ id: 'void.kanban.toggleAutoRun', label: 'カンバン自動実行の切替' },
	{ id: 'workbench.action.terminal.new', label: 'ターミナルを開く' },
	{ id: 'workbench.action.reloadWindow', label: 'ウィンドウを再読み込み' },
];

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
	return (
		<View style={[styles.bubbleWrap, { alignItems: style.align }]}>
			<View style={[styles.bubble, { backgroundColor: style.backgroundColor }]}>
				<Text style={styles.bubbleRole}>
					{style.label}{message.toolName ? ` · ${message.toolName}` : ''}
				</Text>
				<Text selectable style={styles.bubbleText}>{message.text || '(内容なし)'}</Text>
			</View>
		</View>
	);
};

export const RemoteScreen = () => {
	const { snapshot, error, refresh, isRefreshing, invalidate, client } = useApp();

	const [draft, setDraft] = useState('');
	const [showCostTuning, setShowCostTuning] = useState(false);
	const [sending, setSending] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const [showThreads, setShowThreads] = useState(false);
	const [showQuickActions, setShowQuickActions] = useState(false);
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
		setNotice(null);
		try {
			await fn();
			if (successNote) setNotice(successNote);
			invalidate();
		} catch (e) {
			setNotice(e instanceof OrchestraApiError ? e.userMessage : String(e));
		}
	}, [invalidate]);

	const send = useCallback(async (newThread: boolean) => {
		const message = draft.trim();
		if (!message || !client || sending) return;
		setSending(true);
		try {
			await client.sendPrompt(message, { newThread });
			setDraft('');
			followMessages.current = true;
			setNotice(null);
			invalidate();
		} catch (e) {
			setNotice(e instanceof OrchestraApiError ? e.userMessage : String(e));
		} finally {
			setSending(false);
		}
	}, [draft, client, invalidate, sending]);

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

				<Card style={styles.workspaceCard}>
					<Row style={styles.spread}>
						<View style={styles.flex}>
							<Body numberOfLines={1}>{ide?.workspaceName || '(フォルダ未オープン)'}</Body>
							<Muted>{ide?.appName} {ide?.version}</Muted>
						</View>
						<Badge
							label={runningLabel}
							color={chat?.awaitingApproval ? colors.warning : chat?.isRunning ? colors.running : colors.fgFaint}
						/>
					</Row>

					{chat?.awaitingApproval ? (
						<Row>
							<Button title='承認して続行' onPress={() => void act(() => client.approveTool(), '承認しました')} style={styles.flex} />
							<Button title='却下' variant='secondary' onPress={() => void act(() => client.rejectTool(), '却下しました')} />
						</Row>
					) : null}

					{chat?.error ? <Text style={styles.errorText}>{chat.error}</Text> : null}
				</Card>

				<View style={styles.toolbar}>
					<Pressable accessibilityRole='button' accessibilityState={{ expanded: showThreads }} onPress={() => { setShowThreads(v => !v); setShowQuickActions(false); scrollRef.current?.scrollTo({ y: 0, animated: false }); }} style={styles.toolbarButton}>
						<Icon name='message-square' size={17} />
						<Text style={styles.link}>スレッド ({snapshot.threads.length})</Text>
						<Icon name={showThreads ? 'chevron-up' : 'chevron-down'} size={16} />
					</Pressable>
					<Pressable accessibilityRole='button' accessibilityState={{ expanded: showQuickActions }} onPress={() => { setShowQuickActions(v => !v); setShowThreads(false); scrollRef.current?.scrollTo({ y: 0, animated: false }); }} style={styles.toolbarButton}>
						<Icon name='zap' size={17} />
						<Text style={styles.link}>操作</Text>
						<Icon name={showQuickActions ? 'chevron-up' : 'chevron-down'} size={16} />
					</Pressable>
				</View>
				<ScrollView
					ref={scrollRef}
					contentContainerStyle={styles.content}
					keyboardShouldPersistTaps='handled'
					keyboardDismissMode='on-drag'
					refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
					scrollEventThrottle={16}
					onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
						followMessages.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
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
								: snapshot.threads.map(t => (
									<Pressable
										key={t.threadId}
										accessibilityRole='button'
										onPress={() => void act(() => client.switchThread(t.threadId), 'スレッドを切り替えました')}
										accessibilityState={{ selected: t.threadId === chat?.threadId }}
										style={[styles.threadRow, t.threadId === chat?.threadId && styles.threadRowActive]}
									>
										<Body numberOfLines={1}>{oneLine(t.title)}</Body>
										<Muted>{relativeTimeFromIso(t.lastModified)} · {t.messageCount} 件</Muted>
									</Pressable>
								))}
							<Button title='新しいスレッド' variant='secondary' onPress={() => void act(() => client.newThread(), '新しいスレッドを開きました')} />
							<Divider />
						</View>
					) : null}

					{showQuickActions ? (
						<Card>
						<SectionTitle>クイック操作</SectionTitle>
						<View style={styles.quickGrid}>
							{QUICK_COMMANDS.map(cmd => (
								<Button
									key={cmd.id}
									title={cmd.label}
									variant='secondary'
									onPress={() => void act(() => client.runCommand(cmd.id), `${cmd.label} を実行しました`)}
									style={styles.quickButton}
								/>
							))}
						</View>
					</Card>
					) : null}
					<View style={styles.conversation}>
						{chat && chat.messages.length > 0
							? chat.messages.map((m, i) => <MessageBubble key={`${i}-${m.role}`} message={m} />)
							: <EmptyState title='まだ会話がありません' detail='下の入力欄から指示を送ると、この IDE のエージェントが動き出します。' />}
					</View>
				</ScrollView>

				<View style={styles.composer}>
					<Button title='コスト調整' variant='secondary' onPress={() => setShowCostTuning(true)} />
					<Modal visible={showCostTuning} animationType='slide' onRequestClose={() => setShowCostTuning(false)}>
						<SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
							<Button title='チャットに戻る' variant='secondary' onPress={() => setShowCostTuning(false)} />
							{showCostTuning ? <TuningScreen composerPrompt={draft} /> : null}
						</SafeAreaView>
					</Modal>
					{notice ? <Text accessibilityLiveRegion='polite' style={styles.notice}>{notice}</Text> : null}
					<Input
						value={draft}
						onChangeText={setDraft}
						placeholder='エージェントへの指示を入力…'
						multiline
						style={styles.composerInput}
					/>
					<Row>
						<Button
							title={chat?.isRunning ? '中断' : '新規で送信'}
							variant='secondary'
							onPress={() => chat?.isRunning ? void act(() => client.abortAgent(), '中断しました') : void send(true)}
							disabled={sending || (!chat?.isRunning && !draft.trim())}
							style={styles.flex}
						/>
						<Button
							title='送信'
							onPress={() => void send(false)}
							loading={sending}
							disabled={!draft.trim()}
							style={styles.flex}
						/>
					</Row>
				</View>
			</KeyboardAvoidingView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	workspaceCard: { marginHorizontal: spacing.lg, marginTop: spacing.lg, borderRadius: radius.md },
	toolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
	toolbarButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.sm },
	conversation: { gap: spacing.md, flexGrow: 1 },
	flex: { flex: 1 },
	spread: { justifyContent: 'space-between' },
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
	threadList: {
		gap: spacing.xs,
		marginBottom: spacing.sm,
	},
	threadRow: {
		padding: spacing.sm,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.border,
	},
	threadRowActive: {
		borderColor: colors.accent,
		backgroundColor: colors.accentSoft,
	},
	quickGrid: {
		gap: spacing.xs,
	},
	quickButton: {
		width: '100%',
	},
	composer: {
		borderTopWidth: 1,
		borderTopColor: colors.border,
		padding: spacing.md,
		gap: spacing.sm,
		backgroundColor: colors.bg,
	},
	composerInput: {
		minHeight: 56,
		maxHeight: 120,
	},
	link: {
		color: colors.accentText,
		fontSize: fontSize.xs,
		fontWeight: '600',
	},
	notice: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
		textAlign: 'center',
	},
	errorText: {
		color: colors.danger,
		fontSize: fontSize.xs,
	},
});

