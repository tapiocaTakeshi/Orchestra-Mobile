/**
 * 動的なアプリ設定。静的な値は今まで通り app.json に置き、ここでは
 * EAS まわり (プロジェクト ID / アカウント) だけを環境変数から差し込む。
 *
 * `extra.eas.projectId` は EAS が発行する UUID で、手で決められる値ではない。
 *   npx eas init          # 新規に発行して EAS_PROJECT_ID を控える
 *   npx eas init --id <id># 既存のプロジェクトに紐づける
 * 発行済みの ID は EAS_PROJECT_ID (アカウントは EXPO_OWNER) で渡す。
 * app.json に直接書いてもよく、その場合は env が無ければそちらが使われる。
 */

import type { ConfigContext, ExpoConfig } from 'expo/config';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const readEnv = (name: string): string => (process.env[name] ?? '').trim();

/** env → app.json の順に見る。空なら undefined (未設定のまま EAS に警告させる)。 */
const resolveProjectId = (fromStaticConfig: unknown): string | undefined => {
	const projectId = readEnv('EAS_PROJECT_ID') || (typeof fromStaticConfig === 'string' ? fromStaticConfig : '');
	if (!projectId) return undefined;
	if (!UUID_PATTERN.test(projectId)) {
		// 不正な ID のままビルドに進むと EAS の奥で分かりにくく落ちるので、ここで止める。
		throw new Error(
			`EAS project ID must be a UUID issued by EAS, got "${projectId}". Run \`npx eas init\` and use the printed ID.`,
		);
	}
	return projectId;
};

export default ({ config }: ConfigContext): ExpoConfig => {
	const eas = (config.extra?.eas ?? {}) as Record<string, unknown>;
	const projectId = resolveProjectId(eas.projectId);
	const owner = readEnv('EXPO_OWNER') || config.owner;

	return {
		...config,
		// ConfigContext の config は Partial なので、必須項目だけ app.json の値で埋め直す。
		name: config.name ?? 'Orchestra Mobile',
		slug: config.slug ?? 'orchestra-mobile',
		...(owner ? { owner } : {}),
		extra: {
			...config.extra,
			...(projectId ? { eas: { ...eas, projectId } } : {}),
		},
	};
};
