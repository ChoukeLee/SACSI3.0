# SACSI 3.0 生产发布检查

更新时间：2026-09-07

## 每次提交

```bash
npm ci
npm run check:daily-rental-rules
npm run typecheck
npm test
npm run build
git diff --check
```

`typecheck` 和 `build` 应串行执行，因为 Next.js 构建会更新 `.next/types`。

## 数据库变更

- 先备份生产数据，再操作迁移。
- 迁移文件必须通过 Supabase CLI 创建并按时间排序。
- 公开 schema 中的新表必须启用 RLS，并审阅 Data API 的 schema 暴露和角色 `GRANT`。
- UPDATE 策略同时检查 `USING` 和 `WITH CHECK`。
- `SECURITY DEFINER` 函数必须说明必要性、固定 `search_path`、检查当前用户，并撤销不需要的 `PUBLIC EXECUTE`。
- 关键 RPC 必须验证事务回滚、幂等请求、重复请求冲突和审计记录。
- Vercel 部署不会自动代表数据库迁移已经应用。

## 权限检查

- `admin`：全部业务与系统维护。
- `boss`：经营与审计只读。
- `finance`：财务写入，其余授权页面只读。
- `front_desk`：法语日租操作和长租只读。
- `rental_sales`：客户、日租、长租和出售业务。
- 中间件只处理会话刷新和未登录跳转；服务端和数据库仍需独立授权。
- 浏览器代码中不得出现 service role key。

## 核心路由冒烟

中文：

- `/management`
- `/daily-rentals`
- `/leases`
- `/sales`
- `/units` 与 `/units/[id]`
- `/customers` 与 `/customers/[id]`
- `/finance`
- `/reports`
- `/assistant`
- `/data-quality`
- `/settings` 与 `/settings/audit-logs`

法语：检查对应的 `/fr/*` 路由，确认文案、权限和数字格式没有回退到中文。

## 关键业务回归

### 日租

- 新建订单使用原子 RPC 和请求 ID。
- 同日换房必须先完成退房和保洁。
- 收款不得超过未收金额。
- 退房同步最终金额、应收、保洁任务和房态。
- 已收款订单不能直接删除；更正使用反冲记录。

### 长租

- 租金和物业费拆分之和等于真实入账金额。
- `paid_through_date` 不得覆盖正式合同结束日期。
- 付款、总账、应收冲抵、合同状态和审计同成同败。
- 外币收款保留原币、金额、汇率和最终 XOF 金额。

### 出售

- 合同、付款计划、应收和房态原子创建。
- 只有明确付款计划产生逾期。
- 修改总价、退款和终止合同需要高风险权限和完整审计。

### 房源

- `/units` 能读取项目、楼栋、业务标记和当前客户。
- 多个 `daily_bookings → customers` 外键必须显式指定关系。
- 项目账号只能读取被授权项目。

### AI

- L0 查询不产生写入。
- 保洁和财务动作先生成草稿，再人工确认。
- 草稿版本、有效期、目标绑定和当前用户权限均被校验。
- 执行后重新读取数据库验证。
- 图片存入私有 Storage，失败、拒绝和完成事件进入 AI 证据链。

## 部署

- GitHub Actions 的 `Validate + Test` 成功。
- Vercel Production deployment 指向本次 `main` 提交并为 `success`。
- 必要环境变量已配置：Supabase URL、匿名/发布密钥和服务端密钥。
- 可选集成按需配置：Sentry、DeepSeek/OpenAI/OCR provider。
- 发布后使用真实账号完成登录、房源页和 AI 查询冒烟。
- 发现数据异常时优先回滚应用部署；不要用推测性 SQL 修改生产数据。

## 备份与恢复

- GitHub Actions 每日执行 `scripts/backup-full.mjs`，产物保存 90 天。
- Supabase 建议开启 PITR 作为主要恢复能力。
- 大型迁移前额外执行按业务域备份脚本。
- `.env.local`、数据库导出和凭证文件不得提交到 Git。
