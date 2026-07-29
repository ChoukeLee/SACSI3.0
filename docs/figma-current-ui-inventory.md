# SACSI Current UI Inventory For Figma Rebuild

## 目标

这份文档记录当前系统已有 UI 结构、主要问题和 Figma 重构时的替换目标。它用于连接“现有代码页面”和“新的 Figma 设计系统”。

## 当前已有共享组件

| 组件 | 当前文件 | Figma 目标 |
|---|---|---|
| Button | `src/components/ui/button.tsx` | `Control/Button` |
| Input | `src/components/ui/input.tsx` | `Control/Input` |
| SearchInput | `src/components/ui/search-input.tsx` | `Control/SearchInput` |
| DateInput | `src/components/ui/date-input.tsx` | `Control/DateInput` |
| StatTile | `src/components/ui/operational.tsx` | `Data/StatCard` |
| SegmentedControl | `src/components/ui/operational.tsx` | `Control/SegmentedControl` |
| FilterBar | `src/components/ui/operational.tsx` | `Layout/FilterBar` |
| BusinessTable | `src/components/ui/business-table.tsx` | `Data/Table` |
| DataVizCard | `src/components/ui/data-viz.tsx` | `Data/ChartCard` |
| Sheet | `src/components/ui/sheet.tsx` | `Overlay/RightDrawer` |
| RoomCard | `src/components/room-card.tsx` | `Business/RoomCard` |
| StatusBadge | `src/components/status-badge.tsx` | `Business/StatusBadge` |
| PageHeader | `src/components/page-header.tsx` | `Layout/PageHeader` |
| AppSidebar | `src/components/app-sidebar.tsx` | `App/Sidebar` |
| AppShell | `src/components/app-shell.tsx` | `App/Shell` |

## 当前页面入口模式

多数核心页面已经采用：

- 权限校验在 `page.tsx`
- 数据查询在 async data component
- 页面交互在 lazy view 或 feature view
- 使用 `Suspense` 显示骨架屏

代表页面：

- `src/app/daily-rentals/page.tsx`
- `src/app/leases/page.tsx`
- `src/app/sales/page.tsx`
- `src/app/finance/page.tsx`
- `src/app/customers/page.tsx`
- `src/app/units/page.tsx`

Figma 重构时应保留这种结构，不需要推倒。

## 页面族盘点

### 日租业务

主要文件：

- `src/app/daily-rentals/page.tsx`
- `src/app/daily-rentals/daily-rental-data.tsx`
- `src/features/daily-rentals/daily-rentals-responsive-view.tsx`
- `src/features/daily-rentals/calendar.tsx`
- `src/features/daily-rentals/booking-panel.tsx`

当前优点：

- 页面响应已经大幅优化。
- 日历是主工作区。
- 支持复杂日租业务状态。
- 业务操作已经接近“前端即时响应 + 后台同步”模式。

当前问题：

- 日租业务状态复杂，容易出现视觉信息过载。
- 订单条、维修条、清洁条需要更明确的信息层级。
- 侧栏操作区仍有继续统一空间。
- 部分财务状态和入住状态容易混在一起。

Figma 目标：

- 重新设计日租日历密度。
- 明确订单条结构。
- 统一订单详情、新建入住、欠款明细、本月结算抽屉。
- 保留高响应操作模式。

### 长租业务

主要文件：

- `src/app/leases/page.tsx`
- `src/features/leases/lease-lazy-view.tsx`
- `src/features/leases/lease-list.tsx`
- `src/features/leases/actions.ts`

当前优点：

- 楼栋切换已经存在。
- KPI 卡片已经支持点击打开明细抽屉。
- 15天内应缴、待收未逾期、逾期金额的业务区分已经开始形成。
- 合同卡片按楼层分组。

当前问题：

- `lease-list.tsx` 过大，页面逻辑、表单、抽屉、卡片混在一起。
- 合同卡片底部按钮和内容容易互相挤压。
- 抽屉结构仍是局部实现，没有完全组件化。

Figma 目标：

- 把长租作为合同业务的基准模板。
- 定义 `ContractCard`。
- 定义 `KPI + Drawer` 交互标准。
- 定义收款、续租、退租抽屉。

### 出售业务

主要文件：

- `src/app/sales/page.tsx`
- `src/features/sales/sale-lazy-view.tsx`
- `src/features/sales/sale-list.tsx`
- `src/features/sales/actions.ts`

当前优点：

- 已开始向长租 KPI 交互靠拢。
- 支持楼栋维度统计。
- 支持出售合同、付款计划、过户状态。

当前问题：

- 存在明显编码乱码。
- 出售和长租还没有共享合同卡片组件。
- 付款计划、回款、过户状态的视觉层级还不够稳定。

Figma 目标：

- 与长租共享合同业务页面结构。
- 重新定义出售独有字段展示。
- 清理所有乱码和中英混杂直出。

### 房源总览

主要文件：

- `src/app/units/page.tsx`
- `src/features/units/unit-lazy-view.tsx`
- `src/features/units/unit-list.tsx`
- `src/components/room-card.tsx`
- `src/components/room-board.tsx`

当前优点：

- 房源卡片和状态色已经形成业务记忆。
- 支持楼栋、楼层、状态筛选。
- 支持特殊房源信息逐步录入。

当前问题：

- 特殊资产表达还不够系统，比如整层办公室、大平层、可分割楼层。
- 某些楼栋会显示无意义的 0 状态筛选。
- 楼层和楼栋筛选需要更稳定的视觉层级。

Figma 目标：

- 房源卡片保留业务识别度，但重新统一布局。
- 设计特殊资产卡片。
- 设计房源详情抽屉。
- 状态筛选按当前楼栋动态收敛。

### 财务

主要文件：

- `src/app/finance/page.tsx`
- `src/features/finance/finance-lazy-view.tsx`
- `src/features/finance/finance-tabs.tsx`
- `src/features/finance/ledger-list.tsx`
- `src/features/finance/receivable-list.tsx`
- `src/features/finance/receipt-upload.tsx`

当前优点：

- 强制动态读取，适合财务实时性。
- 已有 `BusinessTable` 和 `DataVizCard`。
- 应收、流水、收据开始分区。

当前问题：

- 表格宽度和抽屉宽度曾多次出现裁切。
- 财务备注、房号、来源需要更强的展示规则。
- 历史英文说明需要中文化或通过映射展示。

Figma 目标：

- 设计高密度财务表格。
- 设计欠款明细、收款详情宽抽屉。
- 明确金额列、状态列、备注列规则。

### 客户档案

主要文件：

- `src/app/customers/page.tsx`
- `src/features/customers/customer-lazy-view.tsx`
- `src/features/customers/customer-list.tsx`
- `src/features/customers/customer-profile-view.tsx`

当前优点：

- 已按业务类型统计客户。
- 已支持客户楼栋归属。
- 支持客户详情。

当前问题：

- 客户卡片和筛选区域仍需与房源、合同页面统一。
- 搜索框、分段控件、楼栋筛选需要作为通用模板处理。

Figma 目标：

- 设计客户记录管理模板。
- 统一客户卡片。
- 定义多业务客户、黑名单、资料待补展示。

### 管理驾驶舱

主要文件：

- `src/app/management/page.tsx`
- `src/app/management/management-page-shell.tsx`
- `src/features/management/management-dashboard.tsx`
- `src/features/management/kpi-service.ts`

当前优点：

- 已有管理视角数据聚合。
- 已开始使用图表和风险信息。

当前问题：

- 首页需要从“数据堆叠”升级为“经营判断入口”。
- 风险、收款、房态、楼栋对比的层级需要重新设计。

Figma 目标：

- 设计真正的管理驾驶舱。
- KPI 可点击进入明细。
- 风险优先于普通统计。

### 审计日志

主要文件：

- `src/app/settings/audit-logs/page.tsx`
- `src/features/settings/audit-log-viewer.tsx`
- `src/features/settings/audit-log-enrichment.ts`

当前优点：

- 已开始修复操作人显示。
- 审计表格能展示操作、对象、摘要。

当前问题：

- 历史记录仍可能出现短 id 或英文摘要。
- 审计详情需要更好地承载 metadata。

Figma 目标：

- 设计审计日志表格和详情抽屉。
- 操作人、操作类型、对象、摘要一眼可读。

## 代码层风险

### 大文件风险

以下文件已经比较大，后续 Figma 落地时应考虑拆分：

- `src/features/leases/lease-list.tsx`
- `src/features/sales/sale-list.tsx`
- `src/features/daily-rentals/calendar.tsx`
- `src/features/daily-rentals/booking-panel.tsx`

### 重复样式风险

需要重点清理：

- feature 文件内手写按钮 class。
- feature 文件内手写侧栏结构。
- 合同卡片重复实现。
- 财务表格局部列宽 hack。
- 文案直接写在组件内导致中法不统一。

## Figma 优先验证点

第一批设计稿必须验证：

- 日租日历是否仍然高效。
- 长租和出售能否共用同一合同页面语言。
- 财务宽表是否完整显示。
- 房源卡片是否能承载特殊资产。
- 侧栏是否解决详情和操作，而不是制造遮挡。

## 结论

当前系统已经具备重构基础，不需要推翻业务结构。Figma 应该承担视觉系统和页面模板的重新定义，代码落地时则以共享组件替换局部样式为主。
