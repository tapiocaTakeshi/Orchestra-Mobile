# UI改善の外部根拠を収集

UI改善の調査メモ（2026-11-09）

- **文字の読みやすさ:** React Native の `Text` は `allowFontScaling` が既定で有効で、OSの文字サイズ設定に応じた拡大をサポートします。固定高で文字を切らないようにし、大きな文字設定でもレイアウトを確認するのが適用条件です。AppleはDynamic Type等で文字を理想的には200%まで拡大可能にすることを推奨しています。出典: React Native「Text」（2026-10-28更新）https://reactnative.dev/docs/text ／ Apple「Accessibility」（2026-10-24更新）https://developer.apple.com/design/human-interface-guidelines/accessibility
- **配色とコントラスト:** WCAG 2.2 AAは通常の文字に4.5:1、大きな文字に3:1を求めます。Web表示には適合基準として適用し、ネイティブ画面では共通の設計目安として使う場合、プラットフォームの基準と区別して確認してください。色だけで状態を伝えず、文字・アイコン等も併用します。出典: W3C「WCAG 2.2」（2026-10-26更新）https://www.w3.org/TR/WCAG22/ ／ W3C「WCAG2Mobile」（2025-05-06公開、2026-10-02更新）https://www.w3.org/TR/wcag2mobile-22/
- **タップ領域:** AppleのiOS/iPadOSでは44×44 ptを標準サイズ、28×28 ptを最小サイズとして案内しています。MaterialではAndroid等のタッチ対象に48×48 dp以上、対象間に通常8 dp以上の間隔を推奨します。アイコンの見た目の寸法ではなく、操作可能な領域を測り、プラットフォームごとに単位・基準を使い分けます。出典: Apple「Accessibility」（2026-11-06更新）https://developer.apple.com/design/human-interface-guidelines/accessibility.md ／ Google Material「Accessibility」（2026-10-26更新）https://m1.material.io/usability/accessibility.html
- **情報階層:** 重要度に応じて項目を配置し、関連する項目を近くにまとめるのがMaterialの指針です。見出し・余白・文字の強弱で優先順位を伝え、既存機能や操作導線を変えずに整理する場合に適用します。出典: Google Material「Accessibility」https://m1.material.io/usability/accessibility.html
- **状態表示:** Material 3は有効・無効・フォーカス・押下などの状態を一貫して表し、アクセシビリティのため状態を示す視覚的手掛かりを2つ用いるよう案内しています。色に加えてラベルやアイコン等を使い、状態変化を判別できる設計が適用条件です。出典: Google Material 3「States」（2026-11-07更新）https://m3.material.io/foundations/interaction/states/overview
- **Expo/RNの適用:** Expo Imageの公式APIは、スクリーンリーダー向けの`accessibilityLabel`や要素のグループ化に関する`accessible`を記載しています。利用するAPI・プラットフォームにより挙動が異なるため、対象環境で確認してください。出典: Expo「Image」（2026-11-09更新）https://docs.expo.dev/versions/latest/sdk/image/

**前提:** 実際の採用技術・Expo/RNのバージョンおよび対象プラットフォームは未確認です。W3CのCSSピクセル、Appleのpt、Materialのdpは同一視せず、各プラットフォームで検証する必要があります。

この環境ではワークスペースの読み取り・書き込みツールが利用できなかったため、`.division/paper.md` は変更していません。
