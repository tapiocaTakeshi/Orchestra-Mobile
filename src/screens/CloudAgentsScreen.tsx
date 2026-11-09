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
 *   - 承認モード … Division Project を選んだときだけ起動の設定で選べる。coder 以外の役割が成果物 (.division/*.md) を
 *                 書くたびに「承認待ち」で止まり、詳細のカードで中身を編集して承認するか、フィードバックを付けて差し戻す
 *   - PR        … Sessions started from a GitHub repo can open / update a pull request from the detail header
 *                 (and the last completion card); `pull_request` log events render as a card. See CloudPullRequest.tsx
 *
 * 見た目は Claude Code (Web / アプリ) に合わせる:
 *   - 一覧の下に入力欄を固定し、そこから指示を書いてすぐ起動する。リポジトリ・モデル・並列数は入力欄の下のチップから設定する
 *   - 1 つだけ起動したときは、そのままセッションのチャットを開く
 *   - 詳細はチャット。自分の指示は右の吹き出し、エージェントの返答は左にアイコン付きでまとめ、
 *     続けて実行したツールは「ツールを N 回実行」に畳む (開くと「● 名前(引数)」「⎿ 出力 … +N 行」)
 *   - 差分は見出しの「±」から開く。動いているあいだは入力欄の送信ボタンが停止ボタンになる
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
	Linking,
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
	Button,
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
	Toggle,
	confirmAction,
	useBack,
	useToast,
} from '../components/ui';
import { TuningScreen } from './TuningScreen';
import { CloudModelPicker } from '../components/CloudModelPicker';
import { CloudProjectPicker, CloudProjects, useCloudProjects } from '../components/CloudProjectPicker';
import {
	PullRequestBar,
	PullRequestEventCard,
	PullRequestSheet,
	RepoPullRequests,
	currentPullRequest,
	usePullRequestInfo,
} from '../components/CloudPullRequest';
import { Markdown } from '../components/Markdown';
import { ParallelLogView } from '../components/ParallelLog';
import { groupParallelBranches } from '../lib/cloudParallel';
import { AiLoading } from '../components/AiLoading';
import { DocumentView } from '../components/DocumentView';
import { DocumentList } from '../components/DocumentList';
import { cloudDocumentSource } from '../lib/documentSource';
import { WorkflowReviewCard } from '../components/WorkflowReviewCard';
import {
	CloudApproval,
	CloudChange,
	CloudChanges,
	CloudModelSelection,
	CloudPullRequest,
	CloudRepo,
	CloudSession,
	CloudSessionEvent,
	CloudSessionStatus,
	DivisionTimeline,
	MAX_PARALLEL_SESSIONS,
	MAX_SESSION_REPOS,
	PatchSection,
	PlanProgress,
	PlanTaskState,
	approvalErrorText,
	approvalEventText,
	archiveCloudSession,
	canSendMessage,
	chatBlocks,
	ChatItem,
	classifyPatchLines,
	CloudGoalLoopMode,
	DEFAULT_GOAL_LOOP,
	GOAL_LOOP_LABELS,
	cloudErrorText,
	cloudModelLabel,
	cloudSource,
	cloudStatusColor,
	cloudStatusLabel,
	divisionTimeline,
	editedApprovalContent,
	fetchCloudChanges,
	getCloudApproval,
	getCloudCommandApproval,
	aiEditCloudDocument,
	aiEditErrorText,
	CloudCommandApproval,
	resolveCloudCommandApproval,
	toCloudCommandApprovalEvent,
	commandApprovalEventText,
	getCloudWorkflowProposal,
	CloudWorkflowProposal,
	resolveCloudWorkflowProposal,
	fetchCloudEvents,
	finishedSessions,
	isActive,
	multiRepos,
	CLOUD_SESSION_FILTERS,
	CloudSessionFilter,
	isDivisionProjectModel,
	isFullNameRepo,
	lastSeqOf,
	launchModelFields,
	launchSessions,
	listCloudSessions,
	listPollInterval,
	mergeEvents,
	modelSelectionIssue,
	outputPreview,
	pausedReviewSeq,
	resolveCloudApproval,
	reviewOutcomeLabel,
	pullRequestActionLabel,
	pullRequestStateFor,
	sectionForChange,
	resumeCloudSession,
	sendCloudMessage,
	splitPatch,
	stopCloudSession,
	sumCloudCosts,
	taskHeaderLabel,
	toCloudApprovalEvent,
	toCloudGoal,
	toCloudPlan,
	toCloudReview,
	toCloudTaskEvent,
	repoLabel,
	searchedSitesOf,
	siteLabel,
	toolCallParts,
	toolCallSummary,
	truncateLines,
	validateBranch,
	validateRepoUrl,
} from '../lib/divisionCloud';
import { DivisionSession } from '../lib/divisionAuth';
import { verifyAndConnect } from '../lib/connect';
import { HomeItem, PcChatState, buildHomeItems, countHomeItems, matchesHomeFilter } from '../lib/homeSessions';
import { ChatConnectionBadge, REMOTE_CONNECTION_LABELS } from '../lib/remoteSession';
import { useRemoteDevices } from '../state/useRemoteDevices';
import { GitHubRepo } from '../lib/divisionGitHub';
import { CloudProjectOption, projectLabel } from '../lib/divisionProjects';
import { durationText, oneLine, relativeTimeFromIso } from '../lib/format';
import { formatUsdCompact } from '../lib/tuning';
import { OpenPage, PageKey, canOpenPage } from '../navigation';
import { notifyRemoteEvent } from '../lib/remoteNotifications';
import {
	GitHubAccountRow,
	GitHubConnection,
	GitHubConnectPanel,
	GitHubRepoPicker,
	GitHubRepoSelection,
	useGitHubConnection,
} from '../components/GitHubRepoPicker';
import { DecisionInbox } from '../components/DecisionInbox';
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
/** 空の画面の見出しだけに使うセリフ体 (Claude のアプリの見出しの雰囲気に寄せる。端末標準のフォントで依存は増やさない) */
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' });

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

/** 状態の印。動いているあいだはくるくる、止まっていれば色の点。 */
const StatusMark = ({ status }: { status: CloudSessionStatus }) => (
	isActive(status)
		? <AiLoading size={20} />
		: <View style={styles.statusDotWrap}><Dot color={cloudStatusColor(status)} /></View>
);

// ---------------------------------------------------------------------------
// ショートカット (プロジェクト / コスト / カンバン)
// ---------------------------------------------------------------------------

type Shortcut = { page: PageKey; label: string; icon: IconName; detail: string | null };

/** 一覧の上に並べる小さな丸いボタン。PC 接続が要るものは鍵の印にして押すと案内を出す。 */
const ShortcutRow = ({ items, connected, onOpen }: {
	items: Shortcut[];
	connected: boolean;
	onOpen: (page: PageKey) => void;
}) => {
	const toast = useToast();
	return (
		<ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.noGrow} contentContainerStyle={styles.shortcutRow}>
			{items.map(item => {
				const enabled = canOpenPage(item.page, connected);
				return (
					<Pressable
						key={item.page}
						accessibilityRole='button'
						accessibilityState={{ disabled: !enabled }}
						accessibilityLabel={enabled ? `${item.label}を開く` : `${item.label}。PC に接続すると使えます`}
						onPress={() => (enabled ? onOpen(item.page) : toast.show(`${item.label}は PC に接続すると使えます`, 'info'))}
						style={({ pressed }) => [styles.shortcut, !enabled && styles.shortcutDisabled, pressed && enabled && styles.rowPressed]}
					>
						<Icon name={enabled ? item.icon : 'lock'} size={14} color={enabled ? colors.fgMuted : colors.fgFaint} />
						<Text style={[styles.shortcutLabel, !enabled && { color: colors.fgFaint }]} numberOfLines={1}>{item.label}</Text>
						{enabled && item.detail ? <Text style={styles.shortcutDetail} numberOfLines={1}>{item.detail}</Text> : null}
					</Pressable>
				);
			})}
		</ScrollView>
	);
};

// ---------------------------------------------------------------------------
// 一覧の行
// ---------------------------------------------------------------------------

/** Claude Code のセッション一覧のように、題名と「リポジトリ · 時刻」の 2 行だけにする。 */
const SessionRow = ({ item, projectName, onPress, onStop, stopping }: {
	item: CloudSession;
	/** プロジェクトを指定して起動したセッションなら、その名前 */
	projectName: string | null;
	onPress: () => void;
	onStop: () => void;
	stopping: boolean;
}) => {
	const source = cloudSource(item);
	const active = isActive(item.status);
	const meta = [
		source.label,
		projectName,
		item.changedFiles > 0 ? `${item.changedFiles} ファイル` : null,
		typeof item.costUsd === 'number' ? formatUsdCompact(item.costUsd) : null,
	].filter(Boolean).join(' · ');
	return (
		<Pressable
			accessibilityRole='button'
			accessibilityLabel={`${item.title}、${cloudStatusLabel(item.status)}、${cloudModelLabel(item)}`}
			onPress={onPress}
			style={({ pressed }) => [styles.sessionRow, pressed && styles.rowPressed]}
		>
			<StatusMark status={item.status} />
			<View style={styles.flex}>
				<Row style={styles.rowTop}>
					<Text style={[styles.rowTitle, styles.flex]} numberOfLines={1}>{item.title}</Text>
					<Text style={styles.rowTime}>{relativeTimeFromIso(item.updatedAt)}</Text>
				</Row>
				<Text style={styles.rowMeta} numberOfLines={1}>
					{active || item.status === 'failed' || item.status === 'awaiting_approval'
						? <Text style={{ color: cloudStatusColor(item.status) }}>{cloudStatusLabel(item.status)} · </Text>
						: null}
					{meta}
				</Text>
			</View>
			{active ? (
				stopping
					? <ActivityIndicator size='small' color={colors.fgMuted} />
					: <IconButton icon='square' accessibilityLabel={`${item.title} を停止`} onPress={onStop} />
			) : null}
		</Pressable>
	);
};

/** 接続中の PC (Orchestra) のチャット。題名と「PC 名 · 状態」の 2 行 (クラウドの行と同じ形) */
const PC_STATE_LABELS: Record<PcChatState, { label: string; color: string } | null> = {
	running: { label: '作業中', color: colors.running },
	approval: { label: '確認待ち', color: colors.warning },
	error: { label: 'エラー', color: colors.danger },
	idle: null,
};

const PcChatRow = ({ item, onPress }: { item: Extract<HomeItem, { kind: 'pc-chat' }>; onPress: () => void }) => {
	const state = PC_STATE_LABELS[item.state];
	return (
		<Pressable
			accessibilityRole='button'
			accessibilityLabel={`${oneLine(item.thread.title)}、PC ${item.pcName}${state ? `、${state.label}` : ''}${item.badge ? `、${item.badge.label}` : ''}`}
			onPress={onPress}
			style={({ pressed }) => [styles.sessionRow, pressed && styles.rowPressed]}
		>
			{item.state === 'running'
				? <AiLoading size={20} />
				: <View style={styles.statusDotWrap}><Icon name='monitor' size={14} color={state?.color ?? colors.fgMuted} /></View>}
			<View style={styles.flex}>
				<Row style={styles.rowTop}>
					<Text style={[styles.rowTitle, styles.flex]} numberOfLines={1}>{oneLine(item.thread.title) || '新しいチャット'}</Text>
					<Text style={styles.rowTime}>{relativeTimeFromIso(item.thread.lastModified)}</Text>
				</Row>
				<Text style={styles.rowMeta} numberOfLines={1}>
					{state ? <Text style={{ color: state.color }}>{state.label} · </Text> : null}
					{item.badge ? <Text style={{ color: PC_BADGE_COLORS[item.badge.tone] }}>{item.badge.label} · </Text> : null}
					{item.pcName}
				</Text>
			</View>
		</Pressable>
	);
};

const PC_BADGE_COLORS: Record<ChatConnectionBadge['tone'], string> = {
	success: colors.success,
	running: colors.running,
	warning: colors.warning,
	danger: colors.danger,
	muted: colors.fgFaint,
};

/** まだ接続していない PC。押すと接続してそのチャットを開く (接続切れの PC は案内を出す) */
const PcDeviceRow = ({ item, connecting, onPress }: {
	item: Extract<HomeItem, { kind: 'pc-device' }>;
	connecting: boolean;
	onPress: () => void;
}) => {
	const offline = item.status === 'offline';
	const name = item.device.deviceLabel || item.device.lanUrl;
	return (
		<Pressable
			accessibilityRole='button'
			accessibilityLabel={offline ? `PC ${name}、接続切れ` : `PC ${name} に接続してチャットを開く`}
			onPress={onPress}
			style={({ pressed }) => [styles.sessionRow, pressed && styles.rowPressed]}
		>
			<View style={styles.statusDotWrap}>
				<Icon name={offline ? 'wifi-off' : 'monitor'} size={14} color={offline ? colors.danger : colors.fgMuted} />
			</View>
			<View style={styles.flex}>
				<Row style={styles.rowTop}>
					<Text style={[styles.rowTitle, styles.flex]} numberOfLines={1}>{name}</Text>
					<Text style={styles.rowTime}>{relativeTimeFromIso(item.device.lastSeenAt)}</Text>
				</Row>
				<Text style={styles.rowMeta} numberOfLines={1}>
					<Text style={{ color: offline ? colors.danger : colors.fgMuted }}>
						{offline ? REMOTE_CONNECTION_LABELS.lost : REMOTE_CONNECTION_LABELS.disconnected}
					</Text>
					{offline ? ' · PC で Orchestra を起動すると接続できます' : ' · 押すと接続してチャットを開きます'}
				</Text>
			</View>
			{connecting ? <ActivityIndicator size='small' color={colors.fgMuted} /> : <Icon name='chevron-right' size={16} color={colors.fgFaint} />}
		</Pressable>
	);
};

// ---------------------------------------------------------------------------
// 新しいセッション
// ---------------------------------------------------------------------------

/** 新しいセッションをどこで動かすか (Claude Code の環境の選択と同じ) */
export type LaunchTarget = 'cloud' | 'pc';

type Draft = {
	prompt: string;
	count: string;
	source: 'repo' | 'empty';
	/**
	 * GitHub 連携で選んだリポジトリとブランチ (空のブランチは既定のブランチ)。Claude Code のように複数選べて、
	 * 2 個以上ならサンドボックスの workspace 直下にそれぞれのディレクトリで clone される
	 */
	repos: DraftRepo[];
	/** 選んだリポジトリがあっても一覧を開いている (「リポジトリを追加」) */
	addingRepo: boolean;
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
	/** 目標ループ (目標を立てて、達成するまでラウンドを繰り返す) */
	goalLoop: CloudGoalLoopMode;
	/** 承認モード (Division Project のときだけ送る)。役割の成果物ごとに止まって承認を待つ */
	approvalMode: boolean;
	showAdvanced: boolean;
};

type DraftRepo = { repo: GitHubRepo; branch: string };

const modelSelectionOf = (draft: Pick<Draft, 'modelMode' | 'model' | 'projectId'>): CloudModelSelection =>
	({ mode: draft.modelMode, model: draft.model, projectId: draft.projectId });

const EMPTY_DRAFT: Draft = {
	prompt: '',
	count: '1',
	source: 'repo',
	repos: [],
	addingRepo: false,
	manualUrl: false,
	repoUrl: '',
	branch: '',
	modelMode: 'default',
	model: '',
	title: '',
	projectId: '',
	goalLoop: DEFAULT_GOAL_LOOP,
	approvalMode: true,
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

/** 起動の設定 (指示以外) の問題。settings が false なら設定のシートを開いて直してもらう。 */
const draftIssues = (draft: Draft, mode: RepoMode, connected: boolean): { repoUrl: string | null; branch: string | null; settings: boolean } => {
	const model = !modelSelectionIssue(modelSelectionOf(draft));
	if (draft.source !== 'repo') return { repoUrl: null, branch: null, settings: model };
	if (mode === 'manual') {
		const repoUrl = validateRepoUrl(draft.repoUrl);
		const branch = validateBranch(draft.branch);
		return { repoUrl, branch, settings: model && !repoUrl && !branch };
	}
	const branch = draft.repos.map(r => validateBranch(r.branch)).find(Boolean) ?? null;
	return { repoUrl: null, branch, settings: model && mode === 'picker' && connected && draft.repos.length > 0 && !branch };
};

const repoModeOf = (draft: Pick<Draft, 'manualUrl'>, github: GitHubConnection): RepoMode => {
	const status = github.status;
	// 状態を確認できなかっただけでは URL 入力に切り替えない (「連携が切れた」ように見えるため)。
	// 取り直しは自動で続け、URL を直接入れたいときは「URL を入力」を選べる
	if (draft.manualUrl || (status && !status.configured)) return 'manual';
	return status ? 'picker' : 'loading';
};

/** 入力欄の下のチップに出す「始める場所」。 */
const draftSourceLabel = (draft: Draft, mode: RepoMode): string => {
	if (draft.source === 'empty') return '空のフォルダ';
	if (mode === 'manual') return draft.repoUrl.trim() ? repoLabel(draft.repoUrl) : 'リポジトリの URL';
	const [first, ...rest] = draft.repos;
	if (first) {
		const one = first.branch.trim() ? `${first.repo.fullName} @ ${first.branch.trim()}` : first.repo.fullName;
		return rest.length ? `${first.repo.name} ほか ${rest.length} 件` : one;
	}
	return mode === 'loading' ? 'GitHub を確認中…' : 'リポジトリを選ぶ';
};

/** 入力欄の下のチップに出すモデル。 */
const draftModelLabel = (draft: Draft, projects: CloudProjectOption[]): string => {
	if (draft.modelMode === 'division') return `Division Project${draft.projectId ? ` · ${projectLabel(projects, draft.projectId)}` : ''}`;
	if (draft.modelMode === 'custom') return draft.model.trim() || 'モデルを指定';
	return '既定のモデル';
};

/** 起動に使うリポジトリ。一覧から選んでいれば { fullName } (複数可)、直接入力なら { url }。 */
const draftRepos = (draft: Draft, mode: RepoMode): CloudRepo[] => {
	if (draft.source !== 'repo') return [];
	if (mode === 'picker' && draft.repos.length) return draft.repos.map(r => ({ fullName: r.repo.fullName, branch: r.branch.trim() || undefined }));
	return [{ url: draft.repoUrl, branch: draft.branch.trim() || undefined }];
};

/** 起動の設定 (始める場所・モデル・プロジェクト・並列数・題名)。指示は画面下の入力欄で書く。 */
const LaunchOptionsSheet = ({ auth, github, projects, draft, onChange, onGoalLoopTouched, onClose }: {
	auth: DivisionSession;
	github: GitHubConnection;
	projects: CloudProjects;
	draft: Draft;
	onChange: React.Dispatch<React.SetStateAction<Draft>>;
	/** 利用者が目標ループを自分で選んだ (保存済みの値で上書きしない) */
	onGoalLoopTouched: () => void;
	onClose: () => void;
}) => {
	const status = github.status;
	const configured = !!status?.configured;
	const connected = !!status?.connected;
	const mode = repoModeOf(draft, github);
	const issues = draftIssues(draft, mode, connected);
	const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange(d => ({ ...d, [key]: value }));
	const count = Number(draft.count);

	const markDisconnected = github.markDisconnected;
	const onNotConnected = useCallback(() => {
		markDisconnected();
		onChange(d => ({ ...d, repos: [], addingRepo: false }));
	}, [markDisconnected, onChange]);

	const disconnect = async () => {
		if (await github.disconnect()) {
			onChange(d => ({ ...d, repos: [], addingRepo: false }));
			void clearLastCloudRepo();
		}
	};

	// 一覧で押したリポジトリを足す (選んである物を押したら外す)
	const selectRepo = useCallback((repo: GitHubRepo) => {
		onChange(d => {
			if (d.repos.some(r => r.repo.fullName === repo.fullName)) {
				return { ...d, repos: d.repos.filter(r => r.repo.fullName !== repo.fullName) };
			}
			if (d.repos.length >= MAX_SESSION_REPOS) return d;
			return { ...d, repos: [...d.repos, { repo, branch: '' }], addingRepo: false };
		});
	}, [onChange]);
	const setRepoBranch = useCallback((fullName: string, value: string) => onChange(d => ({
		...d,
		repos: d.repos.map(r => (r.repo.fullName === fullName ? { ...r, branch: value } : r)),
	})), [onChange]);
	const removeRepo = useCallback((fullName: string) => onChange(d => ({
		...d,
		repos: d.repos.filter(r => r.repo.fullName !== fullName),
	})), [onChange]);

	return (
		<Sheet title='起動の設定' eyebrow='クラウドエージェント' onClose={onClose}>
			<ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps='handled'>
				<View style={styles.field}>
					<SectionTitle>始める場所</SectionTitle>
					<SegmentedControl options={SOURCE_OPTIONS} value={draft.source} onChange={value => set('source', value)} />
					{draft.source === 'repo' && mode === 'loading' && !github.error ? (
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
								{draft.repos.map(r => (
									<GitHubRepoSelection
										key={r.repo.fullName}
										auth={auth}
										repo={r.repo}
										branch={r.branch}
										onBranch={value => setRepoBranch(r.repo.fullName, value)}
										onChange={() => removeRepo(r.repo.fullName)}
										changeLabel='外す'
										onNotConnected={onNotConnected}
									/>
								))}
								{draft.repos.length === 0 || draft.addingRepo ? (
									<>
										<GitHubRepoPicker
											auth={auth}
											onSelect={selectRepo}
											selected={draft.repos.map(r => r.repo.fullName)}
											onNotConnected={onNotConnected}
										/>
										{draft.addingRepo && draft.repos.length > 0 ? (
											<Button title='閉じる' variant='ghost' size='sm' onPress={() => set('addingRepo', false)} style={styles.alignStart} />
										) : null}
									</>
								) : draft.repos.length < MAX_SESSION_REPOS ? (
									<Pressable accessibilityRole='button' onPress={() => set('addingRepo', true)} style={styles.linkButton}>
										<Icon name='plus' size={14} color={colors.accentText} />
										<Text style={styles.linkText}>リポジトリを追加</Text>
									</Pressable>
								) : null}
								<Muted>
									{draft.repos.length > 1
										? `${draft.repos.length} 個のリポジトリを、サンドボックスの workspace 直下にそれぞれのフォルダ (${draft.repos.map(r => r.repo.name).join(', ')}) として clone します。PR はリポジトリごとに作れます。`
										: 'リポジトリは複数選べます (最大 ' + MAX_SESSION_REPOS + ' 個)。非公開のリポジトリも、連携したアカウントの権限でサーバーが clone します。'}
								</Muted>
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
					{draft.source === 'repo' && mode === 'manual' && draft.manualUrl && (configured || !status) ? (
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
					<SectionTitle>モデルを選ぶ</SectionTitle>
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
					{draft.modelMode === 'division' ? (
						<>
							<Row style={styles.spread}>
								<Text style={styles.toggleLabel}>承認モード</Text>
								<Toggle value={draft.approvalMode} onValueChange={value => set('approvalMode', value)} accessibilityLabel='承認モード' />
							</Row>
							<Muted>
								{draft.approvalMode
									? 'コーダー以外の役割が成果物 (.division/REVIEW.md など) を書き終えるたびに止まります。中身を確かめて (必要なら編集して) 承認するか、フィードバックを付けて差し戻してください。'
									: 'オンにすると、コーダー以外の役割の成果物ごとに止まって承認を待ちます。'}
							</Muted>
						</>
					) : null}
				</View>

				<View style={styles.field}>
					<Muted>繰り返し (ループ実行) と目標は、プロジェクトのワークフローの for / while ループで設定します。</Muted>
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

				<View style={styles.field}>
					<SectionTitle>並列数</SectionTitle>
					<ChipGroup options={COUNT_OPTIONS} value={draft.count} onChange={value => set('count', value)} />
					<Muted>同じ指示を別々のサンドボックスで {count} 個同時に動かします{count > 1 ? '。題名の末尾に #1〜#' + count + ' が付きます' : ''}。</Muted>
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
				<Button title='完了' icon='check' onPress={onClose} />
			</ScrollView>
		</Sheet>
	);
};

/**
 * Claude Code のホームと同じく、画面の下に固定した入力欄。指示を書いて送ると、その場でセッションを起動する。
 * 下のチップ (始める場所・モデル・並列数) を押すと起動の設定を開く。設定が足りないまま送ったときも設定を開く。
 */
const LaunchComposer = ({ auth, projects, draft, onChange, onGoalLoopTouched, onLaunch, optionsOpen, onOptionsOpen, costLabel, target = 'cloud', pcLabel = null, onTargetPress, onSendToPc, sendingToPc = false }: {
	auth: DivisionSession;
	projects: CloudProjects;
	draft: Draft;
	onChange: React.Dispatch<React.SetStateAction<Draft>>;
	onGoalLoopTouched: () => void;
	onLaunch: (repos: CloudRepo[]) => void;
	optionsOpen: boolean;
	onOptionsOpen: (open: boolean) => void;
	/** 「コスト」チップに添える金額 (一覧の料金の合計)。分からなければ出さない */
	costLabel: string | null;
	/** どこで動かすか (ホームだけ)。pc なら接続中の PC に新しいチャットとして送る */
	target?: LaunchTarget;
	/** 接続中の PC の名前。未接続なら null */
	pcLabel?: string | null;
	/** 送り先のチップを押した (ホームだけ。渡さなければチップを出さない) */
	onTargetPress?: () => void;
	onSendToPc?: (prompt: string) => void;
	sendingToPc?: boolean;
}) => {
	const [costOpen, setCostOpen] = useState(false);
	const toast = useToast();
	const github = useGitHubConnection(auth);
	const mode = repoModeOf(draft, github);
	const count = Number(draft.count);
	const prompt = draft.prompt.trim();
	const connected = !!github.status?.connected;
	const issues = draftIssues(draft, mode, connected);

	// 連携済みなら、前回選んだリポジトリとブランチを選んだ状態にする (1 回だけ)。
	const preselectTried = useRef(false);
	useEffect(() => {
		if (!connected || draft.repos.length || preselectTried.current) return;
		preselectTried.current = true;
		void loadLastCloudRepo(auth.userId).then(last => {
			if (last) onChange(d => (d.repos.length ? d : { ...d, repos: [{ repo: last.repo, branch: last.branch }] }));
		});
	}, [connected, draft.repos.length, auth.userId, onChange]);

	const sourceMissing = draft.source === 'repo' && (mode === 'picker' ? draft.repos.length === 0 : mode === 'manual' ? !!issues.repoUrl || !!issues.branch : false);

	const toPc = target === 'pc' && !!pcLabel && !!onSendToPc;

	const submit = () => {
		if (!prompt) return;
		if (toPc) {
			onSendToPc!(prompt);
			return;
		}
		if (!issues.settings) {
			toast.show(mode === 'loading' ? 'GitHub の連携を確認しています。少し待ってから送ってください' : '起動の設定を確認してください', 'info');
			if (mode !== 'loading') onOptionsOpen(true);
			return;
		}
		onLaunch(draftRepos(draft, mode));
	};

	return (
		<View style={styles.composerWrap}>
			<View style={styles.composerBox}>
				<TextInput
					value={draft.prompt}
					onChangeText={value => onChange(d => ({ ...d, prompt: value }))}
					placeholder={toPc ? `${pcLabel} のエージェントに頼みたいことを書く…` : 'エージェントに頼みたいことを書く…'}
					placeholderTextColor={colors.fgFaint}
					selectionColor={colors.accentText}
					accessibilityLabel='エージェントへの指示'
					multiline
					style={styles.composerInput}
				/>
				<View style={styles.composerBar}>
					<ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps='handled' style={styles.flex} contentContainerStyle={styles.composerChips}>
						{onTargetPress ? (
							<ComposerChip
								icon={toPc ? 'monitor' : 'cloud'}
								label={toPc ? pcLabel! : 'クラウド'}
								accessibilityLabel={`送り先: ${toPc ? `PC ${pcLabel}` : 'クラウド'}。変更する`}
								onPress={onTargetPress}
							/>
						) : null}
						{toPc ? null : <>
						<ComposerChip
							icon={draft.source === 'empty' ? 'folder' : 'git-branch'}
							label={draftSourceLabel(draft, mode)}
							warn={sourceMissing && mode !== 'loading'}
							accessibilityLabel={`始める場所: ${draftSourceLabel(draft, mode)}。変更する`}
							onPress={() => onOptionsOpen(true)}
						/>
						<ComposerChip
							icon={draft.modelMode === 'division' ? 'users' : 'cpu'}
							label={draftModelLabel(draft, projects.projects)}
							warn={!!modelSelectionIssue(modelSelectionOf(draft))}
							accessibilityLabel={`モデル: ${draftModelLabel(draft, projects.projects)}。変更する`}
							onPress={() => onOptionsOpen(true)}
						/>
						{draft.modelMode === 'division' ? (
							<ComposerChip
								icon='check-square'
								label={draft.approvalMode ? '承認モード' : '承認なし'}
								accessibilityLabel={`承認モード: ${draft.approvalMode ? 'オン' : 'オフ'}。変更する`}
								onPress={() => onOptionsOpen(true)}
							/>
						) : null}
						{count > 1 ? (
							<ComposerChip icon='copy' label={`×${count}`} accessibilityLabel={`並列数 ${count}。変更する`} onPress={() => onOptionsOpen(true)} />
						) : null}
						</>}
						{/* コストの管理は入力欄から: 書いている指示の見積もり・方針・残高をシートで開く */}
						<ComposerChip
							icon='bar-chart-2'
							label={costLabel ? `コスト · ${costLabel}` : 'コスト'}
							accessibilityLabel='コスト調整を開く'
							onPress={() => setCostOpen(true)}
						/>
					</ScrollView>
					<SendButton
						icon='arrow-up'
						disabled={!prompt || sendingToPc}
						loading={sendingToPc}
						accessibilityLabel={toPc ? `PC ${pcLabel} に送る` : count > 1 ? `${count} 個のセッションを起動` : 'セッションを起動'}
						onPress={submit}
					/>
				</View>
			</View>
			{optionsOpen ? (
				<LaunchOptionsSheet
					auth={auth}
					github={github}
					projects={projects}
					draft={draft}
					onChange={onChange}
					onGoalLoopTouched={onGoalLoopTouched}
					onClose={() => onOptionsOpen(false)}
				/>
			) : null}
			{costOpen ? (
				<Sheet title='コスト調整' eyebrow='入力中の指示' onClose={() => setCostOpen(false)}>
					<TuningScreen composerPrompt={draft.prompt} />
				</Sheet>
			) : null}
		</View>
	);
};

/** 入力欄の下の設定チップ。 */
const ComposerChip = ({ icon, label, warn, accessibilityLabel, onPress }: {
	icon: IconName;
	label: string;
	warn?: boolean;
	accessibilityLabel: string;
	onPress: () => void;
}) => (
	<Pressable
		accessibilityRole='button'
		accessibilityLabel={accessibilityLabel}
		hitSlop={{ top: 6, bottom: 6 }}
		onPress={onPress}
		style={({ pressed }) => [styles.composerChip, warn && styles.composerChipWarn, pressed && styles.rowPressed]}
	>
		<Icon name={icon} size={13} color={warn ? colors.warning : colors.fgMuted} />
		<Text style={[styles.composerChipText, warn && { color: colors.warning }]} numberOfLines={1}>{label}</Text>
		<Icon name='chevron-down' size={12} color={colors.fgFaint} />
	</Pressable>
);

/** 入力欄の右下の丸いボタン (送信 / 停止)。 */
const SendButton = ({ icon, disabled, loading, accessibilityLabel, onPress }: {
	icon: IconName;
	disabled?: boolean;
	loading?: boolean;
	accessibilityLabel: string;
	onPress: () => void;
}) => (
	<Pressable
		accessibilityRole='button'
		accessibilityLabel={accessibilityLabel}
		accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
		disabled={!!disabled || !!loading}
		hitSlop={8}
		onPress={onPress}
		style={({ pressed }) => [styles.sendButton, (disabled || loading) && styles.sendButtonDisabled, pressed && styles.rowPressed]}
	>
		{loading ? <ActivityIndicator size='small' color={colors.onAccent} /> : <Icon name={icon} size={18} color={colors.onAccent} />}
	</Pressable>
);

// ---------------------------------------------------------------------------
// ログ
// ---------------------------------------------------------------------------

/** 行頭の印 (● / ⎿ / >) の幅。続く本文はこの幅だけ下げて揃える。 */
const GUTTER = 18;

/** 行頭の「●」。色で返答・成功・失敗を分ける。 */
const Bullet = ({ color = colors.fg }: { color?: string }) => (
	<View style={styles.gutter}><Text style={[styles.bullet, { color }]}>●</Text></View>
);

/** 自分の指示は右寄せの吹き出し。 */
const UserBubble = ({ value }: { value: string }) => (
	<View style={styles.userWrap}>
		<View accessibilityLabel={`あなた: ${value}`} style={styles.userBubble}>
			<Text selectable style={styles.userText}>{value || '(内容なし)'}</Text>
		</View>
	</View>
);

/** エージェントの 1 回分の返答。Claude のように見出し (アイコン・名前) は付けず、中身をそのまま詰めて並べる。 */
const AgentTurn = ({ name, children }: { name: string; children: React.ReactNode }) => (
	<View style={styles.agentTurn} accessibilityLabel={`${name} の返答`}>
		<View style={styles.agentBody}>{children}</View>
	</View>
);

/**
 * 続けて実行したツールを「ツールを 3 回実行」の 1 行に畳む (1 回だけならその要約)。押すと 1 つずつの行を開く。
 */
const ToolGroup = ({ events }: { events: CloudSessionEvent[] }) => {
	const [open, setOpen] = useState(false);
	const failed = events.filter(e => e.data.ok === false).length;
	const last = events[events.length - 1].data;
	const lastSummary = toolCallSummary(text(last.name), last.args, 60);
	const label = events.length === 1 ? lastSummary : `ツールを ${events.length} 回実行`;
	return (
		<View style={styles.toolGroup}>
			<Pressable
				accessibilityRole='button'
				accessibilityState={{ expanded: open }}
				accessibilityLabel={`${label}${failed > 0 ? `、${failed} 件失敗` : ''}。${open ? '閉じる' : '詳しく見る'}`}
				onPress={() => setOpen(v => !v)}
				style={({ pressed }) => [styles.toolGroupHead, pressed && styles.rowPressed]}
			>
				<Icon name='tool' size={13} color={failed > 0 ? colors.danger : colors.fgFaint} />
				<Text style={styles.toolGroupLabel} numberOfLines={1}>
					{label}
					{events.length > 1 && !open ? <Text style={styles.toolGroupLast}>  {lastSummary}</Text> : null}
				</Text>
				{failed > 0 ? <Text style={styles.toolGroupFailed}>{failed} 失敗</Text> : null}
				<Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.fgFaint} />
			</Pressable>
			{open ? (
				<View style={styles.toolGroupBody}>
					{events.map(event => <ToolRow key={event.seq} data={event.data} />)}
				</View>
			) : null}
		</View>
	);
};

/** 「作業中」の吹き出し。点が順に光り、経過時間を数える。 */
const TypingBubble = ({ status, since }: { status: CloudSessionStatus; since: string }) => {
	// 経過時間を数え直すためだけの再描画 (1 秒ごと)
	const [, setTick] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setTick(t => t + 1), 1000);
		return () => clearInterval(timer);
	}, []);
	const started = Date.parse(since);
	const elapsed = Number.isNaN(started) ? null : Math.max(0, Date.now() - started);
	const label = status === 'running' ? '作業中' : cloudStatusLabel(status);
	return (
		<View style={styles.typing} accessibilityLiveRegion='polite' accessibilityLabel={`${label}…`}>
			<AiLoading size={18} />
			<Text style={styles.typingText}>
				{label}
				{elapsed !== null ? <Text style={styles.workingElapsed}> · {durationText(elapsed)}</Text> : null}
			</Text>
		</View>
	);
};

/**
 * ツールの実行は「● 名前(引数)」と「⎿ 出力の 1 行目 … +N 行」の 2 行にし、押すと出力を全部開く。
 */
const ToolRow = ({ data }: { data: Record<string, unknown> }) => {
	const [open, setOpen] = useState(false);
	const ok = data.ok !== false;
	const output = text(data.output);
	const duration = typeof data.durationMs === 'number' ? durationText(data.durationMs) : null;
	const parts = toolCallParts(text(data.name), data.args);
	const preview = useMemo(() => outputPreview(output), [output]);
	const expandable = preview.more > 0 || output.length > preview.first.length;
	return (
		<Pressable
			accessibilityRole='button'
			accessibilityState={{ expanded: open }}
			accessibilityLabel={`ツール ${toolCallSummary(text(data.name), data.args)}。${ok ? '' : '失敗。'}${open ? '出力を閉じる' : '出力を見る'}`}
			onPress={() => setOpen(v => !v)}
			style={styles.tool}
		>
			<View style={styles.line}>
				<Bullet color={ok ? colors.success : colors.danger} />
				<Text style={styles.toolCall} numberOfLines={open ? undefined : 1}>
					<Text style={styles.toolName}>{parts.name}</Text>
					{parts.arg ? <Text style={styles.toolArg}>({parts.arg})</Text> : null}
				</Text>
				{duration ? <Text style={styles.toolDuration}>{duration}</Text> : null}
			</View>
			<View style={styles.line}>
				<View style={styles.gutter}><Text style={styles.elbow}>⎿</Text></View>
				{open ? (
					<View style={styles.toolOutput}>
						<Text selectable style={[styles.monoText, !ok && { color: colors.danger }]}>{output || '(出力なし)'}</Text>
					</View>
				) : (
					<Text style={[styles.monoText, styles.flex, !ok && { color: colors.danger }]} numberOfLines={1}>
						{preview.first || '(出力なし)'}
						{expandable ? <Text style={styles.moreText}>{preview.more > 0 ? `  … +${preview.more} 行` : '  …'}</Text> : null}
					</Text>
				)}
			</View>
		</Pressable>
	);
};

/**
 * モデルが Web 検索したサイト。「● 検索したサイト (N 件)」と「⎿ 1 件目 … +N 件」の 2 行にし、
 * 押すと全部開く。開いた一覧の各行を押すとブラウザで開く。
 */
const SearchedSitesRow = ({ sites }: { sites: string[] }) => {
	const [open, setOpen] = useState(false);
	if (!sites.length) return null;
	return (
		<View style={styles.tool}>
			<Pressable
				accessibilityRole='button'
				accessibilityState={{ expanded: open }}
				accessibilityLabel={`検索したサイト ${sites.length} 件。${open ? '一覧を閉じる' : '一覧を見る'}`}
				onPress={() => setOpen(v => !v)}
				style={styles.line}
			>
				<Bullet color={colors.running} />
				<Text style={styles.toolCall}>
					<Text style={styles.toolName}>検索したサイト</Text>
					<Text style={styles.toolArg}> ({sites.length} 件)</Text>
				</Text>
			</Pressable>
			<View style={styles.line}>
				<View style={styles.gutter}><Text style={styles.elbow}>⎿</Text></View>
				{open ? (
					<View style={[styles.toolOutput, styles.siteList]}>
						{sites.map((url, i) => (
							<Pressable
								key={url}
								accessibilityRole='link'
								accessibilityLabel={`${siteLabel(url)} を開く`}
								onPress={() => { void Linking.openURL(url).catch(() => undefined); }}
							>
								<Text style={styles.siteLink} numberOfLines={2}>{i + 1}. {siteLabel(url)}</Text>
							</Pressable>
						))}
					</View>
				) : (
					<Text style={[styles.monoText, styles.flex]} numberOfLines={1} onPress={() => setOpen(true)}>
						{siteLabel(sites[0])}
						{sites.length > 1 ? <Text style={styles.moreText}>{`  … +${sites.length - 1} 件`}</Text> : null}
					</Text>
				)}
			</View>
		</View>
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

/** チェックリストの印 (Claude Code の Todo と同じく四角)。☑ 完了 / ☒ 失敗 / くるくる 実行中 / ☐ 未着手 / ⊟ 中断。 */
const PlanMarker = ({ state }: { state: PlanTaskState }) => (
	<View style={styles.planMarker}>
		{state === 'done' ? <Icon name='check-square' size={14} color={colors.success} />
			: state === 'failed' ? <Icon name='x-square' size={14} color={colors.danger} />
				: state === 'running' ? <AiLoading size={15} />
					: state === 'interrupted' ? <Icon name='minus-square' size={14} color={colors.fgFaint} />
						: <Icon name='square' size={14} color={colors.fgFaint} />}
	</View>
);

const PlanCard = ({ progress }: { progress: PlanProgress }) => {
	const total = progress.items.length;
	return (
		<View style={styles.plan} accessibilityLabel={`計画 ${total} タスク、${progress.done} 件完了`}>
			<View style={styles.line}>
				<View style={styles.gutter}><Icon name='list' size={14} color={colors.accentText} /></View>
				<Text style={styles.planTitle}>
					計画
					<Text style={styles.planCount}>  {progress.done}/{total} 完了{progress.failed > 0 ? ` · ${progress.failed} 失敗` : ''}</Text>
				</Text>
			</View>
			{progress.leaderModel ? <Text style={[styles.planMeta, styles.indent]} numberOfLines={1}>リーダー: {progress.leaderModel}</Text> : null}
			{total === 0 ? <Muted style={styles.indent}>タスクはありません。</Muted> : null}
			{progress.items.map((item, i) => (
				<View
					key={`${item.index}-${i}`}
					style={styles.line}
					accessibilityLabel={`${i + 1}. ${item.roleName}: ${item.title}。${PLAN_STATE_LABELS[item.state]}`}
				>
					<PlanMarker state={item.state} />
					<View style={styles.flex}>
						<Text
							style={[
								styles.planItemTitle,
								item.state === 'running' && styles.planItemRunning,
								(item.state === 'done' || item.state === 'interrupted') && styles.planItemDone,
							]}
							numberOfLines={2}
						>
							<Text style={styles.planRole}>{item.roleName} </Text>
							{item.title || '(題名なし)'}
						</Text>
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
					<Text style={styles.taskHeaderArrow}>▸ </Text>
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
		<View style={styles.line}>
			<Icon name={ok ? 'check' : 'x'} size={13} color={ok ? colors.success : colors.danger} />
			<Text selectable style={styles.taskResultText} numberOfLines={3}>
				<Text style={{ color: ok ? colors.fgMuted : colors.danger }}>{task.roleName}{ok ? ' 完了' : ' 失敗'}</Text>
				{task.summary ? ` · ${oneLine(task.summary, 240)}` : ''}
			</Text>
		</View>
	);
};

/** goal イベント: リーダーが立てた目標と達成条件。 */
const GoalCard = ({ data }: { data: Record<string, unknown> }) => {
	const goal = toCloudGoal(data);
	return (
		<View style={[styles.plan, styles.goal]} accessibilityLabel={`目標: ${goal.goal}。達成条件 ${goal.criteria.length} 件`}>
			<View style={styles.line}>
				<View style={styles.gutter}><Icon name='target' size={14} color={colors.accentText} /></View>
				<Text style={styles.planTitle}>
					目標
					<Text style={styles.planCount}>  {GOAL_LOOP_LABELS[goal.mode]}{goal.maxRounds ? ` · 最大 ${goal.maxRounds} ラウンド` : ''}</Text>
				</Text>
			</View>
			<Text selectable style={[styles.doneText, styles.indent]}>{goal.goal}</Text>
			{goal.criteria.length ? <Text style={[styles.planMeta, styles.indent]}>達成条件</Text> : null}
			{goal.criteria.map((c, i) => (
				<View key={i} style={[styles.line, styles.indent]}>
					<Text style={styles.criterionIndex}>{i + 1}.</Text>
					<Text selectable style={styles.criterionText}>{c}</Text>
				</View>
			))}
			{goal.model ? <Text style={[styles.planMeta, styles.indent]} numberOfLines={1}>リーダー: {goal.model}</Text> : null}
		</View>
	);
};

/** review イベント: start はラウンドのレビューの区切り、done は条件ごとの判定と次にどうなるか。 */
const ReviewEventView = ({ data, roleName, onContinue, continuing }: {
	data: Record<string, unknown>;
	roleName: string;
	/** 確認待ちの最新のレビューなら「次のラウンドへ進む」 */
	onContinue?: () => void;
	continuing?: boolean;
}) => {
	const review = toCloudReview(data);
	if (!review) return null;
	if (review.status === 'start') {
		return (
			<View style={styles.taskHeader} accessibilityRole='header' accessibilityLabel={`ラウンド ${review.round} のレビュー`}>
				<View style={styles.taskHeaderLine} />
				<Text style={styles.taskHeaderText}>
					<Text style={styles.taskHeaderArrow}>◎ </Text>
					ラウンド {review.round} のレビュー · {roleName}
					{review.model ? <Text style={styles.taskHeaderModel}> ({review.model})</Text> : null}
				</Text>
			</View>
		);
	}
	const color = review.next === 'achieved' ? colors.success : review.next === 'limit' ? colors.danger : colors.warning;
	return (
		<View style={[styles.done, { borderColor: withAlpha(color, '55') }]}>
			<View style={styles.line}>
				<View style={styles.gutter}><Icon name='target' size={14} color={colors.fgMuted} /></View>
				<Text style={styles.doneTitle}>
					目標との照合
					<Text style={styles.doneCount}>  ラウンド {review.round}</Text>
				</Text>
			</View>
			{review.criteria.map(c => (
				<View key={c.index} style={styles.line} accessibilityLabel={`${c.index}. ${c.text}: ${c.met ? '達成' : '未達'}${c.reason ? `。${c.reason}` : ''}`}>
					<View style={styles.gutter}><Icon name={c.met ? 'check' : 'x'} size={13} color={c.met ? colors.success : colors.danger} /></View>
					<Text selectable style={styles.criterionText}>
						{c.index}. {c.text}
						{c.reason ? <Text style={styles.criterionReason}> — {c.reason}</Text> : null}
					</Text>
				</View>
			))}
			{review.summary ? <Text selectable style={styles.doneText}>{review.summary}</Text> : null}
			<View style={styles.line}>
				<View style={styles.gutter}><Icon name={review.next === 'achieved' ? 'check-circle' : review.next === 'limit' ? 'x-circle' : 'repeat'} size={14} color={color} /></View>
				<Text style={[styles.doneTitle, { color }]}>{reviewOutcomeLabel(review)}</Text>
			</View>
			{onContinue ? (
				<>
					<Button title='次のラウンドへ進む' size='sm' icon='repeat' loading={continuing} disabled={continuing} onPress={onContinue} style={styles.alignStart} />
					<Muted>入力欄に書いた内容は、追加の指示として次のラウンドに渡します。普通に送信すると新しい依頼になります。</Muted>
				</>
			) : null}
		</View>
	);
};

/** approval イベント: 成果物を承認した / 差し戻した。 */
const ApprovalEventView = ({ data }: { data: Record<string, unknown> }) => {
	const approval = toCloudApprovalEvent(data);
	if (!approval) return null;
	const label = approvalEventText(approval);
	return (
		<View style={styles.line} accessibilityLabel={`${approval.roleName}: ${label}`}>
			<Text selectable style={[styles.approvalEventText, { color: approval.status === 'approved' ? colors.success : colors.warning }]}>
				{label}
				{approval.file ? <Text style={styles.approvalEventFile}>  {approval.file}</Text> : null}
			</Text>
		</View>
	);
};

/**
 * 承認モードで止まっているときのカード。成果物の中身を編集でき、「承認して続行」か
 * フィードバックを付けて「差し戻す」。中身が読めない (大きすぎるなど) ときは編集せずに承認・差し戻しだけできる。
 */
/** command_approval イベント: 「⚠️ コマンドの承認待ち: 理由」+ コマンド / 許可 / 拒否 (とメモ) */
const CommandApprovalEventView = ({ data, roleName }: { data: Record<string, unknown>; roleName?: string }) => {
	const event = toCloudCommandApprovalEvent(data);
	if (!event) return null;
	const label = commandApprovalEventText(event);
	const color = event.status === 'pending' ? colors.warning : event.status === 'approved' ? colors.success : colors.danger;
	return (
		<View style={styles.line} accessibilityLabel={`${roleName ? `${roleName}: ` : ''}${label}`}>
			<Text selectable style={[styles.approvalEventText, { color }]}>
				{roleName ? `${roleName}: ` : ''}{label}
				{event.status === 'pending' && event.command ? <Text style={styles.approvalEventFile}>{'\n'}{event.command}</Text> : null}
			</Text>
		</View>
	);
};

/** 承認待ちのコマンド: 内容と理由を見せて、実行を許可 / 拒否 (理由は任意。エージェントに伝わる) */
const CommandApprovalView = ({ command, busy, error, onAnswer, onReload, loading }: {
	command: CloudCommandApproval;
	busy: 'approve' | 'deny' | null;
	error: string | null;
	loading: boolean;
	onAnswer: (action: 'approve' | 'deny', feedback: string) => void;
	onReload: () => void;
}) => {
	const [feedback, setFeedback] = useState('');
	useEffect(() => { setFeedback(''); }, [command.requestSeq]);
	return (
		<View style={[styles.done, styles.approval]} accessibilityLabel='コマンドの承認'>
			<View style={styles.line}>
				<View style={styles.gutter}><Icon name='shield' size={14} color={colors.warning} /></View>
				<Text style={[styles.doneTitle, styles.flex]}>
					コマンドの承認待ち
					{command.role ? <Text style={styles.doneCount}>  {command.role}</Text> : null}
				</Text>
				<Button title='更新' icon='refresh-cw' variant='ghost' size='sm' loading={loading} disabled={!!busy} onPress={onReload} />
			</View>
			<Text selectable style={styles.planMeta}>理由: {command.reason}</Text>
			<Text selectable style={styles.commandText}>{command.command}</Text>
			<Muted>エージェントが実行する前に止まっています。許可するとこのまま実行し、拒否すると実行せずに続けます。</Muted>
			<Input
				value={feedback}
				onChangeText={setFeedback}
				multiline
				editable={!busy}
				placeholder='任意: 拒否する理由や、代わりにしてほしいこと'
				accessibilityLabel='拒否の理由'
				style={styles.approvalFeedback}
			/>
			{error ? <ErrorBanner message={error} style={styles.inlineBanner} /> : null}
			<Row style={styles.doneActions}>
				<Button title='許可して実行' icon='check' size='sm' loading={busy === 'approve'} disabled={!!busy} onPress={() => onAnswer('approve', '')} />
				<Button title='拒否' icon='x' variant='secondary' size='sm' loading={busy === 'deny'} disabled={!!busy} onPress={() => onAnswer('deny', feedback)} />
			</Row>
		</View>
	);
};

const ApprovalCard = ({ auth, sessionId, lastSeq, onResolved }: {
	auth: DivisionSession;
	sessionId: string;
	/** ログが進んだら (別の端末で承認されて次の成果物を待っているなど) 読み直す */
	lastSeq: number;
	onResolved: (next: CloudSession, action: 'approve' | 'revise' | 'deny') => void;
}) => {
	const [approval, setApproval] = useState<CloudApproval | null>(null);
	/** エージェントが実行しようとしている危険なコマンド (どのセッションでも) */
	const [command, setCommand] = useState<CloudCommandApproval | null>(null);
	const [commandBusy, setCommandBusy] = useState<'approve' | 'deny' | null>(null);
	/** 成果物ではなく、Leader のワークフロー案 (計画を図にしたもの) を待っているとき */
	const [proposal, setProposal] = useState<CloudWorkflowProposal | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [content, setContent] = useState('');
	const [feedback, setFeedback] = useState('');
	const [busy, setBusy] = useState<'approve' | 'revise' | null>(null);
	const [error, setError] = useState<string | null>(null);
	const shownSeq = useRef<number | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setLoadError(null);
		try {
			const nextCommand = await getCloudCommandApproval(auth, sessionId);
			setCommand(nextCommand);
			if (nextCommand) {
				setApproval(null);
				setProposal(null);
				return;
			}
			const next = await getCloudApproval(auth, sessionId);
			setApproval(next);
			const nextProposal = next ? null : await getCloudWorkflowProposal(auth, sessionId);
			setProposal(prev => (prev && nextProposal && prev.proposalSeq === nextProposal.proposalSeq ? prev : nextProposal));
			// 同じ成果物を読み直したときは、編集中の内容とフィードバックを消さない
			if (next && next.taskSeq !== shownSeq.current) {
				shownSeq.current = next.taskSeq;
				setContent(next.content ?? '');
				setFeedback('');
				setError(null);
			}
		} catch (e) {
			setLoadError(cloudErrorText(e));
		} finally {
			setLoading(false);
		}
	}, [auth, sessionId]);

	useEffect(() => { void load(); }, [load, lastSeq]);

	const submit = async (action: 'approve' | 'revise') => {
		if (!approval || busy) return;
		if (action === 'revise' && !feedback.trim()) return;
		setBusy(action);
		setError(null);
		try {
			// 中身を変えたときだけ送る (読めなかったファイルは送らない)
			const edited = editedApprovalContent(approval, content);
			const next = await resolveCloudApproval(auth, sessionId, {
				taskSeq: approval.taskSeq,
				action,
				...(edited !== undefined ? { content: edited } : {}),
				...(action === 'revise' ? { feedback } : {}),
			});
			onResolved(next, action);
		} catch (e) {
			setError(approvalErrorText(e));
		} finally {
			setBusy(null);
		}
	};

	const readOnly = !approval || approval.content === null;
	const edited = !!approval && editedApprovalContent(approval, content) !== undefined;

	if (command) {
		const answerCommand = async (action: 'approve' | 'deny', feedback: string) => {
			if (commandBusy) return;
			setCommandBusy(action);
			setError(null);
			try {
				const next = await resolveCloudCommandApproval(auth, sessionId, { requestSeq: command.requestSeq, action, ...(action === 'deny' ? { feedback } : {}) });
				setCommand(null);
				onResolved(next, action);
			} catch (e) {
				setError(approvalErrorText(e));
				void load();
			} finally {
				setCommandBusy(null);
			}
		};
		return <CommandApprovalView command={command} busy={commandBusy} error={error} loading={loading} onAnswer={(a, f) => void answerCommand(a, f)} onReload={() => void load()} />;
	}

	if (!approval && proposal) {
		const answer = async (action: 'approve' | 'revise', input: { workflow?: CloudWorkflowProposal['workflow']; feedback?: string }) => {
			if (busy) return;
			setBusy(action);
			setError(null);
			try {
				const next = await resolveCloudWorkflowProposal(auth, sessionId, { proposalSeq: proposal.proposalSeq, action, ...input });
				setProposal(null);
				onResolved(next, action);
			} catch (e) {
				setError(approvalErrorText(e));
			} finally {
				setBusy(null);
			}
		};
		return (
			<WorkflowReviewCard
				key={proposal.proposalSeq}
				workflow={proposal.workflow}
				busy={busy}
				error={error}
				onApprove={workflow => void answer('approve', workflow ? { workflow } : {})}
				onRevise={feedback => void answer('revise', { feedback })}
			/>
		);
	}

	return (
		<View style={[styles.done, styles.approval]} accessibilityLabel='成果物の承認'>
			<View style={styles.line}>
				<View style={styles.gutter}><Icon name='check-square' size={14} color={colors.warning} /></View>
				<Text style={[styles.doneTitle, styles.flex]}>
					承認待ち
					{approval ? <Text style={styles.doneCount}>  {approval.roleName}</Text> : null}
				</Text>
				<Button title='更新' icon='refresh-cw' variant='ghost' size='sm' loading={loading && !!approval} disabled={!!busy} onPress={() => void load()} />
			</View>
			{loading && !approval && !loadError ? <Loading label='成果物を読み込んでいます…' /> : null}
			{loadError ? <ErrorBanner message={loadError} onRetry={() => void load()} style={styles.inlineBanner} /> : null}
			{!loading && !loadError && !approval ? (
				<Muted>承認待ちの成果物やワークフロー案が見つかりません。少し待ってから「更新」を押してください。</Muted>
			) : null}
			{approval ? (
				<>
					{approval.title ? <Text selectable style={styles.doneText}>{approval.title}</Text> : null}
					<Text selectable style={styles.approvalFile}>{approval.file}</Text>
					{approval.summary ? <Text selectable style={styles.planMeta} numberOfLines={4}>{approval.summary}</Text> : null}
					{readOnly ? (
						<Muted>
							{approval.tooLarge
								? 'ファイルが大きいため、ここでは表示・編集できません。そのまま承認するか、フィードバックを付けて差し戻してください。'
								: 'ファイルの中身を読み込めませんでした。そのまま承認するか、フィードバックを付けて差し戻してください。'}
						</Muted>
					) : (
						<>
							{/* 論文・仕様書は Markdown で、デザインは画面のまま見られる。「編集」で全文を直し、選んだ部分はロールの AI にも頼める */}
							<DocumentView
								name={approval.file}
								value={content}
								onChangeText={busy ? undefined : setContent}
								height={360}
								aiEdit={req => aiEditCloudDocument(auth, sessionId, { ...req, path: approval.file })}
								aiEditErrorText={aiEditErrorText}
							/>
							<Muted>{edited ? '編集した内容を保存してから続けます。' : '必要なら「編集」で中身を直すか、選んだ部分をロールの AI に直してもらってから承認できます。'}</Muted>
						</>
					)}
					<Input
						value={feedback}
						onChangeText={setFeedback}
						multiline
						editable={!busy}
						placeholder='差し戻すときのフィードバック (何を直してほしいか)'
						accessibilityLabel='差し戻しのフィードバック'
						style={styles.approvalFeedback}
					/>
					{error ? <ErrorBanner message={error} style={styles.inlineBanner} /> : null}
					<Row style={styles.doneActions}>
						<Button
							title='承認して続行'
							icon='check'
							size='sm'
							loading={busy === 'approve'}
							disabled={!!busy}
							onPress={() => void submit('approve')}
						/>
						<Button
							title='差し戻す'
							icon='corner-up-left'
							variant='secondary'
							size='sm'
							loading={busy === 'revise'}
							disabled={!!busy || !feedback.trim()}
							onPress={() => void submit('revise')}
						/>
					</Row>
				</>
			) : null}
		</View>
	);
};

const EventView = ({ event, timeline, onShowChanges, doneAction, onContinueGoal, continuing }: {
	event: CloudSessionEvent;
	timeline: DivisionTimeline;
	onShowChanges: () => void;
	/** Extra button on the completion card (the PR button, only on the latest one) */
	doneAction?: React.ReactNode;
	/** このイベントが確認待ちのレビューなら、次のラウンドへ進める */
	onContinueGoal?: () => void;
	continuing?: boolean;
}) => {
	const data = event.data;
	switch (event.type) {
		case 'user':
			return <UserBubble value={text(data.text)} />;
		case 'assistant': {
			const value = text(data.text).trim();
			const sites = searchedSitesOf(data);
			if (!value && !sites.length) return null;
			// 目標ループのレビュアーの発言には phase: 'review' が付く (Division Project ならロールも)
			const review = data.phase === 'review';
			const role = text(data.role) || (review ? 'reviewer' : '');
			return (
				<View style={styles.assistantBody}>
					{role ? <RoleChip label={timeline.roleNames.get(role) ?? (review ? 'レビュー' : role)} /> : null}
					{value ? <Markdown text={value} textStyle={styles.assistantText} /> : null}
					<SearchedSitesRow sites={sites} />
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
				<View style={styles.note}>
					<Icon name='info' size={12} color={colors.fgFaint} />
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
				<View style={styles.done}>
					<View style={styles.line}>
						<View style={styles.gutter}><Icon name='check-circle' size={14} color={colors.success} /></View>
						<Text style={styles.doneTitle}>
							完了
							{typeof data.round === 'number' ? <Text style={styles.doneCount}>  ラウンド {data.round}</Text> : null}
							{changed !== null ? <Text style={styles.doneCount}>  {changed} ファイル変更</Text> : null}
						</Text>
					</View>
					{text(data.summary) ? <Text selectable style={styles.doneText}>{text(data.summary)}</Text> : null}
					<Row style={styles.doneActions}>
						<Button title='差分を見る' variant='secondary' size='sm' icon='file-text' onPress={onShowChanges} style={styles.alignStart} />
						{doneAction}
					</Row>
				</View>
			);
		}
		case 'pull_request':
			return <PullRequestEventCard data={data} />;
		case 'goal':
			return <GoalCard data={data} />;
		case 'approval':
			return <ApprovalEventView data={data} />;
		case 'command_approval': {
			const role = text(data.role);
			return <CommandApprovalEventView data={data} roleName={role ? timeline.roleNames.get(role) ?? role : undefined} />;
		}
		case 'workflow':
			return <Muted>🗺️ Leader がワークフロー案を作りました{text(data.leaderModel) ? ` (${text(data.leaderModel)})` : ''}</Muted>;
		case 'workflow_review':
			return <Muted>{data.status === 'approved' ? `✅ ワークフローを承認しました${data.edited ? ' (図で編集)' : ''}` : `↩️ ワークフローを差し戻しました: ${text(data.feedback)}`}</Muted>;
		case 'review': {
			const role = text(data.role) || 'reviewer';
			return <ReviewEventView data={data} roleName={timeline.roleNames.get(role) ?? 'レビュー'} onContinue={onContinueGoal} continuing={continuing} />;
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

/** 詳細の見出し。題名の下に「リポジトリ · モデル」、右に差分の切り替えとアーカイブ。 */
const DetailHeader = ({ session, subtitle, showChanges, onToggleChanges, onOpenDocuments, archiving, onArchive }: {
	session: CloudSession;
	subtitle: string;
	showChanges: boolean;
	onToggleChanges: () => void;
	/** サンドボックスの .division の文書 (ワークフロー・論文・仕様書・デザイン) を開く。サンドボックスが無ければ undefined */
	onOpenDocuments?: () => void;
	archiving: boolean;
	onArchive: () => void;
}) => {
	const back = useBack();
	return (
		<View style={styles.detailHeader}>
			{back ? <IconButton icon='chevron-left' accessibilityLabel='戻る' onPress={back} /> : null}
			<View style={[styles.flex, !back && styles.detailHeaderTitlePad]}>
				<Text accessibilityRole='header' style={styles.detailTitle} numberOfLines={1}>{session.title}</Text>
				<Text style={styles.detailSubtitle} numberOfLines={1}>{subtitle}</Text>
			</View>
			<Pressable
				accessibilityRole='button'
				accessibilityState={{ selected: showChanges }}
				accessibilityLabel={showChanges ? 'ログに戻る' : `差分を見る (${session.changedFiles} ファイル)`}
				hitSlop={6}
				onPress={onToggleChanges}
				style={({ pressed }) => [styles.diffPill, showChanges && styles.diffPillActive, pressed && styles.rowPressed]}
			>
				<Icon name={showChanges ? 'message-square' : 'git-commit'} size={14} color={showChanges ? colors.onAccent : colors.fgMuted} />
				<Text style={[styles.diffPillText, showChanges && { color: colors.onAccent }]}>
					{showChanges ? 'ログ' : session.changedFiles > 0 ? `${session.changedFiles}` : '差分'}
				</Text>
			</Pressable>
			{onOpenDocuments ? <IconButton icon='book-open' accessibilityLabel='文書 (ワークフロー・論文・仕様書・デザイン)' onPress={onOpenDocuments} /> : null}
			{archiving
				? <View style={styles.headerSpinner}><ActivityIndicator size='small' color={colors.fgMuted} /></View>
				: <IconButton icon='archive' accessibilityLabel='アーカイブ' onPress={onArchive} />}
		</View>
	);
};

const sessionKey = (s: CloudSession): string =>
	`${s.status}|${s.updatedAt}|${s.lastSeq}|${s.changedFiles}|${s.modelLabel}|${s.title}|${s.costUsd ?? ''}|${s.pullRequest?.number ?? ''}|${s.pullRequest?.updatedAt ?? ''}`;

/** 失敗した送信操作。通常送信 (send) と目標ループの継続 (continueGoal) を区別して再試行する */
export type PendingSendAction = { kind: 'send' | 'continueGoal'; message: string };

/**
 * ホームから PC へ新しいチャットとして送ったときの失敗。
 * stage: どこで失敗したか。threadId: 作成済みのチャット (あれば再試行はここへ本文だけを送る)。
 * client: 送った PC。別の PC に繋ぎ直したら同じ threadId は使えないので再試行しない。
 */
export type PendingPcSend = {
	prompt: string;
	stage: 'newThread' | 'sendPrompt';
	client: NonNullable<ReturnType<typeof useApp>['client']>;
	threadId?: string;
};

const pcErrorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
	/** 送信に失敗した理由。入力欄の直上に再試行と一緒に残す (下書きは消さない。FR-003 / FR-005) */
	const [sendError, setSendError] = useState<string | null>(null);
	/** 失敗した操作の種類と引数。再試行は現在の入力欄ではなく、これを同じ形で送り直す (FR-003) */
	const [pendingAction, setPendingAction] = useState<PendingSendAction | null>(null);
	// 失敗表示と再試行対象は対で消す (入力の編集・別操作の成功で古い失敗を残さない。FR-004)
	const clearSendError = useCallback(() => {
		setSendError(null);
		setPendingAction(null);
	}, []);
	const [stopping, setStopping] = useState(false);
	const [archiving, setArchiving] = useState(false);
	const [composingPr, setComposingPr] = useState(false);
	const [documentsOpen, setDocumentsOpen] = useState(false);
	// 文書はエージェントが動くたびに変わりうるので、イベントが増えたら (lastSeq) 読み直す
	const documentSource = useMemo(() => cloudDocumentSource(auth, id, current.lastSeq), [auth, id, current.lastSeq]);

	const [changes, setChanges] = useState<CloudChanges | null>(null);
	const [changesLoading, setChangesLoading] = useState(false);
	const [changesError, setChangesError] = useState<string | null>(null);
	const changesSeq = useRef<number | null>(null);

	const lastSeq = useRef(0);
	const lastKey = useRef(sessionKey(initial));
	const scrollRef = useRef<ScrollView | null>(null);
	const follow = useRef(true);
	/** 指でスクロールしている最中 (このときだけ、上へ離れたら追従をやめる) */
	const dragging = useRef(false);

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
			clearSendError();
			toast.show('停止しました', 'success');
			void loadEvents();
		} catch (e) {
			toast.show(cloudErrorText(e), 'error');
		} finally {
			setStopping(false);
		}
	}, [auth, id, applySession, loadEvents, toast, clearSendError]);

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

	// 通常送信と目標継続の共通処理。失敗したら種類と引数を pendingAction に残す
	const runSend = useCallback(async (action: PendingSendAction) => {
		if (sending) return;
		setSending(true);
		try {
			applySession(action.kind === 'continueGoal'
				? await sendCloudMessage(auth, id, action.message, { continueGoal: true })
				: await sendCloudMessage(auth, id, action.message));
			setDraft('');
			clearSendError();
			follow.current = true;
			void loadEvents();
		} catch (e) {
			setPendingAction(action);
			setSendError(`${action.kind === 'continueGoal' ? '次のラウンドへ進めませんでした' : '送信できませんでした'}: ${cloudErrorText(e)}`);
		} finally {
			setSending(false);
		}
	}, [auth, id, sending, applySession, loadEvents, clearSendError]);

	const send = useCallback(async () => {
		const message = draft.trim();
		if (!message) return;
		await runSend({ kind: 'send', message });
	}, [draft, runSend]);

	// 目標ループが「毎回確認」で止まっているとき、次のラウンドへ進める (入力欄の内容は追加の指示になる)
	const continueGoal = useCallback(async () => {
		await runSend({ kind: 'continueGoal', message: draft });
	}, [draft, runSend]);

	// 再試行は入力欄の状態に依存せず、失敗した操作を同じ種類・引数で実行し直す
	const retrySend = useCallback(async () => {
		if (!pendingAction) return;
		await runSend(pendingAction);
	}, [pendingAction, runSend]);

	const onDraftChange = useCallback((text: string) => {
		setDraft(text);
		if (pendingAction) clearSendError();
	}, [pendingAction, clearSendError]);

	// エラーで止まったセッションを、止まったところから続ける (失敗したタスクを飛ばさず、その途中から)
	const resume = useCallback(async () => {
		if (sending) return;
		setSending(true);
		try {
			applySession(await resumeCloudSession(auth, id));
			clearSendError();
			follow.current = true;
			void loadEvents();
		} catch (e) {
			toast.show(cloudErrorText(e), 'error');
		} finally {
			setSending(false);
		}
	}, [auth, id, sending, applySession, loadEvents, toast, clearSendError]);

	// 承認モードで成果物の承認・差し戻しをしたら、セッションとログを取り直す
	const onApprovalResolved = useCallback((next: CloudSession, action: 'approve' | 'revise' | 'deny') => {
		applySession(next);
		clearSendError();
		toast.show(action === 'approve' ? '承認しました' : action === 'deny' ? '実行を拒否しました' : '差し戻しました', 'success');
		follow.current = true;
		void loadEvents();
	}, [applySession, loadEvents, toast, clearSendError]);

	const source = cloudSource(current);
	const active = isActive(current.status);
	const awaitingApproval = current.status === 'awaiting_approval';
	const sendable = canSendMessage(current);
	// Division Project の計画ごとのタスクの状態 (plan / task イベントが無ければ空)
	const timeline = useMemo(() => divisionTimeline(events, active), [events, active]);
	const canSend = sendable && !!draft.trim() && !sending;
	// 「作業中」の経過時間の起点。最後の指示から、無ければ開始から数える
	// ワークフローの並列ノードの分岐は、分岐ごとのレーンのカードにまとめる
	const blocks = useMemo(() => groupParallelBranches(chatBlocks(events), events, active), [events, active]);
	// 返答の頭に出す名前。Division Project ならそう出し、それ以外は「エージェント」
	const agentName = isDivisionProjectModel(current.model) ? 'Division Project' : 'エージェント';
	const workingSince = useMemo(() => {
		for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'user') return events[i].createdAt;
		return current.startedAt ?? current.createdAt;
	}, [events, current.startedAt, current.createdAt]);

	// Pull request (GitHub-repo sessions only; nothing is fetched or shown otherwise)
	const prState = usePullRequestInfo(auth, current);
	const pullRequest = currentPullRequest(current, prState.info);
	const applyPrResult = prState.applyResult;
	const onPrSubmitted = useCallback((pr: CloudPullRequest) => {
		applyPrResult(pr);
		follow.current = true;
		// Picks up the session's pullRequest and the new pull_request event
		void loadEvents();
	}, [applyPrResult, loadEvents]);
	// Multi-repo sessions: each repository's bar keeps its own state; only the log is followed here
	const onRepoPrSubmitted = useCallback(() => {
		follow.current = true;
		void loadEvents();
	}, [loadEvents]);
	const pausedSeq = useMemo(() => (active ? null : pausedReviewSeq(events)), [events, active]);
	const lastDoneSeq = useMemo(() => {
		for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'done') return events[i].seq;
		return null;
	}, [events]);
	const prDoneAction = prState.available && prState.info?.canCreate ? (
		<Button
			title={pullRequestActionLabel(pullRequest, pullRequestStateFor(pullRequest, prState.info))}
			variant='secondary'
			size='sm'
			icon='git-pull-request'
			onPress={() => setComposingPr(true)}
		/>
	) : null;

	/** 返答の中の 1 つ (続けて実行したツールのまとまり、またはイベント)。並列の分岐のレーンの中でも使う */
	const renderChatItem = (item: ChatItem) => (item.kind === 'tools' ? (
		<ToolGroup key={`t${item.key}`} events={item.events} />
	) : (
		<EventView
			key={item.event.seq}
			event={item.event}
			timeline={timeline}
			onShowChanges={() => setTab('changes')}
			doneAction={item.event.seq === lastDoneSeq ? prDoneAction : undefined}
			onContinueGoal={sendable && item.event.seq === pausedSeq ? () => void continueGoal() : undefined}
			continuing={sending}
		/>
	));

	const showChanges = tab === 'changes';
	// 動いていて何も書いていなければ、送信ボタンを停止ボタンにする (Claude Code と同じ)
	// 承認待ちのあいだは指示を送れない (サーバーも 409) ので、停止だけできるようにする
	const stopMode = awaitingApproval || (active && !draft.trim());

	return (
		<KeyboardAvoidingView
			style={styles.flex}
			behavior={Platform.OS === 'ios' ? 'padding' : undefined}
			keyboardVerticalOffset={insets.top}
		>
			<DetailHeader
				session={current}
				subtitle={[source.label, cloudModelLabel(current), current.projectId ? projectLabel(projects, current.projectId) : null]
					.filter(Boolean).join(' · ')}
				showChanges={showChanges}
				onToggleChanges={() => setTab(showChanges ? 'log' : 'changes')}
				onOpenDocuments={current.status !== 'provisioning' && current.status !== 'uploading' ? () => setDocumentsOpen(true) : undefined}
				archiving={archiving}
				onArchive={() => void archive()}
			/>

			{current.status === 'failed' && current.errorMsg ? (
				<Text selectable style={[styles.errorText, styles.detailError]} numberOfLines={4}>{current.errorMsg}</Text>
			) : null}
			{current.workspaceInfo?.repoFullName && (prState.available || pullRequest) ? (
				<View style={styles.prBar}>
					<PullRequestBar auth={auth} session={current} state={prState} onCompose={() => setComposingPr(true)} />
				</View>
			) : null}
			{multiRepos(current.workspaceInfo).some(r => r.fullName) ? (
				<View style={styles.prBar}>
					<RepoPullRequests auth={auth} session={current} onSubmitted={onRepoPrSubmitted} />
				</View>
			) : null}

			{error ? <ErrorBanner message={error} onRetry={() => void loadEvents()} /> : null}

			{!showChanges ? (
				<>
					<ScrollView
						ref={scrollRef}
						style={styles.flex}
						contentContainerStyle={styles.logContent}
						keyboardShouldPersistTaps='handled'
						keyboardDismissMode='on-drag'
						scrollEventThrottle={16}
						// 既定で常に最新を表示する。追従をやめるのは、指で上へ動かして一番下から離れたときだけ
						// (中身の伸び縮みやこちらからのスクロールでは切れない)。一番下の近くに戻ればまた追いかける
						onScrollBeginDrag={() => { dragging.current = true; }}
						onScrollEndDrag={() => { dragging.current = false; }}
						onMomentumScrollEnd={() => { dragging.current = false; }}
						onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
							const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
							if (distance < 80) follow.current = true;
							else if (dragging.current) follow.current = false;
						}}
						onContentSizeChange={() => { if (follow.current) scrollRef.current?.scrollToEnd({ animated: false }); }}
						// キーボードが開いて見える高さが縮んだときも一番下を保つ
						onLayout={() => { if (follow.current) scrollRef.current?.scrollToEnd({ animated: false }); }}
					>
						{!loaded ? <Loading label='ログを読み込んでいます…' /> : null}
						{loaded && events.length === 0 ? <Muted>{active ? 'サンドボックスを用意しています…' : 'ログはまだありません。'}</Muted> : null}
						<View style={styles.conversation}>
							{blocks.map(block => {
								if (block.kind === 'user') return <UserBubble key={block.event.seq} value={text(block.event.data.text)} />;
								const isLast = block === blocks[blocks.length - 1];
								return (
									<AgentTurn key={block.key} name={agentName}>
										{block.items.map(item => (item.kind === 'parallel' ? (
											<ParallelLogView
												key={`p${item.key}`}
												log={{ v: 1, lanes: item.lanes }}
												note='クラウドではサンドボックスを共有するので、分岐は上から 1 つずつ実行します。'
												waitingText='前の分岐が終わると始まります。'
												renderLane={lane => {
													// 分岐の見出し (task の start) はレーンの見出しと同じなので出さない
													const shown = lane.items.filter(it => !(it.kind === 'event' && it.event.type === 'task' && it.event.data.status === 'start'));
													return shown.length ? <View style={styles.laneItems}>{shown.map(renderChatItem)}</View> : null;
												}}
											/>
										) : renderChatItem(item)))}
										{active && isLast ? <TypingBubble status={current.status} since={workingSince} /> : null}
									</AgentTurn>
								);
							})}
							{active && blocks[blocks.length - 1]?.kind !== 'agent' ? (
								<AgentTurn name={agentName}>
									<TypingBubble status={current.status} since={workingSince} />
								</AgentTurn>
							) : null}
							{awaitingApproval ? (
								<ApprovalCard key={id} auth={auth} sessionId={id} lastSeq={current.lastSeq} onResolved={onApprovalResolved} />
							) : null}
							{current.status === 'failed' && loaded && events.length > 0 ? (
								<View style={styles.resumeRow}>
									<Button title='続ける' icon='play' size='sm' loading={sending} disabled={sending} onPress={() => void resume()} style={styles.alignStart} />
									<Muted style={styles.flex}>止まったところから再開します (失敗したステップを飛ばさず、その途中から続けます)。</Muted>
								</View>
							) : null}
						</View>
					</ScrollView>

					<View style={styles.composerWrap}>
						{sendError ? (
							<ErrorBanner
								message={pendingAction && !sendable
									// 失敗後にポーリングで送れない状態へ変わったら、押せない再試行は出さず理由と次の操作を示す (FR-004 / ISS-12)
									? `${sendError}\n${awaitingApproval
										? '現在は再試行できません。承認待ちのため、上のカードで内容を確認して承認するか差し戻してください。失敗した操作と入力は保持しています。'
										: '現在は再試行できません。セッションの準備ができるまでお待ちください。準備ができると再試行できます。失敗した操作と入力は保持しています。'}`
									: sendError}
								onRetry={pendingAction && sendable && !sending ? () => void retrySend() : undefined}
								style={styles.inlineBanner}
							/>
						) : null}
						<View style={styles.composerBox}>
							<TextInput
								value={draft}
								onChangeText={onDraftChange}
								editable={sendable}
								placeholder={awaitingApproval
									? '成果物の承認待ちです。上のカードで承認するか差し戻してください'
									: sendable ? (current.status === 'running' ? '作業中のエージェントに追加で指示する…' : '続きを指示する…') : '準備ができるまで指示は送れません'}
								placeholderTextColor={colors.fgFaint}
								selectionColor={colors.accentText}
								accessibilityLabel='追加の指示'
								multiline
								style={styles.composerInput}
							/>
							<View style={styles.composerBar}>
								<View style={styles.composerChips}>
									<View style={styles.statusInline} accessibilityLabel={`状態: ${cloudStatusLabel(current.status)}`}>
										<StatusMark status={current.status} />
										<Text style={[styles.statusLabel, { color: cloudStatusColor(current.status) }]}>{cloudStatusLabel(current.status)}</Text>
									</View>
									{typeof current.costUsd === 'number' ? (
										<Badge label={formatUsdCompact(current.costUsd)} icon='dollar-sign' color={colors.fgFaint} />
									) : null}
								</View>
								{stopMode ? (
									<SendButton icon='square' loading={stopping} accessibilityLabel='停止' onPress={() => void stop()} />
								) : (
									<SendButton icon='arrow-up' disabled={!canSend} loading={sending} accessibilityLabel='送信' onPress={() => void send()} />
								)}
							</View>
						</View>
					</View>
				</>
			) : (
				<ChangesView data={changes} loading={changesLoading} error={changesError} onReload={() => void loadChanges()} />
			)}

			{documentsOpen ? (
				<Sheet title='文書' eyebrow={`${current.title} · サンドボックスの .division`} onClose={() => setDocumentsOpen(false)}>
					<ScrollView contentContainerStyle={styles.documentsContent}>
						<DocumentList source={documentSource} />
					</ScrollView>
				</Sheet>
			) : null}

			{composingPr && prState.info ? (
				<PullRequestSheet
					auth={auth}
					session={current}
					info={prState.info}
					onClose={() => setComposingPr(false)}
					onSubmitted={result => onPrSubmitted(result.pullRequest)}
				/>
			) : null}
		</KeyboardAvoidingView>
	);
};

// ---------------------------------------------------------------------------
// ページ本体
// ---------------------------------------------------------------------------

/** これ以上の項目があるときだけ、一覧の上に絞り込み (全て / 稼働中 / 承認待ち / エラー) を出す */
const FILTER_MIN_ITEMS = 6;

export const CloudAgentsScreen = ({ onOpenPage, initialSessionId, headerTitle, onOpenPcChat }: {
	/** 「プロジェクト」「コスト」「カンバン」を開く (App のページの重なりに積む) */
	onOpenPage?: OpenPage;
	/** 開いたらすぐ詳細を出すセッション (カンバンの「クラウドで開く」から) */
	initialSessionId?: string | null;
	/**
	 * ホームの中に出すときの見出し (モード切り替え)。渡したときは上の段のショートカットを出さない
	 * (ページはホームのナビゲーションドロワーに、コストは入力欄にある)。
	 */
	headerTitle?: React.ReactNode;
	/**
	 * ホームだけ: 渡すと Claude Code のように、PC (リモートコントロール) のチャットと接続できる PC を
	 * クラウドのセッションと同じ一覧に混ぜ、入力欄で送り先 (クラウド / PC) を選べるようにする。
	 * PC のチャットを開くときに呼ぶ (チャットの切り替えはここで済ませてある)
	 */
	onOpenPcChat?: () => void;
} = {}) => {
	const { session, refreshSession } = useDivisionAuth();
	const { connection, connectionStatus, snapshot, client, connect, invalidate, refresh } = useApp();
	const unified = !!onOpenPcChat;
	const toast = useToast();
	const insets = useSafeAreaInsets();
	const foreground = useForeground();
	const connected = !!connection;
	const projects = useCloudProjects(session);

	const [sessions, setSessions] = useState<CloudSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(initialSessionId ?? null);
	const [optionsOpen, setOptionsOpen] = useState(false);
	const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
	const goalLoopTouched = useRef(false);
	const [launching, setLaunching] = useState(0);
	const [launchError, setLaunchError] = useState<string | null>(null);
	const [stoppingId, setStoppingId] = useState<string | null>(null);
	const [target, setTarget] = useState<LaunchTarget>('cloud');
	const [targetSheetOpen, setTargetSheetOpen] = useState(false);
	const [sendingToPc, setSendingToPc] = useState(false);
	/** PC への送信に失敗した理由と再試行対象。入力欄の直上に出す (トーストだけにしない。FR-003 / FR-005) */
	const [pcSendError, setPcSendError] = useState<string | null>(null);
	const [pendingPcSend, setPendingPcSend] = useState<PendingPcSend | null>(null);
	const clearPcSendError = useCallback(() => {
		setPcSendError(null);
		setPendingPcSend(null);
	}, []);
	const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(null);
	/** 引っ張って更新した回数 (判断の受信箱も読み直す) */
	const [pullCount, setPullCount] = useState(0);

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
		goalLoopTouched.current = false;
		previousStatus.current = null;
		setSessions([]);
		setSelectedId(null);
		setLoading(true);
		setDraft(d => ({ ...d, repos: [], addingRepo: false, projectId: '', modelMode: 'default', model: '', goalLoop: DEFAULT_GOAL_LOOP, approvalMode: true }));
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
						s.status === 'idle' ? `「${s.title}」が終わりました。`
							: s.status === 'awaiting_approval' ? `「${s.title}」が承認を待っています。`
								: `「${s.title}」が失敗しました。`,
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


	// Division のプロジェクトは画面を開いたときに一度読むだけなので、PC やウェブで新しく作ったものが
	// 出てくるよう、オプションを開いたときと前面に戻ったときに読み直す。
	const reloadProjects = projects.reload;
	useEffect(() => {
		if (optionsOpen && foreground) reloadProjects();
	}, [optionsOpen, foreground, reloadProjects]);

	const onPull = useCallback(async () => {
		setRefreshing(true);
		reloadProjects();
		setPullCount(n => n + 1);
		try { await loadList(); } finally { setRefreshing(false); }
	}, [loadList, reloadProjects]);

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

	const launch = useCallback(async (repos: CloudRepo[]) => {
		if (!session) return;
		const count = Number(draft.count);
		setOptionsOpen(false);
		setLaunchError(null);
		setLaunching(n => n + count);
		// 次に開いたとき同じリポジトリを選んだ状態にする
		// (後ろから保存して、最初に選んだ物を履歴の先頭にする)
		if (repos.some(isFullNameRepo)) {
			const picks = draft.repos.slice().reverse();
			void picks.reduce<Promise<void>>(
				(prev, r) => prev.then(() => saveLastCloudRepo(session.userId, { repo: r.repo, branch: r.branch.trim() })),
				Promise.resolve(),
			);
		}
		// 次に開いたとき同じモデル (Division Project ならそのプロジェクト) を選んだ状態にする
		const selection = modelSelectionOf(draft);
		void saveLastCloudModel(session.userId, selection);
		try {
			const results = await launchSessions(session, {
				prompt: draft.prompt,
				count,
				repos,
				title: draft.title || undefined,
				// model と projectId。Division Project なら model: 'division-project' + そのプロジェクト
				...launchModelFields(selection),
				// 承認モードは Division Project のときだけ
				approvalMode: selection.mode === 'division' && draft.approvalMode,
				// 1 つだけ起動したときは、作れた時点でそのセッションのチャットを開く (サンドボックスの用意はチャットの中で待つ)
				onCreated: count === 1
					? created => {
						setSessions(prev => (prev.some(s => s.id === created.id) ? prev : [created, ...prev]));
						setSelectedId(created.id);
					}
					: undefined,
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
	// 判断の受信箱は、セッションの状態 (承認待ち・変更・PR) が変わったときだけ読み直す (ポーリングのたびには読まない)。
	const inboxKey = useMemo(
		() => `${pullCount}#${sessions.map(s => `${s.id}:${s.status}:${s.changedFiles}:${s.pullRequest?.number ?? ''}`).join('|')}`,
		[sessions, pullCount],
	);
	const onInvestigationStarted = useCallback((started: CloudSession) => {
		setSessions(prev => (prev.some(s => s.id === started.id) ? prev : [started, ...prev]));
		setSelectedId(started.id);
	}, []);
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
	// ホームでは PC (リモートコントロール) のチャットと接続できる PC も同じ一覧に混ぜる
	const { devices } = useRemoteDevices(session, unified && !connection && foreground);
	const pcName = snapshot?.ide?.workspaceName || connection?.label || 'PC';
	const items = useMemo(() => buildHomeItems({
		cloudSessions: sessions,
		snapshot: unified ? snapshot : null,
		connectionStatus: unified ? connectionStatus : 'connected',
		pcName,
		devices: unified ? devices : [],
	}), [sessions, unified, snapshot, connectionStatus, pcName, devices]);
	// 全て / 稼働中 / 承認待ち / エラー で一覧を絞り込む
	const [listFilter, setListFilter] = useState<CloudSessionFilter>('all');
	const filterCounts = useMemo(() => countHomeItems(items), [items]);
	const visibleItems = useMemo(() => items.filter(item => matchesHomeFilter(item, listFilter)), [items, listFilter]);
	const pcRunning = items.filter(item => item.kind === 'pc-chat' && item.state === 'running').length;
	// PC が繋がっていなければ送り先はクラウドに戻す
	const pcAvailable = unified && connectionStatus === 'connected';
	useEffect(() => { if (!pcAvailable) setTarget('cloud'); }, [pcAvailable]);

	const openPcChat = useCallback(async (threadId: string, isActiveThread: boolean) => {
		if (!client || !onOpenPcChat) return;
		if (connectionStatus === 'lost') {
			onOpenPcChat();
			return;
		}
		try {
			if (!isActiveThread) {
				await client.switchThread(threadId);
				invalidate();
			}
			onOpenPcChat();
		} catch (e) {
			toast.show(`チャットを開けませんでした: ${e instanceof Error ? e.message : String(e)}`, 'error');
		}
	}, [client, onOpenPcChat, connectionStatus, invalidate, toast]);

	const connectDevice = useCallback(async (item: Extract<HomeItem, { kind: 'pc-device' }>) => {
		if (!session || !onOpenPcChat) return;
		const name = item.device.deviceLabel || item.device.lanUrl;
		if (item.status === 'offline') {
			toast.show(`${name} との接続が切れています。PC で Orchestra を起動し、リモートコントロールを有効にしてください。`, 'info');
			return;
		}
		setConnectingDeviceId(item.device.id);
		const result = await verifyAndConnect(
			{ url: item.device.lanUrl, token: item.device.token, label: item.device.deviceLabel },
			connect,
			{ accessToken: session.accessToken, sessions: devices, refreshAccessToken: async () => (await refreshSession?.())?.accessToken ?? null },
		);
		setConnectingDeviceId(null);
		if (!result.ok) {
			toast.show(result.message, 'error');
			return;
		}
		if (result.warning) toast.show(result.warning, 'info');
		onOpenPcChat();
	}, [session, onOpenPcChat, connect, devices, toast, refreshSession]);

	/** 送り先が PC のとき: PC で新しいチャットを開いて指示を送り、そのチャットを開く */
	// 失敗したら、どの段階で失敗したか・作成済みのチャット (threadId)・送った本文を覚えておく。
	// 再試行はチャット作成後の失敗なら同じ threadId へ本文だけを送り、チャットを重複して作らない (FR-003 / ISS-09)
	const runPcSend = useCallback(async (attempt: PendingPcSend) => {
		if (!client || !onOpenPcChat || sendingToPc) return;
		setSendingToPc(true);
		let threadId = attempt.client === client ? attempt.threadId : undefined;
		try {
			if (!threadId) {
				try {
					threadId = (await client.newThread())?.threadId || undefined;
				} catch (e) {
					setPendingPcSend({ prompt: attempt.prompt, stage: 'newThread', client });
					setPcSendError(`PC にチャットを作れませんでした: ${pcErrorText(e)}`);
					return;
				}
			}
			try {
				await client.sendPrompt(attempt.prompt, threadId ? { threadId } : undefined);
			} catch (e) {
				setPendingPcSend({ prompt: attempt.prompt, stage: 'sendPrompt', client, threadId });
				setPcSendError(`PC への本文を送信できませんでした: ${pcErrorText(e)}${threadId ? '（チャットは作成済みです。再試行では同じチャットへ本文だけを送ります）' : ''}`);
				return;
			}
			clearPcSendError();
			setDraft(d => ({ ...d, prompt: '' }));
			invalidate();
			onOpenPcChat();
		} finally {
			setSendingToPc(false);
		}
	}, [client, onOpenPcChat, sendingToPc, invalidate, clearPcSendError]);

	const sendToPc = useCallback(async (prompt: string) => {
		if (!client) return;
		await runPcSend({ prompt, stage: 'newThread', client });
	}, [client, runPcSend]);

	// 入力欄の本文を書き換えたら、古い失敗表示と再試行対象を消す (FR-004)
	useEffect(() => { clearPcSendError(); }, [draft.prompt, clearPcSendError]);

	/** 失敗した PC 送信を今やり直せるか。やり直せないときは理由と次の操作を出す (ISS-12) */
	const pcRetry = useMemo((): { kind: 'retry' } | { kind: 'blocked'; reason: string; actionLabel?: string; action?: () => void } | null => {
		if (!pendingPcSend) return null;
		if (connectionStatus === 'lost') {
			return { kind: 'blocked', reason: '現在は再試行できません。PC との接続が切れています。本文は保持しています。再接続してから再試行できます。', actionLabel: 'PCに再接続', action: () => void refresh() };
		}
		if (connectionStatus === 'connecting') {
			return { kind: 'blocked', reason: '現在は再試行できません。PC に接続しています…。接続が済むと再試行できます。本文は保持しています。' };
		}
		if (!pcAvailable || !client || pendingPcSend.client !== client) {
			return { kind: 'blocked', reason: '現在は再試行できません。送信した PC に接続していません。本文は保持しています。一覧の PC を押して接続するか、送り先をクラウドに切り替えてください。' };
		}
		return { kind: 'retry' };
	}, [pendingPcSend, connectionStatus, pcAvailable, client, refresh]);

	const retryPcSend = useCallback(() => {
		if (pendingPcSend) void runPcSend(pendingPcSend);
	}, [pendingPcSend, runPcSend]);

	/** 送り先を自分で選び直したら、PC への送信失敗は過去のものになる */
	const chooseTarget = useCallback((next: LaunchTarget) => {
		setTarget(next);
		setTargetSheetOpen(false);
		clearPcSendError();
	}, [clearPcSendError]);
	const filterOptions = useMemo(
		() => CLOUD_SESSION_FILTERS.map(f => ({ value: f.value, label: filterCounts[f.value] > 0 ? `${f.label} ${filterCounts[f.value]}` : f.label })),
		[filterCounts],
	);
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
			detail: projects.projects.length > 0 ? `${projects.projects.length} 件` : 'Division',
		},
		{ page: 'tuning', label: 'コスト', icon: 'bar-chart-2', detail: cost.known > 0 ? `${formatUsdCompact(cost.totalUsd)}` : '料金と残高' },
		{ page: 'kanban', label: 'カンバン', icon: 'columns', detail: typeof kanbanTasks === 'number' ? `${kanbanTasks} タスク` : null },
	];

	if (!session) {
		return (
			<Screen>
				<ScreenHeader title={headerTitle ?? 'クラウド'} />
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
			<KeyboardAvoidingView
				style={styles.flex}
				behavior={Platform.OS === 'ios' ? 'padding' : undefined}
				keyboardVerticalOffset={insets.top}
			>
				<ScreenHeader title={headerTitle ?? 'クラウド'} />

				{error ? <ErrorBanner message={error} onRetry={() => void loadList()} /> : null}
				{launchError ? <ErrorBanner message={launchError} onRetry={() => { setLaunchError(null); setOptionsOpen(true); }} /> : null}

				<ScrollView
					style={styles.flex}
					contentContainerStyle={styles.content}
					keyboardShouldPersistTaps='handled'
					keyboardDismissMode='on-drag'
					refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onPull()} tintColor={colors.fgMuted} />}
				>
					{onOpenPage && headerTitle === undefined ? <ShortcutRow items={shortcuts} connected={connected} onOpen={page => onOpenPage(page)} /> : null}

					{session ? (
						<DecisionInbox
							auth={session}
							refreshKey={inboxKey}
							onOpenSession={id => setSelectedId(id)}
							onSessionStarted={onInvestigationStarted}
						/>
					) : null}

					{launching > 0 ? (
						<View style={styles.launching} accessibilityLiveRegion='polite'>
							<AiLoading size={22} />
							<View style={styles.flex}>
								<Text style={styles.rowTitle}>{launching} 個のセッションを起動しています…</Text>
								<Muted>サンドボックスの用意に数分かかることがあります。この画面を離れても起動は続きます。</Muted>
							</View>
						</View>
					) : null}

					{loading && items.length === 0 ? (
						<Loading label='セッションを読み込んでいます…' />
					) : items.length === 0 ? (
						// 取得に失敗したときは空状態 (歓迎文) を出さない。失敗は上の ErrorBanner が再試行と一緒に示す (FR-004)
						launching > 0 || error ? null : (
							<View style={styles.welcome}>
								<Text style={styles.welcomeMark}>✻</Text>
								<Text style={styles.welcomeTitle}>{unified ? 'エージェントを動かす' : 'クラウドでエージェントを動かす'}</Text>
								<Muted style={styles.welcomeText}>
									{unified
										? '下の入力欄に頼みたいことを書いて送ると、クラウドのサンドボックスで動き始めます。PC の Orchestra でリモートコントロールを有効にすると、PC のチャットもここに並びます。'
										: '下の入力欄に頼みたいことを書いて送ると、Git リポジトリか空のフォルダからサンドボックスで動き始めます。PC の Orchestra から起動したセッションもここに出ます。'}
								</Muted>
							</View>
						)
					) : (
						<>
							<View style={styles.listHeader}>
								<Text style={styles.listHeaderText}>
									セッション{activeCount + pcRunning > 0 ? <Text style={{ color: colors.running }}>  {activeCount + pcRunning} 件が動いています</Text> : null}
								</Text>
								{cost.known > 0 ? (
									<Pressable
										accessibilityRole='button'
										accessibilityLabel={`表示中のセッションの料金 合計 ${formatUsdCompact(cost.totalUsd)}${onOpenPage ? '。コストを開く' : ''}`}
										disabled={!onOpenPage}
										hitSlop={8}
										onPress={() => onOpenPage?.('tuning')}
										style={({ pressed }) => [styles.costRow, pressed && styles.rowPressed]}
									>
										<Text style={styles.costValue}>
											{formatUsdCompact(cost.totalUsd)}{cost.unknown > 0 ? ` (${cost.known} 件分)` : ''}
										</Text>
										{onOpenPage ? <Icon name='chevron-right' size={12} color={colors.fgFaint} /> : null}
									</Pressable>
								) : null}
							</View>
							{/* 絞り込みは一覧が長いときだけ (短いうちは見れば足りる)。絞り込み中は戻せるよう出したまま */}
							{items.length >= FILTER_MIN_ITEMS || listFilter !== 'all' ? (
								<SegmentedControl<CloudSessionFilter>
									options={filterOptions}
									value={listFilter}
									onChange={setListFilter}
									style={styles.filterTabs}
								/>
							) : null}
							<View>
								{visibleItems.map(item => item.kind === 'cloud' ? (
									<SessionRow
										key={item.key}
										item={item.session}
										projectName={projectNameOf(item.session)}
										stopping={stoppingId === item.session.id}
										onPress={() => setSelectedId(item.session.id)}
										onStop={() => void stopFromList(item.session)}
									/>
								) : item.kind === 'pc-chat' ? (
									<PcChatRow key={item.key} item={item} onPress={() => void openPcChat(item.thread.threadId, item.isActive)} />
								) : (
									<PcDeviceRow
										key={item.key}
										item={item}
										connecting={connectingDeviceId === item.device.id}
										onPress={() => { if (!connectingDeviceId) void connectDevice(item); }}
									/>
								))}
								{visibleItems.length === 0 ? (
									<Muted style={styles.filterEmpty}>
										{listFilter === 'running' ? '稼働中のセッションはありません。'
											: listFilter === 'approval' ? '承認待ちのセッションはありません。'
												: '失敗したセッションはありません。'}
									</Muted>
								) : null}
							</View>
						</>
					)}
				</ScrollView>

				{/* PC への送信失敗は入力欄の直上に 1 つだけ。再試行できないときは再試行を消し、理由と次の操作を出す (FR-004 / ISS-12) */}
				{pcSendError && pcRetry ? (
					<ErrorBanner
						message={pcRetry.kind === 'blocked' ? `${pcSendError}\n${pcRetry.reason}` : pcSendError}
						onRetry={pcRetry.kind === 'retry' ? (sendingToPc ? undefined : retryPcSend) : pcRetry.action}
						retryLabel={pcRetry.kind === 'retry' ? (pendingPcSend?.threadId ? '同じチャットへ再試行' : '再試行') : pcRetry.actionLabel}
						style={styles.pcSendBanner}
					/>
				) : null}

				<LaunchComposer
					auth={session}
					projects={projects}
					draft={draft}
					onChange={setDraft}
					onGoalLoopTouched={() => { goalLoopTouched.current = true; }}
					onLaunch={repos => void launch(repos)}
					optionsOpen={optionsOpen}
					onOptionsOpen={setOptionsOpen}
					costLabel={cost.known > 0 ? formatUsdCompact(cost.totalUsd) : null}
					target={target}
					pcLabel={pcAvailable ? pcName : null}
					onTargetPress={unified ? () => setTargetSheetOpen(true) : undefined}
					onSendToPc={prompt => void sendToPc(prompt)}
					sendingToPc={sendingToPc}
				/>
				{targetSheetOpen ? (
					<Sheet title='送り先' eyebrow='新しいセッションをどこで動かすか' onClose={() => setTargetSheetOpen(false)}>
						<View style={styles.targetList}>
							<Pressable
								accessibilityRole='button'
								accessibilityState={{ selected: target === 'cloud' }}
								onPress={() => chooseTarget('cloud')}
								style={({ pressed }) => [styles.targetRow, pressed && styles.rowPressed]}
							>
								<Icon name='cloud' size={18} color={colors.fg} />
								<View style={styles.flex}>
									<Text style={styles.rowTitle}>クラウド</Text>
									<Muted>Division のサンドボックスで動かします。PC に繋いでいなくても使えます。</Muted>
								</View>
								{target === 'cloud' ? <Icon name='check' size={18} color={colors.fg} /> : null}
							</Pressable>
							<Pressable
								accessibilityRole='button'
								accessibilityState={{ selected: target === 'pc', disabled: !pcAvailable }}
								disabled={!pcAvailable}
								onPress={() => chooseTarget('pc')}
								style={({ pressed }) => [styles.targetRow, !pcAvailable && styles.targetRowDisabled, pressed && styles.rowPressed]}
							>
								<Icon name='monitor' size={18} color={pcAvailable ? colors.fg : colors.fgFaint} />
								<View style={styles.flex}>
									<Text style={[styles.rowTitle, !pcAvailable && { color: colors.fgFaint }]}>{pcAvailable ? pcName : 'PC'}</Text>
									<Muted>
										{pcAvailable
											? 'PC の Orchestra で新しいチャットとして動かします (リモートコントロール)。'
											: connectionStatus === 'lost'
												? 'PC との接続が切れています。'
												: '一覧の PC を押して接続すると選べます。'}
									</Muted>
								</View>
								{target === 'pc' ? <Icon name='check' size={18} color={colors.fg} /> : null}
							</Pressable>
						</View>
					</Sheet>
				) : null}
			</KeyboardAvoidingView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	laneItems: { gap: spacing.sm },
	flex: { flex: 1 },
	spread: { justifyContent: 'space-between' },
	wrapRow: { flexWrap: 'wrap' },
	alignStart: { alignSelf: 'flex-start' },
	rowPressed: { opacity: 0.6 },
	noGrow: { flexGrow: 0 },

	// 一覧
	content: {
		flexGrow: 1,
		paddingHorizontal: spacing.lg,
		paddingBottom: spacing.lg,
	},
	shortcutRow: { gap: spacing.sm, paddingVertical: spacing.md },
	shortcut: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs + 2,
		height: 32,
		paddingHorizontal: spacing.md,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: colors.border,
	},
	shortcutDisabled: { opacity: 0.6 },
	shortcutLabel: { color: colors.fg, fontSize: fontSize.xs + 1, fontWeight: '500' },
	shortcutDetail: { color: colors.fgFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
	launching: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		marginBottom: spacing.sm,
		padding: spacing.md,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
	},
	welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl * 2 },
	welcomeMark: { color: colors.accent, fontSize: fontSize.xl + 6 },
	welcomeTitle: { color: colors.fgStrong, fontSize: fontSize.lg, fontWeight: '500', textAlign: 'center', fontFamily: SERIF },
	welcomeText: { textAlign: 'center', lineHeight: 21, maxWidth: 320 },
	listHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingTop: spacing.xs,
		paddingBottom: spacing.xs,
	},
	listHeaderText: { color: colors.fgFaint, fontSize: fontSize.xs, fontWeight: '600', letterSpacing: 0.4 },
	costRow: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 28 },
	costValue: { color: colors.fgMuted, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
	sessionRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.md,
		minHeight: 64,
		paddingVertical: spacing.md,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	rowTop: { gap: spacing.sm },
	rowTitle: { color: colors.fg, fontSize: fontSize.sm, fontWeight: '500' },
	rowTime: { color: colors.fgFaint, fontSize: fontSize.xs, fontVariant: ['tabular-nums'] },
	rowMeta: { color: colors.fgFaint, fontSize: fontSize.xs, fontFamily: MONO, marginTop: 3 },
	statusDotWrap: { width: 20, alignItems: 'center' },

	// 入力欄 (一覧・詳細で共通)
	composerWrap: {
		paddingHorizontal: spacing.md,
		paddingTop: spacing.sm,
		paddingBottom: spacing.sm,
	},
	composerBox: {
		borderRadius: 24,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
		paddingHorizontal: spacing.sm,
		paddingTop: spacing.xs,
		paddingBottom: spacing.sm,
		gap: spacing.xs,
		shadowColor: colors.shadow,
		shadowOpacity: 0.06,
		shadowRadius: 10,
		shadowOffset: { width: 0, height: 2 },
		elevation: 2,
	},
	composerInput: {
		minHeight: 44,
		maxHeight: 160,
		paddingHorizontal: spacing.xs + 2,
		paddingTop: spacing.sm,
		paddingBottom: spacing.xs,
		color: colors.fg,
		fontSize: fontSize.sm,
		lineHeight: 21,
		textAlignVertical: 'top',
	},
	composerBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
	composerChips: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
	composerChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		maxWidth: 220,
		height: 28,
		paddingHorizontal: spacing.sm + 2,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bg,
	},
	composerChipWarn: { borderColor: withAlpha(colors.warning, '66') },
	composerChipText: { flexShrink: 1, color: colors.fgMuted, fontSize: fontSize.xs, fontFamily: MONO },
	// 送信・停止は主要操作なので、hitSlop に頼らず実寸で 44×44 を確保する (FR-011)
	sendButton: {
		width: 44,
		height: 44,
		borderRadius: radius.sm,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.accent,
	},
	sendButtonDisabled: { backgroundColor: colors.accent, opacity: 0.4 },

	// 起動の設定
	sheetContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
	field: { gap: spacing.sm },
	inputInvalid: { borderColor: colors.danger },
	invalidText: { color: colors.danger, fontSize: fontSize.xs },
	githubChecking: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
	linkButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.xs, minHeight: 32 },
	linkText: { color: colors.accentText, fontSize: fontSize.xs + 1, fontWeight: '600' },
	advancedToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 36 },
	advancedText: { color: colors.fgMuted, fontSize: fontSize.xs + 1, fontWeight: '600' },

	// 詳細の見出し
	detailHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		minHeight: 56,
		paddingLeft: spacing.xs,
		paddingRight: spacing.sm,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	detailHeaderTitlePad: { paddingLeft: spacing.md },
	detailTitle: { color: colors.fgStrong, fontSize: fontSize.sm + 1, fontWeight: '600' },
	detailSubtitle: { color: colors.fgFaint, fontSize: fontSize.xs, fontFamily: MONO, marginTop: 2 },
	diffPill: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		height: 30,
		paddingHorizontal: spacing.sm + 2,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: colors.borderStrong,
	},
	documentsContent: { padding: spacing.lg, gap: spacing.md },
	diffPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
	diffPillText: { color: colors.fgMuted, fontSize: fontSize.xs, fontWeight: '600', fontVariant: ['tabular-nums'] },
	headerSpinner: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
	detailError: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
	prBar: {
		paddingHorizontal: spacing.lg,
		paddingVertical: spacing.sm,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.border,
	},
	statusInline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
	statusLabel: { fontSize: fontSize.xs, fontWeight: '600' },
	filterTabs: { marginBottom: spacing.sm },
	targetList: { gap: spacing.xs, paddingBottom: spacing.lg },
	targetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md },
	targetRowDisabled: { opacity: 0.6 },
	filterEmpty: { paddingVertical: spacing.lg, textAlign: 'center' },

	// ログ (チャット)
	logContent: {
		flexGrow: 1,
		paddingHorizontal: spacing.lg,
		paddingTop: spacing.md,
		paddingBottom: spacing.md,
	},
	conversation: { gap: spacing.md },
	line: { flexDirection: 'row', alignItems: 'flex-start' },
	gutter: { width: GUTTER, minHeight: 22, alignItems: 'flex-start', justifyContent: 'center' },
	indent: { marginLeft: GUTTER },
	elbow: { color: colors.fgFaint, fontFamily: MONO, fontSize: fontSize.xs + 1, lineHeight: 20, paddingLeft: 3 },
	bullet: { fontSize: 10, lineHeight: 22 },
	userWrap: { alignItems: 'flex-end', paddingLeft: spacing.xl * 2 },
	userBubble: {
		borderRadius: 18,
		borderBottomRightRadius: 6,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		backgroundColor: colors.bgHover,
	},
	userText: { color: colors.fg, fontSize: fontSize.sm, lineHeight: 21 },
	agentTurn: { gap: spacing.xs },
	agentBody: { gap: spacing.sm },
	assistantBody: { gap: spacing.xs },
	assistantText: { color: colors.fg, fontSize: fontSize.sm, lineHeight: 22 },
	roleChip: {
		alignSelf: 'flex-start',
		maxWidth: 160,
		paddingHorizontal: spacing.sm,
		paddingVertical: 2,
		borderRadius: 999,
		backgroundColor: colors.bgHover,
	},
	roleChipText: { color: colors.fgMuted, fontSize: fontSize.xs - 1, fontWeight: '600' },
	// ツールは枠の無い 1 行 (Claude と同じ)。押すと下に開く
	toolGroup: {},
	toolGroupHead: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs + 2,
		minHeight: 28,
	},
	toolGroupLabel: { flex: 1, color: colors.fgMuted, fontSize: fontSize.xs + 1 },
	toolGroupLast: { color: colors.fgFaint, fontFamily: MONO, fontSize: fontSize.xs },
	toolGroupFailed: { color: colors.danger, fontSize: fontSize.xs },
	toolGroupBody: {
		gap: spacing.sm,
		marginLeft: 6,
		paddingLeft: spacing.sm + 2,
		paddingVertical: spacing.xs,
		borderLeftWidth: StyleSheet.hairlineWidth,
		borderLeftColor: colors.border,
	},
	tool: { gap: 2 },
	toolCall: { flex: 1, fontFamily: MONO, fontSize: fontSize.xs + 1, lineHeight: 20 },
	toolName: { color: colors.fgStrong, fontWeight: '700' },
	toolArg: { color: colors.fgMuted },
	toolDuration: { color: colors.fgFaint, fontSize: fontSize.xs, lineHeight: 22, marginLeft: spacing.sm },
	toolOutput: {
		flex: 1,
		padding: spacing.sm,
		borderRadius: radius.sm,
		backgroundColor: colors.bg,
	},
	monoText: { color: colors.fgFaint, fontFamily: MONO, fontSize: fontSize.xs, lineHeight: 20 },
	siteList: { gap: spacing.xs },
	siteLink: { color: colors.accentText, fontFamily: MONO, fontSize: fontSize.xs, lineHeight: 20 },
	moreText: { color: colors.fgFaint, fontStyle: 'italic' },
	note: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
	noteText: { color: colors.fgFaint, fontSize: fontSize.xs, lineHeight: 18, flexShrink: 1 },
	errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
	resumeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
	errorText: { color: colors.danger, fontSize: fontSize.xs + 1, lineHeight: 20, flexShrink: 1 },
	plan: {
		gap: spacing.xs + 2,
		padding: spacing.md,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.bgElevated,
	},
	planTitle: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600', lineHeight: 22 },
	goal: { borderColor: withAlpha(colors.accentText, '55') },
	criterionIndex: { color: colors.fgFaint, fontSize: fontSize.xs, lineHeight: 20, width: GUTTER, fontVariant: ['tabular-nums'] },
	criterionText: { color: colors.fg, fontSize: fontSize.xs + 1, lineHeight: 20, flexShrink: 1 },
	criterionReason: { color: colors.fgFaint },
	planCount: { color: colors.fgFaint, fontSize: fontSize.xs, fontWeight: '400' },
	planMeta: { color: colors.fgFaint, fontSize: fontSize.xs },
	planMarker: { width: 22, height: 20, alignItems: 'flex-start', justifyContent: 'center' },
	planItemTitle: { color: colors.fg, fontSize: fontSize.xs + 1, lineHeight: 20 },
	planItemRunning: { color: colors.fgStrong, fontWeight: '600' },
	planItemDone: { color: colors.fgFaint, textDecorationLine: 'line-through' },
	planRole: { color: colors.fgFaint, fontWeight: '600', textDecorationLine: 'none' },
	planItemModel: { color: colors.fgFaint, fontSize: fontSize.xs, marginTop: 1 },
	taskHeader: { gap: spacing.xs, marginTop: spacing.sm },
	taskHeaderLine: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
	taskHeaderText: { color: colors.fgStrong, fontSize: fontSize.xs + 1, fontWeight: '600', lineHeight: 20 },
	taskHeaderArrow: { color: colors.accentText },
	taskHeaderPos: { color: colors.accentText, fontVariant: ['tabular-nums'] },
	taskHeaderModel: { color: colors.fgFaint, fontWeight: '400' },
	taskResultText: { color: colors.fgFaint, fontSize: fontSize.xs, lineHeight: 20, flexShrink: 1, marginLeft: spacing.xs },
	done: {
		gap: spacing.sm,
		padding: spacing.md,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: withAlpha(colors.success, '44'),
	},
	doneTitle: { color: colors.fgStrong, fontSize: fontSize.sm, fontWeight: '600', lineHeight: 22 },
	doneCount: { color: colors.fgFaint, fontSize: fontSize.xs, fontWeight: '400' },
	doneText: { color: colors.fg, fontSize: fontSize.sm, lineHeight: 22 },
	doneActions: { flexWrap: 'wrap' },
	approval: { borderColor: withAlpha(colors.warning, '66') },
	approvalFile: { color: colors.fgMuted, fontFamily: MONO, fontSize: fontSize.xs },
	approvalFeedback: { minHeight: 64, textAlignVertical: 'top' },
	approvalEventText: { fontSize: fontSize.xs + 1, lineHeight: 20, flexShrink: 1 },
	approvalEventFile: { color: colors.fgFaint, fontFamily: MONO, fontSize: fontSize.xs },
	commandText: { color: colors.fgStrong, fontFamily: MONO, fontSize: fontSize.xs + 1, lineHeight: 19, padding: spacing.sm, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.bgInput },
	toggleLabel: { color: colors.fg, fontSize: fontSize.sm },
	typing: {
		flexDirection: 'row',
		alignItems: 'center',
		alignSelf: 'flex-start',
		gap: spacing.sm,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		borderRadius: 18,
		borderTopLeftRadius: 6,
		backgroundColor: colors.bgElevated,
	},
	typingText: { color: colors.fgMuted, fontSize: fontSize.xs + 1 },
	workingElapsed: { color: colors.fgFaint },

	// 変更
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
	// ホームの PC 送信失敗。入力欄 (composerWrap) と同じ左右の余白で直上に置く
	pcSendBanner: { marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: 0 },
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
