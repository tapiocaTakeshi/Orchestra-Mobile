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
