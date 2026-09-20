/** 表示用の小さな整形関数。全部 UI 非依存なのでテストできる。 */

/** 「3 分前」形式。未来の時刻は「まもなく」に丸める。 */
export const relativeTime = (timestamp: number | null | undefined, now: number = Date.now()): string => {
	if (!timestamp) return '—';
	const diffSec = Math.round((now - timestamp) / 1000);
	if (diffSec < 0) return 'まもなく';
	if (diffSec < 45) return 'たった今';
	const diffMin = Math.round(diffSec / 60);
	if (diffMin < 60) return `${diffMin} 分前`;
	const diffHour = Math.round(diffMin / 60);
	if (diffHour < 24) return `${diffHour} 時間前`;
	const diffDay = Math.round(diffHour / 24);
	if (diffDay < 30) return `${diffDay} 日前`;
	const diffMonth = Math.round(diffDay / 30);
	if (diffMonth < 12) return `${diffMonth} ヶ月前`;
	return `${Math.round(diffMonth / 12)} 年前`;
};

/** ISO 文字列版。スレッド一覧の lastModified 用。 */
export const relativeTimeFromIso = (iso: string, now: number = Date.now()): string => {
	const parsed = Date.parse(iso);
	return Number.isNaN(parsed) ? '—' : relativeTime(parsed, now);
};

export const durationText = (ms: number): string => {
	if (!Number.isFinite(ms) || ms < 0) return '—';
	const sec = Math.round(ms / 1000);
	if (sec < 60) return `${sec} 秒`;
	const min = Math.floor(sec / 60);
	const rest = sec % 60;
	if (min < 60) return rest ? `${min} 分 ${rest} 秒` : `${min} 分`;
	const hour = Math.floor(min / 60);
	return `${hour} 時間 ${min % 60} 分`;
};

/** 長い本文を 1 行のプレビューに落とす。 */
export const oneLine = (text: string, max = 80): string => {
	const collapsed = text.replace(/\s+/g, ' ').trim();
	return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
};

/** 'anthropic' → 'Anthropic' のような表示名。IDE 側の providerName に合わせる。 */
const PROVIDER_TITLES: Record<string, string> = {
	anthropic: 'Anthropic',
	openAI: 'OpenAI',
	gemini: 'Google Gemini',
	perplexity: 'Perplexity',
	xAI: 'xAI',
	deepseek: 'DeepSeek',
	divisionAPI: 'Division API',
	openRouter: 'OpenRouter',
	ollama: 'Ollama',
	lmStudio: 'LM Studio',
	liteLLM: 'LiteLLM',
	vLLM: 'vLLM',
	groq: 'Groq',
	mistral: 'Mistral',
	openAICompatible: 'OpenAI Compatible',
	googleVertex: 'Google Vertex',
	microsoftAzure: 'Azure',
	awsBedrock: 'AWS Bedrock',
};

export const providerTitle = (provider: string): string =>
	PROVIDER_TITLES[provider] ?? provider;

/**
 * Division のロール表示名。IDE 側の AgentRole と、Division API 側で使われている
 * 綴り (reviewer / file-searcher など) の両方を引けるようにしてある。
 */
const ROLE_TITLES: Record<string, string> = {
	leader: 'リーダー',
	coder: 'コーダー',
	planner: 'プランナー',
	search: '検索',
	searcher: '検索',
	research: 'リサーチ',
	researcher: 'リサーチ',
	design: 'デザイン',
	designer: 'デザイン',
	writing: 'ライティング',
	writer: 'ライティング',
	ideaman: 'アイデア',
	filesearch: 'ファイル検索',
	'file-searcher': 'ファイル検索',
	image: '画像',
	imager: '画像',
	review: 'レビュー',
	reviewer: 'レビュー',
	generate: '生成',
};

export const roleTitle = (role: string): string => ROLE_TITLES[role] ?? role;

/** 役割を追加するときの候補。表示名が分かっているものだけ出す。 */
export const KNOWN_ROLES: string[] = [
	'leader', 'planner', 'coder', 'review', 'search', 'research', 'design', 'writing', 'ideaman', 'filesearch', 'image',
];
