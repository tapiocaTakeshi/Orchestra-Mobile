/**
 * 既存の認証・セッション処理（src/lib/divisionAuth.ts / divisionSession.ts）への接続口。
 * 既存実装は変更せず、エクスポートされた関数を名前で探して呼び出す。
 * 見つからない場合に「ログイン成功」を偽装することはしない。
 */
import * as authModule from '../lib/divisionAuth';
import * as sessionModule from '../lib/divisionSession';

type AnyFn = (...args: unknown[]) => unknown;
export type AuthProvider = 'github' | 'division';

const authApi = authModule as unknown as Record<string, unknown>;
const sessionApi = sessionModule as unknown as Record<string, unknown>;

function pick(sources: Record<string, unknown>[], names: string[]): AnyFn | null {
  for (const name of names) {
    for (const src of sources) {
      const fn = src[name];
      if (typeof fn === 'function') return fn as AnyFn;
    }
  }
  return null;
}

const RESTORE_NAMES = [
  'restoreSession',
  'loadSession',
  'getSession',
  'getStoredSession',
  'readSession',
  'getCurrentSession',
  'getCurrentUser',
];
const GENERIC_SIGN_IN = ['signIn', 'login', 'startLogin', 'startDivisionLogin', 'authenticate', 'signInWithDivision'];
const GITHUB_SIGN_IN = ['signInWithGitHub', 'signInWithGithub', 'loginWithGitHub', 'loginWithGithub'];
const DIVISION_SIGN_IN = ['signInWithDivision', 'loginWithDivision', 'startDivisionLogin'];
const SIGN_OUT_NAMES = ['signOut', 'logout', 'logOut', 'clearSession', 'deleteSession'];

const restoreFn = pick([sessionApi, authApi], RESTORE_NAMES);
const githubFn = pick([authApi], GITHUB_SIGN_IN) ?? pick([authApi], GENERIC_SIGN_IN);
const divisionFn = pick([authApi], DIVISION_SIGN_IN) ?? pick([authApi], GENERIC_SIGN_IN);
const signOutFn = pick([authApi, sessionApi], SIGN_OUT_NAMES);

export const authAdapterInfo = {
  hasRestore: restoreFn !== null,
  hasGitHub: githubFn !== null,
  hasDivision: divisionFn !== null,
  hasSignOut: signOutFn !== null,
};

export function hasSignIn(provider: AuthProvider): boolean {
  return provider === 'github' ? githubFn !== null : divisionFn !== null;
}

export function hasAnySignIn(): boolean {
  return githubFn !== null || divisionFn !== null;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('ok' in v && v.ok === false) return false;
    if ('success' in v && v.success === false) return false;
    if ('error' in v && v.error) return false;
  }
  return true;
}

/** 保存済みセッションを復元。無ければ null */
export async function restoreSession(): Promise<unknown | null> {
  if (!restoreFn) return null;
  const result = await Promise.resolve(restoreFn());
  return isPresent(result) ? result : null;
}

/** 既存の認証フローを実行。キャンセル・失敗時は null（例外は呼び出し側へ） */
export async function signIn(provider: AuthProvider): Promise<unknown | null> {
  const fn = provider === 'github' ? githubFn : divisionFn;
  if (!fn) throw new Error('認証処理が見つかりません');
  const result = await Promise.resolve(fn());
  // サインイン後は保存されたセッションを正とする
  const restored = await restoreSession().catch(() => null);
  if (restored) return restored;
  return isPresent(result) ? result : null;
}

export async function signOut(): Promise<void> {
  if (signOutFn) await Promise.resolve(signOutFn());
}

export interface SessionUser {
  name: string;
  email: string | null;
  initial: string;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function describeUser(session: unknown): SessionUser | null {
  if (!session || typeof session !== 'object') return null;
  const root = session as Record<string, unknown>;
  const user = (root.user && typeof root.user === 'object' ? root.user : root) as Record<string, unknown>;
  const email = str(user.email) ?? str(root.email);
  const name =
    str(user.name) ??
    str(user.displayName) ??
    str(user.login) ??
    str(user.username) ??
    (email ? email.split('@')[0] : null);
  if (!name) return null;
  return { name, email, initial: name.charAt(0).toUpperCase() };
}
