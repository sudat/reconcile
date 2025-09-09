# Balance Detail UI Components (2025-09-09)

目的: `/balance-detail` の可読性・保守性を高めるため、主要 UI を小さな責務に分割する。

## コンポーネント一覧

- app/balance-detail/page.tsx
  - 画面状態のオーケストレーション（部門/科目/年月、`projects`、展開状態）。
  - 保存・一括展開トグルの制御。
  - テーブル関連の更新ロジック（移動/並び替え/新規/削除/改名）をコールバックとして `ProjectsTable` に提供。

- components/balance-detail/projects-table.tsx
  - テーブル本体。ヘッダー、案件行、明細行、当月累計を描画。
  - D&D（案件行/仕訳行）と右クリックメニュー、案件名のインライン編集の一時UI状態を内包。
  - Props:
    - `shownYm: string | null`, `hasMatch: boolean`
    - `projects: Project[]`, `expanded: Record<string, boolean>`
    - `onToggleProject(id)`, `onMoveEntry(entryId, fromId, toId)`, `onReorderProjects(dragId, overId, place)`
    - `onEditProjectName(id, name)`, `onCreateProjectWithEntry(entry, fromProjectId)`, `onDeleteProject(projectId)`

- components/balance-detail/context-menu.tsx
  - 汎用オーバーレイ型コンテキストメニュー。
  - Props: `{ x, y, onClose, items? }` or `children`。

## 設計上のポイント

- YAGNI: 汎用D&Dライブラリの導入は見送り。HTML5 DnDの最小実装で対応。
- DRY: 金額/日付表示は `@/lib/format` を直接利用。列構成は `ProjectsTable` に集約。
- KISS: `ProjectsTable` が UI の複雑さを吸収し、Page は配列更新ロジックに専念。

## 受入確認（UI観点）

- レイアウトと見た目が分割前と変わらないこと。
- D&D と右クリックメニュー、案件名編集が機能すること。
- Page で「保存」「全案件トグル」が従来通り動作すること。

