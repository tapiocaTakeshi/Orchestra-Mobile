/**
 * 動的なアプリ設定。静的な値は今まで通り app.json に置き、ここでは
 * ビルド環境ごとに変わる値だけを環境変数から差し込む。
 *
 * EAS:
 *   `extra.eas.projectId` は EAS が発行する UUID で、手で決められる値ではない。
 *     npx eas init          # 新規に発行して EAS_PROJECT_ID を控える
 *     npx eas init --id <id># 既存のプロジェクトに紐づける
 *   発行済みの ID は EAS_PROJECT_ID (アカウントは EXPO_OWNER) で渡す。
 *   app.json に直接書いてもよく、その場合は env が無ければそちらが使われる。
 *
 * Xcode Cloud (ios/ci_scripts/ci_post_clone.sh が prebuild 前に設定する):
 *   APPLE_TEAM_ID     … 署名に使う Apple Developer のチーム ID (10 文字)
 *   IOS_BUILD_NUMBER  … CFBundleVersion。Xcode Cloud の CI_BUILD_NUMBER を渡す
 *   どちらも未設定なら何もしない (EAS はビルド番号をリモートで管理している)。
 */

import type { ConfigContext, ExpoConfig } from 'expo/config';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPLE_TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;
const BUILD_NUMBER_PATTERN = /^[1-9][0-9]*$/;

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

/** Xcode Cloud 向けの iOS 設定。値が変だと署名やアップロードの段階で分かりにくく落ちるので、ここで止める。 */
const resolveIosOverrides = (): { appleTeamId?: string; buildNumber?: string } => {
	const appleTeamId = readEnv('APPLE_TEAM_ID');
	const buildNumber = readEnv('IOS_BUILD_NUMBER');
	if (appleTeamId && !APPLE_TEAM_ID_PATTERN.test(appleTeamId)) {
		throw new Error(
			`APPLE_TEAM_ID must be the 10-character team ID from developer.apple.com/account (Membership details), got "${appleTeamId}".`,
		);
	}
	if (buildNumber && !BUILD_NUMBER_PATTERN.test(buildNumber)) {
		throw new Error(`IOS_BUILD_NUMBER must be a positive integer, got "${buildNumber}".`);
	}
	return {
		...(appleTeamId ? { appleTeamId } : {}),
		...(buildNumber ? { buildNumber } : {}),
	};
};

export default ({ config }: ConfigContext): ExpoConfig => {
	const eas = (config.extra?.eas ?? {}) as Record<string, unknown>;
	const projectId = resolveProjectId(eas.projectId);
	const owner = readEnv('EXPO_OWNER') || config.owner;
	const iosOverrides = resolveIosOverrides();

	return {
		...config,
		// ConfigContext の config は Partial なので、必須項目だけ app.json の値で埋め直す。
		name: config.name ?? 'Orchestra Mobile',
		slug: config.slug ?? 'orchestra-mobile',
		...(owner ? { owner } : {}),
		ios: {
			...config.ios,
			...iosOverrides,
		},
		extra: {
			...config.extra,
			...(projectId ? { eas: { ...eas, projectId } } : {}),
		},
	};
};
