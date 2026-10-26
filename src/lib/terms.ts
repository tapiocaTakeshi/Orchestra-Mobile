/**
 * 利用規約への同意の扱い。
 *
 * 同意はログイン前に求める (まだユーザーがいないので、まず端末に同意した版を保存する)。
 * ログインできたら、その版をサーバー (profiles.terms_version) にも記録する。
 * 規約の文面を変えて TERMS_VERSION を上げると、保存済みの版と合わなくなるので、
 * ログイン済みの利用者にももう一度同意を求める。
 */

import { DivisionSession, getDivisionSupabase } from './divisionAuth';
import { TERMS_VERSION } from './legal';

/** 同意を求める必要があるか (未同意、または古い版に同意しただけ)。 */
export const needsTermsAgreement = (
	acceptedVersion: string | null | undefined,
	currentVersion: string = TERMS_VERSION,
): boolean => !acceptedVersion || acceptedVersion.trim() !== currentVersion;

/**
 * サーバーに同意を記録する。失敗してもログインは止めない (端末側の記録が先にあり、
 * 次のログインでまた送る)。成功したかどうかだけ返す。
 */
export const recordTermsAcceptance = async (
	session: DivisionSession,
	version: string = TERMS_VERSION,
): Promise<boolean> => {
	try {
		const sb = getDivisionSupabase();
		await sb.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken });
		const { error } = await sb.rpc('accept_terms', { p_version: version });
		return !error;
	} catch {
		return false;
	}
};
