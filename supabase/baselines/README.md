# 应用结构基线

`20260916.application-schema.json` 是经授权只读提取的 SACSI public/private 应用结构，不含表记录、Auth 用户、令牌、数据库密码、存储文件或序列当前值。导出 SQL 在 `scripts/sql/export-application-schema.sql`。

这是隔离验收使用的历史基线，不是待执行的线上迁移，也不是全平台备份。它补足了当前迁移仓库未覆盖的物业费规则结构。禁止直接将历史迁移整批套在基线上，尤其不得导入历史修账/业务种子。

固定哈希、离线组装、本地环境断言及白名单迁移由 `scripts/setup-local-full-schema.mjs` 实现；`scripts/check-local-full-schema.mjs` 比较原结构及明确列出的预期差异。完整边界见 `docs/OPERATOR_STAGE2_ACCEPTANCE.md`。
