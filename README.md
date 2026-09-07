# SACSI 3.0

SACSI 3.0 是科建地产使用的单租户房地产经营系统。系统以 Supabase 作为业务数据库，覆盖房源、日租、长租、出售、客户、应收、收付款、总账、数据质量和审计，并正在演进为可通过传统页面与 AI 工作台共同操作的业务系统。

当前生产部署由 GitHub `main` 分支自动发布到 Vercel。数据库结构通过 `supabase/migrations` 中按时间排序的迁移维护。

## 产品范围

- 多项目与多楼栋：SACSI 3/4/5/6/7/11，以及 CIMAC 商业项目。
- 日租：预订、入住、续住、收款、退房、取消、保洁和房态。
- 长租：合同、租金、物业费、押金、组合收款、应收和退租记录。
- 出售：销售合同、付款计划、收款、退款及过户状态。
- 经营数据：管理首页、财务流水、应收、报表、客户档案和数据质量。
- 系统能力：Supabase Auth、角色权限、RLS、原子 RPC、幂等请求、审计日志、Sentry 和每日备份。
- AI 工作台：自然语言查询、持久化会话、有限上下文理解、受控操作草稿、人工确认，以及在统一输入框粘贴、拖入或选择图片凭证入账。

## 技术栈

- Next.js 15 App Router、React 19、TypeScript
- Tailwind CSS、Radix UI、Framer Motion
- Supabase PostgreSQL、Auth、Storage、RLS、PostgREST/RPC
- Vitest、GitHub Actions、Vercel、Sentry

## 架构原则

传统页面和 AI 工作台是两种平级入口，最终应进入同一套业务动作和数据库 RPC：

```text
传统页面 ─┐
          ├─ Business Actions ─ 权限/业务校验 ─ 原子 RPC ─ Supabase
AI 工作台 ┘
```

AI 不直接执行 SQL，也不拥有独立于当前登录用户的权限。所有写操作必须先形成不可变草稿，经人工确认后执行，并在执行后重新查询数据库验证结果。

详细说明见 [系统架构](docs/ARCHITECTURE.md) 和 [AI 开发进度](docs/AI_PROGRESS.md)。

## 本地运行

要求 Node.js 24。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

`.env.local` 至少需要：

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` 只能在服务端使用，不能添加 `NEXT_PUBLIC_` 前缀，也不能提交到 Git。

## 验证

```bash
npm run check:daily-rental-rules
npm run typecheck
npm test
npm run build
```

提交前的完整检查使用：

```bash
npm run validate
npm test
git diff --check
```

## 主要目录

```text
src/app                 页面、路由和 API
src/components          应用外壳与通用 UI
src/features            业务模块与 Server Actions
src/features/ai-workbench
                        AI 查询、草稿、确认与财务匹配
src/features/business-actions
                        业务动作目录和 AI 证据链服务
src/lib/supabase        浏览器、服务端与特权客户端
src/types               领域与数据库类型
supabase/migrations     数据库迁移、RLS 和原子 RPC
scripts                 仍在使用的备份、核对和运维脚本
tests                   跨模块业务规则测试
docs                    当前架构、业务规则和运维文档
```

## 角色

- `admin`：全部业务与系统维护。
- `boss`：经营与审计只读。
- `finance`：财务登记及授权数据读取。
- `front_desk`：法语日租操作、长租只读。
- `rental_sales`：客户、日租、长租和出售业务。

页面权限只是第一层保护；关键写入还必须经过服务端角色校验和数据库授权。

## 部署与数据库变更

- 推送 `main` 会触发 GitHub Actions 检查及 Vercel 生产部署。
- 应用部署不会自动替代数据库迁移。新增迁移必须先备份、审阅 RLS/RPC 权限并在隔离环境验证。
- `.env.local`、`.vercel`、构建产物和本地工具目录均不得提交。
- 生产检查流程见 [PRODUCTION_CHECKLIST](docs/PRODUCTION_CHECKLIST.md)。

## 当前 AI 状态

已完成自然语言只读查询、L1 保洁草稿确认执行、AI 证据链、持久化会话与近期对话恢复，以及从 AI 对话输入框提交图片/文字凭证进行长租租金和物业费候选提取、人工确认与入账。当前上下文理解仅覆盖对上一业务对象的有限指代，不等同于开放式通用对话；可编辑的跨轮凭证草稿、Excel/PDF 批量导入、语音、合同导入、经营洞察和后台自动化仍在后续范围。

以 [AI_PROGRESS](docs/AI_PROGRESS.md) 为当前进度基准，早期设计讨论不作为已完成能力说明。
