/**
 * クラウドエージェントのページ。
 *
 * Division のサーバー上 (Daytona のサンドボックス) で動くエージェントのセッションを、
 * 起動・監視・追加指示・停止・アーカイブする。PC の Orchestra から起動したセッションも
 * 同じアカウントなら一覧に出るので、外出先から様子を見て続きを指示できる。
 *
 *   - 一覧      … 状態・題名・変更ファイル数・モデル・出どころ。動いているものがあれば 4 秒、無ければ 20 秒ごとに更新
 *   - 新規      … 指示・並列数 (1〜10)・出どころ (Git リポジトリ / 空のフォルダ)・モデル。
 *                 リポジトリは GitHub と連携していれば一覧から選べる (非公開も可)。URL の直接入力も残してある
 *   - モデル    … デスクトップのモデルの選択と同じく "Division Project · <プロジェクト>" が先頭。選ぶとリーダーが
 *                 役割ごとに分担するマルチエージェントで動く。続けて既定 (プロジェクトの coder)・直接指定。前回の選択を覚える
 *   - 詳細      … ログ (指示・返答・ツール実行・状態) を 2 秒ごとに差分取得、変更ファイルと差分 (読むだけ)。
 *                 Division Project では計画 (チェックリスト)・タスクの見出しと結果・返答の役割も出す
 *   - 上の段    … 「プロジェクト」「コスト」「カンバン」へのショートカット (デスクトップと同じくクラウドから辿れる)。
 *                 カンバンと Division のプロジェクトは PC 接続が必要なので、未接続なら押せない
 *   - プロジェクト … 新規のシートで Division のプロジェクトを選ぶと、そのプロジェクトのコーダーのモデルで動く
 *   - 料金      … 各セッションの料金 (costUsd) と、一覧の合計
 *
 * 変更を手元のワークスペースに取り込むのは PC の Orchestra の役目で、ここでは差分を読むだけにする。
 * Division API 直結なので、PC に接続していなくても使える。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ActivityIndicator,
	AppState,
	BackHandler,
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

import {
	BackProvider,
	Badge,
	Body,
	Button,
	Card,
	ChipGroup,
	Dot,
	EmptyState,
	ErrorBanner,
	Icon,
	IconButton,
	IconName,
	Input,
	Loading,
	Muted,
	Row,
	Screen,
	ScreenHeader,
	SectionTitle,
	SegmentedControl,
	Sheet,
	confirmAction,
	useToast,
} from '../components/ui';
import { CloudModelPicker } from '../components/CloudModelPicker';
import { CloudProjectPicker, CloudProjects, useCloudProjects } from '../components/CloudProjectPicker';
import {
	CloudChange,
	CloudChanges,
	CloudModelSelection,
	CloudRepo,
	CloudSession,
	CloudSessionEvent,
	CloudSessionStatus,
	CloudSource,
	DivisionTimeline,
	MAX_PARALLEL_SESSIONS,
	PatchSection,
	PlanProgress,
	PlanTaskState,
	archiveCloudSession,
	canSendMessage,
	classifyPatchLines,
	cloudErrorText,
	cloudModelLabel,
	cloudSource,
	cloudStatusColor,
	cloudStatusLabel,
	divisionTimeline,
	fetchCloudChanges,
	fetchCloudEvents,
	finishedSessions,
	isActive,
	isDivisionProjectModel,
	isFullNameRepo,
	lastSeqOf,
	launchModelFields,
	launchSessions,
	listCloudSessions,
	listPollInterval,
	mergeEvents,
	modelSelectionIssue,
	sectionForChange,
	sendCloudMessage,
	splitPatch,
	stopCloudSession,
	sumCloudCosts,
	taskHeaderLabel,
	toCloudPlan,
	toCloudTaskEvent,
	toolCallSummary,
	truncateLines,
	validateBranch,
	validateRepoUrl,
} from '../lib/divisionCloud';
import { DivisionSession } from '../lib/divisionAuth';
import { GitHubRepo } from '../lib/divisionGitHub';
import { CloudProjectOption, projectLabel } from '../lib/divisionProjects';
import { durationText, oneLine, relativeTimeFromIso } from '../lib/format';
import { formatUsdCompact } from '../lib/tuning';
import { OpenPage, PageKey, canOpenPage } from '../navigation';
import { notifyRemoteEvent } from '../lib/remoteNotifications';
import {
	GitHubAccountRow,
	GitHubConnectPanel,
	GitHubRepoPicker,
	GitHubRepoSelection,
	useGitHubConnection,
} from '../components/GitHubRepoPicker';
import { useApp } from '../state/AppContext';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import {
	clearLastCloudRepo,
	loadLastCloudModel,
	loadLastCloudRepo,
	saveLastCloudModel,
	saveLastCloudRepo,
} from '../state/cloudStorage';
import { colors, fontSize, radius, spacing, withAlpha } from '../theme';

/** 開いているセッションのイベントを取りに行く間隔。 */
const EVENTS_POLL_MS = 2_000;
/** 1 回で取るイベントの上限。これだけ返ってきたら続きをすぐ取りに行く。 */
const EVENTS_PAGE = 500;
/** 差分の表示はファイルごとにこの行数まで (描画が重くなるため)。 */
const MAX_DIFF_LINES = 1_000;

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** アプリが前面にあるか。裏にいるあいだはポーリングを止める。 */
const useForeground = (): boolean => {
	const [foreground, setForeground] = useState(AppState.currentState !== 'background');
	useEffect(() => {
		const sub = AppState.addEventListener('change', next => setForeground(next !== 'background'));
		return () => sub.remove();
	}, []);
	return foreground;
};

const SOURCE_ICONS: Record<CloudSource['kind'], IconName> = { repo: 'git-branch', workspace: 'monitor', empty: 'folder' };

/** Division Project (マルチエージェント) は人の集まりの印、それ以外はチップの印。 */
const modelIcon = (session: Pick<CloudSession, 'model'>): IconName => (isDivisionProjectModel(session.model) ? 'users' : 'cpu');

/** 状態の印。動いているあいだはくるくる、止まっていれば色の点。 */
const StatusMark = ({ status }: { status: CloudSessionStatus }) => (
	isActive(status)
		? <ActivityIndicator size='small' color={cloudStatusColor(status)} />
		: <View style={styles.statusDotWrap}><Dot color={cloudStatusColor(status)} /></View>
);

// ---------------------------------------------------------------------------
// ショートカット (プロジェクト / コスト / カンバン)
// ---------------------------------------------------------------------------

type Shortcut = { page: PageKey; label: string; icon: IconName; detail: string | null };

const ShortcutRow = ({ items, connected, onOpen }: {
	items: Shortcut[];
	connected: boolean;
	onOpen: (page: PageKey) => void;
}) => {
	const toast = useToast();
	const locked = items.filter(item => !canOpenPage(item.page, connected));
	return (
		<View style={styles.shortcuts}>
			<View style={styles.shortcutRow}>
				{items.map(item => {
					const enabled = canOpenPage(item.page, connected);
					return (
						<Pressable
							key={item.page}
							accessibilityRole='button'
							accessibilityState={{ disabled: !enabled }}
							accessibilityLabel={enabled ? `${item.label}を開く` : `${item.label}。PC に接続すると使えます`}
							onPress={() => (enabled ? onOpen(item.page) : toast.show('PC に接続すると使えます', 'info'))}
							style={({ pressed }) => [styles.shortcut, !enabled && styles.shortcutDisabled, pressed && enabled && styles.rowPressed]}
						>
							<Icon name={enabled ? item.icon : 'lock'} size={18} color={enabled ? colors.fg : colors.fgFaint} />
							<Text style={[styles.shortcutLabel, !enabled && { color: colors.fgFaint }]} numberOfLines={1}>{item.label}</Text>
							<Text style={styles.shortcutDetail} numberOfLines={1}>{enabled ? item.detail ?? ' ' : 'PC 接続が必要'}</Text>
						</Pressable>
					);
				})}
			</View>
			{locked.length > 0 ? (
				<Muted>{locked.map(item => item.label).join('と')}は PC に接続すると使えます。</Muted>
			) : null}
		</View>
	);
};

// ---------------------------------------------------------------------------
// 一覧の行
// ---------------------------------------------------------------------------

const SessionRow = ({ item, projectName, onPress, onStop, stopping }: {
	item: CloudSession;
	/** プロジェクトを指定して起動したセッションなら、その名前 */
	projectName: string | null;
	onPress: () => void;
	onStop: () => void;
	stopping: boolean;
}) => {
	const source = cloudSource(item);
	const meta = [
		cloudStatusLabel(item.status),
		relativeTimeFromIso(item.updatedAt),
		item.changedFiles > 0 ? `${item.changedFiles} ファイル変更` : null,
		typeof item.costUsd === 'number' ? formatUsdCompact(item.costUsd) : null,
	].filter(Boolean).join(' · ');
	return (
		<Pressable
			accessibilityRole='button'
			accessibilityLabel={`${item.title}、${cloudStatusLabel(item.status)}`}
			onPress={onPress}
			style={({ pressed }) => [styles.sessionRow, pressed && styles.rowPressed]}
		>
			<StatusMark status={item.status} />
			<View style={styles.flex}>
				<Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
				<Text style={[styles.rowMeta, { color: cloudStatusColor(item.status) }]} numberOfLines={1}>{meta}</Text>
				<Row style={styles.rowBadges}>
					<Badge label={cloudModelLabel(item)} icon={modelIcon(item)} />
					<Badge label={source.label} icon={SOURCE_ICONS[source.kind]} />
					{projectName ? <Badge label={projectName} icon='layers' /> : null}
				</Row>
			</View>
			{isActive(item.status)
				? <Button title='停止' variant='ghost' size='sm' loading={stopping} onPress={onStop} accessibilityLabel={`${item.title} を停止`} />
				: <Icon name='chevron-right' size={16} color={colors.fgFaint} />}
		</Pressable>
	);
};

// ---------------------------------------------------------------------------
// 新しいセッション
// ---------------------------------------------------------------------------

type Draft = {
	prompt: string;
	count: string;
	source: 'repo' | 'empty';
	/** GitHub 連携で選んだリポジトリ (未選択なら null) */
	repo: GitHubRepo | null;
	/** 選んだリポジトリのブランチ (空なら既定のブランチ) */
	repoBranch: string;
	/** 「URL を直接入力」を開いているか (GitHub 連携が使えないときは常に直接入力) */
	manualUrl: boolean;
	repoUrl: string;
	branch: string;
	/** モデルの選び方 (Division Project / 既定 / 直接指定) */
	modelMode: CloudModelSelection['mode'];
	/** 直接指定のモデル (provider/model) */
	model: string;
	title: string;
	/**
	 * Division のプロジェクト ID (空なら指定なし)。モデルに Division Project を選んだときはそのプロジェクトで、
	 * 「プロジェクト」の欄はこれに固定される (モデルとプロジェクトが食い違わないよう 1 つの値で持つ)。
	 */
	projectId: string;
	showAdvanced: boolean;
};

const modelSelectionOf = (draft: Pick<Draft, 'modelMode' | 'model' | 'projectId'>): CloudModelSelection =>
	({ mode: draft.modelMode, model: draft.model, projectId: draft.projectId });

const EMPTY_DRAFT: Draft = {
	prompt: '',
	count: '1',
	source: 'repo',
	repo: null,
	repoBranch: '',
	manualUrl: false,
	repoUrl: '',
	branch: '',
	modelMode: 'default',
	model: '',
	title: '',
	projectId: '',
	showAdvanced: false,
};

const COUNT_OPTIONS = Array.from({ length: MAX_PARALLEL_SESSIONS }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

const SOURCE_OPTIONS: { value: Draft['source']; label: string }[] = [
	{ value: 'repo', label: 'Gitリポジトリ' },
	{ value: 'empty', label: '空のフォルダ' },
];

/**
 * リポジトリの決め方。
 *   picker  … GitHub の一覧から選ぶ (連携済みならリスト、未連携なら「GitHub と連携」)
 *   manual  … URL を直接入力 (自分で開いたか、サーバーに GitHub 連携が無いか、状態を取れなかった)
 *   loading … 連携の状態を確認中
 */
type RepoMode = 'picker' | 'manual' | 'loading';

const draftIssues = (draft: Draft, mode: RepoMode, connected: boolean): { repoUrl: string | null; branch: string | null; ok: boolean } => {
	const prompt = !!draft.prompt.trim() && !modelSelectionIssue(modelSelectionOf(draft));
	if (draft.source !== 'repo') return { repoUrl: null, branch: null, ok: prompt };
	if (mode === 'manual') {
		const repoUrl = validateRepoUrl(draft.repoUrl);
		const branch = validateBranch(draft.branch);
		return { repoUrl, branch, ok: prompt && !repoUrl && !branch };
	}
	const branch = validateBranch(draft.repoBranch);
	return { repoUrl: null, branch, ok: prompt && mode === 'picker' && connected && !!draft.repo && !branch };
};

/** 起動に使うリポジトリ。一覧から選んでいれば { fullName }、直接入力なら { url }。 */
const draftRepo = (draft: Draft, mode: RepoMode): CloudRepo | undefined => {
	if (draft.source !== 'repo') return undefined;
	if (mode === 'picker' && draft.repo) return { fullName: draft.repo.fullName, branch: draft.repoBranch.trim() || undefined };
	return { url: draft.repoUrl, branch: draft.branch.trim() || undefined };
};

const NewSessionSheet = ({ auth, projects, draft, onChange, onClose, onLaunch }: {
	auth: DivisionSession;
	projects: CloudProjects;
	draft: Draft;
	onChange: React.Dispatch<React.SetStateAction<Draft>>;
	onClose: () => void;
	onLaunch: (repo: CloudRepo | undefined) => void;
}) => {
	const github = useGitHubConnection(auth);
	const status = github.status;
	const configured = !!status?.configured;
	const connected = !!status?.connected;
	const mode: RepoMode = draft.manualUrl || (status && !configured) || (!status && github.error)
		? 'manual'
		: status ? 'picker' : 'loading';
	const issues = draftIssues(draft, mode, connected);
	const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange(d => ({ ...d, [key]: value }));
	const count = Number(draft.count);

	// 連携済みなら、前回選んだリポジトリとブランチを選んだ状態にする (シートを開くたびに 1 回だけ)。
	const preselectTried = useRef(false);
	useEffect(() => {
		if (!connected || draft.repo || preselectTried.current) return;
		preselectTried.current = true;
		void loadLastCloudRepo(auth.userId).then(last => {
			if (last) onChange(d => (d.repo ? d : { ...d, repo: last.repo, repoBranch: last.branch }));
		});
	}, [connected, draft.repo, auth.userId, onChange]);

	const markDisconnected = github.markDisconnected;
	const onNotConnected = useCallback(() => {
		markDisconnected();
		onChange(d => ({ ...d, repo: null, repoBranch: '' }));
	}, [markDisconnected, onChange]);

	const disconnect = async () => {
		if (await github.disconnect()) {
			onChange(d => ({ ...d, repo: null, repoBranch: '' }));
			void clearLastCloudRepo();
		}
	};

	const selectRepo = useCallback((repo: GitHubRepo) => {
		onChange(d => ({ ...d, repo, repoBranch: d.repo?.fullName === repo.fullName ? d.repoBranch : '' }));
	}, [onChange]);
	const setRepoBranch = useCallback((value: string) => onChange(d => ({ ...d, repoBranch: value })), [onChange]);

	return (
		<Sheet title='新しいセッション' eyebrow='クラウドエージェント' onClose={onClose}>
			<ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps='handled'>
				<View style={styles.field}>
					<SectionTitle>指示</SectionTitle>
					<Input
						value={draft.prompt}
						onChangeText={value => set('prompt', value)}
						placeholder='エージェントにやってほしいこと'
						multiline
						accessibilityLabel='エージェントへの指示'
						style={styles.promptInput}
					/>
				</View>

				<View style={styles.field}>
					<SectionTitle>並列数</SectionTitle>
					<ChipGroup options={COUNT_OPTIONS} value={draft.count} onChange={value => set('count', value)} />
					<Muted>同じ指示を別々のサンドボックスで {count} 個同時に動かします{count > 1 ? '。題名の末尾に #1〜#' + count + ' が付きます' : ''}。</Muted>
				</View>

				<View style={styles.field}>
					<SectionTitle>始める場所</SectionTitle>
					<SegmentedControl options={SOURCE_OPTIONS} value={draft.source} onChange={value => set('source', value)} />
					{draft.source === 'repo' && mode === 'loading' ? (
						<View style={styles.githubChecking}>
							<ActivityIndicator size='small' color={colors.fgMuted} />
							<Muted>GitHub の連携を確認しています…</Muted>
						</View>
					) : null}
					{draft.source === 'repo' && github.error ? (
						<ErrorBanner
							tone='warning'
							message={status ? github.error : `GitHub の連携状態を確認できませんでした: ${github.error}`}
							onRetry={status ? undefined : () => void github.refresh()}
							style={styles.inlineBanner}
						/>
					) : null}
					{draft.source === 'repo' && mode === 'picker' && status ? (
						connected ? (
							<>
								<GitHubAccountRow status={status} disconnecting={github.disconnecting} onDisconnect={() => void disconnect()} />
								{draft.repo ? (
									<GitHubRepoSelection
										auth={auth}
										repo={draft.repo}
										branch={draft.repoBranch}
										onBranch={setRepoBranch}
										onChange={() => onChange(d => ({ ...d, repo: null, repoBranch: '' }))}
										onNotConnected={onNotConnected}
									/>
								) : (
									<GitHubRepoPicker auth={auth} onSelect={selectRepo} onNotConnected={onNotConnected} />
								)}
								<Muted>非公開のリポジトリも、連携したアカウントの権限でサーバーが clone します。</Muted>
							</>
						) : (
							<GitHubConnectPanel
								starting={github.starting}
								waiting={github.waiting}
								onConnect={() => void github.connect()}
								onCancel={github.cancelConnect}
							/>
						)
					) : null}
					{draft.source === 'repo' && mode === 'manual' ? (
						<>
							<Input
								value={draft.repoUrl}
								onChangeText={value => set('repoUrl', value)}
								placeholder='https://github.com/owner/repo.git'
								autoCapitalize='none'
								autoCorrect={false}
								keyboardType='url'
								accessibilityLabel='リポジトリの URL'
								style={draft.repoUrl.trim() && issues.repoUrl ? styles.inputInvalid : undefined}
							/>
							{draft.repoUrl.trim() && issues.repoUrl ? <Text style={styles.invalidText}>{issues.repoUrl}</Text> : null}
							<Input
								value={draft.branch}
								onChangeText={value => set('branch', value)}
								placeholder='ブランチ (空欄なら既定のブランチ)'
								autoCapitalize='none'
								autoCorrect={false}
								accessibilityLabel='ブランチ'
								style={issues.branch ? styles.inputInvalid : undefined}
							/>
							{issues.branch ? <Text style={styles.invalidText}>{issues.branch}</Text> : null}
							<Muted>
								{connected
									? 'github.com の URL は連携したアカウントの権限で clone します。それ以外は公開リポジトリのみです (URL に認証情報は入れられません)。'
									: '公開リポジトリだけ clone できます (URL に認証情報は入れられません)。'}
							</Muted>
							{status && !configured ? (
								<Muted>サーバー側で GitHub 連携が未設定のため、リポジトリを一覧から選べません (管理者が GitHub OAuth アプリを設定すると使えます)。</Muted>
							) : null}
						</>
					) : null}
					{draft.source === 'repo' && mode !== 'manual' ? (
						<Pressable accessibilityRole='button' onPress={() => set('manualUrl', true)} style={styles.linkButton}>
							<Icon name='link' size={14} color={colors.accentText} />
							<Text style={styles.linkText}>URL を直接入力</Text>
						</Pressable>
					) : null}
					{draft.source === 'repo' && mode === 'manual' && draft.manualUrl && configured ? (
						<Pressable accessibilityRole='button' onPress={() => set('manualUrl', false)} style={styles.linkButton}>
							<Icon name='github' size={14} color={colors.accentText} />
							<Text style={styles.linkText}>GitHub のリポジトリから選ぶ</Text>
						</Pressable>
					) : null}
					{draft.source === 'empty' ? (
						<Muted>何も無いフォルダから始めます。新しく作らせたいときに使います。</Muted>
					) : null}
				</View>

				<View style={styles.field}>
					<SectionTitle>モデル</SectionTitle>
					<CloudModelPicker
						projects={projects}
						value={modelSelectionOf(draft)}
						onChange={next => onChange(d => ({ ...d, modelMode: next.mode, model: next.model, projectId: next.projectId }))}
					/>
					{draft.modelMode === 'division' ? (
						<Muted>
							プロジェクトのリーダーが指示を役割ごとのタスクに分け、各役割に割り当てたモデルがサンドボックスで順に進めて、
							最後にまとめます。ログに計画と各タスクの進み具合が出ます。
						</Muted>
					) : null}
				</View>

				<View style={styles.field}>
					<SectionTitle>プロジェクト</SectionTitle>
					<CloudProjectPicker
						projects={projects}
						value={draft.projectId}
						onChange={value => set('projectId', value)}
						lockedReason={draft.modelMode === 'division'
							? 'モデルに Division Project を選んでいるので、そのプロジェクトに固定しています (変えるときはモデルの欄から)。'
							: undefined}
						hint={draft.modelMode === 'custom' && draft.model.trim()
							? '直接指定したモデルで動きます (プロジェクトのコーダーより優先)。'
							: '選んだプロジェクトの「コーダー」に割り当てたモデルで動きます。'}
					/>
				</View>

				<Pressable
					accessibilityRole='button'
					accessibilityState={{ expanded: draft.showAdvanced }}
					onPress={() => set('showAdvanced', !draft.showAdvanced)}
					style={styles.advancedToggle}
				>
					<Icon name={draft.showAdvanced ? 'chevron-down' : 'chevron-right'} size={16} color={colors.fgMuted} />
					<Text style={styles.advancedText}>詳細</Text>
				</Pressable>
				{draft.showAdvanced ? (
					<View style={styles.field}>
						<Input
							value={draft.title}
							onChangeText={value => set('title', value)}
							placeholder='題名 (空欄なら指示の 1 行目)'
							accessibilityLabel='題名'
						/>
					</View>
				) : null}

				<Muted>Orchestra Plus とクレジットが必要です。モデルの利用料金はセッションごとにかかります。</Muted>
				<Button
					title={count > 1 ? `${count} 個のセッションを起動` : 'セッションを起動'}
					icon='play'
					disabled={!issues.ok}
					onPress={() => onLaunch(draftRepo(draft, mode))}
				/>
			</ScrollView>
		</Sheet>
	);
};

// ---------------------------------------------------------------------------
// ログ
// ---------------------------------------------------------------------------

const UserBubble = ({ value }: { value: string }) => (
	<View style={styles.userWrap}>
		<View accessibilityLabel={`あなた: ${value}`} style={styles.userBubble}>
			<Text selectable style={styles.userText}>{value || '(内容なし)'}</Text>
		</View>
	</View>
);

/** ツールの実行は 1 行 (例: read_file src/a.ts) にし、押すと出力を開く。 */
const ToolRow = ({ data }: { data: Record<string, unknown> }) => {
	const [open, setOpen] = useState(false);
	const ok = data.ok !== false;
	const output = text(data.output);
	const duration = typeof data.durationMs === 'number' ? durationText(data.durationMs) : null;
	const summary = toolCallSummary(text(data.name), data.args);
	return (
		<Pressable
			accessibilityRole='button'
			accessibilityState={{ expanded: open }}
			accessibilityLabel={`ツール ${summary}。${ok ? '' : '失敗。'}${open ? '出力を閉じる' : '出力を見る'}`}
			onPress={() => setOpen(v => !v)}
			style={styles.tool}
		>
			<View style={styles.toolHeader}>
				<View style={[styles.toolDot, { backgroundColor: ok ? colors.fgFaint : colors.danger }]} />
				<Text style={styles.toolName} numberOfLines={open ? undefined : 1}>{summary}</Text>
				{duration ? <Text style={styles.toolDuration}>{duration}</Text> : null}
				<Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={colors.fgFaint} />
			</View>
			{open ? (
				<View style={styles.toolOutput}>
					<Text selectable style={[styles.monoText, !ok && { color: colors.danger }]}>{output || '(出力なし)'}</Text>
				</View>
			) : null}
		</Pressable>
	);
};

// ---------------------------------------------------------------------------
// Division Project の計画とタスク
// ---------------------------------------------------------------------------

/** 役割の小さなチップ (例: 実装)。 */
const RoleChip = ({ label }: { label: string }) => (
	<View style={styles.roleChip}>
		<Text style={styles.roleChipText} numberOfLines={1}>{label}</Text>
	</View>
);

const PLAN_STATE_LABELS: Record<PlanTaskState, string> = {
	pending: '未着手',
	running: '実行中',
	done: '完了',
	failed: '失敗',
	interrupted: '中断',
};

/** チェックリストの印。✓ 完了 / ✕ 失敗 / くるくる 実行中 / 白抜き 未着手 / − 中断。 */
const PlanMarker = ({ state }: { state: PlanTaskState }) => (
	<View style={styles.planMarker}>
		{state === 'done' ? <Icon name='check' size={15} color={colors.success} />
			: state === 'failed' ? <Icon name='x' size={15} color={colors.danger} />
				: state === 'running' ? <ActivityIndicator size='small' color={colors.running} />
					: state === 'interrupted' ? <Icon name='minus' size={15} color={colors.fgFaint} />
						: <View style={styles.planHollow} />}
	</View>
);

const PlanCard = ({ progress }: { progress: PlanProgress }) => {
	const total = progress.items.length;
	return (
		<View style={styles.planCard} accessibilityLabel={`計画 ${total} タスク、${progress.done} 件完了`}>
			<Row>
				<Icon name='list' size={16} color={colors.accentText} />
				<Text style={styles.planTitle}>計画 · {total} タスク</Text>
				<View style={styles.flex} />
				<Muted>{progress.done}/{total} 完了{progress.failed > 0 ? ` · ${progress.failed} 失敗` : ''}</Muted>
			</Row>
			{progress.leaderModel ? <Text style={styles.planMeta} numberOfLines={1}>リーダー: {progress.leaderModel}</Text> : null}
			{total === 0 ? <Muted>タスクはありません。</Muted> : null}
			{progress.items.map((item, i) => (
				<View
					key={`${item.index}-${i}`}
					style={styles.planItem}
					accessibilityLabel={`${i + 1}. ${item.roleName}: ${item.title}。${PLAN_STATE_LABELS[item.state]}`}
				>
					<PlanMarker state={item.state} />
					<View style={styles.flex}>
						<View style={styles.planItemHead}>
							<RoleChip label={item.roleName} />
							<Text
								style={[styles.planItemTitle, item.state === 'done' && styles.planItemDone]}
								numberOfLines={2}
							>
								{item.title || '(題名なし)'}
							</Text>
						</View>
						{item.model ? <Text style={styles.planItemModel} numberOfLines={1}>{item.model}</Text> : null}
					</View>
				</View>
			))}
		</View>
	);
};

const TaskEventView = ({ data, position }: { data: Record<string, unknown>; position?: { position: number; total: number } }) => {
	const task = toCloudTaskEvent(data);
	if (!task) return null;
	if (task.status === 'start') {
		return (
			<View style={styles.taskHeader} accessibilityRole='header' accessibilityLabel={taskHeaderLabel(task, position)}>
				<View style={styles.taskHeaderLine} />
				<Text style={styles.taskHeaderText}>
					{position ? <Text style={styles.taskHeaderPos}>{position.position}/{position.total} · </Text> : null}
					{task.roleName}
					{task.model ? <Text style={styles.taskHeaderModel}> ({task.model})</Text> : null}
					{task.title ? ` — ${task.title}` : ''}
				</Text>
			</View>
		);
	}
	const ok = task.status === 'done';
	return (
		<View style={styles.taskResult}>
			<Icon name={ok ? 'check' : 'x'} size={14} color={ok ? colors.success : colors.danger} />
			<Text selectable style={styles.taskResultText} numberOfLines={3}>
				<Text style={{ color: ok ? colors.fgMuted : colors.danger }}>{task.roleName}{ok ? ' 完了' : ' 失敗'}</Text>
				{task.summary ? ` · ${oneLine(task.summary, 240)}` : ''}
			</Text>
		</View>
	);
};

const EventView = ({ event, timeline, onShowChanges }: {
	event: CloudSessionEvent;
	timeline: DivisionTimeline;
	onShowChanges: () => void;
}) => {
	const data = event.data;
	switch (event.type) {
		case 'user':
			return <UserBubble value={text(data.text)} />;
		case 'assistant': {
			const value = text(data.text).trim();
			if (!value) return null;
			const role = text(data.role);
			if (!role) return <Text selectable style={styles.assistantText}>{value}</Text>;
			return (
				<View style={styles.assistantWithRole}>
					<RoleChip label={timeline.roleNames.get(role) ?? role} />
					<Text selectable style={styles.assistantText}>{value}</Text>
				</View>
			);
		}
		case 'plan': {
			const progress = timeline.plans.get(event.seq);
			if (progress) return <PlanCard progress={progress} />;
			const plan = toCloudPlan(data);
			return <PlanCard progress={{ leaderModel: plan.leaderModel, items: plan.tasks.map(t => ({ ...t, state: 'pending' })), done: 0, failed: 0 }} />;
		}
		case 'task':
			return <TaskEventView data={data} position={timeline.taskPositions.get(event.seq)} />;
		case 'tool':
			return <ToolRow data={data} />;
		case 'status': {
			const status = text(data.status) as CloudSessionStatus;
			const message = text(data.message);
			return (
				<View style={styles.noteRow}>
					<View style={styles.noteLine} />
					<Text style={styles.noteText}>{cloudStatusLabel(status)}{message ? ` · ${message}` : ''}</Text>
				</View>
			);
		}
		case 'error':
			return (
				<View style={styles.errorRow}>
					<Icon name='alert-circle' size={14} color={colors.danger} />
					<Text selectable style={styles.errorText}>{text(data.message) || 'エラーが発生しました'}</Text>
				</View>
			);
		case 'done': {
			const changed = typeof data.changedFiles === 'number' ? data.changedFiles : null;
			return (
				<View style={styles.doneCard}>
					<Row>
						<Icon name='check-circle' size={16} color={colors.success} />
						<Text style={styles.doneTitle}>完了</Text>
						{changed !== null ? <Muted>{changed} ファイル変更</Muted> : null}
					</Row>
					{text(data.summary) ? <Text selectable style={styles.doneText}>{text(data.summary)}</Text> : null}
					<Button title='変更を見る' variant='secondary' size='sm' icon='file-text' onPress={onShowChanges} style={styles.alignStart} />
				</View>
			);
		}
		default:
			return null;
	}
};

// ---------------------------------------------------------------------------
// 変更
// ---------------------------------------------------------------------------

const CHANGE_MARKS: Record<CloudChange['status'], { mark: string; color: string }> = {
	added: { mark: 'A', color: colors.success },
	modified: { mark: 'M', color: colors.accentText },
	deleted: { mark: 'D', color: colors.danger },
	renamed: { mark: 'R', color: colors.fgMuted },
};

const DIFF_COLORS = {
	add: { color: colors.success, backgroundColor: withAlpha(colors.success, '14') },
	del: { color: colors.danger, backgroundColor: withAlpha(colors.danger, '14') },
	hunk: { color: colors.accentText, backgroundColor: 'transparent' },
	meta: { color: colors.fgFaint, backgroundColor: 'transparent' },
	context: { color: colors.fgMuted, backgroundColor: 'transparent' },
} as const;

const DiffView = ({ section, change }: { section: PatchSection | null; change: CloudChange }) => {
	const view = useMemo(() => {
		if (!section) return null;
		const kinds = classifyPatchLines(section.lines);
		const shown = truncateLines(section.lines, MAX_DIFF_LINES);
		return { ...shown, kinds };
	}, [section]);

	if (change.binary || section?.binary) return <Muted style={styles.diffNote}>バイナリファイルのため差分は表示しません。</Muted>;
	if (!view) return <Muted style={styles.diffNote}>差分がありません (長すぎて省略された可能性があります)。</Muted>;
	return (
		<View style={styles.diffBox}>
			<ScrollView horizontal showsHorizontalScrollIndicator>
				<View>
					{view.lines.map((line, i) => {
						const tone = DIFF_COLORS[view.kinds[i]];
						return (
							<Text key={i} selectable style={[styles.diffLine, { color: tone.color, backgroundColor: tone.backgroundColor }]}>
								{line || ' '}
							</Text>
						);
					})}
				</View>
			</ScrollView>
			{view.truncated ? (
				<Muted style={styles.diffNote}>長いため先頭 {MAX_DIFF_LINES.toLocaleString('en-US')} 行だけ表示しています (残り {view.hidden.toLocaleString('en-US')} 行)。</Muted>
			) : null}
		</View>
	);
};

const ChangesView = ({ data, loading, error, onReload }: {
	data: CloudChanges | null;
	loading: boolean;
	error: string | null;
	onReload: () => void;
}) => {
	const [openIndex, setOpenIndex] = useState<number | null>(null);
	const sections = useMemo(() => splitPatch(data?.patch ?? ''), [data]);
	const totals = useMemo(() => (data?.changes ?? []).reduce(
		(sum, c) => ({ add: sum.add + Math.max(0, c.additions), del: sum.del + Math.max(0, c.deletions) }),
		{ add: 0, del: 0 },
	), [data]);

	return (
		<ScrollView
			contentContainerStyle={styles.changesContent}
			refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={onReload} tintColor={colors.fgMuted} />}
		>
			<View style={styles.pullNote}>
				<Icon name='monitor' size={16} color={colors.fgMuted} />
				<Muted style={styles.flex}>変更は表示するだけです。手元のワークスペースに取り込むときは、PC の Orchestra のクラウドエージェントから取り込んでください。</Muted>
			</View>

			{error ? <ErrorBanner message={error} onRetry={onReload} style={styles.inlineBanner} /> : null}

			{loading && !data ? <Loading label='変更を集めています…' /> : null}

			{data ? (
				<>
					<Row style={styles.spread}>
						<SectionTitle>
							{data.changes.length} ファイル{data.changes.length > 0 ? ` · +${totals.add} −${totals.del}` : ''}
						</SectionTitle>
						<Button title='更新' icon='refresh-cw' variant='ghost' size='sm' loading={loading} onPress={onReload} />
					</Row>
					{data.changes.length === 0 ? <Muted>まだ変更はありません。</Muted> : null}
					{data.patchTruncated ? (
						<ErrorBanner tone='warning' message='差分が大きいため、サーバー側で途中までに切り詰められています。' style={styles.inlineBanner} />
					) : null}
					{data.changes.map((change, index) => {
						const mark = CHANGE_MARKS[change.status];
						const open = openIndex === index;
						return (
							<View key={`${change.path}-${index}`} style={styles.changeItem}>
								<Pressable
									accessibilityRole='button'
									accessibilityState={{ expanded: open }}
									accessibilityLabel={`${change.path}。${open ? '差分を閉じる' : '差分を見る'}`}
									onPress={() => setOpenIndex(open ? null : index)}
									style={({ pressed }) => [styles.changeRow, pressed && styles.rowPressed]}
								>
									<Text style={[styles.changeMark, { color: mark.color }]}>{mark.mark}</Text>
									<View style={styles.flex}>
										<Text style={styles.changePath} numberOfLines={2}>{change.path}</Text>
										{change.oldPath ? <Muted numberOfLines={1}>{change.oldPath} から</Muted> : null}
									</View>
									{change.binary ? (
										<Muted>バイナリ</Muted>
									) : (
										<Text style={styles.changeStats}>
											<Text style={{ color: colors.success }}>+{change.additions}</Text>
											{' '}
											<Text style={{ color: colors.danger }}>−{change.deletions}</Text>
										</Text>
									)}
									<Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={colors.fgFaint} />
								</Pressable>
								{open ? <DiffView section={sectionForChange(sections, data.changes, index)} change={change} /> : null}
							</View>
						);
					})}
				</>
			) : null}
		</ScrollView>
	);
};

// ---------------------------------------------------------------------------
// 詳細
// ---------------------------------------------------------------------------

const sessionKey = (s: CloudSession): string => `${s.status}|${s.updatedAt}|${s.lastSeq}|${s.changedFiles}|${s.modelLabel}|${s.title}|${s.costUsd ?? ''}`;

const SessionDetail = ({ auth, initial, projects, foreground, onSessionChange, onArchived }: {
	auth: DivisionSession;
	initial: CloudSession;
	/** プロジェクト名の引き当てに使う一覧 */
	projects: CloudProjectOption[];
	foreground: boolean;
	onSessionChange: (next: CloudSession) => void;
	onArchived: (id: string) => void;
}) => {
	const toast = useToast();
	const insets = useSafeAreaInsets();
	const id = initial.id;

	const [current, setCurrent] = useState<CloudSession>(initial);
	const [events, setEvents] = useState<CloudSessionEvent[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<'log' | 'changes'>('log');
	const [draft, setDraft] = useState('');
	const [sending, setSending] = useState(false);
	const [stopping, setStopping] = useState(false);
	const [archiving, setArchiving] = useState(false);

	const [changes, setChanges] = useState<CloudChanges | null>(null);
	const [changesLoading, setChangesLoading] = useState(false);
	const [changesError, setChangesError] = useState<string | null>(null);
	const changesSeq = useRef<number | null>(null);

	const lastSeq = useRef(0);
	const lastKey = useRef(sessionKey(initial));
	const scrollRef = useRef<ScrollView | null>(null);
	const follow = useRef(true);

	const applySession = useCallback((next: CloudSession) => {
		setCurrent(next);
		const key = sessionKey(next);
		if (key !== lastKey.current) {
			lastKey.current = key;
			onSessionChange(next);
		}
	}, [onSessionChange]);

	const loadEvents = useCallback(async () => {
		try {
			// 長いセッションを初めて開いたときは、上限いっぱいで返ってくる限り続けて取る。
			for (let page = 0; page < 20; page++) {
				const res = await fetchCloudEvents(auth, id, lastSeq.current, EVENTS_PAGE);
				if (res.events.length > 0) {
					setEvents(prev => mergeEvents(prev, res.events));
					lastSeq.current = Math.max(lastSeq.current, lastSeqOf(res.events));
				}
				applySession(res.session);
				if (res.events.length < EVENTS_PAGE) break;
			}
			setError(null);
		} catch (e) {
			setError(cloudErrorText(e));
		} finally {
			setLoaded(true);
		}
	}, [auth, id, applySession]);

	// 開いているあいだ (アプリが前面のときだけ) 2 秒ごとに続きを取る。
	useEffect(() => {
		if (!foreground) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const tick = async () => {
			await loadEvents();
			if (!cancelled) timer = setTimeout(() => { void tick(); }, EVENTS_POLL_MS);
		};
		void tick();
		return () => { cancelled = true; if (timer) clearTimeout(timer); };
	}, [foreground, loadEvents]);

	const loadChanges = useCallback(async () => {
		setChangesLoading(true);
		setChangesError(null);
		try {
			changesSeq.current = lastSeq.current;
			setChanges(await fetchCloudChanges(auth, id));
		} catch (e) {
			setChangesError(cloudErrorText(e));
		} finally {
			setChangesLoading(false);
		}
	}, [auth, id]);

	// 「変更」を開いたとき、まだ取っていないか前回からログが進んでいれば取り直す。
	useEffect(() => {
		if (tab !== 'changes' || changesLoading) return;
		if (changesSeq.current === null || changesSeq.current !== current.lastSeq) void loadChanges();
		// changesLoading と lastSeq の変化は取り直しのきっかけにしない (タブを開いたときだけ)
	}, [tab, loadChanges]);

	const stop = useCallback(async () => {
		setStopping(true);
		try {
			applySession(await stopCloudSession(auth, id));
			toast.show('停止しました', 'success');
			void loadEvents();
		} catch (e) {
			toast.show(cloudErrorText(e), 'error');
		} finally {
			setStopping(false);
		}
	}, [auth, id, applySession, loadEvents, toast]);

	const archive = useCallback(async () => {
		const ok = await confirmAction({
			title: 'アーカイブしますか？',
			message: 'サンドボックスを削除して一覧から隠します。PC に取り込んでいない変更は失われます。',
			confirmLabel: 'アーカイブ',
			destructive: true,
		});
		if (!ok) return;
		setArchiving(true);
		try {
			await archiveCloudSession(auth, id);
			toast.show('アーカイブしました', 'success');
			onArchived(id);
		} catch (e) {
			toast.show(cloudErrorText(e), 'error');
			setArchiving(false);
		}
	}, [auth, id, onArchived, toast]);

	const send = useCallback(async () => {
		const message = draft.trim();
		if (!message || sending) return;
		setSending(true);
		try {
			applySession(await sendCloudMessage(auth, id, message));
			setDraft('');
			follow.current = true;
			void loadEvents();
		} catch (e) {
			toast.show(cloudErrorText(e), 'error');
		} finally {
			setSending(false);
		}
	}, [auth, id, draft, sending, applySession, loadEvents, toast]);

	const source = cloudSource(current);
	const active = isActive(current.status);
	const sendable = canSendMessage(current);
	// Division Project の計画ごとのタスクの状態 (plan / task イベントが無ければ空)
	const timeline = useMemo(() => divisionTimeline(events, active), [events, active]);
	const canSend = sendable && !!draft.trim() && !sending;

	return (
		<KeyboardAvoidingView
			style={styles.flex}
			behavior={Platform.OS === 'ios' ? 'padding' : undefined}
			keyboardVerticalOffset={insets.top}
		>
			<ScreenHeader title={current.title} />

			<View style={styles.detailMeta}>
				<Row style={styles.wrapRow}>
					<View style={styles.statusInline} accessibilityLabel={`状態: ${cloudStatusLabel(current.status)}`}>
						<StatusMark status={current.status} />
						<Text style={[styles.statusLabel, { color: cloudStatusColor(current.status) }]}>{cloudStatusLabel(current.status)}</Text>
					</View>
					<Badge label={cloudModelLabel(current)} icon={modelIcon(current)} />
					<Badge label={source.label} icon={SOURCE_ICONS[source.kind]} />
					{current.projectId ? <Badge label={projectLabel(projects, current.projectId) ?? ''} icon='layers' /> : null}
					{typeof current.costUsd === 'number' ? (
						<Badge label={formatUsdCompact(current.costUsd)} icon='dollar-sign' color={colors.fgMuted} />
					) : null}
				</Row>
				{current.status === 'failed' && current.errorMsg ? (
					<Text selectable style={styles.errorText} numberOfLines={4}>{current.errorMsg}</Text>
				) : null}
				<Row>
					{active ? <Button title='停止' variant='secondary' size='sm' icon='square' loading={stopping} onPress={() => void stop()} /> : null}
					<Button title='アーカイブ' variant='danger' size='sm' icon='archive' loading={archiving} onPress={() => void archive()} />
					<View style={styles.flex} />
					<Muted>{relativeTimeFromIso(current.createdAt)}に開始</Muted>
				</Row>
			</View>

			<View style={styles.toolbar}>
				<SegmentedControl<'log' | 'changes'>
					options={[
						{ value: 'log', label: 'ログ' },
						{ value: 'changes', label: current.changedFiles > 0 ? `変更 (${current.changedFiles})` : '変更' },
					]}
					value={tab}
					onChange={setTab}
				/>
			</View>

			{error ? <ErrorBanner message={error} onRetry={() => void loadEvents()} /> : null}

			{tab === 'log' ? (
				<>
					<ScrollView
						ref={scrollRef}
						style={styles.flex}
						contentContainerStyle={styles.logContent}
						keyboardShouldPersistTaps='handled'
						keyboardDismissMode='on-drag'
						scrollEventThrottle={16}
						onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
							follow.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
						}}
						onContentSizeChange={() => { if (follow.current) scrollRef.current?.scrollToEnd({ animated: false }); }}
					>
						{!loaded ? <Loading label='ログを読み込んでいます…' /> : null}
						{loaded && events.length === 0 ? <Muted>{active ? 'サンドボックスを用意しています…' : 'ログはまだありません。'}</Muted> : null}
						<View style={styles.conversation}>
							{events.map(event => (
								<EventView key={event.seq} event={event} timeline={timeline} onShowChanges={() => setTab('changes')} />
							))}
							{current.status === 'running' ? (
								<View style={styles.working} accessibilityLiveRegion='polite'>
									<ActivityIndicator size='small' color={colors.running} />
									<Text style={styles.workingText}>作業中…</Text>
								</View>
							) : null}
						</View>
					</ScrollView>

					<View style={styles.composerWrap}>
						<View style={styles.composer}>
							<TextInput
								value={draft}
								onChangeText={setDraft}
								editable={sendable}
								placeholder={sendable ? (current.status === 'running' ? '作業中のエージェントに追加で指示する…' : '続きを指示する…') : '準備ができるまで指示は送れません'}
								placeholderTextColor={colors.fgFaint}
								selectionColor={colors.fgMuted}
								accessibilityLabel='追加の指示'
								multiline
								style={styles.composerInput}
							/>
							<Button title='送信' size='sm' icon='arrow-up' disabled={!canSend} loading={sending} onPress={() => void send()} />
						</View>
					</View>
				</>
			) : (
				<ChangesView data={changes} loading={changesLoading} error={changesError} onReload={() => void loadChanges()} />
			)}
		</KeyboardAvoidingView>
	);
};

// ---------------------------------------------------------------------------
// ページ本体
// ---------------------------------------------------------------------------

export const CloudAgentsScreen = ({ onOpenPage, initialSessionId }: {
	/** 「プロジェクト」「コスト」「カンバン」を開く (App のページの重なりに積む) */
	onOpenPage?: OpenPage;
	/** 開いたらすぐ詳細を出すセッション (カンバンの「クラウドで開く」から) */
	initialSessionId?: string | null;
} = {}) => {
	const { session } = useDivisionAuth();
	const { connection, snapshot } = useApp();
	const toast = useToast();
	const foreground = useForeground();
	const connected = !!connection;
	const projects = useCloudProjects(session);

	const [sessions, setSessions] = useState<CloudSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(initialSessionId ?? null);
	const [showNew, setShowNew] = useState(false);
	const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
	const [launching, setLaunching] = useState(0);
	const [launchError, setLaunchError] = useState<string | null>(null);
	const [stoppingId, setStoppingId] = useState<string | null>(null);

	const sessionsRef = useRef<CloudSession[]>([]);
	const launchingRef = useRef(0);
	/** 前回の一覧の状態。動いていたものが終わったら通知するのに使う (最初の読み込みでは通知しない)。 */
	const previousStatus = useRef<Map<string, CloudSessionStatus> | null>(null);

	useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
	useEffect(() => { launchingRef.current = launching; }, [launching]);

	// アカウントが替わったら前のアカウントの一覧を持ち越さない (開いた直後は何もしない)。
	const lastUserId = useRef(session?.userId);
	useEffect(() => {
		if (lastUserId.current === session?.userId) return;
		lastUserId.current = session?.userId;
		previousStatus.current = null;
		setSessions([]);
		setSelectedId(null);
		setLoading(true);
		setDraft(d => ({ ...d, repo: null, repoBranch: '', projectId: '', modelMode: 'default', model: '' }));
	}, [session?.userId]);

	// 前回選んだモデル (Division Project ならそのプロジェクト) を選んだ状態にする。まだ何も選んでいないときだけ。
	useEffect(() => {
		const userId = session?.userId;
		if (!userId) return;
		let cancelled = false;
		void loadLastCloudModel(userId).then(last => {
			if (cancelled || !last) return;
			setDraft(d => (d.modelMode === 'default' && !d.model && !d.projectId
				? { ...d, modelMode: last.mode, model: last.model, projectId: last.projectId }
				: d));
		});
		return () => { cancelled = true; };
	}, [session?.userId]);

	const loadList = useCallback(async () => {
		if (!session) return;
		try {
			const rows = await listCloudSessions(session);
			if (previousStatus.current) {
				for (const s of finishedSessions(previousStatus.current, rows)) {
					void notifyRemoteEvent(
						'クラウドエージェント',
						s.status === 'idle' ? `「${s.title}」が終わりました。` : `「${s.title}」が失敗しました。`,
						'cloud-session',
					);
				}
			}
			previousStatus.current = new Map(rows.map(s => [s.id, s.status]));
			setSessions(rows);
			setError(null);
		} catch (e) {
			setError(cloudErrorText(e));
		} finally {
			setLoading(false);
		}
	}, [session]);

	// 一覧のポーリング。動いているセッションがある (か起動中) なら 4 秒、無ければ 20 秒。
	useEffect(() => {
		if (!session || !foreground) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const tick = async () => {
			await loadList();
			if (cancelled) return;
			const interval = launchingRef.current > 0 ? 4_000 : listPollInterval(sessionsRef.current);
			timer = setTimeout(() => { void tick(); }, interval);
		};
		void tick();
		return () => { cancelled = true; if (timer) clearTimeout(timer); };
	}, [session, foreground, loadList]);


	const onPull = useCallback(async () => {
		setRefreshing(true);
		try { await loadList(); } finally { setRefreshing(false); }
	}, [loadList]);

	const patchSession = useCallback((next: CloudSession) => {
		setSessions(prev => prev.map(s => (s.id === next.id ? next : s)));
	}, []);

	const onArchived = useCallback((id: string) => {
		setSelectedId(null);
		setSessions(prev => prev.filter(s => s.id !== id));
	}, []);

	const stopFromList = useCallback(async (item: CloudSession) => {
		if (!session) return;
		setStoppingId(item.id);
		try {
			patchSession(await stopCloudSession(session, item.id));
			toast.show('停止しました', 'success');
		} catch (e) {
			toast.show(cloudErrorText(e), 'error');
		} finally {
			setStoppingId(null);
		}
	}, [session, patchSession, toast]);

	const launch = useCallback(async (repo: CloudRepo | undefined) => {
		if (!session) return;
		const count = Number(draft.count);
		setShowNew(false);
		setLaunchError(null);
		setLaunching(n => n + count);
		// 次に開いたとき同じリポジトリを選んだ状態にする
		if (repo && isFullNameRepo(repo) && draft.repo) {
			void saveLastCloudRepo(session.userId, { repo: draft.repo, branch: repo.branch ?? '' });
		}
		// 次に開いたとき同じモデル (Division Project ならそのプロジェクト) を選んだ状態にする
		const selection = modelSelectionOf(draft);
		void saveLastCloudModel(session.userId, selection);
		try {
			const results = await launchSessions(session, {
				prompt: draft.prompt,
				count,
				repo,
				title: draft.title || undefined,
				// model と projectId。Division Project なら model: 'division-project' + そのプロジェクト
				...launchModelFields(selection),
			});
			const failed = results.filter(r => r.error);
			const succeeded = results.length - failed.length;
			if (failed.length === 0) {
				toast.show(succeeded > 1 ? `${succeeded} 個のセッションを起動しました` : 'セッションを起動しました', 'success');
				// 同じリポジトリで続けて起動しやすいよう、出どころは残して指示だけ消す。
				setDraft(d => ({ ...d, prompt: '', title: '' }));
			} else if (succeeded === 0) {
				setLaunchError(`起動できませんでした: ${failed[0].error}`);
			} else {
				toast.show(`${succeeded} 個を起動しました。${failed.length} 個は失敗しました: ${failed[0].error}`, 'error');
			}
		} catch (e) {
			setLaunchError(`起動できませんでした: ${cloudErrorText(e)}`);
		} finally {
			setLaunching(n => Math.max(0, n - count));
			void loadList();
		}
	}, [session, draft, toast, loadList]);

	const selected = useMemo(() => sessions.find(s => s.id === selectedId) ?? null, [sessions, selectedId]);
	// 開いていたセッションが一覧から消えたら (PC でアーカイブされたなど)、一覧に戻る。
	useEffect(() => {
		if (selectedId && !selected && !loading) setSelectedId(null);
	}, [selectedId, selected, loading]);
	// 詳細を開いているあいだは、Android の戻るキーで一覧に戻る。
	// 詳細が実際に出てから登録する (カンバンから開いたとき、App 側の戻るキーより後に登録されて先に呼ばれるように)。
	const detailOpen = !!(selectedId && selected);
	useEffect(() => {
		if (!detailOpen) return;
		const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSelectedId(null); return true; });
		return () => sub.remove();
	}, [detailOpen]);
	const activeCount = useMemo(() => sessions.filter(s => isActive(s.status)).length, [sessions]);
	const cost = useMemo(() => sumCloudCosts(sessions), [sessions]);
	// 一覧の行には、名前が分かるときだけプロジェクトを出す (詳細では ID の先頭でも出す)
	const projectNameOf = useCallback(
		(s: CloudSession) => (s.projectId ? projects.projects.find(p => p.id === s.projectId)?.name ?? null : null),
		[projects.projects],
	);

	const kanbanTasks = snapshot?.kanban?.board.tasks.length;
	const shortcuts: Shortcut[] = [
		{
			page: 'projects',
			label: 'プロジェクト',
			icon: 'layers',
			detail: projects.source === 'pc' && projects.projects.length > 0 ? `${projects.projects.length} 件` : 'Division',
		},
		{ page: 'tuning', label: 'コスト', icon: 'bar-chart-2', detail: cost.known > 0 ? `${formatUsdCompact(cost.totalUsd)}` : '料金と残高' },
		{ page: 'kanban', label: 'カンバン', icon: 'columns', detail: typeof kanbanTasks === 'number' ? `${kanbanTasks} タスク` : null },
	];

	if (!session) {
		return (
			<Screen>
				<ScreenHeader title='クラウド' />
				<EmptyState
					icon='log-in'
					title='Division にログインしてください'
					detail='クラウドエージェントのセッションは Division アカウントに紐づいています。'
				/>
			</Screen>
		);
	}

	if (selectedId && selected) {
		return (
			<Screen>
				<BackProvider value={() => setSelectedId(null)}>
					<SessionDetail
						key={selected.id}
						auth={session}
						initial={selected}
						projects={projects.projects}
						foreground={foreground}
						onSessionChange={patchSession}
						onArchived={onArchived}
					/>
				</BackProvider>
			</Screen>
		);
	}

	return (
		<Screen>
			<ScreenHeader
				title='クラウド'
				right={<IconButton icon='plus' accessibilityLabel='新しいセッション' onPress={() => setShowNew(true)} />}
			/>

			{error ? <ErrorBanner message={error} onRetry={() => void loadList()} /> : null}
			{launchError ? <ErrorBanner message={launchError} onRetry={() => { setLaunchError(null); setShowNew(true); }} /> : null}

			<ScrollView
				contentContainerStyle={styles.content}
				refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onPull()} tintColor={colors.fgMuted} />}
			>
				{onOpenPage ? <ShortcutRow items={shortcuts} connected={connected} onOpen={page => onOpenPage(page)} /> : null}

				{launching > 0 ? (
					<View style={styles.launching} accessibilityLiveRegion='polite'>
						<ActivityIndicator size='small' color={colors.running} />
						<View style={styles.flex}>
							<Body>{launching} 個のセッションを起動しています…</Body>
							<Muted>サンドボックスの用意に数分かかることがあります。この画面を離れても起動は続きます。</Muted>
						</View>
					</View>
				) : null}

				{loading && sessions.length === 0 ? (
					<Loading label='セッションを読み込んでいます…' />
				) : sessions.length === 0 ? (
					<EmptyState
						icon='cloud'
						title='クラウドのセッションはまだありません'
						detail='Git リポジトリか空のフォルダから、エージェントをクラウドで動かせます。PC の Orchestra から起動したセッションもここに出ます。'
						action={launching > 0 ? undefined : <Button title='新しいセッション' icon='plus' onPress={() => setShowNew(true)} />}
					/>
				) : (
					<>
						<Card style={styles.summaryCard}>
							<Row style={styles.spread}>
								<Muted>{sessions.length} 件{activeCount > 0 ? ` · ${activeCount} 件が動いています` : ''}</Muted>
								<Button title='新しいセッション' icon='plus' variant='secondary' size='sm' onPress={() => setShowNew(true)} />
							</Row>
							{cost.known > 0 ? (
								<Pressable
									accessibilityRole='button'
									accessibilityLabel={`表示中のセッションの料金 合計 ${formatUsdCompact(cost.totalUsd)}${onOpenPage ? '。コストを開く' : ''}`}
									disabled={!onOpenPage}
									onPress={() => onOpenPage?.('tuning')}
									style={({ pressed }) => [styles.costRow, pressed && styles.rowPressed]}
								>
									<Icon name='dollar-sign' size={14} color={colors.fgMuted} />
									<Text style={styles.costLabel}>
										料金の合計{cost.unknown > 0 ? ` (${cost.known} 件分)` : ''}
									</Text>
									<Text style={styles.costValue}>{formatUsdCompact(cost.totalUsd)}</Text>
									{onOpenPage ? <Text style={styles.linkText}>コスト</Text> : null}
									{onOpenPage ? <Icon name='chevron-right' size={14} color={colors.accentText} /> : null}
								</Pressable>
							) : null}
						</Card>
						<View>
							{sessions.map(item => (
								<SessionRow
									key={item.id}
									item={item}
									projectName={projectNameOf(item)}
									stopping={stoppingId === item.id}
									onPress={() => setSelectedId(item.id)}
									onStop={() => void stopFromList(item)}
								/>
							))}
						</View>
						<Muted style={styles.footnote}>
							PC の Orchestra から起動したセッションも表示されます。変更を手元に取り込むのは PC の Orchestra で行います。
						</Muted>
					</>
				)}
			</ScrollView>

			{showNew ? (
				<NewSessionSheet
					auth={session}
					projects={projects}
					draft={draft}
					onChange={setDraft}
					onClose={() => setShowNew(false)}
					onLaunch={repo => void launch(repo)}
				/>
			) : null}
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	spread: { justifyContent: 'space-between' },
	wrapRow: { flexWrap: 'wrap' },
	alignStart: { alignSelf: 'flex-start' },
	content: {
		paddingHorizontal: spacing.lg,
		paddingBottom: spacing.xl,
	},
	summaryCard: { paddingVertical: spacing.sm },
	costRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		minHeight: 32,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: colors.border,
		paddingTop: spacing.xs,
	},
	costLabel: { flex: 1, color: colors.fgMuted, fontSize: fontSize.xs + 1 },
	costValue: { color: colors.fg, fontSize: fontSize.sm, fontWeight: '600', fontVariant: ['tabular-nums'] },
	shortcuts: { gap: spacing.xs, marginTop: spacing.md },
	shortcutRow: { flexDirection: 'row', gap: spacing.sm },
	shortcut: {
		flex: 1,
		gap: 2,
		minHeight: 72,
		padding: spacing.sm + 2,
		borderRadius: radius.md,
		backgroundColor: colors.bgElevated,
	},
	shortcutDisabled: { opacity: 0.6 },
	shortcutLabel: { color: colors.fg, fontSize: fontSize.xs + 1, fontWeight: '600', marginTop: spacing.xs },
	shortcutDetail: { color: colors.fgFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
	footnote: { marginTop: spacing.lg },
	launching: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		marginTop: spacing.md,
		padding: spacing.md,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
	},
	sessionRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		minHeight: 72,
		paddingVertical: spacing.md,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	rowPressed: { opacity: 0.6 },
	rowTitle: { color: colors.fg, fontSize: fontSize.sm, fontWeight: '500' },
	rowMeta: { fontSize: fontSize.xs, marginTop: 2 },
	rowBadges: { flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
	statusDotWrap: { width: 20, alignItems: 'center' },
	sheetContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
	field: { gap: spacing.sm },
	promptInput: { minHeight: 120 },
	inputInvalid: { borderColor: colors.danger },
	invalidText: { color: colors.danger, fontSize: fontSize.xs },
	githubChecking: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
	linkButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.xs, minHeight: 32 },
	linkText: { color: colors.accentText, fontSize: fontSize.xs + 1, fontWeight: '600' },
	advancedToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 36 },
	advancedText: { color: colors.fgMuted, fontSize: fontSize.xs + 1, fontWeight: '600' },
	detailMeta: {
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.sm,
		gap: spacing.sm,
	},
	statusInline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
	statusLabel: { fontSize: fontSize.xs, fontWeight: '600' },
	toolbar: {
		paddingHorizontal: spacing.lg,
		paddingBottom: spacing.sm,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.borderStrong,
	},
	logContent: {
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
	assistantWithRole: { gap: spacing.xs },
	roleChip: {
		alignSelf: 'flex-start',
		maxWidth: 160,
		paddingHorizontal: spacing.sm,
		paddingVertical: 2,
		borderRadius: 999,
		backgroundColor: colors.bgHover,
	},
	roleChipText: { color: colors.fgMuted, fontSize: fontSize.xs - 1, fontWeight: '600' },
	planCard: {
		gap: spacing.sm,
		padding: spacing.md,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
	},
	planTitle: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600' },
	planMeta: { color: colors.fgFaint, fontSize: fontSize.xs },
	planItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
	planMarker: { width: 20, height: 22, alignItems: 'center', justifyContent: 'center' },
	planHollow: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: colors.fgFaint },
	planItemHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
	planItemTitle: { color: colors.fg, fontSize: fontSize.xs + 1, lineHeight: 20, flexShrink: 1 },
	planItemDone: { color: colors.fgMuted },
	planItemModel: { color: colors.fgFaint, fontSize: fontSize.xs, marginTop: 2 },
	taskHeader: { gap: spacing.xs, marginTop: spacing.sm },
	taskHeaderLine: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
	taskHeaderText: { color: colors.fgStrong, fontSize: fontSize.xs + 1, fontWeight: '600', lineHeight: 20 },
	taskHeaderPos: { color: colors.accentText, fontVariant: ['tabular-nums'] },
	taskHeaderModel: { color: colors.fgFaint, fontWeight: '400' },
	taskResult: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
	taskResultText: { color: colors.fgFaint, fontSize: fontSize.xs, lineHeight: 18, flexShrink: 1 },
	tool: { gap: spacing.xs },
	toolHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	toolDot: { width: 6, height: 6, borderRadius: 3 },
	toolName: { flex: 1, color: colors.fgMuted, fontFamily: MONO, fontSize: fontSize.xs + 1 },
	toolDuration: { color: colors.fgFaint, fontSize: fontSize.xs },
	toolOutput: {
		marginLeft: spacing.md,
		padding: spacing.sm,
		borderRadius: radius.sm,
		backgroundColor: colors.bgElevated,
	},
	monoText: { color: colors.fgFaint, fontFamily: MONO, fontSize: fontSize.xs, lineHeight: 18 },
	noteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	noteLine: { width: 12, height: StyleSheet.hairlineWidth, backgroundColor: colors.fgFaint },
	noteText: { color: colors.fgFaint, fontSize: fontSize.xs, lineHeight: 18, flexShrink: 1 },
	errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
	errorText: { color: colors.danger, fontSize: fontSize.xs, lineHeight: 18, flexShrink: 1 },
	doneCard: {
		gap: spacing.sm,
		padding: spacing.md,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: withAlpha(colors.success, '44'),
	},
	doneTitle: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600' },
	doneText: { color: colors.fg, fontSize: fontSize.sm, lineHeight: 23 },
	working: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	workingText: { color: colors.fgFaint, fontSize: fontSize.xs + 1 },
	composerWrap: {
		paddingHorizontal: spacing.md,
		paddingTop: spacing.xs,
		paddingBottom: spacing.sm,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: colors.border,
	},
	composer: {
		flexDirection: 'row',
		alignItems: 'flex-end',
		gap: spacing.sm,
		borderRadius: 20,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
		paddingLeft: spacing.sm,
		paddingRight: spacing.xs,
		paddingVertical: spacing.xs,
	},
	composerInput: {
		flex: 1,
		minHeight: 40,
		maxHeight: 140,
		paddingHorizontal: spacing.sm,
		paddingTop: spacing.sm,
		paddingBottom: spacing.sm,
		color: colors.fg,
		fontSize: fontSize.sm,
		lineHeight: 21,
		textAlignVertical: 'top',
	},
	changesContent: {
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.md,
		paddingBottom: spacing.xl,
		gap: spacing.sm,
	},
	pullNote: {
		flexDirection: 'row',
		alignItems: 'flex-start',
		gap: spacing.sm,
		padding: spacing.md,
		borderRadius: radius.md,
		backgroundColor: colors.bgElevated,
	},
	inlineBanner: { marginHorizontal: 0 },
	changeItem: {
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	changeRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		minHeight: 48,
		paddingVertical: spacing.sm,
	},
	changeMark: { width: 16, fontFamily: MONO, fontSize: fontSize.xs + 1, fontWeight: '700', textAlign: 'center' },
	changePath: { color: colors.fg, fontFamily: MONO, fontSize: fontSize.xs + 1 },
	changeStats: { fontFamily: MONO, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
	diffBox: {
		marginBottom: spacing.sm,
		paddingVertical: spacing.xs,
		borderRadius: radius.sm,
		backgroundColor: colors.bgElevated,
	},
	diffLine: {
		fontFamily: MONO,
		fontSize: fontSize.xs - 1,
		lineHeight: 16,
		paddingHorizontal: spacing.sm,
	},
	diffNote: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
});
