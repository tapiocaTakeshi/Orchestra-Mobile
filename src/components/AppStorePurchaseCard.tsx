/**
 * iOS の App 内課金のカード (コストページの「管理」)。
 *
 * Orchestra Plus (自動更新サブスクリプション) とクレジットパックを StoreKit で
 * 買う。購入は lib/appStorePurchases.ts の流れ (サーバーで付与 → finish) で処理する。
 * Guideline 3.1.2 に合わせ、サブスクリプションには価格・期間・内容・自動更新の
 * 説明と、利用規約 (EULA)・プライバシーポリシーへのリンクを載せる。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
	ErrorCode,
	type Product,
	type Purchase,
	deepLinkToSubscriptions,
	endConnection,
	fetchProducts,
	finishTransaction,
	getAvailablePurchases,
	initConnection,
	purchaseErrorListener,
	purchaseUpdatedListener,
	requestPurchase,
} from 'expo-iap';

import { Badge, Body, Button, Card, Muted, Row, SectionTitle, useToast } from './ui';
import {
	APP_STORE_PRODUCTS,
	AppStoreProductInfo,
	CONSUMABLE_PRODUCT_IDS,
	PLUS_MONTHLY_PRODUCT_ID,
	SUBSCRIPTION_PRODUCT_IDS,
	isConsumableProduct,
	purchaseSuccessText,
	shouldFinishAfterError,
	verifyAppStorePurchase,
} from '../lib/appStorePurchases';
import { DivisionSession } from '../lib/divisionAuth';
import { APPLE_STANDARD_EULA_URL, PRIVACY_URL, TERMS_URL } from '../lib/legal';
import { colors, fontSize, spacing } from '../theme';

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const openUrl = (url: string) => { void Linking.openURL(url).catch(() => undefined); };

/** StoreKit の取引 ID (iOS では purchase.id も同じ値) */
const transactionIdOf = (p: Purchase): string => String((p as { transactionId?: string }).transactionId || p.id || '');

export const AppStorePurchaseCard = ({ session, isPlus, onPurchased }: {
	session: DivisionSession;
	/** すでに Plus (App Store / Web どちらで買ったものでも) */
	isPlus: boolean;
	/** 付与できたあと (残高・プランを読み直す) */
	onPurchased: () => void;
}) => {
	const toast = useToast();
	const [prices, setPrices] = useState<Record<string, string>>({});
	const [storeReady, setStoreReady] = useState(false);
	const [storeError, setStoreError] = useState<string | null>(null);
	const [buying, setBuying] = useState<string | null>(null);
	const [restoring, setRestoring] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// リスナーは一度だけ登録するので、最新の値は ref で読む
	const sessionRef = useRef(session);
	sessionRef.current = session;
	const onPurchasedRef = useRef(onPurchased);
	onPurchasedRef.current = onPurchased;
	/** 同じ取引を (リスナーと復元で) 二重に処理しない */
	const inFlight = useRef(new Set<string>());

	/** サーバーで付与し、できたら StoreKit の取引を終える。付与できたら true */
	const handlePurchase = useCallback(async (purchase: Purchase, quiet = false): Promise<boolean> => {
		const txId = transactionIdOf(purchase);
		if (!txId || inFlight.current.has(txId)) return false;
		inFlight.current.add(txId);
		try {
			const env = (purchase as { environmentIOS?: string | null }).environmentIOS ?? null;
			const result = await verifyAppStorePurchase(sessionRef.current, txId, env);
			await finishTransaction({ purchase, isConsumable: isConsumableProduct(purchase.productId) });
			if (!quiet) toast.show(purchaseSuccessText(result), 'success');
			onPurchasedRef.current();
			return true;
		} catch (e) {
			if (shouldFinishAfterError(e)) await finishTransaction({ purchase, isConsumable: isConsumableProduct(purchase.productId) }).catch(() => undefined);
			setError(`購入の反映に失敗しました: ${errorText(e)}${shouldFinishAfterError(e) ? '' : '\n次回アプリを開いたときに自動でやり直します。'}`);
			return false;
		} finally {
			inFlight.current.delete(txId);
			setBuying(null);
		}
	}, [toast]);

	useEffect(() => {
		let alive = true;
		const updated = purchaseUpdatedListener(purchase => { void handlePurchase(purchase); });
		const failed = purchaseErrorListener(e => {
			setBuying(null);
			if (e.code === ErrorCode.UserCancelled) return;
			setError(`購入できませんでした: ${e.message}`);
		});
		(async () => {
			try {
				await initConnection();
				const [subs, packs] = await Promise.all([
					fetchProducts({ skus: SUBSCRIPTION_PRODUCT_IDS, type: 'subs' }),
					fetchProducts({ skus: CONSUMABLE_PRODUCT_IDS, type: 'in-app' }),
				]);
				if (!alive) return;
				const next: Record<string, string> = {};
				for (const p of [...(subs ?? []), ...(packs ?? [])] as Product[]) next[p.id] = p.displayPrice;
				setPrices(next);
				setStoreReady(true);
				if (Object.keys(next).length === 0) setStoreError('App Store から商品情報を取得できませんでした。');
			} catch (e) {
				if (alive) setStoreError(`App Store に接続できませんでした: ${errorText(e)}`);
			}
		})();
		return () => {
			alive = false;
			updated.remove();
			failed.remove();
			void endConnection().catch(() => undefined);
		};
	}, [handlePurchase]);

	const buy = useCallback(async (product: AppStoreProductInfo) => {
		setError(null);
		setBuying(product.id);
		try {
			// 結果は purchaseUpdatedListener に届く (そこでサーバーに送って finish する)
			await requestPurchase(product.kind === 'subscription'
				? { type: 'subs', request: { ios: { sku: product.id, appAccountToken: session.userId } } }
				: { type: 'in-app', request: { ios: { sku: product.id, appAccountToken: session.userId } } });
		} catch (e) {
			setBuying(null);
			if ((e as { code?: string })?.code === ErrorCode.UserCancelled) return;
			setError(`購入できませんでした: ${errorText(e)}`);
		}
	}, [session.userId]);

	const restore = useCallback(async () => {
		setError(null);
		setRestoring(true);
		try {
			const purchases = await getAvailablePurchases();
			let restored = 0;
			for (const p of purchases ?? []) if (await handlePurchase(p, true)) restored++;
			toast.show(restored > 0 ? '購入を復元しました' : '復元できる購入はありませんでした', restored > 0 ? 'success' : undefined);
		} catch (e) {
			setError(`購入を復元できませんでした: ${errorText(e)}`);
		} finally {
			setRestoring(false);
		}
	}, [handlePurchase, toast]);

	const plus = APP_STORE_PRODUCTS.find(p => p.id === PLUS_MONTHLY_PRODUCT_ID)!;
	const packs = APP_STORE_PRODUCTS.filter(p => p.kind === 'consumable');
	const priceOf = (id: string) => prices[id] ?? (storeReady ? '—' : '…');
	const canBuy = (id: string) => storeReady && !!prices[id] && buying === null;

	return (
		<Card>
			<SectionTitle>プランとクレジットの購入</SectionTitle>

			<View style={styles.product}>
				<Row style={styles.spread}>
					<View style={styles.flex}>
						<Body>{plus.title}</Body>
						<Text style={styles.price}>{priceOf(plus.id)} / 月</Text>
					</View>
					{isPlus
						? <Badge label='利用中' color={colors.success} />
						: <Button
							title='登録する'
							loading={buying === plus.id}
							disabled={!canBuy(plus.id)}
							onPress={() => void buy(plus)}
						/>}
				</Row>
				<Muted>{plus.description}</Muted>
				<Muted>
					1 か月ごとの自動更新サブスクリプションです。お支払いは購入の確定時に Apple ID に請求されます。
					現在の期間が終わる 24 時間前までに解約しない限り、同じ価格で自動的に更新されます。
					解約や管理は「サブスクリプションを管理」(iOS の設定 &gt; Apple ID &gt; サブスクリプション) から行えます。
				</Muted>
			</View>

			{packs.map(pack => (
				<View key={pack.id} style={styles.product}>
					<Row style={styles.spread}>
						<View style={styles.flex}>
							<Body>{pack.title}</Body>
							<Text style={styles.price}>{priceOf(pack.id)}</Text>
						</View>
						<Button
							title='購入'
							variant='secondary'
							loading={buying === pack.id}
							disabled={!canBuy(pack.id)}
							onPress={() => void buy(pack)}
						/>
					</Row>
					<Muted>{pack.description}</Muted>
				</View>
			))}

			{storeError ? <Text style={styles.error}>{storeError}</Text> : null}
			{error ? <Text style={styles.error}>{error}</Text> : null}

			<Row style={styles.actions}>
				<Button title='購入を復元' variant='secondary' size='sm' loading={restoring} disabled={!storeReady} onPress={() => void restore()} />
				<Button
					title='サブスクリプションを管理'
					variant='ghost'
					size='sm'
					onPress={() => { void deepLinkToSubscriptions({}).catch(() => openUrl('https://apps.apple.com/account/subscriptions')); }}
				/>
			</Row>

			<View style={styles.links}>
				<Pressable accessibilityRole='link' hitSlop={6} onPress={() => openUrl(APPLE_STANDARD_EULA_URL)}>
					<Text style={styles.link}>利用規約 (EULA)</Text>
				</Pressable>
				<Text style={styles.sep}>·</Text>
				<Pressable accessibilityRole='link' hitSlop={6} onPress={() => openUrl(TERMS_URL)}>
					<Text style={styles.link}>サービス利用規約</Text>
				</Pressable>
				<Text style={styles.sep}>·</Text>
				<Pressable accessibilityRole='link' hitSlop={6} onPress={() => openUrl(PRIVACY_URL)}>
					<Text style={styles.link}>プライバシーポリシー</Text>
				</Pressable>
			</View>
		</Card>
	);
};

const styles = StyleSheet.create({
	product: { gap: spacing.xs, paddingVertical: spacing.sm },
	spread: { justifyContent: 'space-between', alignItems: 'center' },
	flex: { flex: 1, gap: 2 },
	price: { color: colors.fg, fontSize: fontSize.md, fontWeight: '600' },
	error: { color: colors.danger, fontSize: fontSize.sm },
	actions: { gap: spacing.sm, flexWrap: 'wrap' },
	links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
	link: { color: colors.accentText, fontSize: fontSize.sm, textDecorationLine: 'underline' },
	sep: { color: colors.fgFaint, fontSize: fontSize.sm },
});
