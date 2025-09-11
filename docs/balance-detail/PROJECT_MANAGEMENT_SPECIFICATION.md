# Project管理仕様書

## 概要
残高明細画面でのProject（案件）管理の詳細仕様について記載する。

## 1. Project管理の基本概念

### データ構造
```
Dataset (部門×科目×年月)
  └── Project[] (案件一覧)
      └── ProjectEntry[] (仕訳との紐づけ)
          └── Entry (個別仕訳)
```

### Project属性
```typescript
type Project = {
  id: string;           // UUID
  datasetId: string;    // 所属データセット
  name: string;         // 案件名
  orderNo: number;      // 表示順序
  isDeleted: boolean;   // 論理削除フラグ
  createdAt: DateTime;  // 作成日時
  updatedAt: DateTime;  // 更新日時
}
```

## 2. Project作成・更新フロー

### 自動作成（AI分類）

#### 実行条件
```typescript
const existingCount = await prisma.project.count({
  where: { datasetId: ds.id, isDeleted: false },
});

// 既存Projectが0件の場合のみ実行
if (existingCount > 0 && !force) {
  return; // AI分類をスキップ
}
```

#### AI分類プロセス
1. **Entry取得**: `softDeletedAt: null` の有効な仕訳のみ
2. **取引先別グルーピング**: `partnerCode` 単位で摘要を集約
3. **OpenAI API呼び出し**: GPT-4o-mini による案件名生成
4. **Project作成**: 絶対額降順で `orderNo` 設定
5. **ProjectEntry作成**: 仕訳との紐づけ

#### プロンプト設定
```typescript
const systemPrompt = `あなたは会計データのアシスタントです。次の部門×勘定科目の取引先ごとの摘要リストを、案件名（短いラベル）に統合してください。

グループ化方針（抽象化強度=${abstr.toFixed(2)}）: ${guide}

ルール:
- ラベルは10〜18文字程度の日本語
- 括弧は最小限に使用
- 対象スコープ: 部門=${deptCode}, 科目=${subjectCode}`;
```

### 手動作成
現在の実装では、画面上での手動Project作成機能は以下の通り：

1. **既存仕訳からの分離**: `createProjectWithEntry()`
2. **名前変更**: `onEditProjectName()` （フロントエンドのみ）
3. **削除**: `deleteProject()` （未分類への移動）

## 3. Project-Entry紐づけ管理

### ProjectEntryテーブル
```typescript
type ProjectEntry = {
  projectId: string;    // Project ID
  entryId: string;      // Entry ID（ユニーク）
  linkedAt: DateTime;   // 紐づけ日時
}
```

### 重要な制約
- **1つのEntryは1つのProjectにのみ紐づく**
- **Entry削除時は自動的にProjectEntryも無効化**
- **ProjectEntry削除時はEntryは残る**

### 紐づけ更新処理
```typescript
// 既存リンクを削除して新規作成
await prisma.projectEntry.deleteMany({
  where: { entryId: entryId }
});

await prisma.projectEntry.create({
  data: { projectId: newProjectId, entryId: entryId }
});
```

## 4. フロントエンド状態管理

### 画面状態（State）vs DB状態

#### 編集可能な項目
| 項目 | 画面操作 | DB反映 | 永続化方法 |
|------|----------|--------|------------|
| **Project名** | ✅ 編集可能 | ❌ 未実装 | `handlePersist()` （ダミー） |
| **Entry移動** | ✅ D&D可能 | ❌ 未実装 | `handlePersist()` （ダミー） |
| **Project順序** | ✅ D&D可能 | ❌ 未実装 | `handlePersist()` （ダミー） |
| **Project削除** | ✅ 可能 | ❌ 未実装 | `handlePersist()` （ダミー） |

#### 状態同期の問題
```typescript
// 問題のあるパターン
// 1. ユーザーがProject名を変更（画面state）
setProjects(prev => prev.map(p => 
  p.id === id ? { ...p, name: newName } : p
));

// 2. 再アップロード時にサーバーからデータ取得
const serverData = await getBalanceAllAction(form);
setAllStore(serverData); // 元の名前で上書き

// 3. 結果：手動変更が消える
```

### 現在の制限事項
1. **永続化未実装**: `handlePersist()` はconsole.logのみ
2. **状態不整合**: サーバーデータ取得で画面変更が消える
3. **楽観的更新**: DB確認なしの画面更新

## 5. Project削除・復元

### 論理削除方式
```typescript
// 削除
await prisma.project.update({
  where: { id: projectId },
  data: { isDeleted: true }
});

// 取得時の除外
await prisma.project.findMany({
  where: { 
    datasetId: datasetId, 
    isDeleted: false  // 有効なもののみ
  }
});
```

### 削除時の仕訳処理
画面上でProjectを削除する際は：

1. **「未分類」Projectを確保**: `ensureMiscProject()`
2. **仕訳を「未分類」に移動**: Entry自体は保持
3. **ProjectEntryリンクを更新**: 削除ProjectのEntryを未分類に紐づけ直し

```typescript
const deleteProject = (pid: string) => {
  const target = projects.find(p => p.id === pid);
  if (target.entries.length === 0) {
    // 空のProjectは単純削除
    return projects.filter(p => p.id !== pid);
  }
  
  // 仕訳がある場合は未分類に移動
  const miscId = ensureMiscProject();
  return projects.map(p => 
    p.id === miscId 
      ? { ...p, entries: [...p.entries, ...target.entries] }
      : p
  ).filter(p => p.id !== pid);
};
```

## 6. AI分類のフォールバック

### APIキー未設定時
```typescript
if (!apiKey) {
  // 摘要をそのまま案件名として使用
  for (const e of entries) {
    const label = normalize(e.memo);
    // ...グルーピング処理
  }
}
```

### APIエラー時
```typescript
catch (e) {
  console.warn("auto-group openai error", e);
  // フォールバック: メモをそのままラベルに
  const results = [];
  for (const pt of partnerTasks) {
    // 摘要ベースでのフォールバック分類
  }
  return results;
}
```

## 7. パフォーマンス最適化

### 並列処理
```typescript
const PROCESSING = {
  maxParallelScopes: 3  // 同時AI分類数の制限
};

await runLimited(datasets, PROCESSING.maxParallelScopes, async (d) => {
  await ensureAutoGrouping(formData);
});
```

### バッチ処理
```typescript
// Project作成
await prisma.project.createMany({
  data: projectsData,
  skipDuplicates: true
});

// ProjectEntry作成（チャンク単位）
const LINK_CHUNK = 2000;
for (let i = 0; i < entriesData.length; i += LINK_CHUNK) {
  const slice = entriesData.slice(i, i + LINK_CHUNK);
  await prisma.projectEntry.createMany({ 
    data: slice, 
    skipDuplicates: true 
  });
}
```

## 8. デバッグ・ログ

> 2025-09-11 追記: マッチング詳細ログはデフォルトで非出力です。必要時のみ `AUTOGROUP_VERBOSE_LOG=true` を設定してください。

### AI分類ログ
```typescript
logWorkflow(workflowId, 
  `自動グループ化開始: 部門=${deptCode}, 科目=${subjectCode}`
);

logWorkflow(workflowId, 
  `取引先処理完了: 取引先=${partnerName}, グループ数=${localGroups.size}`
);
```

### マッチング詳細
```typescript
logWorkflow(workflowId, 
  `部分一致: ${originalMemo} → ${mappedMemo} (${label})`
);

logWorkflow(workflowId, 
  `取引先${partnerCode}: マッチ${matchedCount}件, 未マッチ${unmatchedCount}件`
);
```

上記「部分一致」「取引先…のマッピング数」「科目…: マッチ/未マッチ」「科目…処理完了」「部門…の全科目処理完了」は `AUTOGROUP_VERBOSE_LOG=true` のときのみ出力されます。

## 9. 今後の改善点

### 必要な機能
1. **永続化API実装**: `handlePersist()` の実装
2. **楽観的排他制御**: 同時編集対応
3. **変更履歴**: Project変更のログ
4. **バリデーション**: Project名の制約
5. **一括操作**: 複数Project操作

### アーキテクチャ改善
1. **Server Actions追加**: Project CRUD操作
2. **リアルタイム同期**: WebSocket/SSE
3. **キャッシュ戦略**: React Query等の導入
4. **型安全性強化**: Zodスキーマ検証
