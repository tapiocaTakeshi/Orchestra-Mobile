#!/usr/bin/env node
/**
 * eas build の前に extra.eas.projectId が揃っているか確かめる。
 *
 * ID が無いまま eas-cli を走らせると
 *   The "extra.eas.projectId" field is missing from your app config.
 * とだけ出て、そのまま対話的に別プロジェクトを作ってしまうことがある。
 * ここで止めて、発行の手順をそのまま出す。
 *
 * 解決順は app.config.ts と同じ: EAS_PROJECT_ID → app.json の extra.eas.projectId
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');

// app.config.ts と同じ判定 (EAS が発行する UUID かどうか)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HOW_TO_ISSUE = [
	'  npx eas-cli login',
	'  npx eas-cli init            # 既存プロジェクトなら: npx eas-cli init --id <uuid>',
	'',
	'発行された UUID を環境変数で渡すか (app.config.ts が差し込みます)、',
	'app.json の expo.extra.eas.projectId に書いてください。',
	'',
	'  export EXPO_OWNER=<EAS のアカウント名>   # 個人アカウントなら省略可',
	'  export EAS_PROJECT_ID=<発行された UUID>',
];

const readStaticProjectId = () => {
	try {
		const appJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
		const projectId = appJson?.expo?.extra?.eas?.projectId;
		return typeof projectId === 'string' ? projectId.trim() : '';
	} catch (error) {
		// app.json が読めないなら projectId 以前の問題なので、そのまま未設定扱いにして下のメッセージに任せる。
		return '';
	}
};

const fail = (lines) => {
	console.error(['', ...lines, ''].join('\n'));
	process.exit(1);
};

const projectId = (process.env.EAS_PROJECT_ID ?? '').trim() || readStaticProjectId();

if (!projectId) {
	fail([
		'EAS のプロジェクト ID が設定されていません。',
		'この ID は EAS がサーバー側で発行する UUID なので、リポジトリには決め打ちできません。',
		'一度だけ次を実行してください。',
		'',
		...HOW_TO_ISSUE,
	]);
}

if (!UUID_PATTERN.test(projectId)) {
	fail([
		`EAS のプロジェクト ID が UUID ではありません: "${projectId}"`,
		'EAS が発行した ID をそのまま使ってください。',
		'',
		...HOW_TO_ISSUE,
	]);
}

console.log(`EAS project ID: ${projectId}`);
