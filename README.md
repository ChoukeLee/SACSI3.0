# SACSI 3.0

SACSI 3.0 是科建地产使用的单租户房地产经营系统。系统以 Supabase 作为业务数据库，覆盖资产、长租、出售、日租、客户、应收、经营收付款、数据质量和审计，可通过业务页面和外部 AI 连接器操作。它是经营台账，不是完整复式会计 ERP。

2026-10-15 整体更新已完成本地实现，最终发布验收进行中；本说明不代表云迁移、提交推送或生产部署已经完成。具体范围及待补发布证据见 [整体更新与验收](docs/PRODUCT_RENEWAL.md)。开发期间本地核验，里程碑统一发布。GitHub `main` 是生产代码基线，但 push 成功不等于 Vercel 已部署，必须另行核对 CI、数据库迁移、实际生产提交和 Ready 状态。

历史迁移存在重复编号及仓库未记录的线上结构，不能在新库简单整批重放；当前重建使用已审核的结构快照及增量清单。历史背景见 [第二阶段技术验收](docs/OPERATOR_STAGE2_ACCEPTANCE.md)，现行流程见 [维护交接](docs/ENGINEERING_HANDOFF.md)。

当前 AI 录入入口是外部工具配合受控业务接口；独立员工连接器位于 `operator-connector/`，员工不需要同步开发仓库。内嵌业务助手已从导航移除，旧 `/assistant` 和 `/fr/assistant` 链接转到 `/operator` 我的业务待办，不再创建或加载聊天会话。共享业务模块与历史记录保留，不删除连接器 API、确认页或审计。

员工独立账号的只读技术准备、下一批审计可追溯性改进与本人验收边界见 [员工使用准备](docs/OPERATOR_USAGE_READINESS.md)。

2026-10-07 四步集中改进包括分账金额校验、同合同/订单历史收据号核对、身份记录筛选、旧聊天UI清理及外部备份完整性复核，见 [四步集中交付](docs/OPERATOR_FOUR_STEP_RELEASE.md)。无收据号跨截图去重、员工本人验收和独立离线密钥保管不宣称完成。

连接器 0.5.0 增加预订、入住、改期改价、无收款取消、录错房号整单纠正、错误收款冲正和实际退款等受控流程，共 19 个工具。写入仍由本人在网页核对确认；实际退款仅登记已退的钱，不发起银行转账。适用边界、验收及发布记录见 [后续业务第二阶段](docs/OPERATOR_BUSINESS_STAGE2.md)。

## 产品范围

- 多项目与多楼栋：SACSI 3/4/5/6/7/11，以及 CIMAC 商业项目。
- 公司经营首页：按当前项目及账号权限展示净收款、到期未收、合同/资产关注事项和经营趋势。业务概览以长租、出售、资产为主，日租保留为最后一行，不以示例房间数或混合资产状态制造入住率。
- 合同工作区：长租/出售默认紧凑表格，支持搜索、排序、筛选及分页；保留楼层/房间视图和原有业务操作。
- 日租：预订、入住、续住、收款、退房、取消、保洁和房态。
- 日租收款分析：`/daily-rentals/receipts`（法语 `/fr/daily-rentals/receipts`），提供完整历史逐笔查询、同口径汇总、12 个完整月趋势、同比/环比和 CSV 导出；只向现有 `finance:read` 角色开放。
- 长租：合同、租金、物业费、押金、组合收款、应收和退租记录。
- 出售：销售合同、付款计划、收款、退款及过户状态。
- 收款事实与账期：区分客户、经办人、实际收款人及认证录入者；按明确证据记录收款事实、服务账期和核销关联，不把录入账号当成历史收款人，也不猜填旧账期。
- 客户/资产档案：完整历史分页读取、相关合同与收付款、应收余额及关联审计时间线；原币与折合 XOF 分开说明。
- 数据质量：检查失败或数据覆盖不足显示未知/不可用，不把空列表当成“数据良好”。
- CIMAC：保留建设/交付、租赁准备及独立资产库存；只租不卖，不套用住宅日租规模或入住率。
- 系统能力：Supabase Auth、角色权限、RLS、原子 RPC、幂等请求、审计日志、Sentry 和历史部分数据定时导出（不等于完整灾备）。
- 外部 AI 工作流：在外部对话整理文字及图片，通过连接器核对实时业务，生成草稿并由本人在网页确认执行。

## 日租历史收款统计口径

- 默认最近完整月；选择本月时截至阿比让时间昨日，与上月、去年同月相同日期段比较。自选区间与紧邻的等长上期比较，不把它标作月环比。同期天数不同、基期无记录/非正数、存在未纳入记录时不生成误导性的增长率。
- 净收款按账务记录日期统计：正向收款减实际退款，加录错冲正调整；跨月冲正不悄悄重述原月份。它不是住宿履约收入、应收或利润。非现金抵扣、非 XOF、异常金额和无法解释的负数单列为未纳入，不猜汇率或退款类型。
- 历史收款方式未记录的有效付款保留金额，显示“方式未记录”，不推断现金。客人、经办人、审计登录账号分别展示；经办人不代表实际收款人。
- 只读 `daily_receipts_read_rpc` 对完整权限范围做同一 SQL 快照查询，不从日历页面已加载的付款数组推算统计。每页 50 笔，导出最多 10000 笔，超过上限明确拒绝，不静默截断。已取消订单和不再启用日租房源的历史收款不会仅因当前状态消失。
- 数据最早记录日期不代表历史完整性证明。补录、更正和未归档的微信/Excel 凭证仍需人工核实。流水详情只显示实际关联到付款的凭证；凭证临时签名链接 5 分钟有效，操作日志为当前账号有权查看的最近 20 条关联记录。
- 发布须先通过本地数据库重建与边界测试，再应用 `20261015154715_daily_receipts_analysis.sql`，最后部署应用；该迁移只新增只读函数和索引，不修改账务数据。源文件由 CLI 创建，发布时版本号已与生产迁移历史登记值对齐，SQL 内容哈希保持不变。

## 技术栈

- Next.js 15 App Router、React 19、TypeScript
- Tailwind CSS、Radix UI、Framer Motion
- Supabase PostgreSQL、Auth、Storage、RLS、PostgREST/RPC
- Vitest、GitHub Actions、Vercel、Sentry

## 架构原则

传统页面和外部 AI 连接器是两种入口，最终进入同一套业务动作和数据库 RPC：

```text
传统页面 ─┐
          ├─ Business Actions ─ 权限/业务校验 ─ 原子 RPC ─ Supabase
外部连接器┘
```

AI 不直接执行 SQL，也不拥有独立于当前登录用户的权限。外部连接器写入先形成受控草稿，由本人在网页确认后执行，并重新查询验证结果；传统页面保留既有业务操作及认证原子 RPC。

现金、应收核销、押金负债是不同指标：净收款不等于利润，也不能用付款总额和核销余额取较大值代替对账。金额沿用业务事务的历史汇率和精度，合同现金可保留两位 XOF，日租严格整数规则独立保留。规则见 [财务口径规范](docs/finance-metrics-spec.md)。

数据库尚未将所有旧财务表的允许角色 DML 收拢为 RPC-only。项目 RLS 策略为 RESTRICTIVE，不能误称 `FOR ALL` 以 OR 绕过角色；剩余入口及兼容收拢方案见 [财务访问边界复核](docs/FINANCIAL_ACCESS_REVIEW.md)。

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
npm run test:operator-concurrency
git diff --check
```

没有生产环境配置时，使用隔离 Supabase 环境执行 `node scripts/start-local-operator-web.mjs --build`；该脚本只复制白名单源码，不复制 `.env.local`。纯数据库重建检查可单独运行 `npm run test:db-rebuild`，仅创建临时本地集群。当前历史迁移不能全部重放；重建来源固定在 `supabase/baselines/rebuild-manifest.json`，任何变更需审核哈希与回归。ESLint 覆盖 src/tests，格式检查渐进覆盖本轮治理模块，不宣称历史代码已全部格式化。

工程化范围和遗留风险见 [工程化验收](docs/ENGINEERING_REFACTOR.md)，开发、发布、恢复与人工验收步骤见 [维护交接](docs/ENGINEERING_HANDOFF.md)。

2026-09-23 已完成真实快照的本地数据库/Auth/Storage 恢复演练；异地副本、定时完整备份和整站云端切换仍待落实，见 [灾备验收](docs/DISASTER_RECOVERY.md)。本轮发布备份即使采用加密应用数据库快照，也不等于已完成新的完整 Auth/Storage/配置灾备演练。

日租日历已通过分页完整读取历史，消除最近 N 条导致的漏数；尚未完成按可见日期窗口懒加载。员工独立账号的实际使用验收仍需由本人完成，不以自动测试或管理员代测替代。

## 主要目录

```text
src/app                 页面、路由和 API
src/components          应用外壳与通用 UI
src/features            业务模块与 Server Actions
src/features/management 项目经营快照、趋势与首页
src/features/contracts  合同列表及现金/应收展示模型
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

- 推送 `main` 后核对 GitHub Actions。Vercel Git 集成若未触发，需按授权发布流程另行部署；不能假设每次 push 必然自动上线。
- 应用部署不会自动替代数据库迁移。新增迁移必须先备份、审阅 RLS/RPC 权限并在隔离环境验证。
- `.env.local`、`.vercel`、构建产物和本地工具目录均不得提交。
- 生产检查流程见 [PRODUCTION_CHECKLIST](docs/PRODUCTION_CHECKLIST.md)。

## 当前 AI 状态

当前用户入口是外部 AI 对话 + 本人账号连接器 + 网页确认，不重新启用内嵌聊天助手。自然语言及图片理解由外部工具完成，系统负责真实数据匹配、权限、草稿、确认、原子操作和审计。没有证据的金额、对象、币种、账期与分账不能由模型猜测。

历史查询、凭证草稿和证据链模块仍有共享依赖，不能因移除聊天入口就整目录删除。连接器当前能力及验收以专项交付记录为准；[AI_PROGRESS](docs/AI_PROGRESS.md) 保留旧内嵌能力的研发记录，不作为当前页面入口或未来必选开发路线。
