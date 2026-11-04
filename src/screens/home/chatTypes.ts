export type AgentStatus = 'running' | 'awaiting' | 'done' | 'denied' | 'error';
export type ChatModel = 'Opus' | 'Sonnet' | 'Haiku';
export type ApprovalDecision = 'approve' | 'deny';

export interface DayItem {
  kind: 'day';
  id: string;
  label: string;
}

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
}

export interface AgentItem {
  kind: 'agent';
  id: string;
  status: AgentStatus;
  paragraphs: string[];
  toolLines: string[];
  code?: string;
}

export type ChatItem = DayItem | UserItem | AgentItem;

export interface PendingApproval {
  id: string;
  /** 承認結果を反映するエージェント発話の id */
  turnId: string;
  summary: string;
}

export interface AgentReply {
  paragraphs: string[];
  toolLines: string[];
  code?: string;
  /** 返答が承認を要求する場合 */
  approval?: { id: string; summary: string };
}

export interface ChatSnapshot {
  title: string;
  connectionLabel: string;
  connected: boolean;
  items: ChatItem[];
  approval: PendingApproval | null;
  model: ChatModel;
  recentTitles: string[];
  /** 例: "$1.84"。取得できない場合は null */
  costLabel: string | null;
}

export interface ChatCapabilities {
  runtimeSwitch: boolean;
  repoPicker: boolean;
  newChat: boolean;
}

/**
 * 画面が依存する唯一の境界。
 * 本番は既存の会話・承認 API（src/lib/division*.ts）をラップして実装する。
 */
export interface ChatBackend {
  readonly isDemo: boolean;
  readonly capabilities: ChatCapabilities;
  readonly repoLabel: string;
  loadInitial(): Promise<ChatSnapshot>;
  send(text: string, model: ChatModel): Promise<AgentReply>;
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<void>;
  setModel?(model: ChatModel): Promise<void>;
}

export const MODEL_OPTIONS: { model: ChatModel; description: string }[] = [
  { model: 'Opus', description: '難しい設計・長い作業に' },
  { model: 'Sonnet', description: '日常の実装と修正に（推奨）' },
  { model: 'Haiku', description: '短い質問・素早い確認に' },
];
