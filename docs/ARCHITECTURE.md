# SACSI 3.0 系统架构

更新时间：2026-09-23（本地工程化整理；不表示已发布）

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
   └─ Audit Logs / AI Evidence Ledger
```

读取通常使用当前登录会话的 Supabase 服务端客户端。需要跨多表原子写入的操作通过 Server Action 调用数据库 RPC；少数旧写入仍由通过角色守卫的服务端特权客户端执行，后续应逐步收敛到统一业务动作和 RPC。

当前模块边界：日租 `calendar.tsx` 管理交互状态，`calendar-model.ts` 处理纯计算，`calendar-view-parts.tsx` / `calendar-finance-panel.tsx` 负责展示；订单提示在 `booking-presentation.ts`。长租 `actions.ts` 是兼容入口，合同、收款、退租分别在 `lease-*-actions.ts`；建约、激活、终止、结算及应收维护已收拢到认证 RPC 事务中，不再由服务端逐表写入（本地完成待发布，见 [长租事务化](LEASE_ATOMIC_TRANSACTIONS.md)）。预订操作的标签、动作对应关系和风险等级由 `booking-operation-contract.ts` 共享；它不是授权引擎，最终授权仍在服务端和数据库。

## 3. 核心路由

| 中文路由 | 法语路由 | 功能 |
|---|---|---|
| `/management` | `/fr/management` | 经营首页与项目总览 |
| `/daily-rentals` | `/fr/daily-rentals` | 日租日历和移动工作台 |
| `/leases` | `/fr/leases` | 长租合同与财务 |
| `/sales` | `/fr/sales` | 出售合同与回款 |
| `/units` | `/fr/units` | 房源台账与详情 |
| `/customers` | `/fr/customers` | 客户档案 |
| `/finance` | `/fr/finance` | 总账和应收 |
| `/reports` | `/fr/reports` | 经营报表 |
| `/assistant` | `/fr/assistant` | AI 工作台 |
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

## 5. 财务一致性

`payments` 记录真实资金事件，`ledger_entries` 记录会计方向和业务分类，`receivables` 记录已确认应收。关键操作必须保证这些记录与合同、订单和房态同步成功或全部回滚。

系统统一以 XOF/FCFA 汇总。外币交易需保存原币金额、币种、确认汇率和最终 XOF 金额；历史交易不得使用当前汇率重新计算。

日租、长租和出售的关键写入采用请求 ID 防止重复提交。错误收款使用反冲记录，不物理删除历史资金流水。

## 6. AI 接入

主要录入方向是外部工具 + 独立员工连接器，内嵌工作台保留兼容。连接器通过 `/api/operator/v1/` 提供受控查询和草稿准备，员工通过本人网页登录确认；客户端不持有数据库管理员密钥。经办人、实际收款人和认证操作人是不同字段，不能以“经办人叫颖”推导审计身份。

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
- GitHub Actions 配置运行 ESLint、渐进格式检查、静态业务规则、类型检查、生产构建和普通测试；新增独立原生 PostgreSQL 回归任务（当前本地未推送）。
- Vercel 通过 GitHub 集成自动部署 `main`。
- Supabase 迁移独立于 Vercel 部署；任何数据库修改都需单独备份、应用和核验。
- Sentry 在配置 DSN 后采集浏览器、服务端和 Edge 错误。

Docker 仅用于本机隔离 Supabase/Auth 集成环境，不在员工日常录入链路中。`npm run test:db-rebuild` 使用一次性原生 PostgreSQL 验证应用结构基线和审核增量，不需要 Docker，也不会读取 `.env.local`。它不是完整生产灾备恢复；Auth/Storage、密钥和业务数据需要另外的备份与恢复演练。

本轮证据与已知债务见 [工程化验收](ENGINEERING_REFACTOR.md)，后续维护见 [发布与交接](ENGINEERING_HANDOFF.md)。
