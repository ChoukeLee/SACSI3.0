# 后续第一阶段：稳定使用与收尾

日期：2026-09-23。状态：本地开发与技术验收完成，未提交、未推送、未执行线上迁移。

## 重启后的连接器

- 当前对话直接调用 SACSI capabilities 和 list_pending 成功：Chouke/admin，组合日租与批次收款能力开放，待办为空。
- 生产只读验收脚本通过：连接器 0.4.0，服务器 e3b73ef61f94197aa3fbb9cbf43067f5f9b865a0，三个恢复入口正常，匿名准备及 Bearer 确认被拒绝，businessWrites=0。
- 这次是真实当前会话调用，不再只是独立进程启动检查。共用 SACSI 账号仍不能区分实际坐在电脑前的人。

## 修复和既有改动核验

1. 新增迁移 `20260923095940_fix_receipt_currency_type.sql`，不修改历史迁移或财务记录。旧 RPC 的 v_currency 改为 public.currency_code，修复 text 写入枚举字段失败。该接口只接受 amount_xof、汇率固定为 1，因此拒绝 CNY/USD/EUR，不能把西法数值错误标记成外币。不增加权限，并拒绝无认证身份或无财务角色的调用。
2. 此 RPC 在当前 src 中没有调用者，现行凭证确认走业务草稿与财务操作入口。本修复处理历史数据库缺陷，不恢复旧入口，也不把其旧启发式应收匹配升级为推荐录入方式。多候选仍应使用现行显式选单流程。
3. 核验原有未发布改动：日租包含锁定房、读取锁定人、增加 5号前台经办人、房间标签。保留原改动；补齐日历调用统一标签规则，避免自用房在日历中被错误显示为锁定人姓名。
4. 新增枚举错误复现、XOF 默认值、币种拒绝、身份/角色拒绝、重复收据、审计真实身份和失败事务回滚测试。补充法语、自用优先、空白姓名及过期锁定人字段测试。

## 本轮验收证据

- `npm test`：885 通过、1 跳过，113 测试文件通过、1 跳过。
- `npm run test:operator-concurrency`：真实临时 PostgreSQL 34 项通过。
- `npm run typecheck` 和 `npm run check:daily-rental-rules`：通过。
- `node scripts/start-local-operator-web.mjs --build`：隔离源代码生产构建通过，不读取生产环境文件。仅有工作区根目录推断与 webpack 缓存性能提示。
- 新迁移通过限定回环、无云端链接的 localSql 应用到本地测试库；本地 public/private db lint 无 error；security advisors 无 warn/error。未修改生产数据库。
- `node scripts/check-local-booking-workflow.mjs --recovery-package work/operator-0.4.0-local-CS3EBB`：真实本地 Auth、查询、计划、确认页、Cookie 确认、续住/退房收款事务、幂等和真实身份审计通过；模拟丢失草稿回复后原号恢复、完成后拒绝重做通过。合成数据清理，productionWrites=0。
- 首轮新增测试遇到测试夹具问题：事务失败后的 reset role 遮蔽原错误，以及合成金额未命中旧应收匹配。增加 RPC savepoint 恢复并明确合成账期后重跑通过；未将失败轮记作成功。

## 交付边界

- 本轮没有推送 GitHub、部署 Vercel、更换连接器包或新增真实付款；待阶段发布时再执行新迁移和应用发布。
- 小颖/黄姐独立账号实操仍延期；自动化技术验收不替代人员验收。
- 房态标签完成代码、测试与构建核验，本轮未进行人工视觉验收。
- 原有未提交文件仍保留，未混入自动提交。下一阶段按真实业务需求补齐操作范围，不自动扩大财务写权限。
