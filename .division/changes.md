# 変更履歴 (論文・仕様書・デザイン)

生きた文書を更新するたびに、何を・なぜ変えたかを記録します。新しい記録は下に追加されます。
基準は .division/goal.md (ユーザーが最初に決めた目的) です。前の版は .division/history/ に残っています。

## 2026-11-09T13:21:43Z — 論文 (.division/paper.md)
- 担当: 2. [Searcher] UI改善の外部根拠を収集
- 依頼: デザインを改善して
- 何を・なぜ: UI改善の調査メモ（2026-11-09） - **文字の読みやすさ:** React Native の `Text` は `allowFontScaling` が既定で有効で、OSの文字サイズ設定に応じた拡大をサポートします。固定高で文字を切らないようにし、大きな文字設定でもレイアウトを確認するのが適用条件です。AppleはDynamic Type等で文字を理想的には200%まで拡大可能にすることを推奨しています。出典: React Native「Text」（2026-10-28更新）https://reactnative.dev/docs/text ／ Apple「Accessibility」（2026-10-24更新）https://developer.apple.com/design/human-interface-guidelines/accessibility - **配色とコントラスト:** WCAG 2.2 AAは通常の文字に4.5:1、大きな文字に3:1を求めます。Web表示には適合基準として適用し、ネイティブ画面では共通の設計目安として使う場合、プラットフォームの基準と区別して確認してください。色だけで状態を伝えず、文字・アイコン等も併用します。出典: W3C「WCAG 2.2」（2026-10-26更新）https://www.w3.org/TR/WCAG22/ ／ W3C「WCAG2Mobile」（2025-05-06公開、2026-10-02更新）https://www.w3.org/TR/wcag2mobile-22/ - **タップ領域:** AppleのiOS/iPadOSでは44×44 ptを標準サイズ、28×28 ptを最小サイズとして案内しています。MaterialではAndroid等のタッチ対象に48×48 dp以上、対象間に通常8 dp以上の間隔を推奨します。アイコンの見た目の寸法ではなく、操作可能な領域を測り、プラットフォームごとに単位・基準を使い分けます。出典: Apple「Accessibility」（2026-11-06更新）https://developer.apple.com/design/human-interface-guidelines/accessibility.md ／ Google Material「Accessibility」（2026-10-26更新）https://m1.material.io/usability/accessibility.html - **情報階層:** 重要度に応じて項目を配置し、関連する項目を近くにまとめるのがMaterialの指針です。見出し・余白・文字の強弱で優先順位を伝え、既存機能や操作導線を変えずに整理する場合に適用します。出典: Google Material「Accessibility」https://m1.material.io/usability/accessibility.html - **状態表示:** Material 3は有効・無効・フォーカス・押下などの状態を一貫して表し、アクセシビリティのため状態を示す視覚的手掛かりを2つ用いるよう案内しています。色に加えてラベルやアイコン等を使い、状態変化を判別できる設計が適用条件です。出典: Google Material 3「States」（2026-11-07更新）https://m3.material.io/foundations/interaction/states/overvi
- 差分: +14 / -0 行 (新規作成)

## 2026-11-09T13:25:22Z — 論文 (.division/paper.md)
- 担当: 3. [Researcher] 改善方針と優先順位を整理
- 依頼: デザインを改善して
- 何を・なぜ: .division/paper.md の既存メモを保持し、両調査を統合してデザイン改善の優先順位、選択肢、未検証事項を追記しました。必須節と出典を確認済みです。アプリのテスト・実機検証は実施していません。
- 差分: +76 / -0 行 (前の版: .division/history/paper/2026-11-09T13-23-18-688Z/)

## 2026-11-09T13:32:00Z — 仕様書 (.division/specification.md)
- 担当: 4. [Writer] デザイン改善の仕様を定義
- 依頼: デザインを改善して
- 何を・なぜ: `.division/specification.md` を初版として作成し、読み返して内容を確認しました。`.division/paper.md` と既存実装を基に、対象画面・共通部品、維持する操作と遷移、見た目の改善、画面幅・セーフエリア・アクセシビリティ、読み込み／空／エラー／無効状態を定義しました。画面別の受け入れ条件と変更対象外も明記し、ループチップは現行挙動どおり追加しない方針を記載しています。`.division/goal.md` やソースコードは変更していません。
- 差分: +126 / -0 行 (新規作成)

## 2026-11-09T14:02:02Z — デザイン (.division/design/ (index.html と各画面の HTML))
- 担当: 5. [Designer] 統一感のある画面デザインを作成
- 依頼: デザインを改善して
- 何を・なぜ: ステップ数の上限 (120) に達したため停止しました。続ける場合は追加の指示を送ってください。
- 差分: +54 / -44 行 (前の版: .division/history/design/2026-11-09T13-32-29-254Z/)
