/**
 * チューニングのタブ。
 *
 * 「チャットでどのモデルが選ばれるか」を、コストと性能の条件で調整する場所。
 *   - 方針      … 最低性能スコア / 1 回あたりの上限 / 出力トークンの上限
 *   - 見積もり  … 依頼文を Jev に判定させ、役割ごとの想定コストを出す
 *   - 利用履歴  … 実測のトークン数と料金 (日別・役割別・モデル別の集計つき)
 *   - 管理      … プラン、クレジット残高、自動チャージ、支払い
 *
 * すべて Division (Supabase / Division API) 直結なので、PC に接続していなくても使える。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
	Linking,
	RefreshControl,
	ScrollView,
	StyleSheet,
	Switch,
	Text,
	View,
} from 'react-native';

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
	ScreenHeader,
	SectionTitle,
} from '../components/ui';
import { relativeTimeFromIso, roleTitle } from '../lib/format';
import {
	CreditTransaction,
	DIVISION_PLANS,
	DivisionProfile,
	createCheckoutUrl,
	createPortalUrl,
	fetchDivisionProfile,
	listCreditTransactions,
	saveAutoChargeSettings,
} from '../lib/divisionBilling';
import {
	DEFAULT_ROUTING_POLICY,
	DivisionRoutingError,
	RoutingHistoryItem,
	RoutingPolicy,
	RoutingQuote,
	fetchRoutingHistory,
	fetchRoutingQuotes,
} from '../lib/divisionRouting';
import {
	CostGroup,
	averageCost,
	byDay,
	byModel,
	byRole,
	estimateDrift,
	estimateInputTokens,
	formatTokens,
	formatUsd,
	formatUsdShort,
	isInputTokensValid,
	quoteTotalUsd,
	quoteViolations,
	remainingRuns,
	sumHistory,
	validatePolicy,
} from '../lib/tuning';
import { useDivisionAuth } from '../state/DivisionAuthContext';
import { loadRoutingPolicy, saveRoutingPolicy } from '../state/tuningStorage';
import { colors, fontSize, radius, spacing } from '../theme';

const errorText = (e: unknown): string =>
	e instanceof DivisionRoutingError ? e.userMessage : e instanceof Error ? e.message : String(e);

type Section = 'policy' | 'estimate' | 'history' | 'account';

const SECTIONS: { value: Section; label: string }[] = [
	{ value: 'policy', label: '方針' },
	{ value: 'estimate', label: '見積もり' },
	{ value: 'history', label: '利用履歴' },
	{ value: 'account', label: '管理' },
];

/** 数値の入力欄。空文字や '-' を打っている途中でも壊れないように文字列で持つ。 */
const NumberField = ({
	label,
	hint,
	value,
	onChange,
	invalid,
}: {
	label: string;
	hint?: string;
	value: string;
	onChange: (text: string) => void;
	invalid?: boolean;
}) => (
	<View style={styles.field}>
		<Muted>{label}</Muted>
		<Input
			value={value}
			onChangeText={onChange}
			// 上限コストは小数を打つので、整数キーパッドにはしない。
			keyboardType='decimal-pad'
			accessibilityLabel={label}
			style={invalid ? styles.inputInvalid : undefined}
		/>
		{hint ? <Muted>{hint}</Muted> : null}
	</View>
);

const GroupTable = ({ title, groups }: { title: string; groups: CostGroup[] }) => (
	<Card>
		<SectionTitle>{title}</SectionTitle>
		{groups.length === 0 ? <Muted>まだ記録がありません。</Muted> : null}
		{groups.map(group => (
			<Row key={group.key} style={styles.spread}>
				<View style={styles.flex}>
					<Body numberOfLines={1}>{group.label}</Body>
					<Muted>
						{group.totals.count} 回 · 入力 {formatTokens(group.totals.inputTokens)} / 出力 {formatTokens(group.totals.outputTokens)}
					</Muted>
				</View>
				<Text style={styles.amount}>{formatUsd(group.totals.totalCostUsd)}</Text>
			</Row>
		))}
	</Card>
);

export const TuningScreen = () => {
	const { session } = useDivisionAuth();

	const [section, setSection] = useState<Section>('policy');
	const [notice, setNotice] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);

	// --- 方針 ---
	const [policy, setPolicy] = useState<RoutingPolicy>(DEFAULT_ROUTING_POLICY);
	const [enabled, setEnabled] = useState(false);
	const [draft, setDraft] = useState({
		minPerformance: String(DEFAULT_ROUTING_POLICY.minPerformance),
		maxCostUsd: String(DEFAULT_ROUTING_POLICY.maxCostUsd),
		maxOutputTokens: String(DEFAULT_ROUTING_POLICY.maxOutputTokens),
	});

	// --- アカウント ---
	const [profile, setProfile] = useState<DivisionProfile | null>(null);
	const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
	const [autoChargeDraft, setAutoChargeDraft] = useState({ enabled: false, threshold: '5', amount: '20' });
	const [savingAutoCharge, setSavingAutoCharge] = useState(false);

	// --- 見積もり ---
	const [promptText, setPromptText] = useState('');
	const [inputTokens, setInputTokens] = useState('2000');
	const [quotes, setQuotes] = useState<RoutingQuote[]>([]);
	const [quoting, setQuoting] = useState(false);

	// --- 履歴 ---
	const [history, setHistory] = useState<RoutingHistoryItem[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [groupTotals, setGroupTotals] = useState<Record<string, number>>({});
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyLoaded, setHistoryLoaded] = useState(false);
	const [breakdown, setBreakdown] = useState<'day' | 'role' | 'model'>('day');

	const parsedDraft = useMemo<RoutingPolicy>(() => ({
		minPerformance: Number(draft.minPerformance),
		maxCostUsd: Number(draft.maxCostUsd),
		maxOutputTokens: Number(draft.maxOutputTokens),
	}), [draft]);
	const issues = useMemo(() => validatePolicy(parsedDraft), [parsedDraft]);
	const issueFor = useCallback(
		(field: keyof RoutingPolicy) => issues.find(i => i.field === field)?.message,
		[issues],
	);

	// Division APIはプロフィールのAPIキーではなく、ログイン中のSupabase JWTで認証する。
	const hasOAuthSession = !!session?.accessToken;

	// --- 読み込み ---

	useEffect(() => {
		void (async () => {
			const saved = await loadRoutingPolicy();
			setPolicy(saved.policy);
			setEnabled(saved.enabled);
			setDraft({
				minPerformance: String(saved.policy.minPerformance),
				maxCostUsd: String(saved.policy.maxCostUsd),
				maxOutputTokens: String(saved.policy.maxOutputTokens),
			});
		})();
	}, []);

	const loadAccount = useCallback(async () => {
		if (!session) return;
		setError(null);
		try {
			const [nextProfile, nextTransactions] = await Promise.all([
				fetchDivisionProfile(session),
				listCreditTransactions(session).catch(() => [] as CreditTransaction[]),
			]);
			setProfile(nextProfile);
			setTransactions(nextTransactions);
			setAutoChargeDraft({
				enabled: nextProfile.autoCharge,
				threshold: String(nextProfile.autoChargeThreshold),
				amount: String(nextProfile.autoChargeAmount),
			});
		} catch (e) {
			setError(errorText(e));
		}
	}, [session]);

	useEffect(() => { void loadAccount(); }, [loadAccount]);

	const loadHistory = useCallback(async (more = false) => {
		if (!session) return;
		setHistoryLoading(true);
		setError(null);
		try {
			const page = await fetchRoutingHistory(session, { cursor: more ? cursor : null });
			setHistory(prev => (more ? [...prev, ...page.items] : page.items));
			setCursor(page.nextCursor);
			setGroupTotals(prev => (more ? { ...prev, ...page.groupTotals } : page.groupTotals));
			setHistoryLoaded(true);
		} catch (e) {
			setError(errorText(e));
		} finally {
			setHistoryLoading(false);
		}
	}, [session, cursor]);

	// 「利用履歴」を開いた時点で 1 回だけ自動で取りに行く (課金は発生しない)。
	useEffect(() => {
		if (section === 'history' && hasOAuthSession && !historyLoaded && !historyLoading) void loadHistory();
	}, [section, hasOAuthSession, historyLoaded, historyLoading, loadHistory]);

	const refresh = useCallback(async () => {
		setRefreshing(true);
		try {
			await loadAccount();
			if (section === 'history' && hasOAuthSession) await loadHistory();
		} finally {
			setRefreshing(false);
		}
	}, [loadAccount, loadHistory, section, hasOAuthSession]);

	// --- 操作 ---

	const savePolicy = useCallback(async (nextEnabled: boolean) => {
		if (issues.length > 0) return;
		setPolicy(parsedDraft);
		setEnabled(nextEnabled);
		await saveRoutingPolicy(parsedDraft, nextEnabled);
		setQuotes([]);
		setNotice(nextEnabled ? '方針を保存して有効にしました。' : '方針を無効にしました。');
	}, [issues, parsedDraft]);

	const runQuote = useCallback(async () => {
		if (!session) return;
		setQuoting(true);
		setError(null);
		setQuotes([]);
		try {
			setQuotes(await fetchRoutingQuotes(session, {
				input: promptText,
				inputTokens: Number(inputTokens),
				policy: parsedDraft,
			}));
		} catch (e) {
			setError(errorText(e));
		} finally {
			setQuoting(false);
		}
	}, [session, promptText, inputTokens, parsedDraft]);

	const saveAutoCharge = useCallback(async () => {
		if (!session) return;
		setSavingAutoCharge(true);
		setError(null);
		try {
			await saveAutoChargeSettings(session, {
				autoCharge: autoChargeDraft.enabled,
				threshold: Number(autoChargeDraft.threshold),
				amount: Number(autoChargeDraft.amount),
			});
			setNotice('自動チャージの設定を保存しました。');
			await loadAccount();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setSavingAutoCharge(false);
		}
	}, [session, autoChargeDraft, loadAccount]);

	const openBillingUrl = useCallback(async (make: () => Promise<string>) => {
		setError(null);
		try {
			const url = await make();
			await Linking.openURL(url);
		} catch (e) {
			setError(errorText(e));
		}
	}, []);

	// --- 集計 ---

	const totals = useMemo(() => sumHistory(history), [history]);
	const drift = useMemo(() => estimateDrift(totals), [totals]);
	const groups = useMemo(() => {
		if (breakdown === 'role') return byRole(history).map(g => ({ ...g, label: roleTitle(g.key) }));
		if (breakdown === 'model') return byModel(history);
		return byDay(history);
	}, [history, breakdown]);
	const runsLeft = useMemo(
		() => (profile ? remainingRuns(profile.creditBalance, averageCost(totals)) : null),
		[profile, totals],
	);

	const quoteTotal = useMemo(() => quoteTotalUsd(quotes), [quotes]);
	const violations = useMemo(() => quoteViolations(quotes, parsedDraft), [quotes, parsedDraft]);

	if (!session) {
		return (
			<Screen>
				<ScreenHeader title='チューニング' />
				<EmptyState
					title='Division にログインしてください'
					detail='コストの見積もりと利用履歴は Division アカウントに紐づいています。'
				/>
			</Screen>
		);
	}

	const missingOAuthSession = !session;

	return (
		<Screen>
			<ScreenHeader title='チューニング' subtitle='コストと性能の条件でモデルの選ばれ方を調整する' />

			<View style={styles.toolbar}>
				<ChipGroup<Section> options={SECTIONS} value={section} onChange={setSection} />
			</View>

			{error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

			<ScrollView
				contentContainerStyle={styles.content}
				refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}
			>
				{missingOAuthSession && section !== 'policy' ? (
					<Card>
						<SectionTitle>DivisionのJWT認証が必要です</SectionTitle>
						<Muted>
							見積もりと利用履歴は、Divisionにログイン中のSupabase JWTで認証します。
							もう一度ログインしてから利用してください。
						</Muted>
					</Card>
				) : null}

				{/* ------------------------------------------------------------- 方針 */}
				{section === 'policy' ? (
					<>
						<Card>
							<Row style={styles.spread}>
								<SectionTitle>自動割り当ての方針</SectionTitle>
								<Badge label={enabled ? '有効' : '無効'} color={enabled ? colors.success : colors.fgFaint} />
							</Row>
							<Muted>
								Jev が役割ごとの出力トークン予算を決め、性能条件を満たす中で最も安いモデルを選びます。
								上限は「役割ごとの 1 回のモデル呼び出し」に効きます。Jev の判定そのものにも料金がかかります。
							</Muted>

							<NumberField
								label='最低性能スコア (0〜100)'
								hint={issueFor('minPerformance') ?? 'サーバーに登録された評価スコア。低くするほど安いモデルが選ばれます。'}
								value={draft.minPerformance}
								invalid={!!issueFor('minPerformance')}
								onChange={text => { setDraft(d => ({ ...d, minPerformance: text })); setQuotes([]); }}
							/>
							<NumberField
								label='1 回のモデル呼び出しの上限 (USD)'
								hint={issueFor('maxCostUsd') ?? '料金 = 入力トークン × 入力単価 + 出力トークン × 出力単価 + 固定料金。'}
								value={draft.maxCostUsd}
								invalid={!!issueFor('maxCostUsd')}
								onChange={text => { setDraft(d => ({ ...d, maxCostUsd: text })); setQuotes([]); }}
							/>
							<NumberField
								label='割り当て可能な最大出力トークン'
								hint={issueFor('maxOutputTokens') ?? '256〜32768。長い出力を許すほど料金が上がります。'}
								value={draft.maxOutputTokens}
								invalid={!!issueFor('maxOutputTokens')}
								onChange={text => { setDraft(d => ({ ...d, maxOutputTokens: text })); setQuotes([]); }}
							/>

							<Row>
								<Button
									title='保存して有効にする'
									disabled={issues.length > 0}
									onPress={() => void savePolicy(true)}
									style={styles.flex}
								/>
								<Button
									title='無効にする'
									variant='secondary'
									disabled={!enabled}
									onPress={() => void savePolicy(false)}
								/>
							</Row>
						</Card>

						<Card>
							<SectionTitle>いま保存されている方針</SectionTitle>
							<Row style={styles.spread}><Muted>最低性能スコア</Muted><Body>{policy.minPerformance}</Body></Row>
							<Row style={styles.spread}><Muted>1 回あたりの上限</Muted><Body>{formatUsd(policy.maxCostUsd)}</Body></Row>
							<Row style={styles.spread}><Muted>最大出力トークン</Muted><Body>{formatTokens(policy.maxOutputTokens)}</Body></Row>
							<Muted>
								この方針はこの端末に保存され、見積もりの条件として使われます。
								IDE 側の設定 (設定 → Division) は別管理です。
							</Muted>
						</Card>
					</>
				) : null}

				{/* --------------------------------------------------------- 見積もり */}
				{section === 'estimate' ? (
					<>
						<Card>
							<SectionTitle>依頼を見積もる</SectionTitle>
							<Muted>
								Jev に出力トークン予算を判定させ、リーダー / コーダー / レビューの 3 役割について
								想定コストを出します。判定のたびに料金が発生します。
							</Muted>
							<Input
								value={promptText}
								onChangeText={text => {
									setPromptText(text);
									setQuotes([]);
									// 依頼文を書き換えたら入力トークンの目安も追従させる。
									if (text.trim()) setInputTokens(String(estimateInputTokens(text)));
								}}
								placeholder='見積もりたい依頼の内容'
								multiline
								accessibilityLabel='見積もる依頼'
							/>
							<NumberField
								label='各役割の想定入力トークン数'
								hint={isInputTokensValid(Number(inputTokens))
									? '依頼文から自動で概算しています。実際の文脈量に合わせて直せます。'
									: '0〜2,000,000 の整数で入力してください。'}
								value={inputTokens}
								invalid={!isInputTokensValid(Number(inputTokens))}
								onChange={text => { setInputTokens(text); setQuotes([]); }}
							/>
							<Button
								title='Jev で見積もる (判定料金が発生)'
								loading={quoting}
								disabled={!hasOAuthSession || (profile !== null && !profile.isPaid) || !promptText.trim() || issues.length > 0 || !isInputTokensValid(Number(inputTokens))}
								onPress={() => void runQuote()}
							/>
							{profile && !profile.isPaid ? (
								<Muted>見積もりの実行には有料プラン（Plus）が必要です。管理タブからプランを確認できます。</Muted>
							) : null}
						</Card>

						{quotes.length > 0 ? (
							<Card>
								<Row style={styles.spread}>
									<SectionTitle>試算</SectionTitle>
									<Text style={styles.amount}>合計 {formatUsd(quoteTotal)}</Text>
								</Row>
								<Muted>実行時は実際の各役割で再判定されるため、結果は前後します。</Muted>
								{quotes.map(quote => (
									<View key={quote.role} style={styles.quoteRow}>
										<Row style={styles.spread}>
											<View style={styles.flex}>
												<Body>{roleTitle(quote.role)}</Body>
												<Muted>{quote.model}</Muted>
											</View>
											<Text style={styles.amount}>{formatUsd(quote.totalCostUsd)}</Text>
										</Row>
										<Row>
											<Badge label={`性能 ${quote.performance}`} color={quote.performance >= parsedDraft.minPerformance ? colors.success : colors.warning} />
											<Badge label={`入力 ${formatTokens(quote.inputTokens)}`} />
											<Badge label={`出力 ${formatTokens(quote.outputTokens)}`} />
										</Row>
										{violations[quote.role] ? <Text style={styles.warn}>{violations[quote.role]}</Text> : null}
										{quote.performanceSource ? <Muted>性能の出典: {quote.performanceSource}</Muted> : null}
									</View>
								))}
							</Card>
						) : null}
					</>
				) : null}

				{/* --------------------------------------------------------- 利用履歴 */}
				{section === 'history' ? (
					<>
						<Card>
							<Row style={styles.spread}>
								<SectionTitle>実際の料金</SectionTitle>
								<Button title='更新' variant='ghost' onPress={() => void loadHistory()} />
							</Row>
							{historyLoading && history.length === 0 ? <Loading label='履歴を読み込んでいます…' /> : null}
							{!historyLoading && history.length === 0 ? <Muted>まだ記録がありません。</Muted> : null}
							{history.length > 0 ? (
								<>
									<Row style={styles.spread}>
										<Muted>{totals.count} 回のモデル実行</Muted>
										<Text style={styles.amountLarge}>{formatUsd(totals.totalCostUsd)}</Text>
									</Row>
									<Row style={styles.spread}>
										<Muted>入力 / 出力トークン</Muted>
										<Body>{formatTokens(totals.inputTokens)} / {formatTokens(totals.outputTokens)}</Body>
									</Row>
									<Row style={styles.spread}>
										<Muted>1 回あたりの平均</Muted>
										<Body>{formatUsd(averageCost(totals))}</Body>
									</Row>
									{drift !== null ? (
										<Row style={styles.spread}>
											<Muted>見積もりとの差 ({totals.estimatedCount} 件)</Muted>
											<Text style={[styles.amount, { color: drift > 0 ? colors.warning : colors.success }]}>
												{drift > 0 ? '+' : ''}{formatUsd(drift)}
											</Text>
										</Row>
									) : null}
									{runsLeft !== null ? (
										<Muted>いまの残高なら、この平均であと約 {runsLeft.toLocaleString('en-US')} 回分です。</Muted>
									) : null}
								</>
							) : null}
						</Card>

						{history.length > 0 ? (
							<>
								<View style={styles.inlineToolbar}>
									<ChipGroup<'day' | 'role' | 'model'>
										options={[
											{ value: 'day', label: '日別' },
											{ value: 'role', label: '役割別' },
											{ value: 'model', label: 'モデル別' },
										]}
										value={breakdown}
										onChange={setBreakdown}
									/>
								</View>
								<GroupTable
									title={breakdown === 'day' ? '日ごとの料金' : breakdown === 'role' ? '役割ごとの料金' : 'モデルごとの料金'}
									groups={groups}
								/>

								<Card>
									<SectionTitle>明細</SectionTitle>
									{history.map(item => (
										<View key={item.id} style={styles.historyRow}>
											<Row style={styles.spread}>
												<View style={styles.flex}>
													<Body numberOfLines={1}>{item.modelId}</Body>
													<Muted>{roleTitle(item.role)} · {relativeTimeFromIso(item.createdAt)}</Muted>
												</View>
												<View style={styles.amountColumn}>
													<Text style={styles.amount}>{formatUsd(item.totalCostUsd)}</Text>
													{item.estimateUsd !== undefined ? <Muted>見積 {formatUsd(item.estimateUsd)}</Muted> : null}
												</View>
											</Row>
											<Muted>入力 {formatTokens(item.inputTokens)} / 出力 {formatTokens(item.outputTokens)}</Muted>
										</View>
									))}
									{cursor ? (
										<Button title='さらに読み込む' variant='secondary' loading={historyLoading} onPress={() => void loadHistory(true)} />
									) : null}
								</Card>

								{Object.keys(groupTotals).length > 0 ? (
									<Card>
										<SectionTitle>リクエストごとの合計</SectionTitle>
										<Muted>同じ依頼で動いた全モデルの料金をまとめたものです。</Muted>
										{Object.entries(groupTotals).map(([id, sum]) => (
											<Row key={id} style={styles.spread}>
												<Muted>リクエスト {id.slice(0, 8)}</Muted>
												<Text style={styles.amount}>{formatUsd(sum)}</Text>
											</Row>
										))}
									</Card>
								) : null}
							</>
						) : null}
					</>
				) : null}

				{/* ------------------------------------------------------------- 管理 */}
				{section === 'account' ? (
					profile === null ? (
						error
							? <Card>
								<SectionTitle>アカウント情報を取得できませんでした</SectionTitle>
								<Button title='再試行' variant='secondary' onPress={() => void loadAccount()} />
							</Card>
							: <Loading label='アカウント情報を読み込んでいます…' />
					) : (
						<>
							<Card>
								<Row style={styles.spread}>
									<SectionTitle>クレジット残高</SectionTitle>
									<Badge
										label={profile.isPaid ? '有料プラン' : '無料プラン'}
										color={profile.isPaid ? colors.accentText : colors.fgMuted}
									/>
								</Row>
								<Text style={styles.balance}>{formatUsdShort(profile.creditBalance)}</Text>
								<Row style={styles.spread}>
									<Muted>購入分</Muted><Body>{formatUsdShort(profile.purchasedCreditBalance)}</Body>
								</Row>
								<Row style={styles.spread}>
									<Muted>プラン付与分</Muted><Body>{formatUsdShort(profile.subscriptionCreditBalance)}</Body>
								</Row>
								{profile.subscriptionCreditsExpireAt ? (
									<Muted>プラン付与分の有効期限: {relativeTimeFromIso(profile.subscriptionCreditsExpireAt)}</Muted>
								) : null}
								<Divider />
								<Row style={styles.spread}>
									<Muted>これまでの利用額</Muted><Body>{formatUsdShort(profile.creditUsed)}</Body>
								</Row>
								{profile.subscriptionStatus ? (
									<Row style={styles.spread}>
										<Muted>サブスクリプション</Muted><Body>{profile.subscriptionStatus}</Body>
									</Row>
								) : null}
								{profile.currentPeriodEnd ? (
									<Row style={styles.spread}>
										<Muted>次回更新</Muted><Body>{relativeTimeFromIso(profile.currentPeriodEnd)}</Body>
									</Row>
								) : null}
							</Card>

							<Card>
								<SectionTitle>自動チャージ</SectionTitle>
								<Muted>残高がしきい値を下回ったときに、登録済みの支払い方法で自動的にチャージします。</Muted>
								<Row style={styles.spread}>
									<Muted>自動チャージを使う</Muted>
									<Switch
										value={autoChargeDraft.enabled}
										onValueChange={value => setAutoChargeDraft(d => ({ ...d, enabled: value }))}
										trackColor={{ true: colors.accent, false: colors.border }}
									/>
								</Row>
								<NumberField
									label='しきい値 (USD)'
									value={autoChargeDraft.threshold}
									invalid={!(Number(autoChargeDraft.threshold) >= 0)}
									onChange={text => setAutoChargeDraft(d => ({ ...d, threshold: text }))}
								/>
								<NumberField
									label='1 回のチャージ額 (USD)'
									value={autoChargeDraft.amount}
									invalid={!(Number(autoChargeDraft.amount) > 0)}
									onChange={text => setAutoChargeDraft(d => ({ ...d, amount: text }))}
								/>
								<Button
									title='自動チャージの設定を保存'
									loading={savingAutoCharge}
									disabled={!(Number(autoChargeDraft.threshold) >= 0) || !(Number(autoChargeDraft.amount) > 0)}
									onPress={() => void saveAutoCharge()}
								/>
								{!profile.hasStripeCustomer ? (
									<Muted>支払い方法がまだ登録されていません。先にプランの登録かチャージを行ってください。</Muted>
								) : null}
							</Card>

							<Card>
								<SectionTitle>プランと支払い</SectionTitle>
								{DIVISION_PLANS.map(plan => (
									<View key={plan.id} style={styles.planRow}>
										<Row style={styles.spread}>
											<View style={styles.flex}>
												<Body>{plan.name} · {plan.priceLabel}</Body>
												<Muted>{plan.features.join(' / ')}</Muted>
											</View>
											{plan.id === profile.plan
												? <Badge label='利用中' color={colors.success} />
												: plan.id === 'free'
													? null
													: <Button
														title='申し込む'
														variant='secondary'
														onPress={() => void openBillingUrl(() => createCheckoutUrl(session, plan.id as 'plus'))}
													/>}
										</Row>
									</View>
								))}
								{profile.hasStripeCustomer ? (
									<Button
										title='支払い方法・請求履歴を開く'
										variant='secondary'
										onPress={() => void openBillingUrl(() => createPortalUrl(session))}
									/>
								) : null}
								<Muted>支払いはブラウザの Stripe の画面で行います。</Muted>
							</Card>

							{transactions.length > 0 ? (
								<Card>
									<SectionTitle>クレジットの増減</SectionTitle>
									{transactions.map(tx => (
										<Row key={tx.id} style={styles.spread}>
											<View style={styles.flex}>
												<Body>{tx.type}</Body>
												<Muted>{relativeTimeFromIso(tx.createdAt)}</Muted>
											</View>
											<View style={styles.amountColumn}>
												<Text style={[styles.amount, { color: tx.amount >= 0 ? colors.success : colors.fg }]}>
													{tx.amount >= 0 ? '+' : ''}{formatUsdShort(tx.amount)}
												</Text>
												<Muted>残高 {formatUsdShort(tx.balanceAfter)}</Muted>
											</View>
										</Row>
									))}
								</Card>
							) : null}
						</>
					)
				) : null}

				{notice ? <Text style={styles.notice}>{notice}</Text> : null}
			</ScrollView>
		</Screen>
	);
};

const styles = StyleSheet.create({
	flex: { flex: 1 },
	spread: { justifyContent: 'space-between' },
	toolbar: {
		padding: spacing.md,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	inlineToolbar: { paddingHorizontal: spacing.xs },
	content: {
		padding: spacing.md,
		gap: spacing.md,
		paddingBottom: spacing.xl,
	},
	field: { gap: spacing.xs },
	inputInvalid: { borderColor: colors.danger },
	amount: {
		color: colors.fg,
		fontSize: fontSize.sm,
		fontWeight: '600',
		fontVariant: ['tabular-nums'],
	},
	amountLarge: {
		color: colors.fg,
		fontSize: fontSize.md,
		fontWeight: '700',
		fontVariant: ['tabular-nums'],
	},
	amountColumn: { alignItems: 'flex-end' },
	balance: {
		color: colors.fg,
		fontSize: fontSize.xl,
		fontWeight: '700',
		fontVariant: ['tabular-nums'],
	},
	quoteRow: {
		gap: spacing.xs,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.sm,
		padding: spacing.md,
	},
	historyRow: {
		gap: 2,
		borderTopWidth: 1,
		borderTopColor: colors.border,
		paddingTop: spacing.sm,
	},
	planRow: {
		borderTopWidth: 1,
		borderTopColor: colors.border,
		paddingTop: spacing.sm,
	},
	warn: {
		color: colors.warning,
		fontSize: fontSize.xs,
	},
	notice: {
		color: colors.fgMuted,
		fontSize: fontSize.xs,
		textAlign: 'center',
	},
});
