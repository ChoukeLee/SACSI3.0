# SACSI 3.0 系统架构

更新时间：2026-09-07

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
- GitHub Actions 运行静态业务规则、类型检查、生产构建和测试。
- Vercel 通过 GitHub 集成自动部署 `main`。
- Supabase 迁移独立于 Vercel 部署；任何数据库修改都需单独备份、应用和核验。
- Sentry 在配置 DSN 后采集浏览器、服务端和 Edge 错误。
