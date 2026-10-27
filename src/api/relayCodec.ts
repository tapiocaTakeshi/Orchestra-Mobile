/**
 * 外出先から PC に繋ぐ中継 (Supabase Realtime) のメッセージの暗号化と分割。
 *
 * PC とスマホはペアリングのトークンから同じ鍵とチャンネル名を作る。Supabase には暗号化した
 * バイト列しか流れないので、中継するサーバーからも中身 (チャット・ファイル) は読めない。
 *
 * IDE 側 (src/vs/code/electron-main/orchestraMobileRelay.ts) と同じ形にすること:
 *   key    = HKDF-SHA256(token, salt 'orchestra-remote-relay', info 'key', 32 bytes)
 *   topic  = 'orchestra-remote-' + hex(HKDF-SHA256(token, salt, info 'topic', 16 bytes))
 *   sealed = base64(iv[12] || AES-256-GCM(deflateRaw(JSON), aad = kind) || tag[16])
 * sealed を分割して、broadcast のイベント 'req' / 'res' の payload { id, i, n, d } で送る。
 */

import { gcm } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/ciphers/webcrypto';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

export type RelayKind = 'req' | 'res';

export type RelayKeys = { key: Uint8Array; topic: string };

/** スマホから PC へ送るリクエスト (LAN の HTTP リクエストと同じ中身)。 */
export type RelayRequest = {
	id: string;
	method: string;
	path: string;
	query: Record<string, string>;
	body?: unknown;
	/** ペアリングのトークン (X-Orchestra-Token と同じ) */
	token: string;
	/** Division の JWT (X-Division-Access-Token と同じ) */
	accessToken: string;
	/** 送った時刻 (ms)。PC は古いものを捨てる (盗み見たメッセージの使い回し対策) */
	sentAt: number;
};

export type RelayResponse = { id: string; status: number; body: unknown };

export type RelayChunk = { id: string; i: number; n: number; d: string };

const SALT = strToU8('orchestra-remote-relay');
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Supabase の broadcast は無料プランで 1 メッセージ 256 KB まで。十分小さく切る */
export const RELAY_CHUNK_CHARS = 60_000;
/** 揃わないまま残った分割メッセージを捨てるまでの時間 */
const PARTIAL_TTL_MS = 60_000;

const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export const deriveRelayKeys = (token: string): RelayKeys => {
	const secret = strToU8(token);
	return {
		key: hkdf(sha256, secret, SALT, strToU8('key'), 32),
		topic: `orchestra-remote-${toHex(hkdf(sha256, secret, SALT, strToU8('topic'), 16))}`,
	};
};

// Hermes の atob/btoa に頼らず、ここで base64 を変換する。
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map(Array.from(B64, (c, i) => [c, i]));

export const toBase64 = (bytes: Uint8Array): string => {
	let out = '';
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
		out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
		out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
		out += c === undefined ? '=' : B64[c & 63];
	}
	return out;
};

export const fromBase64 = (text: string): Uint8Array => {
	const clean = text.replace(/=+$/, '');
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let bits = 0, value = 0, o = 0;
	for (const ch of clean) {
		const v = B64_INDEX.get(ch);
		if (v === undefined) throw new Error('invalid base64');
		value = (value << 6) | v;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[o++] = (value >> bits) & 255;
		}
	}
	return out;
};

export const sealRelayMessage = (key: Uint8Array, kind: RelayKind, message: unknown): string => {
	const iv = randomBytes(IV_BYTES);
	const encrypted = gcm(key, iv, strToU8(kind)).encrypt(deflateSync(strToU8(JSON.stringify(message))));
	const out = new Uint8Array(iv.length + encrypted.length);
	out.set(iv);
	out.set(encrypted, iv.length);
	return toBase64(out);
};

/** 別のトークンで暗号化されたものや、書き換えられたものは例外になる。 */
export const openRelayMessage = <T>(key: Uint8Array, kind: RelayKind, sealed: string): T => {
	const raw = fromBase64(sealed);
	if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('relay message is too short');
	const plain = gcm(key, raw.subarray(0, IV_BYTES), strToU8(kind)).decrypt(raw.subarray(IV_BYTES));
	return JSON.parse(strFromU8(inflateSync(plain))) as T;
};

export const splitRelayMessage = (id: string, sealed: string): RelayChunk[] => {
	const n = Math.max(1, Math.ceil(sealed.length / RELAY_CHUNK_CHARS));
	return Array.from({ length: n }, (_, i) => ({ id, i, n, d: sealed.slice(i * RELAY_CHUNK_CHARS, (i + 1) * RELAY_CHUNK_CHARS) }));
};

/** 分割されたメッセージを組み立てる。全部そろったら sealed 全体を返す。 */
export class RelayAssembler {
	private readonly _partial = new Map<string, { parts: (string | undefined)[]; received: number; expiresAt: number }>();

	add(raw: unknown, now: number = Date.now()): { id: string; sealed: string } | undefined {
		for (const [id, entry] of this._partial) if (entry.expiresAt < now) this._partial.delete(id);
		const chunk = raw as Partial<RelayChunk> | undefined;
		if (typeof chunk?.id !== 'string' || typeof chunk.d !== 'string' || !Number.isInteger(chunk.i) || !Number.isInteger(chunk.n)) return undefined;
		const { id, i, n, d } = chunk as RelayChunk;
		if (n < 1 || n > 256 || i < 0 || i >= n) return undefined;
		if (n === 1) return { id, sealed: d };
		let entry = this._partial.get(id);
		if (!entry || entry.parts.length !== n) {
			entry = { parts: new Array(n), received: 0, expiresAt: now + PARTIAL_TTL_MS };
			this._partial.set(id, entry);
		}
		if (entry.parts[i] === undefined) entry.received++;
		entry.parts[i] = d;
		if (entry.received < n) return undefined;
		this._partial.delete(id);
		return { id, sealed: entry.parts.join('') };
	}
}
