/**
 * 外出先 (モバイルデータや別の Wi-Fi) から PC に繋ぐための中継トランスポート。
 *
 * PC と同じ LAN にいないときは、HTTP の代わりに Supabase Realtime の broadcast で
 * リクエストを送り、PC からの返事を待つ。中身は relayCodec でエンドツーエンド暗号化する。
 * チャンネルはペアリングのトークンごとに 1 つで、同じ PC への接続はそれを使い回す。
 */

import { getDivisionSupabase } from '../lib/divisionAuth';
import {
	RelayAssembler,
	RelayKeys,
	RelayRequest,
	RelayResponse,
	deriveRelayKeys,
	openRelayMessage,
	sealRelayMessage,
	splitRelayMessage,
} from './relayCodec';

/** 中継に使うチャンネル。テストでは偽物に差し替える。 */
export type RelayChannel = {
	/** 参加できたら resolve する */
	ready: Promise<void>;
	send: (event: 'req', payload: unknown) => Promise<void>;
	close: () => void;
};

export type RelayChannelFactory = (topic: string, onResponseChunk: (payload: unknown) => void) => RelayChannel;

/** チャンネルに参加するまで待つ時間 */
const JOIN_TIMEOUT_MS = 10_000;

export class RelayError extends Error {
	constructor(readonly code: 'relay_unavailable' | 'request_timeout' | 'aborted', detail?: string) {
		super(detail ?? code);
		this.name = 'RelayError';
	}
}

const supabaseChannelFactory: RelayChannelFactory = (topic, onResponseChunk) => {
	const sb = getDivisionSupabase();
	let resolveReady: () => void = () => undefined;
	let rejectReady: (e: Error) => void = () => undefined;
	const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
	// 未処理のまま捨てられても警告にしない (request 側で待つ)
	ready.catch(() => undefined);
	const channel = sb
		.channel(topic, { config: { broadcast: { self: false, ack: false } } })
		.on('broadcast', { event: 'res' }, ({ payload }) => onResponseChunk(payload))
		.subscribe(status => {
			if (status === 'SUBSCRIBED') resolveReady();
			else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') rejectReady(new Error(status));
		});
	return {
		ready,
		send: async (event, payload) => {
			const result = await channel.send({ type: 'broadcast', event, payload });
			if (result !== 'ok') throw new Error(`relay send failed: ${result}`);
		},
		close: () => { void sb.removeChannel(channel); },
	};
};

let channelFactory: RelayChannelFactory = supabaseChannelFactory;

/** テスト用: チャンネルの作り方を差し替える。戻り値で元に戻す。 */
export const setRelayChannelFactory = (factory: RelayChannelFactory): (() => void) => {
	const previous = channelFactory;
	channelFactory = factory;
	relays.forEach(r => r.close());
	relays.clear();
	return () => {
		channelFactory = previous;
		relays.forEach(r => r.close());
		relays.clear();
	};
};

let idCounter = 0;
const newRequestId = (): string => {
	idCounter = (idCounter + 1) % 1_000_000;
	return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

type Pending = { resolve: (r: RelayResponse) => void; reject: (e: Error) => void };

export class RelayTransport {
	private readonly _keys: RelayKeys;
	private readonly _assembler = new RelayAssembler();
	private readonly _pending = new Map<string, Pending>();
	private _channel: RelayChannel | null = null;

	constructor(token: string) {
		this._keys = deriveRelayKeys(token);
	}

	private _ensureChannel(): RelayChannel {
		if (!this._channel) this._channel = channelFactory(this._keys.topic, payload => this._onChunk(payload));
		return this._channel;
	}

	private _onChunk(payload: unknown): void {
		const message = this._assembler.add(payload);
		if (!message) return;
		const pending = this._pending.get(message.id);
		if (!pending) return; // 別のスマホ宛ての返事
		try {
			const response = openRelayMessage<RelayResponse>(this._keys.key, 'res', message.sealed);
			if (response.id !== message.id) return;
			pending.resolve(response);
		} catch {
			// 鍵が合わない・壊れている返事は無視して、タイムアウトに任せる
		}
	}

	async request(
		input: Omit<RelayRequest, 'id' | 'sentAt'>,
		timeoutMs: number,
		signal?: AbortSignal,
	): Promise<RelayResponse> {
		const id = newRequestId();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;
		const done = new Promise<RelayResponse>((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			timer = setTimeout(() => reject(new RelayError('request_timeout')), timeoutMs);
			onAbort = () => reject(new RelayError('aborted'));
			if (signal?.aborted) onAbort();
			signal?.addEventListener('abort', onAbort);
		});
		done.catch(() => undefined);
		try {
			const channel = this._ensureChannel();
			let joinTimer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					channel.ready,
					new Promise<never>((_, reject) => { joinTimer = setTimeout(() => reject(new Error('join timeout')), JOIN_TIMEOUT_MS); }),
					done.then(() => undefined),
				]);
			} catch (e) {
				if (e instanceof RelayError) throw e;
				// 次のリクエストで参加し直す
				this.close();
				throw new RelayError('relay_unavailable', e instanceof Error ? e.message : String(e));
			} finally {
				clearTimeout(joinTimer);
			}
			const sealed = sealRelayMessage(this._keys.key, 'req', { ...input, id, sentAt: Date.now() } satisfies RelayRequest);
			try {
				for (const chunk of splitRelayMessage(id, sealed)) await channel.send('req', chunk);
			} catch (e) {
				throw new RelayError('relay_unavailable', e instanceof Error ? e.message : String(e));
			}
			return await done;
		} finally {
			clearTimeout(timer);
			if (onAbort) signal?.removeEventListener('abort', onAbort);
			this._pending.delete(id);
		}
	}

	close(): void {
		this._channel?.close();
		this._channel = null;
	}
}

const relays = new Map<string, RelayTransport>();

/** 同じ PC (トークン) への中継は 1 本にまとめる。 */
export const relayForToken = (token: string): RelayTransport => {
	let relay = relays.get(token);
	if (!relay) {
		relay = new RelayTransport(token);
		relays.set(token, relay);
	}
	return relay;
};
