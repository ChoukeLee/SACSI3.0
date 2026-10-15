# SACSI 3.0 系统架构

更新时间：2026-10-15（当前代码架构；本轮发布状态以提交、迁移、部署和实际页面核验为准）

当前采用按业务域组织的模块化单体，保留既有认证事务、权限及外部录入连接器。本轮在此基础上统一项目经营首页、合同列表、档案、质量核验和统计读模型，不重建日租日历，不把日租当作公司的经营核心。此次修改和验收清单见 [整体界面与读模型更新](PRODUCT_RENEWAL.md)。

[架构整改验收](ARCHITECTURE_EXECUTION.md) 是此前整改的历史记录，其中日期、发布门禁和待核对笔数不应直接当作当前线上状态。代码实现、自动测试、线上发布、员工业务验收是四个独立状态。

最新本地灾备快照、真实Auth/Storage恢复核验和D盘交付见 [灾备验收](DISASTER_RECOVERY.md)。不启用新的线上定时任务；独立密钥保管不等于把密钥与备份一起复制到同一硬盘。

## 1. 产品边界

SACSI 采用单租户、独立部署模式：每个客户拥有独立的 Vercel 应用、Supabase 项目和数据库。当前代码服务于科建地产的多项目、多楼栋业务，不预设共享数据库的多租户模型。

系统是业务经营台账，不是完整会计 ERP。核心范围是房源、日租、长租、出售、客户、应收、真实资金流水、经营汇总和审计。

## 2. 应用分层

```text
Next.js App Router
├─ Server Components：鉴权、页面级查询、首屏数据
├─ Client Components：筛选、表格、日历、侧栏和确认交互
├─ Server Actions / Route Handlers：输入校验和业务入口
├─ Business Actions：动作目录、风险等级、角色边界和 AI 草稿
└─ Supabase
   ├─ Auth / RLS
   ├─ PostgreSQL 表与约束
   ├─ 原子 RPC 与幂等请求
   ├─ Storage 私有凭证
   └─ Audit Logs / 凭证与动作证据
```

读取通常使用当前登录会话的 Supabase 服务端客户端。需要跨多表原子写入的操作通过 Server Action 调用数据库 RPC；手工记账、出售分期/终止、日租补录与财务修复已进一步收拢到认证事务，见 [剩余财务入口收拢](REMAINING_FINANCE_TRANSACTIONS.md)。这一范围之外的特权客户端和传统页面仍须按用途分别审查。

当前模块边界：日租 `calendar.tsx` 管理交互状态，`calendar-model.ts` 处理纯计算，`calendar-view-parts.tsx` / `calendar-finance-panel.tsx` 负责展示；订单提示在 `booking-presentation.ts`。长租 `actions.ts` 是兼容入口，合同、收款、退租分别在 `lease-*-actions.ts`；建约、激活、终止、结算及应收维护已收拢到认证 RPC 事务中，不再由服务端逐表写入（见 [长租事务化](LEASE_ATOMIC_TRANSACTIONS.md)）。预订操作的标签、动作对应关系和风险等级由 `booking-operation-contract.ts` 共享；它不是授权引擎，最终授权仍在服务端和数据库。

读取按语义分层，而非让每个页面各自算一套金额：

- `features/management`：同一数据库快照的项目经营汇总、趋势、关注事项。
- `features/contracts`：合同表格、搜索排序、已核应收余额和经营现金的独立展示模型；长租/出售默认列表，保留楼层视图。
- `features/daily-rentals/receipt-*`：日租收款、真实退款、纠错冲正的严格只读模型，汇总/列表/明细/导出共用分类规则。
- `features/finance/metrics.ts`：已核应收及核销余额；不是按收款日期统计的现金流。
- 档案和质量服务：完整分页、明确读取失败及覆盖范围；失败不得变成空数组后显示“良好”。

## 3. 核心路由

| 中文路由 | 法语路由 | 功能 |
|---|---|---|
| `/management` | `/fr/management` | 经营首页与项目总览 |
| `/daily-rentals` | `/fr/daily-rentals` | 日租日历和移动工作台 |
| `/daily-rentals/receipts` | `/fr/daily-rentals/receipts` | 日租历史收款与同比、环比分析 |
| `/leases` | `/fr/leases` | 长租合同与财务 |
| `/sales` | `/fr/sales` | 出售合同与回款 |
| `/units` | `/fr/units` | 房源台账与详情 |
| `/customers` | `/fr/customers` | 客户档案 |
| `/finance` | `/fr/finance` | 经营流水和应收；非完整复式总账 |
| `/reports` | `/fr/reports` | 经营报表 |
| `/operator` | `/fr/operator` | 外部录入连接器、本人身份确认与操作记录 |
| `/assistant` | `/fr/assistant` | 退役入口，重定向至连接器页 |
| `/settings` | `/fr/settings` | 管理员维护入口 |

`src/middleware.ts` 负责刷新 Supabase 会话并把未登录请求导向 `/login`。真正的授权判断在服务端组件、Server Actions 和数据库策略中完成。

## 4. 数据模型

主要业务实体：

- `projects`、`buildings`、`units`、`unit_business_flags`
- `customers`、`daily_bookings`、`cleaning_tasks`
- `lease_contracts`、`sale_contracts`、`sale_payment_schedule`
- `receivables`、`payments`、`ledger_entries`
- `audit_logs`、`user_profiles`、`project_account_access`
- `ai_jobs`、`ai_inputs`、`ai_proposed_actions`、`ai_action_events`

所有公开 schema 中的业务表必须启用 RLS。新表是否进入 Data API 还取决于项目的 Data API 暴露设置和对 `anon`/`authenticated` 的显式授权。

资产的所有权、建设/可用条件、日租占用、长租占用和保洁状态是不同维度。`unit_operational_position` 为已建立的状态读模型，不能再把出售、长租、自用的合计叫作“日租入住率”。CIMAC 的建设/交付和开业准备必须保留自身业务含义，不套用住宅日租指标。

真实客户/住客、合同或订单经办人、实际收款人、认证录入者、确认者不能互相替代。当前日租已存在 `guest_customer_id` 与 `booking_agent_id`，历史兼容字段仍需谨慎识别；没有独立证据的历史实际收款人不得自动回填为录入账号。独立人员目录与历史映射若未完成迁移和验收，不能仅因界面出现姓名就宣称已解决。

## 5. 财务一致性

`payments` 保存资金事件的原始记录，`ledger_entries` 保存经营收入、支出和押金负债方向，`receivables` 保存已确认应收，`payment_receivable_allocations` 保存已建立的核销关联。旧记录可能缺失结构化分类或关联，所以“有付款记录”不等于“已自动证明其应收归属”。关键操作必须保证相应记录与合同、订单和房态同步成功或全部回滚。

现金收入、应收核销、未收余额、押金负债分别计算：

- 首页本月净收款按实际付款日期，明确退款冲减；不扣经营费用、不含押金和非现金抵扣。
- 合同已核销取已管理应收的 `paid_amount_xof`；不得取 `max(付款净额, 应收核销)`。
- 未收逐条计算 `max(0, amount_xof - paid_amount_xof)` 后相加；一条超付不自动冲掉另一条欠款。
- 到期日当天计入到期未收，严格早于当天才算逾期；`historical_pending` / `excluded` / `cancelled` 不混进当前管理余额。
- 合同估算只作跟进提醒；未建立已核应收时显示“未建已核应收”，而非证明已收清或虚构欠款。
- 缺历史汇率或无法核验的退款/冲正保留原貌并标记待核，不能猜汇率或依据备注改写账务。

详细定义见 [财务口径规范](finance-metrics-spec.md)。

系统统一以 XOF/FCFA 汇总。外币交易需保存原币金额、币种、确认汇率和最终 XOF 金额；历史交易不得使用当前汇率重新计算。

日租、长租和出售的关键写入采用请求 ID 防止重复提交。错误收款使用反冲记录，不物理删除历史资金流水。

## 6. AI 接入

主要录入方向是外部工具 + 独立员工连接器，内嵌业务助手的主页面入口已退役。连接器通过 `/api/operator/v1/` 提供受控查询和草稿准备，员工通过本人网页登录确认；客户端不持有数据库管理员密钥。`ai-workbench` 中仍有凭证、草稿与证据链的兼容依赖，不能因为删除了导航入口就整目录删除。经办人、实际收款人和认证操作人不是同一个概念，不能以“经办人叫颖”推导审计身份。

```text
文字/图片
  ↓
意图或凭证提取
  ↓
查询真实业务对象并唯一匹配
  ↓
生成 Proposed Business Action
  ↓
人工确认
  ↓
Business Action / 原子 RPC
  ↓
重新查询验证 + 审计事件
```

AI 只生成结构化建议，不直接写 SQL。AI 动作继承当前登录用户权限，数据库记录中的 actor 始终是实际用户。所有模型输入应最小化，敏感凭证保存在私有 Storage，并遵循保留期与脱敏流程。

当前动作目录已经定义 L0-L3 风险等级，但传统页面尚未全部通过统一 Gateway；完成这一收敛是继续扩展 AI 写操作前的架构任务。

## 7. 部署

- GitHub `main` 是生产基线。
- GitHub Actions 运行 ESLint、渐进格式检查、静态业务规则、类型检查、生产构建和普通测试；独立任务运行原生 PostgreSQL 回归。
- 推送 GitHub 不等于部署完成。Vercel Git 集成能触发时等待其结果；不能触发时按授权的发布流程部署，并核对生产环境的具体提交及 Ready 状态。
- Supabase 迁移独立于 Vercel 部署；先备份、以兼容扩展方式应用、核验数据库，再发布依赖新结构的应用。读模型上线也必须核验函数权限、RLS、执行计划和原生 PostgreSQL 回归。
- Sentry 在配置 DSN 后采集浏览器、服务端和 Edge 错误。

Docker 仅用于本机隔离 Supabase/Auth 集成环境，不在员工日常录入链路中。`npm run test:db-rebuild` 使用一次性原生 PostgreSQL 验证应用结构基线和审核增量，不需要 Docker，也不会读取 `.env.local`。它不是完整生产灾备恢复；Auth/Storage、密钥和业务数据需要另外的备份与恢复演练。

本轮证据与已知债务见 [工程化验收](ENGINEERING_REFACTOR.md)，后续维护见 [发布与交接](ENGINEERING_HANDOFF.md)。
