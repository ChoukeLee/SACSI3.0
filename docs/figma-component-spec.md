# SACSI Figma Component Spec

## 用途

这份文档用于指导 Figma 组件库设计。它不要求沿用当前代码里的视觉规则，但要求未来代码实现能一一映射到组件，避免页面再次变成局部样式堆叠。

## 组件命名

建议 Figma 组件按以下结构命名：

- `App/Topbar`
- `App/Sidebar`
- `Layout/PageHeader`
- `Layout/Toolbar`
- `Control/Button`
- `Control/IconButton`
- `Control/SegmentedControl`
- `Control/Input`
- `Control/Select`
- `Control/DateInput`
- `Control/Textarea`
- `Feedback/Toast`
- `Feedback/Skeleton`
- `Feedback/EmptyState`
- `Feedback/ErrorState`
- `Data/StatCard`
- `Data/Table`
- `Data/FinanceTable`
- `Data/DonutCard`
- `Data/StatusLegend`
- `Business/RoomCard`
- `Business/DailyBookingBar`
- `Business/ContractCard`
- `Business/PaymentSummary`
- `Overlay/RightDrawer`
- `Overlay/TableDrawer`
- `Overlay/ConfirmDialog`

## 全局框架

### Topbar

目标：作为系统工具栏，不抢业务内容注意力。

需要状态：

- 默认
- 搜索/扫描按钮悬停
- 通知有未读
- 用户菜单打开
- 移动端收起

内容：

- 侧栏展开/收起
- 收据扫描
- 通知
- 语言切换
- 当前用户
- 退出

验收：

- 高度稳定。
- 所有按钮同一尺寸。
- 不出现某个按钮比业务主按钮更显眼。

### Sidebar

目标：稳定导航，当前页面清楚，分组不臃肿。

需要状态：

- 展开
- 收起
- 当前页面
- 悬停
- 移动端抽屉

验收：

- 当前页面一眼可见。
- 分组标题不抢眼。
- logo 区域不变形。

## 控件

### Button

变体：

- Primary：主业务动作。
- Secondary：次要动作。
- Ghost：轻量操作。
- Danger：取消、删除、作废。
- Success：只用于短暂完成反馈，不作为常规主按钮。

尺寸：

- 主要按钮：40px 高。
- 工具栏按钮：36px 高。
- 小按钮：32px 高。

状态：

- Default
- Hover
- Pressed
- Disabled
- Loading
- Success feedback

验收：

- 同一工具栏内按钮高度一致。
- Danger 不与普通按钮混在一起。
- Loading 不改变按钮宽度。

### IconButton

用途：

- 查看
- 收款
- 单据
- 编辑
- 打印
- 关闭
- 更多

状态：

- Default
- Hover
- Active
- Disabled

验收：

- 固定正方形。
- 图标大小一致。
- 必须有 tooltip 文案。

### SegmentedControl

用途：

- 楼栋切换
- 状态切换
- tab 切换
- 日/周/月切换

状态：

- Default
- Selected
- Hover
- Disabled
- With count

验收：

- 不像主按钮。
- 激活项清楚但不臃肿。
- 文案较长时不撑满整行。

### Input / Select / DateInput / Textarea

状态：

- Default
- Focus
- Disabled
- Error
- Filled

验收：

- 高度、圆角、边框一致。
- Textarea 默认不显示滚动条拖拽痕迹。
- 搜索框和普通输入框属于同一视觉家族。

## 数据组件

### StatCard

用途：

- 页面 KPI
- 可点击钻取
- 财务金额摘要
- 风险计数

结构：

- 标题
- 主数值
- 辅助说明
- 状态点或图标
- 可选趋势

状态：

- Default
- Hover
- Selected
- Empty
- Loading

验收：

- 所有 KPI 卡片使用同一种信息结构。
- 金额、数量、比例有不同但协调的数字层级。
- 点击后打开侧栏，而不是只做筛选高亮。

### Table

用途：

- 财务流水
- 应收列表
- 欠款明细
- 审计日志
- 合同付款记录

结构：

- 表头
- 数据行
- 金额列
- 状态列
- 备注列
- 操作列
- 分页

状态：

- Default
- Hover row
- Selected row
- Empty
- Loading
- Error

验收：

- 金额右对齐。
- 房号、客户、日期不被挤没。
- 备注截断后可进入详情查看。
- 表格横向滚动时不能把侧栏内容推偏。

### FinanceTable

在普通 Table 基础上增加：

- 收入绿色
- 欠款或逾期红色
- 中性金额黑色
- 已付清状态弱化
- 未收金额突出

验收：

- “待收未逾期”和“逾期金额”视觉含义不同。
- 0 欠款不能显示成红色风险。

## 业务组件

### RoomCard

用途：

- 房源总览
- 长租房间卡片
- 出售房间卡片
- 特殊资产卡片

状态：

- 空闲
- 日租中
- 已预订
- 长租中
- 已售
- 待清洁
- 维修
- 自用
- 锁定

结构：

- 房号
- 状态
- 客户或用途
- 日期或收款摘要
- 主要操作按钮

特殊规则：

- 整层自用办公室可以是一个卡片，不强制拆成 801、802、803、804、805。
- 前楼/后楼、大平层、可分割房间需要能在详情里解释。

验收：

- 状态颜色一眼可区分。
- 按钮居中且间距稳定。
- 长客户名不挤压底部按钮。

### DailyBookingBar

用途：日租日历中的入住/预订/维修/清洁条。

状态：

- 已预订未入住未付款
- 已预订未入住已付款
- 已入住未付款
- 已入住已付款
- 非固定离店
- 已退房待清洁
- 维修

验收：

- 条内必须显示客户名或状态核心文字。
- 维修、清洁这类无客户状态不能空白。
- 付款状态和入住状态同时可读。

### ContractCard

用途：

- 长租合同
- 出售合同

结构：

- 房号
- 客户
- 合同状态
- 收款状态
- 起止日期或签约日期
- 金额摘要
- 操作按钮

验收：

- 长租和出售可以有差异，但不能像两个系统。
- 欠款、逾期、资料待补必须有明确徽章。
- 底部按钮不遮挡内容。

## 侧栏

### RightDrawer

用途：

- 订单详情
- 合同详情
- 房间详情
- 收款操作
- KPI 明细

结构：

- 固定头部
- 标题
- 副标题
- 关闭按钮
- 内容区
- 可选固定底部操作区

尺寸：

- 常规详情：480px
- 表格明细：720px - 960px
- 复杂财务明细：尽量接近页面右侧大抽屉，但不能覆盖侧边导航

验收：

- 右侧、顶部、底部贴合正确。
- 不出现灰色空隙。
- 表格内容完整显示，不被裁掉。
- 关闭按钮位置稳定。

### TableDrawer

用途：

- 当前欠款明细
- 本月结算明细
- KPI 点击后的合同/收款列表

验收：

- 适合宽表。
- 如果列太多，优先调整列宽和内容截断，不把抽屉拉到页面最左。
- 表头、统计条、表格边界对齐。

## 页面级组件组合

### KPI + Drawer Pattern

适用页面：

- 长租
- 出售
- 财务
- 管理驾驶舱
- 房源总览

交互：

1. 点击 KPI 卡片。
2. 卡片进入 selected 状态。
3. 右侧打开对应明细抽屉。
4. 抽屉关闭后取消 selected。

验收：

- 所有页面行为一致。
- KPI 不只是过滤，还能解释数字来源。

### Filter + List Pattern

适用页面：

- 房源
- 客户
- 长租
- 出售
- 财务

交互：

1. 筛选即时响应。
2. 列表局部变化。
3. 页面不跳顶。
4. 筛选结果数量更新。

验收：

- 楼栋切换影响所有下游统计。
- 无意义的 0 状态筛选可以隐藏。

### Operation Drawer Pattern

适用页面：

- 日租
- 长租
- 出售
- 财务

交互：

1. 点击业务动作。
2. 立即打开/关闭对应侧栏或按钮进入 loading。
3. 前端即时反馈。
4. 后台同步成功后更新数据。
5. 失败时明确回滚和提示。

验收：

- 不使用丑陋横幅占位。
- 不因 `router.refresh()` 造成整页跳顶。

## Figma 到代码映射

| Figma 组件 | 当前代码目标 |
|---|---|
| `Control/Button` | `src/components/ui/button.tsx` |
| `Control/SegmentedControl` | `src/components/ui/operational.tsx` |
| `Data/StatCard` | `StatTile` |
| `Data/Table` | `BusinessTable` |
| `Data/DonutCard` | `DataVizCard` |
| `Business/RoomCard` | `src/components/room-card.tsx` |
| `Overlay/RightDrawer` | `Sheet` 或新的统一 Drawer |
| `Business/DailyBookingBar` | `src/features/daily-rentals/calendar.tsx` |
| `Business/ContractCard` | 长租/出售列表组件 |

## 第一批 Figma 页面建议

1. 日租业务页 desktop。
2. 日租订单详情抽屉。
3. 长租合同页 desktop。
4. 长租 KPI 明细抽屉。
5. 出售合同页 desktop。
6. 房源总览页 desktop。
7. 财务应收页 desktop。

这七张图足够决定系统 80% 的视觉方向。
