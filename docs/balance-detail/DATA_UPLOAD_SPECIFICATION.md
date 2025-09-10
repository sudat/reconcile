# データアップロード仕様書

## 概要
残高明細画面でのExcelファイルアップロード処理の詳細仕様について記載する。

## 処理フロー

### 1. アップロード全体フロー
```
ユーザー操作 → upload-and-group.ts → balance-upload.ts → project-autogroup.ts
```

1. **`upload-and-group.ts`**: オーケストレーション
2. **`balance-upload.ts`**: Excelファイルの解析・DB永続化
3. **`project-autogroup.ts`**: AI による案件自動分類

### 2. Entryデータ処理（洗替え処理）

#### ハッシュベースの最適化処理

**rowKey生成ロジック**：
```typescript
function rowKeyOf(x: {
  date: string;
  voucherNo: string;
  partnerCode: string;
  memo: string;
  debit: number;
  credit: number;
}): string {
  const norm = [x.date, x.voucherNo, x.partnerCode, x.memo, x.debit, x.credit]
    .map((v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : String(v)))
    .join("|");
  return createHash("sha256").update(norm).digest("hex");
}
```

#### 処理分類

| 分類 | 条件 | 処理 | Entry ID |
|------|------|------|----------|
| **新規** | rowKeyが既存DBに存在しない | `Entry.createMany()` | 新規生成 |
| **更新** | rowKeyが既存DBに存在 | `Entry.update()` | **既存ID保持** |
| **削除** | DBに存在するが今回ファイルに無い | `softDeletedAt` 設定 | 既存ID保持 |

#### 重要な特徴

- **同一仕訳は同一Entry IDを保持**
- **ProjectEntryリンクは維持される**
- **物理削除ではなく論理削除**（`softDeletedAt`）

## 3. Project処理（自動分類）

### 既存Project保護ロジック
```typescript
const existingCount = await prisma.project.count({
  where: { datasetId: ds.id, isDeleted: false },
});
if (existingCount > 0 && !force)
  return { ok: true, result: { created: 0, projects: [] } };
```

#### 動作パターン

| 状況 | forceフラグ | 動作 |
|------|-------------|------|
| **初回アップロード** | N/A | AI分類実行、Project作成 |
| **2回目アップロード** | false（デフォルト） | **AI分類スキップ** |
| **2回目アップロード** | true | AI分類再実行、Project再作成 |

### AI分類処理

1. **取引先×摘要の組み合わせ**でグルーピング
2. **OpenAI GPT-4o-mini**による案件名生成
3. **絶対額降順**でProject作成
4. **ProjectEntryリンク**作成

## 4. よくある誤解

### Q: 同じファイルを2回アップロードするとProjectが削除される？
**A: いいえ**

- **Entryは最適化処理**（同一rowKeyは更新のみ）
- **Projectは保護される**（既存があるとAI分類スキップ）
- **ProjectEntryリンクも維持**

### Q: なぜ手動変更したProject名が元に戻る？
**A: フロントエンド側の未保存変更のため**

1. **Project名の手動変更**: フロントエンドstateのみ（DB未保存）
2. **再アップロード**: サーバーからデータ再取得
3. **結果**: 元のAI分類名が復活（DBの内容が正）

## 5. データベーススキーマ

### 関連テーブル
```
Dataset (1) ----< Entry (*)
   |                 |
   |                 | (1)
   |                 |
   +----< Project    ProjectEntry
          (*)        (*) ----< (*)
```

### 重要な制約
- `Entry.rowKey`: データセット内でユニーク
- `ProjectEntry`: Entry ID ベースのリンク（Entry削除で無効化）
- `Project.isDeleted`: 論理削除フラグ

## 6. 設定・定数

### 処理制限
- `PROCESSING.maxParallelScopes`: 並列処理数
- `CREATE_CHUNK: 1000`: Entry作成チャンクサイズ
- `UPSERT_CHUNK: 500`: Entry更新チャンクサイズ
- `LINK_CHUNK: 2000`: ProjectEntry作成チャンクサイズ

### AI設定
- `AI_GROUPING.model`: 使用モデル（デフォルト: "gpt-4o-mini"）
- `AI_GROUPING.abstraction`: 抽象化レベル（0-1）

## 7. エラーハンドリング

### よくあるエラー
1. **Excel形式不正**: 必要カラムの不足
2. **年月不一致**: 指定年月とファイル内容の齟齬
3. **APIキー未設定**: OpenAI API未設定時（フォールバック: 摘要そのまま）
4. **タイムアウト**: 大量データ処理時（5分制限）

### ログ出力
- `logWorkflow()`: 進捗・エラーログ
- `setProgress()`: ブラウザ側進捗表示用

## 8. パフォーマンス考慮

### 最適化ポイント
- **チャンク処理**: 大量データ対応
- **並列処理**: スコープ単位の並列AI分類
- **ハッシュキャッシュ**: 重複処理の回避
- **トランザクション**: 整合性保証

### 処理時間目安
- **小規模**（1000件以下）: 30秒以内
- **中規模**（1000-10000件）: 1-3分
- **大規模**（10000件以上）: 3-5分（制限時間内）