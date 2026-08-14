# 开发工作流与运维手册（Stage 1 加固）

> 本文档记录 CI、错误监控、登录限流、备份的接入方式与外部配置清单。

## 1. 分支与提交

- 主干分支：`main`（受保护，任何改动须经 PR + CI 通过）。
- 分支命名：`feat/<简述>`、`fix/<简述>`、`chore/<简述>`。
- 提交信息遵循现有项目风格（`feat:` / `fix:` / `perf:` / `refactor:` / `docs:` / `chore:`）。

## 2. CI 流水线

`.github/workflows/ci.yml` 在 push/PR 到 `main` 时运行：

1. `npm ci`
2. `npm run validate`（日租静态规则 → typecheck → build）
3. `npm test`

CI 使用占位环境变量，不访问真实数据。

## 3. 错误监控（Sentry）

- SDK：`@sentry/nextjs`，已接入 client/server/edge 三端与 `instrumentation.ts`。
- 未配置 DSN 时 SDK 不初始化、不发送事件，**不影响构建与运行**。
- 需外部配置（可选）：在 Sentry 创建项目后，把 DSN 配置到
  `NEXT_PUBLIC_SENTRY_DSN`（Vercel / `.env.local`）。上传 sourcemap 还需
  `SENTRY_ORG`、`SENTRY_PROJECT`、`SENTRY_AUTH_TOKEN`。
- 原生错误边界：`src/app/global-error.tsx`（全局）与 `src/app/error.tsx`（路由级）。

## 4. 登录守卫中间件

`src/middleware.ts` 负责：

1. 刷新 Supabase 会话 cookie；
2. 未登录访问受保护路由时重定向到 `/login?redirect=<原路径>`。

真正的权限判定仍在服务端组件 `getCurrentUser()`（基于 `auth.getUser()`）。

## 5. 登录限流

- 迁移：`supabase/migrations/202608140001_login_rate_limit.sql`（`login_attempts`
  表 + 两个 SECURITY DEFINER RPC：`record_login_attempt` / `login_failure_count`）。
- 规则：同一邮箱 15 分钟内失败 ≥ 5 次、或同一 IP 失败 ≥ 10 次，则拒绝登录。
- 迁移未应用时登录动作会「失败开放」，不影响登录。

## 6. 自动备份

- 脚本：`scripts/backup-full.mjs`（导出全部业务表为 JSON）。
- 定时任务：`.github/workflows/backup.yml` 每日 02:15 UTC 执行，产物保存 90 天。
- 需在 GitHub 配置 Secrets：`NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。
- Supabase 控制台另建议开启 PITR（时间点恢复）作为主备份手段。

## 7. 上线前外部配置清单

- [ ] GitHub Secrets：`NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`
- [ ] Sentry 项目 DSN（可选）：`NEXT_PUBLIC_SENTRY_DSN`
- [ ] 应用迁移 `202608140001_login_rate_limit.sql`
- [ ] 轮换已暴露的 service role key（阶段 0.2）
- [ ] Supabase 开启 PITR
