import type { AgentReply, ApprovalDecision, ChatBackend, ChatModel, ChatSnapshot } from './chatTypes';

/**
 * デモ専用。本番の会話・承認 API とは無関係で、通信も行わない。
 * isDemo=true を必ず返し、未対応の操作は capabilities=false で明示する。
 */
export function createDemoChatBackend(options: { delayMs?: number } = {}): ChatBackend {
  const delayMs = options.delayMs ?? 1200;
  let seq = 0;
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const snapshot: ChatSnapshot = {
    title: '配色を Claude 風に整える',
    connectionLabel: '接続済み · MacBook Pro',
    connected: true,
    model: 'Opus',
    costLabel: '$1.84',
    recentTitles: ['配色を Claude 風に整える', 'ログイン画面の文言修正', 'EAS ビルドの失敗を調査'],
    approval: { id: 'demo-approval-1', turnId: 'demo-a2', summary: 'jest のスナップショットを更新' },
    items: [
      { kind: 'day', id: 'demo-d1', label: '今日 9:12' },
      { kind: 'user', id: 'demo-u1', text: 'この画面の配色を Claude 風に整えてください。背景は暖かい色で、余白は広めに。' },
      {
        kind: 'agent',
        id: 'demo-a1',
        status: 'done',
        paragraphs: ['了解しました。地は暖かいオフホワイトにして、主な操作だけテラコッタを使います。src/theme.ts のトークンを更新しました。'],
        toolLines: ['● ツールを 3 回実行　⎿ 読み取り・検索・置換'],
        code: "colors.bg      = '#faf9f5'\ncolors.accent  = '#b95a3a'\nradius.input   = 24",
      },
      { kind: 'user', id: 'demo-u2', text: '型チェックとテストも回しておいて。' },
      {
        kind: 'agent',
        id: 'demo-a2',
        status: 'awaiting',
        paragraphs: ['テストを実行する前に、スナップショットの更新（ファイルの書き込み）について承認をお願いします。'],
        toolLines: ['● Bash　⎿ npm run typecheck … 0 errors', '○ Bash　⎿ npx jest --runInBand -u（承認待ち）'],
      },
    ],
  };

  return {
    isDemo: true,
    capabilities: { runtimeSwitch: false, repoPicker: false, newChat: false },
    repoLabel: 'orchestra-mobile',
    async loadInitial() {
      return JSON.parse(JSON.stringify(snapshot)) as ChatSnapshot;
    },
    async send(_text: string, _model: ChatModel): Promise<AgentReply> {
      seq += 1;
      await wait(delayMs);
      return {
        paragraphs: ['デモ表示のため実際の処理は行っていませんが、ここにエージェントの返答が表示されます。'],
        toolLines: ['● ツールを 2 回実行　⎿ 読み取り・検索'],
      };
    },
    async resolveApproval(_id: string, _decision: ApprovalDecision) {
      await wait(300);
    },
    async setModel() {
      await wait(0);
    },
  };
}
