# 外部连接器生产发布记录

## 2026-09-16 发布准备与数据库更新

用户明确授权推送并线上放行；不升级套餐，不开通付费资源，不向生产写测试收款。

发布前完整 public/private 应用结构与 `supabase/baselines/20260916.application-schema.json` 相同。生产五项迁移已逐项执行成功，均设置事务锁等待 5 秒、语句执行 60 秒上限。Supabase 发布工具生成的线上版本与本地源文件对应如下；不得按旧文件名再次重放。

| 本地源版本 | 线上迁移版本 | 名称 |
| --- | --- | --- |
| 20260915150854 | 20260916195857 | harden_operator_daily_payment_integrity |
| 20260915162247 | 20260916195858 | add_operator_payment_confirmations |
| 20260915222405 | 20260916195859 | add_operator_confirmation_reprepare |
| 20260916170356 | 20260916195900 | harden_receivable_timestamp_search_path |
| 20260916173232 | 20260916195901 | restrict_property_fee_rule_access |

线上 34 张应用表、78 个函数、104 项策略与本地已验收结构对照：表结构、函数体、策略、索引、约束、触发器一致；原有 ACL 顺序不影响权限。仅 `operator_daily_payment_protocol_version()` 的 `service_role` 执行权来自线上默认授权，比本地多一项，为只读协议版本查询，不授予员工高权限身份。

Vercel Production 已保存 `SACSI_OPERATOR_PREVIEW_SECRET`（随机生成，不写仓库）、`SACSI_OPERATOR_PUBLIC_ORIGIN=https://sacsi-3-0.vercel.app`、`SACSI_OPERATOR_CONFIRMATIONS_ENABLED=true`。须等新部署生效及正常账号核验通过，才算线上放行完成；本记录此处不预填部署/测试成功。

## 线上放行结果（20:06 UTC）

功能提交 `d05c93fc3092e31b138aa7d62cce27ee6a7db097` 已推送 main，Vercel 部署 `EeCQ12Zz9r55HNnasggDagnBnmCE` 为 Production / Ready，正式域名已切换。

使用普通 admin 账号真实登录，对 `https://sacsi-3-0.vercel.app` 执行上述只读发布检查并通过：返回提交号正确、数据库协议 2、身份匹配、匿名 401、Bearer 确认 403、确认功能开关生效、真实日租查询和签名预览成功。未创建确认单、未入账，测试会话已单独退出。不是 service-role 代替员工验收。

因此本次日租查询和单笔截图收款的服务端技术放行完成。员工电脑安装、本人确认真实凭证、黄姐独立账号及审计阅读反馈仍是第三阶段待办，不计为已通过。

连接器 0.1.1 的已核验包位于 `work/SACSI-operator-0.1.1-candidate.zip`，SHA-256：`47e91660b1e1cb2d630181374ac4f953776085b2dbe9ad1a67f7cd6e698d3471`。此精确哈希的候选包现可用于受控员工试用；文件名保留以避免混淆版本。不要发送本地测试包或包含会话文件的目录。

回归证据：749 项测试通过、1 项跳过，类型检查通过；发布前另跑只读预览路由 12 项测试通过，Vercel 生产构建通过。未新增付费服务。剩余历史安全提示见下文，不能把本次上线视为完整安全审计完成。

## 安全告警范围

本轮修复了函数可变 search_path 告警，收紧物业规则策略，新增确认入口为 authenticated-only SECURITY INVOKER，匿名不可执行。未宣称全部安全告警清零。

仍有历史提示：8 个匿名可执行 SECURITY DEFINER 函数、25 个已登录可执行 SECURITY DEFINER 函数，以及未开启泄漏密码保护。它们包含登录限流、角色辅助及旧业务 RPC，需逐项专项审查，不能批量撤权导致登录/业务中断。新增 private 确认表无员工直读策略是有意设计，由校验身份的函数访问。

- [函数权限告警说明](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [泄漏密码保护说明](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

## 线上核验及回退

运行 `node scripts/check-production-operator.mjs <部署的完整提交号>`，在隐藏密码终端由本人登录。只读取订单、签发不落库的预览并验证匿名/连接器无法确认；不创建待确认单，不执行收款。测试结束注销该测试会话，不影响其他设备登录。真实员工收款及审计可读性仍需本人验收。

紧急暂停：将 Production 的 `SACSI_OPERATOR_CONFIRMATIONS_ENABLED` 改为 `false` 并重新部署；保留已有付款和审计，不能删除确认表或冲销真实业务来“回滚发布”。重新部署会让旧的待确认单部署绑定失效，需沿原请求号重新准备，不能换号重录。网页普通业务入口独立于此截图确认开关。
