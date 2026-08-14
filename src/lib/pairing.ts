/**
 * IDE が出すペアリング情報を読み取る。
 *
 * 受け付ける形は 3 つ:
 *   1. orchestra://pair?v=1&url=...&token=...&workspace=...   (設定パネルの「ペアリングリンクをコピー」)
 *   2. {"v":1,"url":"...","token":"...","workspace":"..."}    (QR に載せた JSON をそのまま貼った場合)
 *   3. http://192.168.0.5:39231?token=xxxx                    (手で組み立てた URL)
 *
 * どれも失敗したら null を返す。URL エンコードされた token の中に & が入っていても壊れないよう、
 * クエリのパースは自前で行う (React Native の URL 実装は環境差があるため)。
 */

import { normalizeBaseUrl } from '../api/client';
import { Connection } from '../api/types';

const decode = (v: string): string => {
	try { return decodeURIComponent(v.replace(/\+/g, ' ')); } catch { return v; }
};

/** 'a=1&b=2' → { a: '1', b: '2' } */
export const parseQuery = (query: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const part of query.split('&')) {
		if (!part) continue;
		const eq = part.indexOf('=');
		if (eq === -1) out[decode(part)] = '';
		else out[decode(part.slice(0, eq))] = decode(part.slice(eq + 1));
	}
	return out;
};

const fromFields = (fields: { url?: string; token?: string; workspace?: string }): Connection | null => {
	const url = normalizeBaseUrl(fields.url ?? '');
	const token = (fields.token ?? '').trim();
	if (!url || !token) return null;
	return { url, token, label: (fields.workspace ?? '').trim() || url.replace(/^https?:\/\//, '') };
};

export const parsePairingInput = (raw: string): Connection | null => {
	const input = raw.trim();
	if (!input) return null;

	// 2. JSON
	if (input.startsWith('{')) {
		try {
			const obj = JSON.parse(input) as { url?: string; token?: string; workspace?: string };
			return fromFields(obj);
		} catch {
			return null;
		}
	}

	const queryStart = input.indexOf('?');

	// 1. orchestra://pair?...
	if (/^orchestra:\/\//i.test(input)) {
		if (queryStart === -1) return null;
		const fields = parseQuery(input.slice(queryStart + 1));
		return fromFields(fields);
	}

	// 3. http://host:port?token=...
	if (queryStart !== -1) {
		const fields = parseQuery(input.slice(queryStart + 1));
		if (fields.token) {
			return fromFields({ url: input.slice(0, queryStart), token: fields.token, workspace: fields.workspace });
		}
	}

	return null;
};

/** 手入力フォームの値から接続情報を作る。ポートだけ省略されたら既定値を足す。 */
export const buildConnection = (host: string, token: string, label = ''): Connection | null => {
	const trimmedHost = host.trim();
	const trimmedToken = token.trim();
	if (!trimmedHost || !trimmedToken) return null;

	const withPort = /:\d+$/.test(trimmedHost.replace(/^https?:\/\//, ''))
		? trimmedHost
		: `${trimmedHost.replace(/\/+$/, '')}:39231`;

	return {
		url: normalizeBaseUrl(withPort),
		token: trimmedToken,
		label: label.trim() || normalizeBaseUrl(withPort).replace(/^https?:\/\//, ''),
	};
};
