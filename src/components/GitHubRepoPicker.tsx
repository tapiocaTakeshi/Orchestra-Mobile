/**
 * クラウドエージェントの「Gitリポジトリ」を GitHub アカウントから選ぶ部品。
 *
 *   - useGitHubConnection … 連携の状態の取得・連携 (ブラウザで許可 → 状態をポーリング)・解除
 *   - GitHubAccountRow    … 連携中のアカウント (アバター + @login) と「解除」
 *   - GitHubConnectPanel  … 未連携のときの「GitHub と連携」と、ブラウザで許可してもらうあいだの待ち表示
 *   - GitHubRepoPicker    … 検索 (サーバー側の q、300 ms 待ってから) とリポジトリ一覧、「もっと見る」
 *   - GitHubRepoSelection … 選んだリポジトリの小さなカードとブランチの選択
 *
 * トークンは Division のサーバーにしか無く、端末はリポジトリ名とブランチ名を送るだけ。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DivisionSession } from '../lib/divisionAuth';
import {
	GitHubConnectWatcher,
	GitHubRepo,
	GitHubStatus,
	disconnectGitHub,
	getGitHubStatus,
	githubErrorText,
	isGitHubNotConnected,
	listGitHubBranches,
	listGitHubRepos,
	mergeRepoPages,
	startGitHubConnect,
	watchGitHubConnection,
} from '../lib/divisionGitHub';
import { relativeTimeFromIso } from '../lib/format';
import { colors, fontSize, radius, spacing } from '../theme';
import { Button, ErrorBanner, Icon, Input, Muted, confirmAction, useToast } from './ui';

/** 検索欄の入力が止まってからサーバーに問い合わせるまで。 */
const SEARCH_DEBOUNCE_MS = 300;
/** ブランチがこれより多ければ絞り込み欄を出す。 */
const BRANCH_FILTER_THRESHOLD = 8;
/** ブランチの一覧に一度に出す数 (それ以上は絞り込んでもらう)。 */
const MAX_BRANCH_ROWS = 50;

// ---------------------------------------------------------------------------
// 連携の状態
// ---------------------------------------------------------------------------

export type GitHubConnection = {
	/** null = まだ取得できていない (読み込み中か、取得に失敗) */
	status: GitHubStatus | null;
	error: string | null;
	/** 連携用の URL を取りに行っているあいだ */
	starting: boolean;
	/** ブラウザで許可してもらうのを待っているあいだ */
	waiting: boolean;
	disconnecting: boolean;
	refresh: () => Promise<void>;
	connect: () => Promise<void>;
	cancelConnect: () => void;
	/** 確認してから解除する。解除できたら true */
	disconnect: () => Promise<boolean>;
	/** API が 409 github_not_connected を返したとき (トークンが失効した) に未連携へ戻す */
	markDisconnected: () => void;
};

export const useGitHubConnection = (auth: DivisionSession): GitHubConnection => {
	const toast = useToast();
	const [status, setStatus] = useState<GitHubStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);
	const [waiting, setWaiting] = useState(false);
	const [disconnecting, setDisconnecting] = useState(false);
	const watcher = useRef<GitHubConnectWatcher | null>(null);
	const mounted = useRef(true);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			watcher.current?.cancel();
		};
	}, []);

	const refresh = useCallback(async () => {
		try {
			const next = await getGitHubStatus(auth);
			if (!mounted.current) return;
			setStatus(next);
			setError(null);
		} catch (e) {
			if (mounted.current) setError(githubErrorText(e));
		}
	}, [auth]);

	useEffect(() => {
		setStatus(null);
		void refresh();
	}, [refresh]);

	// 許可を待っているあいだは、ブラウザからアプリに戻ってきた時点ですぐ確かめる。
	useEffect(() => {
		if (!waiting) return;
		const sub = AppState.addEventListener('change', next => {
			if (next === 'active') watcher.current?.checkNow();
		});
		return () => sub.remove();
	}, [waiting]);

	const connect = useCallback(async () => {
		if (starting || watcher.current) return;
		setStarting(true);
		setError(null);
		let w: GitHubConnectWatcher;
		try {
			const url = await startGitHubConnect(auth);
			await Linking.openURL(url);
			w = watchGitHubConnection(() => getGitHubStatus(auth));
			watcher.current = w;
		} catch (e) {
			if (mounted.current) setError(githubErrorText(e));
			return;
		} finally {
			if (mounted.current) setStarting(false);
		}

		setWaiting(true);
		const outcome = await w.result;
		if (watcher.current === w) watcher.current = null;
		if (!mounted.current) return;
		setWaiting(false);
		if (outcome.kind === 'connected') {
			setStatus(outcome.status);
			toast.show(outcome.status.login ? `GitHub (@${outcome.status.login}) と連携しました` : 'GitHub と連携しました', 'success');
		} else if (outcome.kind === 'timeout') {
			setError('5 分待ちましたが連携を確認できませんでした。もう一度「GitHub と連携」からお試しください。');
		}
	}, [auth, starting, toast]);

	const cancelConnect = useCallback(() => {
		watcher.current?.cancel();
	}, []);

	const disconnect = useCallback(async (): Promise<boolean> => {
		const ok = await confirmAction({
			title: 'GitHub の連携を解除しますか？',
			message: 'リポジトリを一覧から選べなくなります (URL の直接入力は使えます)。動いているセッションには影響しません。',
			confirmLabel: '解除',
			destructive: true,
		});
		if (!ok) return false;
		setDisconnecting(true);
		try {
			await disconnectGitHub(auth);
			if (mounted.current) {
				setStatus(s => ({ configured: s?.configured ?? true, connected: false }));
				toast.show('GitHub の連携を解除しました', 'success');
			}
			return true;
		} catch (e) {
			toast.show(githubErrorText(e), 'error');
			return false;
		} finally {
			if (mounted.current) setDisconnecting(false);
		}
	}, [auth, toast]);

	const markDisconnected = useCallback(() => {
		setStatus(s => (s ? { configured: s.configured, connected: false } : s));
	}, []);

	return { status, error, starting, waiting, disconnecting, refresh, connect, cancelConnect, disconnect, markDisconnected };
};

// ---------------------------------------------------------------------------
// アカウント
// ---------------------------------------------------------------------------

export const GitHubAccountRow = ({ status, disconnecting, onDisconnect }: {
	status: GitHubStatus;
	disconnecting: boolean;
	onDisconnect: () => void;
}) => (
	<View style={styles.account}>
		{status.avatarUrl ? (
			<Image source={{ uri: status.avatarUrl }} style={styles.avatar} accessibilityIgnoresInvertColors />
		) : (
			<View style={[styles.avatar, styles.avatarFallback]}><Icon name='github' size={14} color={colors.fgMuted} /></View>
		)}
		<View style={styles.flex}>
			<Text style={styles.accountLogin} numberOfLines={1}>{status.login ? `@${status.login}` : 'GitHub'}</Text>
			<Muted>GitHub と連携中</Muted>
		</View>
		<Button
			title='解除'
			variant='ghost'
			size='sm'
			loading={disconnecting}
			onPress={onDisconnect}
			accessibilityLabel='GitHub の連携を解除'
		/>
	</View>
);

// ---------------------------------------------------------------------------
// 連携
// ---------------------------------------------------------------------------

export const GitHubConnectPanel = ({ starting, waiting, onConnect, onCancel }: {
	starting: boolean;
	waiting: boolean;
	onConnect: () => void;
	onCancel: () => void;
}) => (
	<View style={styles.connectPanel}>
		{waiting ? (
			<>
				<View style={styles.waitingRow} accessibilityLiveRegion='polite'>
					<ActivityIndicator size='small' color={colors.running} />
					<Text style={styles.waitingText}>ブラウザで GitHub の連携を許可してください…</Text>
				</View>
				<Muted>許可したらこのアプリに戻ってください。自動で続きに進みます。</Muted>
				<Button title='キャンセル' variant='secondary' size='sm' onPress={onCancel} style={styles.alignStart} />
			</>
		) : (
			<>
				<Muted>GitHub アカウントと連携すると、URL を入力しなくても自分のリポジトリ (非公開を含む) を一覧から選べます。</Muted>
				<Button title='GitHub と連携' icon='github' loading={starting} onPress={onConnect} />
			</>
		)}
	</View>
);

// ---------------------------------------------------------------------------
// リポジトリ一覧
// ---------------------------------------------------------------------------

const RepoRow = ({ repo, onPress }: { repo: GitHubRepo; onPress: () => void }) => (
	<Pressable
		accessibilityRole='button'
		accessibilityLabel={`${repo.fullName}${repo.private ? '、非公開' : ''}を選ぶ`}
		onPress={onPress}
		style={({ pressed }) => [styles.repoRow, pressed && styles.pressed]}
	>
		<Icon name={repo.private ? 'lock' : 'book'} size={14} color={repo.private ? colors.accentText : colors.fgFaint} />
		<View style={styles.flex}>
			<Text style={styles.repoName} numberOfLines={1}>
				{repo.name}
				<Text style={styles.repoOwner}>  {repo.owner}</Text>
			</Text>
			{repo.description ? <Muted numberOfLines={1}>{repo.description}</Muted> : null}
		</View>
		{repo.pushedAt ? <Text style={styles.repoTime}>{relativeTimeFromIso(repo.pushedAt)}</Text> : null}
	</Pressable>
);

export const GitHubRepoPicker = ({ auth, onSelect, onNotConnected }: {
	auth: DivisionSession;
	onSelect: (repo: GitHubRepo) => void;
	/** トークンが失効していた (409 github_not_connected) */
	onNotConnected: () => void;
}) => {
	const toast = useToast();
	const [query, setQuery] = useState('');
	const [debounced, setDebounced] = useState('');
	const [repos, setRepos] = useState<GitHubRepo[]>([]);
	const [page, setPage] = useState(1);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	/** 古い問い合わせの結果で上書きしないための通し番号 */
	const requestId = useRef(0);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query]);

	const load = useCallback(async (q: string, nextPage: number) => {
		const id = ++requestId.current;
		setLoading(true);
		setError(null);
		try {
			const res = await listGitHubRepos(auth, { q, page: nextPage });
			if (id !== requestId.current) return;
			setRepos(prev => (nextPage === 1 ? res.repos : mergeRepoPages(prev, res.repos)));
			setPage(nextPage);
			setHasMore(res.hasMore);
		} catch (e) {
			if (id !== requestId.current) return;
			if (isGitHubNotConnected(e)) {
				toast.show(githubErrorText(e), 'error');
				onNotConnected();
				return;
			}
			setError(githubErrorText(e));
		} finally {
			if (id === requestId.current) setLoading(false);
		}
	}, [auth, onNotConnected, toast]);

	useEffect(() => {
		void load(debounced, 1);
	}, [debounced, load]);

	// 画面を離れたあとに返ってきた結果は捨てる
	useEffect(() => () => { requestId.current += 1; }, []);

	const firstLoad = loading && page === 1;

	return (
		<View style={styles.picker}>
			<Input
				value={query}
				onChangeText={setQuery}
				placeholder='リポジトリを検索'
				autoCapitalize='none'
				autoCorrect={false}
				returnKeyType='search'
				accessibilityLabel='リポジトリを検索'
			/>
			{error ? <ErrorBanner message={error} onRetry={() => void load(debounced, 1)} style={styles.inlineBanner} /> : null}
			<View style={styles.repoBox}>
				<ScrollView nestedScrollEnabled keyboardShouldPersistTaps='handled'>
					{repos.map(repo => <RepoRow key={repo.fullName} repo={repo} onPress={() => onSelect(repo)} />)}
					{firstLoad && repos.length === 0 ? (
						<View style={styles.boxNote}><ActivityIndicator size='small' color={colors.fgMuted} /></View>
					) : null}
					{!loading && !error && repos.length === 0 ? (
						<Muted style={styles.boxNote}>
							{debounced ? `「${debounced}」に一致するリポジトリはありません。` : 'リポジトリがありません。'}
						</Muted>
					) : null}
					{hasMore ? (
						<Button
							title='もっと見る'
							variant='ghost'
							size='sm'
							loading={loading && repos.length > 0}
							onPress={() => void load(debounced, page + 1)}
							style={styles.moreButton}
						/>
					) : null}
				</ScrollView>
				{firstLoad && repos.length > 0 ? <View style={styles.refreshing}><ActivityIndicator size='small' color={colors.fgMuted} /></View> : null}
			</View>
		</View>
	);
};

// ---------------------------------------------------------------------------
// 選んだリポジトリとブランチ
// ---------------------------------------------------------------------------

export const GitHubRepoSelection = ({ auth, repo, branch, onBranch, onChange, onNotConnected }: {
	auth: DivisionSession;
	repo: GitHubRepo;
	branch: string;
	onBranch: (branch: string) => void;
	/** 「変更」 (一覧に戻る) */
	onChange: () => void;
	onNotConnected: () => void;
}) => {
	const toast = useToast();
	const [branches, setBranches] = useState<string[] | null>(null);
	const [defaultBranch, setDefaultBranch] = useState(repo.defaultBranch);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState('');
	const [reload, setReload] = useState(0);

	// 取得が終わった時点の値で判断するので、最新の branch / onBranch は ref から読む
	const branchRef = useRef(branch);
	branchRef.current = branch;
	const onBranchRef = useRef(onBranch);
	onBranchRef.current = onBranch;
	const onNotConnectedRef = useRef(onNotConnected);
	onNotConnectedRef.current = onNotConnected;

	useEffect(() => {
		let cancelled = false;
		setBranches(null);
		setError(null);
		listGitHubBranches(auth, repo.fullName)
			.then(res => {
				if (cancelled) return;
				setBranches(res.branches);
				const fallback = res.defaultBranch || repo.defaultBranch;
				setDefaultBranch(fallback);
				// 前回のブランチが無くなっていたら既定のブランチにする
				if (!branchRef.current || (res.branches.length > 0 && !res.branches.includes(branchRef.current))) {
					onBranchRef.current(fallback);
				}
			})
			.catch((e: unknown) => {
				if (cancelled) return;
				if (isGitHubNotConnected(e)) {
					toast.show(githubErrorText(e), 'error');
					onNotConnectedRef.current();
					return;
				}
				setError(githubErrorText(e));
				if (!branchRef.current) onBranchRef.current(repo.defaultBranch);
			});
		return () => { cancelled = true; };
	}, [auth, repo.fullName, repo.defaultBranch, reload, toast]);

	const shown = useMemo(() => {
		const list = branches ?? [];
		const q = filter.trim().toLowerCase();
		const matched = q ? list.filter(b => b.toLowerCase().includes(q)) : list;
		return { rows: matched.slice(0, MAX_BRANCH_ROWS), hidden: Math.max(0, matched.length - MAX_BRANCH_ROWS) };
	}, [branches, filter]);

	return (
		<View style={styles.selection}>
			<View style={styles.selectedHeader}>
				<Icon name={repo.private ? 'lock' : 'book'} size={16} color={repo.private ? colors.accentText : colors.fgMuted} />
				<View style={styles.flex}>
					<Text style={styles.selectedName} numberOfLines={1}>{repo.fullName}</Text>
					{repo.description ? <Muted numberOfLines={1}>{repo.description}</Muted> : null}
				</View>
				<Button title='変更' variant='ghost' size='sm' onPress={onChange} accessibilityLabel='リポジトリを選び直す' />
			</View>

			<Pressable
				accessibilityRole='button'
				accessibilityState={{ expanded: open }}
				accessibilityLabel={`ブランチ ${branch || defaultBranch || '既定'}。${open ? '一覧を閉じる' : 'ブランチを選ぶ'}`}
				onPress={() => setOpen(v => !v)}
				style={({ pressed }) => [styles.branchChip, pressed && styles.pressed]}
			>
				<Icon name='git-branch' size={14} color={colors.fgMuted} />
				<Text style={styles.branchText} numberOfLines={1}>{branch || defaultBranch || '既定のブランチ'}</Text>
				{branch && branch === defaultBranch ? <Text style={styles.branchDefault}>既定</Text> : null}
				{branches === null && !error ? <ActivityIndicator size='small' color={colors.fgFaint} /> : null}
				<Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.fgFaint} />
			</Pressable>

			{error ? <ErrorBanner tone='warning' message={`ブランチを読み込めませんでした: ${error}`} onRetry={() => setReload(n => n + 1)} style={styles.inlineBanner} /> : null}

			{open && branches ? (
				<View style={styles.branchList}>
					{branches.length > BRANCH_FILTER_THRESHOLD ? (
						<Input
							value={filter}
							onChangeText={setFilter}
							placeholder='ブランチを絞り込む'
							autoCapitalize='none'
							autoCorrect={false}
							accessibilityLabel='ブランチを絞り込む'
						/>
					) : null}
					<View style={styles.branchBox}>
						<ScrollView nestedScrollEnabled keyboardShouldPersistTaps='handled'>
							{shown.rows.map(name => {
								const selected = name === branch;
								return (
									<Pressable
										key={name}
										accessibilityRole='button'
										accessibilityState={{ selected }}
										onPress={() => { onBranch(name); setOpen(false); setFilter(''); }}
										style={({ pressed }) => [styles.branchRow, pressed && styles.pressed]}
									>
										<Text style={[styles.branchRowText, selected && styles.branchRowSelected]} numberOfLines={1}>{name}</Text>
										{name === defaultBranch ? <Text style={styles.branchDefault}>既定</Text> : null}
										{selected ? <Icon name='check' size={14} color={colors.accentText} /> : null}
									</Pressable>
								);
							})}
							{shown.rows.length === 0 ? <Muted style={styles.boxNote}>一致するブランチはありません。</Muted> : null}
							{shown.hidden > 0 ? <Muted style={styles.boxNote}>ほかに {shown.hidden} 件あります。絞り込んでください。</Muted> : null}
						</ScrollView>
					</View>
				</View>
			) : null}
		</View>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	alignStart: { alignSelf: 'flex-start' },
	pressed: { opacity: 0.6 },
	inlineBanner: { marginHorizontal: 0 },
	account: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.bgHover },
	avatarFallback: { alignItems: 'center', justifyContent: 'center' },
	accountLogin: { color: colors.fg, fontSize: fontSize.sm, fontWeight: '600' },
	connectPanel: {
		gap: spacing.sm,
		padding: spacing.md,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
	},
	waitingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	waitingText: { flex: 1, color: colors.fg, fontSize: fontSize.sm },
	picker: { gap: spacing.sm },
	repoBox: {
		maxHeight: 360,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		overflow: 'hidden',
	},
	repoRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		minHeight: 52,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	repoName: { color: colors.fg, fontSize: fontSize.sm, fontWeight: '600' },
	repoOwner: { color: colors.fgFaint, fontSize: fontSize.xs, fontWeight: '400' },
	repoTime: { color: colors.fgFaint, fontSize: fontSize.xs },
	boxNote: { padding: spacing.md, alignItems: 'center' },
	moreButton: { alignSelf: 'center', marginVertical: spacing.xs },
	refreshing: { position: 'absolute', top: spacing.sm, right: spacing.sm },
	selection: {
		gap: spacing.sm,
		padding: spacing.md,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.borderStrong,
		backgroundColor: colors.bgElevated,
	},
	selectedHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	selectedName: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600' },
	branchChip: {
		flexDirection: 'row',
		alignItems: 'center',
		alignSelf: 'flex-start',
		gap: spacing.xs,
		maxWidth: '100%',
		minHeight: 32,
		paddingHorizontal: spacing.sm + 2,
		borderRadius: 16,
		borderWidth: 1,
		borderColor: colors.borderStrong,
		backgroundColor: colors.bgInput,
	},
	branchText: { flexShrink: 1, color: colors.fg, fontSize: fontSize.xs + 1 },
	branchDefault: { color: colors.fgFaint, fontSize: fontSize.xs - 1 },
	branchList: { gap: spacing.sm },
	branchBox: {
		maxHeight: 260,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bg,
	},
	branchRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		minHeight: 40,
		paddingHorizontal: spacing.md,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	branchRowText: { flex: 1, color: colors.fgMuted, fontSize: fontSize.xs + 1 },
	branchRowSelected: { color: colors.fgStrong, fontWeight: '600' },
});
