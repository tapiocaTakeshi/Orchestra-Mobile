import type {
  AgentReply,
  ApprovalDecision,
  ChatItem,
  ChatModel,
  ChatSnapshot,
  PendingApproval,
} from './chatTypes';

export interface ChatState {
  loaded: boolean;
  title: string;
  connectionLabel: string;
  connected: boolean;
  items: ChatItem[];
  approval: PendingApproval | null;
  resolvingApproval: boolean;
  model: ChatModel;
  recentTitles: string[];
  costLabel: string | null;
}

export type ChatAction =
  | { type: 'loaded'; snapshot: ChatSnapshot }
  | { type: 'userSent'; userId: string; agentId: string; text: string }
  | { type: 'agentReplied'; agentId: string; reply: AgentReply }
  | { type: 'agentFailed'; agentId: string; message: string }
  | { type: 'approvalStarted' }
  | { type: 'approvalResolved'; decision: ApprovalDecision }
  | { type: 'approvalFailed' }
  | { type: 'modelChanged'; model: ChatModel };

export const initialChatState: ChatState = {
  loaded: false,
  title: '',
  connectionLabel: '',
  connected: false,
  items: [],
  approval: null,
  resolvingApproval: false,
  model: 'Opus',
  recentTitles: [],
  costLabel: null,
};

function updateAgent(items: ChatItem[], id: string, patch: (a: Extract<ChatItem, { kind: 'agent' }>) => ChatItem): ChatItem[] {
  return items.map((it) => (it.kind === 'agent' && it.id === id ? patch(it) : it));
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loaded':
      return { ...state, ...action.snapshot, loaded: true, resolvingApproval: false };

    case 'userSent':
      return {
        ...state,
        items: [
          ...state.items,
          { kind: 'user', id: action.userId, text: action.text },
          { kind: 'agent', id: action.agentId, status: 'running', paragraphs: [], toolLines: ['● 考えています…'] },
        ],
      };

    case 'agentReplied': {
      const { reply } = action;
      const items = updateAgent(state.items, action.agentId, (a) => ({
        ...a,
        status: reply.approval ? 'awaiting' : 'done',
        paragraphs: reply.paragraphs,
        toolLines: reply.toolLines,
        code: reply.code,
      }));
      const approval = reply.approval
        ? { id: reply.approval.id, turnId: action.agentId, summary: reply.approval.summary }
        : state.approval;
      return { ...state, items, approval };
    }

    case 'agentFailed':
      return {
        ...state,
        items: updateAgent(state.items, action.agentId, (a) => ({
          ...a,
          status: 'error',
          paragraphs: [action.message],
          toolLines: [],
        })),
      };

    case 'approvalStarted':
      return state.approval ? { ...state, resolvingApproval: true } : state;

    case 'approvalResolved': {
      if (!state.approval) return state;
      const turnId = state.approval.turnId;
      return {
        ...state,
        approval: null,
        resolvingApproval: false,
        items: updateAgent(state.items, turnId, (a) => ({
          ...a,
          status: action.decision === 'approve' ? 'done' : 'denied',
        })),
      };
    }

    case 'approvalFailed':
      return { ...state, resolvingApproval: false };

    case 'modelChanged':
      return { ...state, model: action.model };

    default:
      return state;
  }
}

export function isSending(state: ChatState): boolean {
  return state.items.some((it) => it.kind === 'agent' && it.status === 'running');
}
