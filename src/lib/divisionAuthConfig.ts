/**
 * Division (Supabase) の公開設定。IDE 側 (divisionAuthConfig.ts) と同じ値。
 *
 * SUPABASE_URL と SUPABASE_ANON_KEY は公開しても問題のない値 (実際の権限は
 * Supabase 側の Row Level Security で制御される)。
 */

export const DIVISION_SUPABASE_URL = 'https://wmhrbhcnxglvqwvnbxlt.supabase.co';
export const DIVISION_SUPABASE_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndtaHJiaGNueGdsdnF3dm5ieGx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3OTg1MDAsImV4cCI6MjA5MTM3NDUwMH0.4qjCIOjFwm4XnmtqZN_N0zcZlhjGc2GQ4-x7ygMa3hM';

/** リモートセッション (デスクトップの接続情報) を保持するテーブル。IDE 側と共通。 */
export const DIVISION_REMOTE_SESSION_TABLE = 'RemoteSession';

/** プラン・クレジット残高・Division API キーを持つテーブル。自分の行だけ読める。 */
export const DIVISION_PROFILES_TABLE = 'profiles';

/** クレジットの増減履歴。自分の行だけ読める。 */
export const DIVISION_CREDIT_TRANSACTION_TABLE = 'credit_transactions';

/** 共有された役割割り当て (ソーシャル) のテーブル。 */
export const DIVISION_ASSIGNMENT_POST_TABLE = 'AssignmentPost';
export const DIVISION_ASSIGNMENT_POST_LIKE_TABLE = 'AssignmentPostLike';

/** 取り込み数を増やしつつ割り当てを返す SECURITY DEFINER 関数。 */
export const DIVISION_IMPORT_POST_FUNCTION = 'import_assignment_post';

/** Stripe の Checkout / Billing Portal を作る Edge Functions。 */
export const DIVISION_FUNCTIONS_BASE_URL = `${DIVISION_SUPABASE_URL}/functions/v1`;

/** Division API (ルーティングの見積もり・利用履歴) の既定のエンドポイント。 */
export const DIVISION_API_BASE_URL = 'https://api.division.he-ro.jp';
