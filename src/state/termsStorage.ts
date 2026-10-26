/**
 * 利用規約に同意した版の保存。
 *
 * ログイン前に同意するので、アカウントではなく端末に持つ。ログインセッションと同じく
 * expo-secure-store に置く (アンインストールで消え、入れ直したらまた同意を求める)。
 */

import * as SecureStore from 'expo-secure-store';

const TERMS_KEY = 'orchestra.termsAcceptedVersion.v1';

export const loadAcceptedTermsVersion = async (): Promise<string | null> => {
	try {
		return (await SecureStore.getItemAsync(TERMS_KEY)) || null;
	} catch {
		return null;
	}
};

export const saveAcceptedTermsVersion = async (version: string): Promise<void> => {
	try {
		await SecureStore.setItemAsync(TERMS_KEY, version);
	} catch {
		// 保存できなくてもこの起動中は同意済みとして動く。次回起動時にもう一度同意を求めるだけ。
	}
};
