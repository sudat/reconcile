# /balance-detail 永続化設計（Prisma + Neon/PostgreSQL, schema: "reconcile"）

本ドキュメントは、勘定科目別残高明細（/balance-detail）に関する永続化処理とデータベース設計（Neon/PostgreSQL + Prisma ORM）を定義する。

- 適用範囲: MVP Phase1（PRD: F001, F002, F003, F004, F005, F006）
- 非対象: F007（AI推定）、F008（案件名統一マスタ）詳細実装
- 実装前提: Prisma（multi‑schema対応）、DBスキーマ名は `reconcile`
- 設計方針: YAGNI / DRY / KISS に準拠
  - YAGNI: マスタ類（部門・科目）は当面DBに持たず`code`のみ保持（UIは既存constants参照）。
  - DRY: 前月実績は「複製保存せず」月度横断クエリで結合して表示。
  - KISS: 仕訳の同一性判定はシンプルな指紋キー（row_key）で一意化。洗替はUPSERT + 軟削除で管理。

---

## 1. 用語・前提

- 年月（YM）: `YYYY-MM` 文字列。月度の主キー要素。
- スコープ: `(dept_code, subject_code, ym)` の組。UIの一画面に相当。
- データセット（Dataset）: スコープ単位の入出力・分類の管理単位。
- 案件（Project）: 仕訳を束ねるユーザー定義のグループ。
- 仕訳（Entry）: Excelの明細行。繰越行は読み飛ばし（本画面では不使用）。
- 洗替: 同一スコープ・同一YMの再アップロードで仕訳を差し替え。分類は可能な限り継承。

Neon: PostgreSQL 15系想定。Prisma: 5.x想定（multi‑schema対応）。Excelファイル本体はVercel Blobを使用。

---

## 2. 処理設計（ユースケース別）

### 2.1 アップロード（F001, F005 洗替）

入力: ユーザーがヘッダから対象年月のみを選択後、全社分(全部門×全科目)のExcelを1ファイルでアップロード。

- Step1 取り込み開始:
  - `dataset` をスコープ＋YMで `UPSERT`（未存在なら作成）。状態 `status = processing`。
  - 本ファイルには複数スコープが含まれるため、Excelの各行を `(dept_code, subject_code)` 単位にグルーピング。
  - 各グループ（=スコープ）ごとに `import_job` を作成（ファイル名・サイズ・ハッシュは同一）。
- Step2 Excel → 正規化:
  - 取込対象シート/列をバリデーション。月計行など非対象は除外。
  - 各行から `row_key` を生成して `entry` に `UPSERT`。対象は選択YMの行のみ（`date` が `YYYY-MM` で始まる）。
    - `row_key = sha256(normalize(date, voucher_no, partner_code, memo, debit, credit))`
    - 正規化規則: 全角空白→半角、連続空白圧縮、トリム、NULL→空文字、日付はISO化。
    - 一意制約: `(dataset_id, row_key)`
  - 既存`entry`で今回アップロードに存在しない`row_key`は `soft_deleted_at` にタイムスタンプ設定（論理削除）。
- Step3 分類継承（洗替）:
  - 取り込んだ各 `entry` について、従前の同 `row_key` の `project_entry` があれば再リンク（`project_id`は同一`dataset`内のもの）。
  - マッチしない行は未分類（`project_entry`無）とする。
- Step4 完了:
  - `dataset` を `status = ready` に更新。`entry_count` を更新。

エラーハンドリング: ファイル構造エラーは各グループの `import_job.status = failed` とし、当該 `dataset.status` は `processing` のままにし、後続の再取込で復旧可能とする。

### 2.2 表示（F002 前月統合）

入力: UIから `dept, subject, ym` が指定され「表示」。

- 当月 `dataset` を取得（`status = ready`）。
- 当月 `project` と `project_entry → entry(current)` を取得。
- 前月 `dataset` を同スコープで検索（存在すれば）し、`project` と `entry(prev)` を取得。
- 画面用 `Dataset` に変換:
  - `Project[]`: 前月のみの案件は `entries.month = "prev"` のみで構成。両月に跨るものは別々の `Project` として並列表示（YAGNI）し、UIでトーン差を付与。繰越は扱わない。

性能: 1万件/30秒以内（PRD）。`entry` はYM+スコープで分割されるため1クエリの対象は数千件規模を想定。適切な複合INDEXで対応。

### 2.3 分類操作（F003）

- 新規案件作成: `project` にレコード追加。`order_no` は末尾＋1。
- 仕訳の案件移動（D&D）: `project_entry` を `UPSERT(project_id, entry_id)`。
- 案件名編集: `project.name` 更新。
- 案件削除: `project.is_deleted = true`（論理削除）。配下 `project_entry` は保持（監査性）。UIは非表示。
- 並び替え: `order_no` の一括更新。

整合性: 前月データは読み取りのみ（AI保護要件に抵触しない）。

### 2.4 Excel出力（F004）

- クエリは表示系と同じ集計を使用。案件別 → 当月累計の順で整形（当月のみ）。

---

## 3. テーブル設計（schema: Reconcile）

ERD（文字列表現）:

```
Dataset 1 ──* Project 1 ──* ProjectEntry *── 1 Entry
                 │                              ▲
                 └───────────────(dataset_id)────┘

ImportJob 1 ──* Entry
```

### 3.1 dataset
- 役割: スコープ＋YMの単位。
- カーディナリティ: `(dept_code, subject_code, ym)` は一意。

| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK | 主キー |
| dept_code | text | 部門コード（UIマスタと一致） |
| subject_code | text | 科目コード（UIマスタと一致） |
| ym | text | `YYYY-MM` |
| status | text | `processing`/`ready`/`failed` |
| entry_count | int | 当月有効エントリ件数（論理削除除外） |
| finalized_at | timestamptz? | 前月確定など将来拡張用（YAGNIで未使用） |
| created_at / updated_at | timestamptz | |

制約/Index:
- `UNIQUE (dept_code, subject_code, ym)`
- `INDEX (ym, dept_code, subject_code)`

### 3.2 import_job
- 役割: ファイル取り込みの監査トレイル。

| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK |
| dataset_id | uuid FK(dataset.id) |
| file_name | text |
| file_size | int |
| file_hash | text | 内容ハッシュ（重複検知） |
| status | text | `processing`/`succeeded`/`failed` |
| created_at | timestamptz |

Index: `INDEX(dataset_id, created_at DESC)`

### 3.3 entry
- 役割: 仕訳明細。洗替対応のためUPSERT＋論理削除。
 - 備考: 繰越行は取り込み時にスキップするため格納しない。

| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK |
| dataset_id | uuid FK(dataset.id) |
| row_key | text | 行同一性指紋（normalize後のsha256） |
| date | date | 伝票日付 |
| voucher_no | text | 伝票番号 |
| partner_code | text |
| partner_name | text |
| memo | text |
| debit | bigint | 金額（円, 借方） |
| credit | bigint | 金額（円, 貸方） |
| balance | bigint | Excel由来の残高（任意） |
| soft_deleted_at | timestamptz? | 洗替で消えた行のマーキング |
| import_job_id | uuid FK(import_job.id) | 最終更新元 |
| created_at / updated_at | timestamptz |

制約/Index:
- `UNIQUE (dataset_id, row_key)`
- `INDEX (dataset_id, soft_deleted_at)`
- `INDEX (dataset_id, date, voucher_no)`

### 3.4 project
- 役割: ユーザー定義の案件グルーピング（データセット内で完結）。

| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK |
| dataset_id | uuid FK(dataset.id) |
| name | text |
| order_no | int | 並び順（昇順） |
| is_deleted | boolean | 論理削除 |
| created_at / updated_at | timestamptz |

制約/Index: `INDEX (dataset_id, is_deleted, order_no)`

### 3.5 project_entry
- 役割: 仕訳と案件の1対多リンク（1仕訳は高々1案件）。

| 列 | 型 | 説明 |
|---|---|---|
| project_id | uuid FK(project.id) |
| entry_id | uuid FK(entry.id) |
| linked_at | timestamptz |

制約/Index:
- `PK(project_id, entry_id)`
- `UNIQUE(entry_id)` （1仕訳1案件）
- `INDEX(project_id)`

---

## 4. Prisma モデル（サンプル）

datasource設定（例）:

```prisma
// schema.prisma（抜粋）
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // Prisma 5.x multi‑schema を利用（必要に応じて schemas を宣言）
  schemas  = ["reconcile"]
}

generator client {
  provider = "prisma-client-js"
}
```

モデル定義（例）:

```prisma
model Dataset {
  id                  String   @id @default(uuid())
  deptCode            String
  subjectCode         String
  ym                  String
  status              String
  entryCount          Int      @default(0)
  finalizedAt         DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  projects            Project[]
  entries             Entry[]
  importJobs          ImportJob[]

  @@unique([deptCode, subjectCode, ym])
  @@index([ym, deptCode, subjectCode])
  @@schema("reconcile")
}

model ImportJob {
  id         String   @id @default(uuid())
  datasetId  String
  dataset    Dataset  @relation(fields: [datasetId], references: [id])
  fileName   String
  fileSize   Int
  fileHash   String
  status     String
  createdAt  DateTime @default(now())

  entries    Entry[]
  @@index([datasetId, createdAt])
  @@schema("reconcile")
}

model Entry {
  id             String   @id @default(uuid())
  datasetId      String
  dataset        Dataset  @relation(fields: [datasetId], references: [id])
  rowKey         String
  date           DateTime
  voucherNo      String
  partnerCode    String
  partnerName    String
  memo           String
  debit          BigInt   @default(0)
  credit         BigInt   @default(0)
  balance        BigInt   @default(0)
  isCarryOver    Boolean  @default(false)
  softDeletedAt  DateTime?
  importJobId    String?
  importJob      ImportJob? @relation(fields: [importJobId], references: [id])
  projectLink    ProjectEntry?

  @@unique([datasetId, rowKey])
  @@index([datasetId, softDeletedAt])
  @@index([datasetId, date, voucherNo])
  @@schema("reconcile")
}

model Project {
  id         String   @id @default(uuid())
  datasetId  String
  dataset    Dataset  @relation(fields: [datasetId], references: [id])
  name       String
  orderNo    Int      @default(0)
  isDeleted  Boolean  @default(false)
  entries    ProjectEntry[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([datasetId, isDeleted, orderNo])
  @@schema("reconcile")
}

model ProjectEntry {
  projectId  String
  entryId    String @unique
  linkedAt   DateTime @default(now())

  project    Project @relation(fields: [projectId], references: [id])
  entry      Entry   @relation(fields: [entryId], references: [id])

  @@id([projectId, entryId])
  @@index([projectId])
  @@schema("Reconcile")
}
```

注意:
- BigIntで金額（円）を扱い、浮動小数誤差を排除。
- モデル毎に `@@schema("reconcile")` を付与（Neonのpublicと分離）。
 - multi‑schema利用が難しい場合はDB接続の `search_path=reconcile,public` で代替可能（将来移行可）。

---

## 5. クエリ設計（表示・出力）

- 当月取得:
  - `dataset` → `project(非削除 order_no昇順)` → `project_entry` → `entry(soft_deleted_at IS NULL)`（当月のみ）
- 前月取得（任意・参照用途）:
  - 当月 `ym` の前月を算出し、同スコープの `dataset` を検索。存在時のみ同様に取得し、UI上はトーン差で区別。繰越は算出しない。
- 表示データ変換:
  - `Entry.month = "current" | "prev"` を付与してUIへ返却（DB列には持たない=DRY）。

---

## 6. API/サーバ処理（Server Actions想定）

- `uploadLedgerFile(file, ym)`: 2.1の手順を実施し `datasetId` を返却。
- `getBalanceDetail({dept, subject, ym})`: 2.2に基づくDTO（`Dataset`型相当）を返却。
- `createProject({datasetId, name})`: `Project` 生成。
- `renameProject({projectId, name})`: 案件名更新。
- `reorderProjects({datasetId, orderedIds})`: 並び順を更新。
- `assignEntryToProject({entryId, projectId})`: 仕訳の案件付け替え。
- `deleteProject({projectId})`: 論理削除。

権限/同時実行: 単一ユーザー想定（PRD）。競合は最小。必要時は `updated_at` を用いた楽観ロックで防止。

---

## 7. 洗替仕様の詳細

- 指紋キー `row_key` は「同一仕訳」を判定する主材料。取り込み前後で同一 `row_key` なら分類を継承。
- 取り込み時の振る舞い:
  - 新規 `row_key`: `entry` INSERT。分類なし。
  - 既存 `row_key`: `entry` UPDATE（partner_name/memo/金額の微修正を反映）。分類は保持。
  - 既存で今回ファイルに存在しない `row_key`: `soft_deleted_at` に設定（UI/出力では除外）。
- 分類継承の制約: プロジェクト自体を作り直した場合は継承対象が無くなるため、同名新規でもIDは別物。必要に応じて「既存プロジェクトから再利用」をUIで促す（将来）。

---

## 8. インデックス/性能

- `entry(dataset_id, row_key)` UNIQUE で高速UPSERT。
- `entry(dataset_id, date, voucher_no)` で日付順/伝票番号順の描画を最適化。
- `project(dataset_id, is_deleted, order_no)` で画面並べ替え最適化。
- 1万件×数スコープでもYM分割により1画面処理は数千件規模を想定。

---

## 9. マイグレーション/Neon設定

- 初期化手順（想定）:
  1) Prismaに `schemas = ["Reconcile"]` を設定。
  2) `prisma migrate dev` で `reconcile` スキーマと各テーブルを生成。
  3) 接続文字列に `options=...&statement_timeout=...` を適宜設定（Neon）。
- 既存データなし想定。Rollbackは `prisma migrate reset`（開発環境）。

---

## 10. ログ/監査

- 取り込み毎に `import_job` を記録。
- 分類変更は `project_entry` の更新のみ（監査は最小限）。将来は履歴テーブルを追加（YAGNI）。

---

## 11. 非機能/運用

- バックアップ: Neonの自動スナップショット（運用設定依存）。
- データ保持: 12ヶ月保持（PRD）。古い `dataset` はUIからアーカイブ/削除（将来）。
- セキュリティ: 単一ユーザー＋閉域想定。アプリレベル認証は既存方針に従う。

---

## 12. 適用範囲外/将来拡張

- F007（AI推定）: `entry`/`project` をそのまま特徴量として利用可。推定結果は別テーブルを提案（将来）。
- F008（案件名統一）: `project_master` 等の導入は将来。現状は自由入力。
- クロス月度で同一案件ID維持: MVPでは未対応。必要なら `project_group` を導入。

---

## 13. 実装タスクリスト（参考）

- Prismaモデル追加 + マイグレーション
- Server Actions/API 作成（upload/get/create/rename/reorder/assign/delete）
- Excelパーサ（既存 or 新規実装）から正規化レコード出力
- UI配線（ダミーデータ→API呼び出し置換）
- 出力（Excel）側は既存レンダリングロジックを流用

実装難易度（見積）: **★★☆**
- 修正範囲: DB/サーバ/API/フロントの複数層
- 技術難度: 中（洗替＋指紋キー＋YM横断集計）
- バグ0件で収束見込み: 50%程度（テストデータ整備に依存）

---

## 14. ユーザ受入テスト（UAT）チェックリスト

- アップロード: 同一YM/スコープで複数回アップロードしても分類が継承される
- 洗替: 既存行の一部金額/摘要変更が上書きされ、分類は維持される
- 削除: 2回目アップロードで消えた行がUIに出ない（論理削除有効）
- 前月統合: 前月のみの案件が灰色トーンで表示される（UI要件）
- 並び順: 案件の並べ替えが保持される
- 割当: エントリのD&D移動後に再取得しても割当が反映される
- 出力: 画面と同じ順序・集計でExcel出力される

---

## 15. オープン事項

- 指紋キーの構成要素の最終確定（列の揺れに対する頑健性）
- 当月累計とTBのBS残高の一致条件の明文化（算出基準の合意）
- multi‑schema運用（Prismaのバージョン固定/検証）
