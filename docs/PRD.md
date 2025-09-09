# プロダクト要件定義（全体）

本ファイルは本プロジェクト全体の要件定義の統合ドキュメントです。個別機能のPRDは各機能配下（例: `docs/balance-detail/PRD.md`）にも保持します。

## 1. 共通UI

### 1.1 テナント切替（サイドバー・フッター）
- 目的: どの会社（テナント）のデータを扱うかをユーザーが明示的に切替できるUIを提供する。
- 配置: サイドバーのフッター。
- 実装: `components/common/nav-user.tsx`。
- ステータス: UIのみ（サーバーアクション・永続化なし）。

#### レスポンシブ方針（2025-09-09 再調整）
- `lg` 以下: サイドバーは非表示（モバイル用ドロワーも提供しない）。
- `xl` 以上: サイドバー表示（`variant: inset`）。
- 付随調整: `SidebarInset` の余白・シャドウ適用は `xl:` から有効化。

#### 要件
- 初期表示で選択状態を保持（コンポーネント内の一時状態）。
- プルダウン（ドロップダウン）で候補を一覧表示し、選択中のテナントにチェックを表示。
- トリガー部にはテナントコードのイニシャルをアバター風に表示し、名称とコードを併記する。

#### サンプルデータ
- DM: DM 株式会社
- PRC: PRC 株式会社

#### 受入基準（UI）
- サイドバー下部のトリガーをクリックすると候補（DM/PRC）が表示される。
- いずれかを選択するとトリガー部の表示が即時に選択先へ更新される。
- 再読込すると初期状態（DM）に戻る（本段階では永続化なし）。

#### 非機能
- shadcn/ui（DropdownMenu, Avatar, Sidebar）に準拠し、既存テーマに整合。
- i18n: ラベルは日本語（例: 「テナントを選択」「データ対象: DM」）。

---

更新履歴:
- 2025-09-07: テナント切替UIを追加（MVP: UIのみ）。
 - 2025-09-07: 照合ページ `/reconcile` をタブUI化（TB/GL）。
 - 2025-09-09: サイドバーの表示ブレークポイントを `xl` 以上へ変更（`lg` 以下は非表示）。
 - 2025-09-09: `/balance-detail` の案件名インライン編集で稀に発生した実行時例外（`currentTarget.value` 参照時の `null`）を解消。

## 2. 照合（TB/GL）

### 2.1 目的
- 本支店勘定の照合作業を「試算表ベース（TB）」と「元帳A/B（GL）」で切替できるタブUIを提供する。

### 2.2 画面仕様（/reconcile）
- 上部に下線タブを1列配置。
  - タブ: 「本支店照合TB」「本支店照合GL」
  - 実装: `components/balance-detail/tab-row.tsx` を再利用（DRY）。
- タブ下のメインエリアに選択中タブのUIのみを表示。
  - TB: `components/tb/tb-form.tsx`
  - GL: `components/ledger/ledger-form.tsx`
- 画面横幅: `container mx-auto p-6 max-w-7xl`（`/balance-detail` と合わせる）。
- 初期選択: 「本支店照合TB」。
- TB/GLフォームはCardラッパー非使用（フラット表示）。見出しはテキストのみ（h2相当）で、結果テーブルもCardなし。
 - タブ非表示側のフォームもアンマウントしない（DOMに残す）。表示は `hidden`/`block` で切替し、TBの照合結果などの一時状態を保持する。

### 2.3 非機能/設計方針
- YAGNI: 新規の状態管理やカードの多重表示は行わず、既存フォームをそのままタブに切替表示。
- DRY: 既存の `TabRow` を再利用し、スタイルやアクセシビリティ属性を統一。
- KISS: サーバーアクションはページ（RSC）側で束ね、タブはクライアント小コンポーネントで最小限の `useState` のみ。

### 2.4 受入基準（UI）
- `/reconcile` にアクセスすると、タブ「本支店照合TB/GL」が表示される。
- タブを切替えるとフォームが入れ替わり、同時表示されない。
- 画面左右の余白/最大幅が `/balance-detail` と同等（`max-w-7xl`）。
- キーボード操作でタブ切替ボタンにフォーカスでき、選択状態がARIAに反映される。
- TB/GLともフォームと結果がCardボックスで囲われていない。
 - TBで照合を実行し結果が表示された状態でGLタブに切替→TBタブへ戻った際、TBの結果表示が維持されている。

---

## 3. ログ/監視（全体方針）

- 目的: 端末(Terminal)に出る重要ログと同等レベルを、`log/terminal.log` に恒常保存する。
- 方式: `instrumentation.ts` で起動時に Console をラップし、すべての `console.*` をファイルへミラー。
- DB: Prisma の `query/warn/error` をイベントで受け取り、ファイルへ逐次追記（`lib/prisma.ts`）。
- ワークフロー: ファイルアップロード等の一連処理は `lib/logger.ts#logWorkflow` で `<workflowId>_terminal.log` へも出力（グローバルへもミラー）。
- 出力先: `log/terminal.log`（グローバル）、`log/<workflowId>_terminal.log`（ワークフロー別）。
- 表示形式: `[YYYY-MM-DDTHH:mm:ss.sssZ][xxxxxxxx...] メッセージ`（2番目の[]はワークフローIDの先頭8桁のみ）。

### 3.1.1 日本語ログ文言（2025-09-09 変更）
- 旧: `upload start ym=YYYY-MM size=12345` → 新: `Excel受信開始: 月度=YYYY-MM, サイズ=12345B`
- 旧: `scope start dept=XXXX subject=YYYY rows=10` → 新: `取り込み開始: 部門=XXXX, 科目=YYYY, 対象行数=10`
- 旧: `scope done dept=XXXX subject=YYYY count=10` → 新: `取り込み完了: 部門=XXXX, 科目=YYYY, 取り込み行数=10`
- 旧: `upload done scopes=67` → 新: `Excel取込完了: 対象部門×科目=67件`
- 旧: `autogroup start dept=XXXX subject=YYYY` → 新: `自動グループ化開始: 部門=XXXX, 科目=YYYY`
- 旧: `partner done code=ZZZ groups=N` → 新: `取引先処理完了: 取引先=名称(ZZZ), グループ数=N`
- 旧: `autogroup done ... projects=P links=L` → 新: `自動グループ化完了: 部門=..., 科目=..., 作成案件=P, 紐付け件数=L`
- 旧: `autogroup progress a/b dept=... subject=...` → 新: `自動グループ化 進捗: a/b (X%) 部門=..., 科目=...`

### 3.2 OpenAIトレース（Observability）
- 目的: OpenAIダッシュボードの「Traces」で、1回のアップロードを1つのトレースに階層化して把握できること。
- 実装: サーバー側でトップレベルトレースを開始し（タイトル: `YYYY/MM/DD HH:MM:SS ファイルアップロード`）、配下に
  - `scope <dept>-<subject>`（Custom Span）
  - その配下に `POST /v1/responses`（Response Span; 応答ID連携）
  というツリーを作る。
- 並列実行ポリシー: 並列は「部門×勘定科目（スコープ）」単位のみ。取引先ごとの処理は逐次で行う。
- 入口: `app/actions/upload-and-group.ts#uploadAndGroupAllAction` でトレース開始。
- 受入基準: Traces画面のヘッダーに上記タイトルが表示され、各バッチ呼び出しの所要時間が1つのトレース内で確認できること。

### 3.1 受入基準（ログ）
- アップロード実行時、`log/terminal.log` に Prisma の `prisma:query` 相当行が逐次追記される。
- 同処理の進行ログ（`upload start/done`, `scope start/done` 等）が `log/<workflowId>_terminal.log` と `log/terminal.log` の両方に出力される。
- 例外発生時、エラー内容が `log/terminal.log` と該当ワークフローのログに記録される。

### 3.3 ブラウザ進捗表示（2025-09-09 追加）
- 目的: アップロード後の「自動グループ化 進捗 a/b」をブラウザに%で表示する。
- 方式: `workflowId` をキーにサーバ内メモリに進捗を記録し、`app/actions/progress.ts#getProgressAction` を1秒間隔でポーリング。
- 受入基準:
  - ステータス文言が `[処理中 X%] a/b` の形式で1秒ごとに更新される。
  - 完了後はトースト「取り込みとAI分類が完了しました」を表示し、ステータスは数秒後に消える。

更新履歴:
- 2025-09-09: ログ方針を追加。Console/Prismaのファイルミラーリングを導入。
 - 2025-09-09: ログ文言の日本語化/IDマスキング、進捗ポーリングを追加。

### 3.4 アップロード後の自動表示・一括取得（2025-09-09 変更）
- 目的: 月度単位で1回のサーバー呼び出しに集約し、ネットワーク/サーバ負荷を低減。
- 仕様:
  - `getBalanceAllAction(ym, autogroup)` を1回呼び出し、当該年月の全スコープの「projects / links / entries」を一括取得。
  - クライアントは取得結果を保持し、部門/科目タブに応じて部分表示へ整形する。
  - `autogroup=true` の場合、当該月でプロジェクト未生成のスコープに限り初回グルーピングをサーバ内で実行してから返却。
- 受入基準:
  - 表示やアップロード完了後の表示において、ネットワークリクエストが1回で完了している。
  - タブ切替時はサーバー通信が発生しない（クライアント整形のみ）。
