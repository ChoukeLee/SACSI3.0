# SACSI Figma Rebuild Index

## 文档入口

这组文档用于 SACSI 3.0 的 Figma UI 重构。新方向允许抛开旧视觉规则，但保留现有业务逻辑、财务同步、审计日志和数据库结构。

## Figma 文件

- [SACSI 3.0 UI Rebuild](https://www.figma.com/design/c9jf61ND56VSs9tqUED1ms)

## 阅读顺序

1. [Figma UI Rebuild Brief](./figma-ui-rebuild-brief.md)
2. [Figma Component Spec](./figma-component-spec.md)
3. [Figma Page Blueprints](./figma-page-blueprints.md)
4. [Current UI Inventory](./figma-current-ui-inventory.md)
5. [Figma Rebuild Workflow](./figma-rebuild-workflow.md)
6. [Figma Rebuild Task Plan](./figma-rebuild-task-plan.md)
7. [Figma To Code Migration Checklist](./figma-to-code-migration-checklist.md)
8. [Figma Generation Prompt](./figma-generation-prompt.md)
9. [Figma Rebuild Progress](./figma-rebuild-progress.md)

## 每份文档的作用

### `figma-ui-rebuild-brief.md`

定义为什么重构、重构边界、用户角色、页面优先级和验收标准。

适合：

- 开始项目时阅读。
- 和设计师或 AI 工具说明系统背景。
- 判断设计是否偏离业务。

### `figma-component-spec.md`

定义 Figma 组件库应该包含哪些组件，每个组件有哪些状态和验收标准。

适合：

- 建立 Figma components。
- 未来代码组件映射。
- 避免按钮、表格、卡片、抽屉继续分裂。

### `figma-page-blueprints.md`

定义核心页面应该怎么组织，包括日租、房源、长租、出售、财务、客户、管理驾驶舱和审计日志。

适合：

- 画页面样板。
- 做页面验收。
- 判断某个页面是否缺少关键业务状态。

### `figma-current-ui-inventory.md`

记录当前代码中已有 UI 结构、页面族、共享组件、主要问题和 Figma 替换目标。

适合：

- 开始画设计前理解现有系统。
- 判断哪些旧组件应该保留业务结构。
- 后续代码落地时确定替换顺序。

### `figma-rebuild-workflow.md`

定义从创建 Figma 文件到代码落地的完整流程。

适合：

- 排工作节奏。
- 控制不要一口气画太多页面。
- 决定什么时候开始改代码。

### `figma-rebuild-task-plan.md`

把重构拆成可执行任务。

适合：

- 项目跟踪。
- 阶段验收。
- 后续创建 issue 或任务列表。

### `figma-to-code-migration-checklist.md`

定义 Figma 设计通过后如何迁移到代码，包括共享组件顺序、页面族顺序、业务回归和验证命令。

适合：

- 设计稿定稿后开始改代码。
- 防止按截图局部修补。
- 每个页面族迁移前后做验收。

### `figma-generation-prompt.md`

可以直接复制给 Figma AI、设计师或其他 UI 生成工具。

适合：

- 快速生成第一版设计稿。
- 按页面拆分给不同工具。
- 和外部设计协作。

## 当前建议下一步

### 方案 A：先在 Figma 画

1. 创建 `SACSI 3.0 UI Rebuild` 文件。
2. 按 `figma-rebuild-workflow.md` 创建页面结构。
3. 用 `figma-generation-prompt.md` 生成或手动画 Foundations。
4. 做第一批组件库。
5. 先画日租、长租、出售三张 desktop 样板。

### 方案 B：先在代码里准备

1. 清理出售页乱码。
2. 统一长租和出售 KPI 抽屉结构。
3. 抽出 `ContractCard`。
4. 抽出统一 `RightDrawer` / `TableDrawer`。
5. 等 Figma 设计回来后再替换视觉样式。

### 推荐

优先选择方案 A。

原因：当前代码已经有大量业务细节，如果继续直接在代码里改视觉，很容易继续产生局部补丁。先用 Figma 定义组件和页面样板，再回到代码，会更稳。

## 第一轮最小目标

第一轮 Figma 只做：

1. Foundations
2. Button / SegmentedControl / Input / StatCard / Table / Drawer / RoomCard / ContractCard
3. 日租业务页
4. 长租合同页
5. 出售合同页

第一轮不做：

- 全部移动端细节。
- 所有设置页。
- 导入导出页。
- 打印单据页。
- 大规模代码重构。

## 代码落地原则

当 Figma 第一轮通过后，代码落地顺序应为：

1. 共享 UI 组件。
2. 日租页面。
3. 长租页面。
4. 出售页面。
5. 房源页面。
6. 财务页面。

不要按截图局部修补。每次改页面前，先确认是否应该改共享组件。
