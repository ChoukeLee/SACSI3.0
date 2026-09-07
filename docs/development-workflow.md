# SACSI 开发与发布流程

更新时间：2026-09-07

## 分支与提交

- 生产基线：`main`。
- 功能分支：`feat/<name>`、`fix/<name>`、`chore/<name>`。
- 提交前同步远端并确认没有覆盖其他人的未合并修改。
- 提交信息使用 `feat:`、`fix:`、`refactor:`、`docs:`、`test:` 或 `chore:`。

## 本地流程

```bash
git fetch origin
npm ci
npm run dev
```

代码完成后按顺序执行：

```bash
npm run check:daily-rental-rules
npm run typecheck
npm test
npm run build
git diff --check
```

数据库或财务改动还需要使用真实数据库的只读查询或隔离环境验证，不能只依赖源码字符串测试。

## GitHub Actions

`.github/workflows/ci.yml` 在推送或 PR 指向 `main` 时运行：

1. `npm ci`
2. `npm run validate`
3. `npm test`

CI 使用占位环境变量，不连接生产数据库。

`.github/workflows/backup.yml` 每天 02:15 UTC 运行完整数据备份，备份产物保留 90 天。数据库应同时启用 Supabase PITR。

## Vercel

Vercel 已通过 GitHub 集成监听 `main`。成功推送后会自动创建 Production deployment。发布完成必须核对 deployment 对应的 Git SHA，而不是只看本地构建成功。

Vercel 需要配置：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

按需配置 Sentry、DeepSeek、OpenAI 或其他 OCR provider。任何密钥只存于 Vercel/Supabase/GitHub Secrets 或本地 `.env.local`。

## Supabase

- 数据库迁移与应用部署分开管理。
- 新迁移必须先备份，并审阅表授权、RLS、函数执行权限和回滚行为。
- 页面和 AI 写操作复用业务动作/原子 RPC，不直接拼接 SQL。
- 生产数据有歧义时停止自动修复，保留原记录并进入人工核对。

## 发布后冒烟

- 登录及角色跳转。
- 中文/法语核心导航。
- 管理首页和房源页。
- 日租查询、入住、退房与保洁。
- 长租/出售台账和财务汇总。
- AI L0 查询与保洁草稿。
- 审计日志中能看到真实操作账号。

完整清单见 `docs/PRODUCTION_CHECKLIST.md`。
