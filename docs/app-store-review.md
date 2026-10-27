# App Store 審査対応 (Guideline 3.1.1 / 1.2)

2026-10-22 の審査 (Submission 45ba19dc-59d0-46b5-b269-0d7095527823, 1.0 (16)) で指摘された 2 点への対応と、
再提出までに必要な作業。

> **2026-10-27 変更**: App 内課金 (StoreKit / `expo-iap`) は取りやめ、ネイティブアプリ (iOS / Android) では
> 課金しないことにした。管理タブには残高・プラン・履歴だけを表示し、購入・申し込み・支払い管理・自動チャージや
> 外部の購入ページへの導線は出さない (購入・管理は Division の Web サイト https://division.he-ro.jp で行う)。以下の App 内課金の商品・`apple-iap`
> 関連の作業は現在のアプリには当てはまらない。3.1.1 には「アプリ内で購入できるものはなく、購入への導線もない」
> と回答する。

## 何を変えたか

| 指摘 | 対応 | 場所 |
| --- | --- | --- |
| 3.1.1 App 内課金 | iOS では Orchestra Plus とクレジットを StoreKit で購入。Stripe の申し込み・支払い管理・自動チャージは iOS では表示しない | `src/components/AppStorePurchaseCard.tsx`, `src/lib/appStorePurchases.ts`, `TuningScreen.tsx` (管理) |
| 3.1.1 (サーバー) | 購入をサーバーで Apple から読み直して付与。更新・失効・返金は App Store Server Notifications で反映 | Orchestra `supabase/functions/apple-iap`, `apple-iap-notifications`, `_shared/appstore.ts` |
| 1.2 EULA | ログイン前に利用規約 (不適切なコンテンツ・迷惑行為を一切許容しない旨) への同意が必須 | `LoginScreen.tsx`, `TermsSheet.tsx`, `src/lib/legal.ts` |
| 1.2 フィルタ | 不適切な語を含む投稿・コメントはサーバー (DB トリガ) とアプリの両方で拒否、フィードからも除外 | migration, `src/lib/moderation.ts` |
| 1.2 通報 | 投稿の「…」→「通報」。開発者にメールで通知、3 人以上に通報された投稿は自動で非表示 | `SocialScreen.tsx`, `supabase/functions/moderation` |
| 1.2 ブロック | 投稿の「…」→「このユーザーをブロック」。その人の投稿は即座にフィードから消え、開発者に通知。ヘッダーの「ブロック中のユーザー」から解除 | 同上 |

あわせて直したセキュリティの問題: `profiles` を利用者が自分で更新でき、クレジット残高やプランを
任意の値に書き換えられた。利用者が書けるのは表示名・アバター・自動チャージ設定だけにした (migration)。

## 再提出までの作業

### 1. データベース (Supabase `wmhrbhcnxglvqwvnbxlt`)
division-hp の `supabase/migrations/20261026_app_review_moderation_iap.sql` を適用する。

### 2. App Store Connect: App 内課金の商品
| 種類 | 製品 ID | 付与 |
| --- | --- | --- |
| 自動更新サブスクリプション (グループ: Orchestra Plus, 1 か月) | `com.hero.orchestra.plus.monthly` | プラン Plus + 毎期 10 クレジット (期末に失効) |
| 消耗型 | `com.hero.orchestra.credits.20` | 20 クレジット |
| 消耗型 | `com.hero.orchestra.credits.50` | 50 クレジット |

- 価格は自由に決めてよい (Apple の手数料 15〜30% を考慮)。付与量を変えるときはアプリの
  `src/lib/appStorePurchases.ts` と Orchestra の `supabase/functions/_shared/appstore.ts` の両方を直す。
- 各商品に審査用のスクリーンショットと説明を付け、**アプリのバージョンと一緒に審査に提出**する。
- 有料 App 契約 (Paid Apps Agreement)・税務・口座情報が有効になっていること。

### 3. App Store Connect: API キーと通知
- ユーザとアクセス > 統合 > App 内課金 でキーを作成し、Issuer ID・Key ID・.p8 を控える。
- App 情報 > App Store サーバ通知 (本番・サンドボックスとも, バージョン 2):
  `https://wmhrbhcnxglvqwvnbxlt.supabase.co/functions/v1/apple-iap-notifications`
- App 情報に **プライバシーポリシー URL** `https://division.he-ro.jp/privacy` を設定し、
  App の説明欄に利用規約 (EULA) のリンク (`https://division.he-ro.jp/terms` または Apple 標準 EULA) を入れる。

### 4. Supabase Edge Function のシークレットとデプロイ
```
APPLE_IAP_ISSUER_ID=...
APPLE_IAP_KEY_ID=...
APPLE_IAP_PRIVATE_KEY=<.p8 の中身>
RESEND_API_KEY=...            # 通報・ブロックのメール
MODERATION_NOTIFY_EMAIL=...   # 通報を受け取るアドレス
```
デプロイ: `apple-iap` (verify_jwt: true)、`apple-iap-notifications` (verify_jwt: **false**)、`moderation` (verify_jwt: true)。

### 5. Web (division-hp)
`/terms` と `/privacy` のページを公開する (今は 404)。文面は下書きなので内容を確認すること
(運営者名・管轄裁判所・24 時間以内の対応など)。

### 6. ビルド
`expo-iap` (ネイティブモジュール) を追加したので、新しいビルド番号でビルドし直す
(Xcode Cloud の prebuild で組み込まれる)。Sandbox のテスターで購入・復元を確認する。

## 画面収録 (実機) で見せるもの
1. 未ログイン状態でアプリを開く → 利用規約のチェックボックス → 「利用規約」で全文 (第3条にゼロトレランス) →「同意する」→ ログイン。
   チェックせずにログインを押すと止まることも見せる。
2. 共有 (ソーシャル) → 他人の投稿の「…」→「通報」→ 理由を選んで「通報する」→ 投稿がフィードから消える。
3. 他人の投稿の「…」→「このユーザーをブロック」→ 確認 → その人の投稿がすべて消える。ヘッダーの「ブロック中のユーザー」に出る。
4. (3.1.1 用に) コスト > 管理 → Orchestra Plus / クレジットを Sandbox アカウントで購入 → 残高が増える。「購入を復元」。

収録は App Store Connect の「App Review に関する情報」のメモに添付する。

## App Review への返信 (例)

> Thank you for the review.
>
> **Guideline 3.1.1** — Orchestra Plus (auto-renewable subscription) and AI credit packs are now available
> through In-App Purchase on iOS (Cost tab > 管理). The app no longer links to or mentions external purchasing
> on iOS. The In-App Purchase products have been submitted together with this build.
>
> **Guideline 1.2** — We added the required precautions for the shared-configuration feed (共有):
> - Users must agree to the Terms of Use, which state there is zero tolerance for objectionable content and
>   abusive users, before logging in.
> - Objectionable words are filtered on the server and in the app.
> - Each post has a "…" menu to report it (通報); reports notify us by email and we act on them within 24 hours.
>   Posts reported by several users are hidden automatically.
> - Users can block an author (このユーザーをブロック); the author's posts are removed from the user's feed
>   immediately and we are notified.
>
> A screen recording on a physical device showing the terms agreement, reporting and blocking is attached in
> the App Review Information notes.
