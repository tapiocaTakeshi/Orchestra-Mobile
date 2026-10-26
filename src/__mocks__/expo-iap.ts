/**
 * jest (node 環境) 用の expo-iap スタブ。
 *
 * 本物はネイティブモジュールで ESM のまま配布されているため、テストでは
 * この薄いスタブに差し替える (package.json の moduleNameMapper)。
 * App Store にはつながらない体 (商品なし・購入なし) で返す。
 */

export enum ErrorCode {
	UserCancelled = 'user-cancelled',
}

const subscription = { remove: (): void => { /* noop */ } };

export const initConnection = async (): Promise<boolean> => false;
export const endConnection = async (): Promise<boolean> => true;
export const fetchProducts = async (): Promise<never[]> => [];
export const getAvailablePurchases = async (): Promise<never[]> => [];
export const requestPurchase = async (): Promise<null> => null;
export const finishTransaction = async (): Promise<void> => undefined;
export const deepLinkToSubscriptions = async (): Promise<void> => undefined;
export const purchaseUpdatedListener = (): typeof subscription => subscription;
export const purchaseErrorListener = (): typeof subscription => subscription;
