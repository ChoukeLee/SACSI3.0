# 财务访问边界复核与后续收拢方案

日期：2026-10-15。状态：只读诊断、方案登记；**未执行本文件提出的权限变更或数据库迁移，未读取或修改业务账务记录**。

## 1. 结论与本轮发布边界

当前线上并非“项目 FOR ALL 策略以 OR 绕过角色策略”。实查 `pg_policies.permissive` 后，`payments`、`receivables`、`ledger_entries` 和 `sale_payment_schedule` 的项目范围策略均为 **RESTRICTIVE**；它们与允许角色的 PERMISSIVE 策略共同约束写入。

因此，不能仅看到 `cmd = ALL` 就断言任意登录账号能够写财务。此前基于该字段省略而得出的 OR 绕过推论撤回。PostgreSQL 的 [RLS 文档](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) 明确区分 PERMISSIVE 的 OR 与 RESTRICTIVE 的 AND。

仍然存在重要的旧设计债务：允许写入的业务角色可以在 RLS 范围内直接修改财务表，未实现“所有财务变动必须经过原子 RPC、幂等和审计”的硬边界。本轮新增人员/账期事实自己的防绕过规则不等于已经收拢所有旧金额字段。

**不建议在此次 UI 发布时直接撤销所有财务 DML 权限。** 当前仍有真实使用的 invoker RPC，会因此中断创建出售合同和作废误入住等入口。完整 RPC-only 收拢应按下面的兼容方案独立验收；不能用简单增加 `SECURITY DEFINER` 代替授权审查。

## 2. 证据范围

线上只读检查来自以下系统目录，不含客户、合同、付款、应收或凭证记录：

- `pg_policies`：`cmd`、`permissive`、角色、`qual`、`with_check`。
- `pg_proc` / `pg_namespace`：函数签名、`prosecdef`、owner、`proconfig`、函数定义。
- `has_function_privilege`：`anon` / `authenticated` 的 execute。
- `pg_class` / `has_table_privilege`：RLS 状态及各数据库角色的表级权限。
- 本地 `src`、迁移、结构基线及测试的调用关系。

检查时，四张旧财务表均启用 RLS、owner 为 `postgres`；`anon` 与 `authenticated` 均仍有较宽表 ACL，包括 INSERT / UPDATE / DELETE。`payment_receivable_allocations` 已是更收敛的例子：`authenticated` 仅有 SELECT，`anon` 无表权限。

四张旧表的行策略只对 `authenticated` 生效，没有允许 `anon` 修改行的策略。因 RLS 默认拒绝，**不能从 anon 表 ACL 或某个函数可 execute 就推导匿名写入成功**；本轮没有在线上做任何写入实验，也未报告匿名成功改账。

旧表 ACL 还包含 TRUNCATE / TRIGGER。RLS 不保护 TRUNCATE 等整表操作，但普通 PostgREST 表接口并不因此自动暴露 SQL TRUNCATE。本次没有证据证明该能力可从现有匿名 REST 路径触达；仍应在后续最小权限审计中收回无需使用的整表权限。不能将其忽略，也不能混称已复现的匿名 REST 漏洞。

## 3. 未封装的 invoker 财务入口

| 公开函数 | 当前实际调用 | 撤销表 DML 后的影响 | 后续处置 |
|---|---|---|---|
| `create_sale_contract_rpc(...)` | `src/features/sales/actions.ts` 的新建出售合同 | 插入应收、分期失败，事务整体回滚；真实入口中断 | 保留公开签名，接入明确授权的 private gateway |
| `daily_void_erroneous_checkin_rpc(uuid,text)` | 日租管理页面直接调用；外部 booking-operation gateway 也调用 | 管理页面直接调用时更新应收失败；外部 definer 调用链不一定受影响 | 同样保留签名，接入 private gateway；核验两条入口 |
| `confirm_receipt_payment(jsonb)` | 当前 `src` 无调用；保留旧函数和独立兼容测试 | 若仍被旧客户端使用，写付款/应收/流水会失败 | 确认旧客户端和维护流程后退役 execute，或单独重做受控入口 |
| `record_receivable_payment_rpc(uuid,date,text,uuid)` | 当前 `src` 无调用 | 旧 RPC 使用者会失败 | 核实外部依赖后退役，不能未经核查统一提权 |
| `generate_property_fee_receivables(date)` | 当前 `src` 无调用；未核实数据库任务/人工维护依赖 | 按登录账号调用时生成应收失败 | 独立审核任务依赖、权限与日期上限后再收拢 |

`generate_property_fee_receivables` 当前 `anon_execute = true`，但它是 **security invoker**，并不会以 owner 权限写入；其可执行性不是匿名写入成功的证据。函数本体缺显式业务角色和日期范围保护，应作为后续退役/维护入口审核项。

`create_sale_contract_rpc` 的旧实现还有两个必须在 gateway 迁移时处理的问题：

- 它依赖 RLS 保护项目范围，没有完整的显式项目销售能力校验。不能只改成 definer，否则会失去原来的行权限约束。
- request ID 重放仅按已有合同查询，未完整绑定 actor / payload。不能把原函数提升权限后继续保留这种重放判断。

此外，当前创建出售合同允许 `rental_sales`，但已核实的应收 INSERT 行策略只允许 admin / finance 或日租来源。由此可推断普通 `rental_sales` 创建非日租应收的路径可能被 RLS 拒绝；这尚未以真实账号写入验证，应在隔离测试中覆盖，而不是在线上试建合同。

## 4. 已存在的受控调用链

这些公开函数虽多为 invoker wrapper，但实际写入已进入有明确身份/业务权限检查的 private definer；仅撤销调用者直接表 DML，通常不影响其 owner 执行链，仍需逐条原生回归确认。

| 业务 | 当前调用链 |
|---|---|
| 手工记账、出售收款/分期/终止、日租财务修复 | `finance_operation_rpc` → `private.finance_operation`；出售内部 core 不向 authenticated 暴露 |
| 长租建约、激活、终止、退租 | `lease_lifecycle_rpc` → `private.lease_lifecycle` |
| 长租逐笔财务 | `record_lease_financial_entry_v2_rpc` → `private.record_lease_financial_entry_atomic` |
| 长租组合收款 | `record_combined_lease_payment_rpc` → 兼容 wrapper → 上述 private 财务入口 |
| 日租收款 | `daily_record_payment_rpc` → `private.operator_record_daily_payment` |
| 外部收款确认 | `confirm_operator_payment` / `confirm_operator_collection` → 对应 private 确认函数 |
| 外部日租流程与纠正 | `confirm_daily_workflow` / `operator_booking_operation` → private 流程函数 |

部分较早日租 RPC 本身仍是 public definer；并非所有旧函数已经迁入 private。不能在文档中宣称全库只剩一种 gateway 结构。

`renew_lease_rpc` 是真实调用中的 invoker，但本体仅更新租约期限、写审计，没有直接修改本次盘点的财务表。只撤销财务表 DML 不必然破坏它；若将范围扩大到合同表权限，必须另行迁移，不能顺手一起 revoke。

## 5. 最小兼容收拢方案（尚未实施）

1. 先固定本次系统目录清单，确认公开 API、旧收据客户端、数据库任务和维护脚本的调用范围。新迁移采用精确函数签名及显式表清单，不使用“所有 public 函数/所有业务表”的笼统 revoke。
2. 优先迁移真实使用的两个剩余 invoker：出售建约、误入住作废。保留公开签名和返回结构；将旧事务 core 置于 private 并撤销直接 execute；由新的 private gateway 完成身份、当前角色、当前项目/房源、业务能力、合法金额/日期和请求身份检查后调用。
3. gateway 必须每次重放也重查权限，使用固定 `search_path` 和全限定名称；维持既有锁顺序、事务回滚和真实 `auth.uid()` 审计。出售建约不能接受其他 actor / target / payload 借用旧请求 ID。还需考虑页面重试时自动生成合同编号的兼容问题，不能把合法重试误判为新合同。
4. 无当前应用调用的旧函数按依赖核验结果退役 execute，或单独迁移为受控维护入口。不要为了撤销表权限把缺业务守卫的 generator/旧收据函数批量设为 definer。
5. 完成兼容回归后，精确撤销 `anon` / `authenticated` 在 payments、receivables、ledger_entries、sale_payment_schedule 的直接写权限和无需使用的整表权限，保留必要 SELECT 与现有 RLS。allocation 表维持只读。service_role 的维护权限单独审计，不改成浏览器凭证。
6. 明确剩余边界：合同总价、订单预付字段、业务主表和用户资料的直接写权限不因上述四表收拢自动消失。若要宣称所有业务变动都不可绕过 RPC，需要另一个更完整的范围审查。
7. 兼容迁移验证、备份和发布独立进行；不得以恢复宽泛 GRANT ALL 作为出现回归后的随意修复。

## 6. 隔离原生 PostgreSQL 验收方案

使用应用真实结构重建、真实角色与 RLS，不用省略 ACL 的简化 mock schema。所有写入仅针对隔离库的虚构测试记录：

- 基线证据：断言项目策略确为 RESTRICTIVE；分别验证 anon、boss、finance、front_desk、rental_sales 的允许/拒绝范围，区分 INSERT 报错与 UPDATE / DELETE 影响零行。
- 收拢后：断言四张财务表所有角色的直接 INSERT / UPDATE / DELETE 均拒绝，读取仍保持项目隔离；无匿名金融写 RPC。
- 兼容成功：出售建约分别以 admin / rental_sales 验证；误入住作废分别走管理页面 RPC 和外部确认链；现有日租、长租、组合收款、出售分期、手工账和外部连接器均仍可工作。
- 授权拒绝：跨项目、已撤销授权、错误角色、CIMAC 禁售、无法访问客户/目标、错 actor 请求 ID、改 payload 重放均拒绝。
- 一致性：人为制造审计失败时，合同/订单、应收、付款、流水、分期、核销、状态全部回滚；并发重试不重建合同或多记收款。
- 数据精度：合同现金保持原子事务现有两位 XOF；日租整数约束独立保留，退款与纠错冲正分别测试。
- 退役依赖：旧收据和物业费 generator 的 execute 改动必须有明确测试及维护说明，不把未测试路径视为不存在。
- 发布验收：数据库重建、原生测试、函数 advisor、生产目录只读复核及应用只读浏览器验证分别记录。线上不以试改客户账务测试权限。

上述是后续安全工作包，不是本轮已完成的安全收拢证明。
