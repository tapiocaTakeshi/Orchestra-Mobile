/**
 * Pull requests from cloud agent sessions that were started from a GitHub repo.
 *
 *   - usePullRequestInfo       … GET .../pull-request (PR state, form suggestion, canCreate / reason) for the open session
 *   - PullRequestBar           … "PR を作成", or "PR #n を開く" + "PR を更新" once a PR exists; the reason when it can't
 *   - PullRequestSheet         … the form (タイトル / 説明 / ブランチ名 / ベース / 下書き) → POST, then the PR link
 *   - PullRequestEventCard     … the `pull_request` log event ("PR #12 を作成しました — <title>"), tap to open
 *   - PullRequestGitHubConnect … the existing "GitHub と連携" flow, for github_not_connected
 *
 * The server commits and pushes with the user's GitHub token; the device only sends title, body and branch.
 * Sessions from a URL, a PC folder or an empty folder never show any of this (canOfferPullRequest).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DivisionSession } from '../lib/divisionAuth';
import {
	CloudPullRequest,
	CloudPullRequestInfo,
	CloudSession,
	CreatePullRequestResult,
	PULL_REQUEST_LIMITS,
	PullRequestForm,
	canOfferPullRequest,
	createPullRequest,
	getPullRequestInfo,
	initialPullRequestForm,
	isPullRequestNotConnected,
	openPullRequestLabel,
	pullRequestActionLabel,
	pullRequestErrorText,
	pullRequestEventText,
	pullRequestFormInput,
	pullRequestInputIssue,
	pullRequestMode,
	pullRequestReasonText,
	toPullRequestEvent,
} from '../lib/divisionCloud';
import { isGitHubNotConnected } from '../lib/divisionGitHub';
import { colors, fontSize, radius, spacing, withAlpha } from '../theme';
import { GitHubConnectPanel, useGitHubConnection } from './GitHubRepoPicker';
import { Badge, Button, ErrorBanner, Icon, Input, Muted, Row, SectionTitle, Sheet, Toggle, useToast } from './ui';

type Toast = ReturnType<typeof useToast>;

const openPullRequestUrl = async (url: string, toast: Toast) => {
	try {
		await Linking.openURL(url);
	} catch {
		toast.show('PR のページを開けませんでした', 'error');
	}
};

/** The PR to show: the session DTO is polled every 2 s, the GET result fills in until it has one. */
export const currentPullRequest = (session: CloudSession, info: CloudPullRequestInfo | null): CloudPullRequest | null =>
	session.pullRequest ?? info?.pullRequest ?? null;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type PullRequestState = {
	/** GitHub-repo session that is not working right now */
	available: boolean;
	/** Last GET result (kept while a newer one loads) */
	info: CloudPullRequestInfo | null;
	loading: boolean;
	error: string | null;
	reload: () => void;
	/** Applies a POST result right away, then re-reads the state */
	applyResult: (pullRequest: CloudPullRequest) => void;
};

export const usePullRequestInfo = (auth: DivisionSession, session: CloudSession): PullRequestState => {
	const available = canOfferPullRequest(session);
	const id = session.id;
	const [info, setInfo] = useState<CloudPullRequestInfo | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/** Sequence number so an older response never overwrites a newer one */
	const requestId = useRef(0);

	const load = useCallback(async () => {
		const rid = ++requestId.current;
		setLoading(true);
		try {
			const next = await getPullRequestInfo(auth, id);
			if (rid !== requestId.current) return;
			setInfo(next);
			setError(null);
		} catch (e) {
			if (rid === requestId.current) setError(pullRequestErrorText(e));
		} finally {
			if (rid === requestId.current) setLoading(false);
		}
	}, [auth, id]);

	// Re-read whenever something that changes canCreate / the PR moves (finished a turn, new changes, a push).
	const pr = session.pullRequest;
	const key = `${session.status}|${session.changedFiles}|${pr?.number ?? ''}|${pr?.headSha ?? ''}|${pr?.updatedAt ?? ''}`;
	useEffect(() => {
		if (!available) {
			requestId.current += 1;
			setLoading(false);
			return;
		}
		void load();
	}, [available, key, load]);

	// Drop responses that arrive after the detail was closed
	useEffect(() => () => { requestId.current += 1; }, []);

	const reload = useCallback(() => { void load(); }, [load]);
	const applyResult = useCallback((pullRequest: CloudPullRequest) => {
		setInfo(prev => (prev ? { ...prev, pullRequest } : prev));
		void load();
	}, [load]);

	return { available, info, loading, error, reload, applyResult };
};

// ---------------------------------------------------------------------------
// GitHub connection (github_not_connected)
// ---------------------------------------------------------------------------

/**
 * The repo picker's "GitHub と連携" flow (browser → poll /api/github/status). Calls onConnected once the user
 * finished connecting; the first status read (on mount) is not treated as a new connection.
 */
export const PullRequestGitHubConnect = ({ auth, onConnected }: { auth: DivisionSession; onConnected: () => void }) => {
	const github = useGitHubConnection(auth);
	const status = github.status;
	const callback = useRef(onConnected);
	callback.current = onConnected;
	const firstStatus = useRef(true);

	useEffect(() => {
		if (!status) return;
		if (firstStatus.current) {
			firstStatus.current = false;
			return;
		}
		if (status.connected) callback.current();
	}, [status]);

	if (status && !status.configured) return <Muted>サーバー側で GitHub 連携が未設定です。管理者に GitHub OAuth アプリの設定を依頼してください。</Muted>;
	return (
		<View style={styles.connect}>
			{github.error ? <ErrorBanner tone='warning' message={github.error} style={styles.inlineBanner} /> : null}
			<GitHubConnectPanel
				starting={github.starting}
				waiting={github.waiting}
				onConnect={() => void github.connect()}
				onCancel={github.cancelConnect}
				description='PR は連携した GitHub アカウントで push・作成します。連携してから、もう一度お試しください。'
			/>
		</View>
	);
};

// ---------------------------------------------------------------------------
// Bar in the session header
// ---------------------------------------------------------------------------

export const PullRequestBar = ({ auth, session, state, onCompose }: {
	auth: DivisionSession;
	session: CloudSession;
	state: PullRequestState;
	/** Opens PullRequestSheet (only offered once the GET said canCreate) */
	onCompose: () => void;
}) => {
	const toast = useToast();
	const pr = currentPullRequest(session, state.info);
	if (!session.workspaceInfo?.repoFullName) return null;
	if (!state.available && !pr) return null;

	const info = state.info;
	const checking = !info && state.loading;
	const blocked = state.available && !!info && !info.canCreate;

	return (
		<View style={styles.bar}>
			<Row style={styles.wrapRow}>
				{pr ? (
					<Button
						title={openPullRequestLabel(pr)}
						variant='secondary'
						size='sm'
						icon='external-link'
						onPress={() => void openPullRequestUrl(pr.url, toast)}
						accessibilityLabel={`${openPullRequestLabel(pr)} (ブラウザ)`}
					/>
				) : null}
				{state.available && (checking || info?.canCreate) ? (
					<Button
						title={pullRequestActionLabel(pr)}
						variant={pr ? 'secondary' : 'primary'}
						size='sm'
						icon='git-pull-request'
						loading={checking}
						onPress={onCompose}
					/>
				) : null}
				{pr?.draft ? <Badge label='下書き' icon='edit-3' /> : null}
			</Row>
			{blocked ? (
				<View style={styles.reason}>
					<Icon name='info' size={14} color={colors.fgFaint} />
					<Muted style={styles.flex}>{pullRequestReasonText(info)}</Muted>
				</View>
			) : null}
			{blocked && isPullRequestNotConnected(info) ? <PullRequestGitHubConnect auth={auth} onConnected={state.reload} /> : null}
			{state.available && !info && state.error ? (
				<View style={styles.reason}>
					<Icon name='alert-circle' size={14} color={colors.danger} />
					<Muted style={styles.flex}>PR の状態を確認できませんでした: {state.error}</Muted>
					<Button title='再試行' variant='ghost' size='sm' onPress={state.reload} />
				</View>
			) : null}
		</View>
	);
};

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

type SubmitError = { text: string; notConnected: boolean };

export const PullRequestSheet = ({ auth, session, info, onClose, onSubmitted }: {
	auth: DivisionSession;
	session: CloudSession;
	info: CloudPullRequestInfo;
	onClose: () => void;
	/** Called after a successful POST (also when the sheet was closed while submitting) */
	onSubmitted: (result: CreatePullRequestResult) => void;
}) => {
	const toast = useToast();
	const existing = currentPullRequest(session, info);
	// Fixed for the sheet's lifetime, so the form does not flip to "update" right after creating
	const [mode] = useState(() => pullRequestMode(existing));
	const [form, setForm] = useState<PullRequestForm>(() => initialPullRequestForm({ pullRequest: existing, suggestion: info.suggestion }));
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<SubmitError | null>(null);
	const [result, setResult] = useState<CreatePullRequestResult | null>(null);

	const input = pullRequestFormInput(form, mode);
	const issue = pullRequestInputIssue(input);
	const set = <K extends keyof PullRequestForm>(key: K, value: PullRequestForm[K]) => setForm(f => ({ ...f, [key]: value }));
	const creating = mode === 'create';

	const submit = async () => {
		if (issue || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const res = await createPullRequest(auth, session.id, input);
			setResult(res);
			onSubmitted(res);
		} catch (e) {
			setError({ text: pullRequestErrorText(e), notConnected: isGitHubNotConnected(e) });
		} finally {
			setSubmitting(false);
		}
	};

	const repo = session.workspaceInfo?.repoFullName ?? '';

	if (result) {
		const pr = result.pullRequest;
		const unchanged = !creating && !result.updated;
		return (
			<Sheet title={creating ? 'PR を作成' : 'PR を更新'} eyebrow={repo} onClose={onClose}>
				<ScrollView contentContainerStyle={styles.sheetContent}>
					<View style={styles.resultCard} accessibilityLiveRegion='polite'>
						<Row>
							<Icon name={unchanged ? 'info' : 'check-circle'} size={18} color={unchanged ? colors.fgMuted : colors.success} />
							<Text style={styles.resultTitle}>
								{unchanged
									? `変更はありません (PR #${pr.number} は最新です)`
									: pullRequestEventText({ number: pr.number, action: creating ? 'created' : 'updated' })}
							</Text>
						</Row>
						{pr.title ? <Text selectable style={styles.resultText}>{pr.title}</Text> : null}
						<Text style={styles.resultMeta} numberOfLines={1}>{pr.branch} → {pr.base}{pr.draft ? ' · 下書き' : ''}</Text>
						<Button title={openPullRequestLabel(pr)} icon='external-link' onPress={() => void openPullRequestUrl(pr.url, toast)} />
						<Button title='閉じる' variant='secondary' onPress={onClose} />
					</View>
				</ScrollView>
			</Sheet>
		);
	}

	return (
		<Sheet title={creating ? 'PR を作成' : `PR #${existing?.number ?? ''} を更新`} eyebrow={repo} onClose={onClose}>
			<ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps='handled'>
				<View style={styles.field}>
					<SectionTitle>タイトル</SectionTitle>
					<Input
						value={form.title}
						onChangeText={value => set('title', value)}
						placeholder='PR のタイトル'
						maxLength={PULL_REQUEST_LIMITS.title}
						editable={!submitting}
						accessibilityLabel='PR のタイトル'
					/>
				</View>

				<View style={styles.field}>
					<SectionTitle>説明</SectionTitle>
					<Input
						value={form.body}
						onChangeText={value => set('body', value)}
						placeholder='変更の内容 (Markdown)'
						multiline
						maxLength={PULL_REQUEST_LIMITS.body}
						editable={!submitting}
						accessibilityLabel='PR の説明'
						style={styles.bodyInput}
					/>
					{!creating ? <Muted>GitHub 上の PR の説明はこの内容に置き換わります。</Muted> : null}
				</View>

				<View style={styles.field}>
					<SectionTitle>ブランチ名</SectionTitle>
					{creating ? (
						<Input
							value={form.branch}
							onChangeText={value => set('branch', value)}
							placeholder='orchestra/…'
							autoCapitalize='none'
							autoCorrect={false}
							editable={!submitting}
							accessibilityLabel='push するブランチ名'
						/>
					) : (
						<View style={styles.readonly} accessibilityLabel={`ブランチ ${form.branch}`}>
							<Icon name='git-branch' size={14} color={colors.fgFaint} />
							<Text style={styles.readonlyText} numberOfLines={1}>{form.branch}</Text>
						</View>
					)}
					<Muted>{creating ? 'このブランチに push して PR を作ります。' : '既存の PR のブランチに続けて push します。'}</Muted>
				</View>

				<View style={styles.field}>
					<SectionTitle>ベース</SectionTitle>
					<View style={styles.readonly} accessibilityLabel={`ベースブランチ ${form.base || '既定のブランチ'}`}>
						<Icon name='git-merge' size={14} color={colors.fgFaint} />
						<Text style={styles.readonlyText} numberOfLines={1}>{form.base || '(既定のブランチ)'}</Text>
					</View>
				</View>

				<View style={styles.draftRow}>
					<View style={styles.flex}>
						<Text style={styles.draftLabel}>下書き</Text>
						<Muted>{creating ? 'レビュー前の下書き (Draft) として作成します。' : '下書きかどうかは GitHub で切り替えてください。'}</Muted>
					</View>
					<Toggle
						value={form.draft}
						onValueChange={value => set('draft', value)}
						disabled={!creating || submitting}
						accessibilityLabel='下書きとして作成'
					/>
				</View>

				{issue ? <Text style={styles.invalidText}>{issue}</Text> : null}

				{error ? <ErrorBanner message={error.text} style={styles.inlineBanner} /> : null}
				{error?.notConnected ? (
					<PullRequestGitHubConnect
						auth={auth}
						onConnected={() => { setError(null); toast.show('GitHub と連携しました。もう一度お試しください', 'success'); }}
					/>
				) : null}

				{submitting ? (
					<View style={styles.progress} accessibilityLiveRegion='polite'>
						<ActivityIndicator size='small' color={colors.running} />
						<Muted style={styles.flex}>
							{creating ? 'コミットを作って GitHub に push し、PR を作成しています…' : '変更を push して PR を更新しています…'}
						</Muted>
					</View>
				) : null}

				<Row style={styles.actions}>
					<Button title='キャンセル' variant='secondary' onPress={onClose} style={styles.flex} />
					<Button
						title={creating ? '作成' : '更新'}
						icon='git-pull-request'
						loading={submitting}
						disabled={!!issue}
						onPress={() => void submit()}
						style={styles.flex}
					/>
				</Row>
				{submitting ? <Muted>閉じても処理はサーバーで続きます。</Muted> : null}
			</ScrollView>
		</Sheet>
	);
};

// ---------------------------------------------------------------------------
// Log event
// ---------------------------------------------------------------------------

export const PullRequestEventCard = ({ data }: { data: Record<string, unknown> }) => {
	const toast = useToast();
	const event = toPullRequestEvent(data);
	if (!event) return null;
	const label = pullRequestEventText(event);
	const url = event.url;
	return (
		<Pressable
			accessibilityRole={url ? 'link' : undefined}
			accessibilityLabel={`${label}${event.title ? ` — ${event.title}` : ''}${url ? '。開く' : ''}`}
			disabled={!url}
			onPress={() => void openPullRequestUrl(url, toast)}
			style={({ pressed }) => [styles.eventCard, pressed && styles.pressed]}
		>
			<Icon name='git-pull-request' size={16} color={colors.accentText} />
			<View style={styles.flex}>
				<Text style={styles.eventTitle} numberOfLines={2}>
					{label}
					{event.title ? <Text style={styles.eventPrTitle}> — {event.title}</Text> : null}
				</Text>
				{event.branch ? (
					<Text style={styles.eventMeta} numberOfLines={1}>{event.branch}{event.base ? ` → ${event.base}` : ''}</Text>
				) : null}
			</View>
			{url ? <Icon name='external-link' size={14} color={colors.fgFaint} /> : null}
		</Pressable>
	);
};

const MONO_FONT = { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) };

const styles = StyleSheet.create({
	flex: { flex: 1 },
	wrapRow: { flexWrap: 'wrap' },
	pressed: { opacity: 0.6 },
	inlineBanner: { marginHorizontal: 0 },
	bar: { gap: spacing.xs },
	reason: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
	connect: { gap: spacing.sm },
	sheetContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
	field: { gap: spacing.sm },
	bodyInput: { minHeight: 160 },
	readonly: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		minHeight: 44,
		paddingHorizontal: spacing.md,
		borderRadius: radius.md,
		backgroundColor: colors.bgElevated,
	},
	readonlyText: { flex: 1, color: colors.fgMuted, fontSize: fontSize.xs + 1, ...MONO_FONT },
	draftRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
	draftLabel: { color: colors.fg, fontSize: fontSize.sm, fontWeight: '600' },
	invalidText: { color: colors.danger, fontSize: fontSize.xs },
	progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	actions: { gap: spacing.sm },
	resultCard: {
		gap: spacing.md,
		padding: spacing.md,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: withAlpha(colors.success, '44'),
	},
	resultTitle: { flex: 1, color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600' },
	resultText: { color: colors.fg, fontSize: fontSize.sm, lineHeight: 22 },
	resultMeta: { color: colors.fgFaint, fontSize: fontSize.xs, ...MONO_FONT },
	eventCard: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		padding: spacing.md,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: withAlpha(colors.accentText, '44'),
		backgroundColor: colors.bgElevated,
	},
	eventTitle: { color: colors.fgStrong, fontSize: fontSize.xs + 1, fontWeight: '600', lineHeight: 20 },
	eventPrTitle: { color: colors.fg, fontWeight: '400' },
	eventMeta: { color: colors.fgFaint, fontSize: fontSize.xs, marginTop: 2, ...MONO_FONT },
});
