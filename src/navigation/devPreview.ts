import { isRouteName, RouteName } from './routes';

/**
 * 外部認証が使えない環境での「確認専用」導線。通常動作とは分離している。
 *
 * - __DEV__ ビルドでのみ有効（本番 / EAS の release ビルドでは常に null）
 * - 例: EXPO_PUBLIC_ORCHESTRA_PREVIEW_ROUTE=kanban npx expo start
 * - 有効時は画面上部に「開発プレビュー」帯が出る。認証済みとはみなさず、
 *   セッション API は一切呼び出し結果を偽装しない。
 */
export function getDevPreviewRoute(): RouteName | null {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;
  // @ts-ignore -- process.env.EXPO_PUBLIC_* は Expo の babel でビルド時に置換される
  const raw: unknown = process.env.EXPO_PUBLIC_ORCHESTRA_PREVIEW_ROUTE;
  return isRouteName(raw) ? raw : null;
}

export function getTermsUrl(): string | null {
  // @ts-ignore -- 同上
  const raw: unknown = process.env.EXPO_PUBLIC_TERMS_URL;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export function getPrivacyUrl(): string | null {
  // @ts-ignore -- 同上
  const raw: unknown = process.env.EXPO_PUBLIC_PRIVACY_URL;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
