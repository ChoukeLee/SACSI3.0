# 第五阶段：待办、离线恢复、兼容和发布回滚

日期：2026-09-23。交付范围为本地开发、技术验收和发布材料；沿用“不每轮推送”的决定，不修改生产业务、部署或员工安装。生产发布和员工实际使用不能用本地测试代替。

## 已实现的完整流程

1. 三类准备操作（单笔日租、多行整批、续住/退房组合）在发网络请求前将完整原输入和稳定请求号加密落盘。写入失败即停止发送。
2. 本地待办按站点和 SACSI 账号隔离；进程重启、软件升级或退出登录不删除待办。列表只显示阶段/编号/时间，读取原文需当前账号；离线身份不授予线上权限。
3. 资料不完整时用 `capture_pending` 留待办；完全断网且无法使用 Codex 时双击 `capture.cmd` 保存简短文字，图片继续按原流程保存。不声称本地运行了 AI 或能离线入账。
4. `recover_pending` 由用户明确调用，联网重新检查身份和能力后按原号查服务器。完成则标记历史完成且不重录；未决则返回原确认页；只有明确未找到时才重新准备原号确认单。没有后台轮询、自动付款、换号重试或静默丢弃冲突行。
5. 修改原单必须指定与本地记录匹配的旧确认 ID；已完成记录不能重做。服务端重新核对账务、签名及权限，仍由本人网页确认。
6. Windows DPAPI 当前用户加密，写临时密文、刷新、再替换。数据损坏、未来格式和达到容量上限均失败关闭，不删除重建。每账号 500 条/4 MiB；没有自动清空历史策略。
7. 异常退出的进程锁可由 `recover-lock.cmd` 恢复：排他句柄、防活跃进程/PID 复用、拒绝旧格式。不自动抢锁，不把解锁当成业务未执行。
8. 新版启动前校验包文件哈希与可执行文件清单。独立版本目录和候选发布材料支持升级/回滚；不覆盖用户全局设置、旧版本或会话目录。

## 数据库与权限

新增只读 `find_operator_payment_confirmation`，用真实认证用户查自己的原请求号，同时核查当前业务授权和房间可见性。公用入口为 invoker，私有实现受限 definer、空 search_path；匿名和 service_role 不开放。没有新业务写接口或生产数据回填。

迁移：`20260923082259_operator_pending_recovery.sql`。组合业务前置迁移：`20260923080038_operator_daily_workflow.sql`。线上均未执行。

## 技术验收与复现

- `npm test`：871 项通过、1 项跳过，覆盖密文、跨账号、退出登录、重启、未知结果、原号恢复、变更拒绝、未来/损坏格式、存储故障、权限撤销、单笔/批次恢复和包篡改拒绝。
- `npm run test:operator-concurrency`：真实 PostgreSQL 全套 34 项通过，包括新增原号查询所有权、权限撤销及完成状态不冒充实时复核。
- `npm run typecheck`、`npm run check:daily-rental-rules`、`node scripts/start-local-operator-web.mjs --build`。
- `node scripts/check-operator-recovery.mjs <0.4.0包>`：真实 Windows DPAPI，272KB 合成数据，重启与注销保留，未来格式拒绝，活动锁拒绝、已退出进程锁恢复。
- `node scripts/check-local-booking-workflow.mjs --recovery-package <0.4.0包>`：固定回环 Supabase+Next，真实 Auth；模拟服务端已创建确认单但回复丢失，再按原号恢复、本人网页确认、再次恢复不重复入账。随机合成账号/业务，清理后退出会话，生产写入 0。
- `node scripts/check-operator-package.mjs <生产候选包>`：清单完整、无私有环境值、公开配置、独立 MCP 启动。
- `node scripts/check-operator-rollback.mjs <0.4.0包> <原0.2.0包>`：旧新版独立启动、会话读写兼容、旧版退出不删除新版待办、新版重开待办。只用隔离合成 Windows 配置，无生产调用。
- 本地 security advisors 无 warn/error。全库 db lint 仍报告旧 `confirm_receipt_payment` 的 text→currency_code 类型问题，本轮新恢复函数无错误；不宣称修复了旧收据流程。

## 发布清单（尚未执行）

1. 保存当前服务器发布编号、旧包完整目录及可信 SHA-256；核对所有待决请求，不按新编号重录。
2. 发布服务器前本地验收；线上只部署两条增量迁移，再部署匹配代码。旧表/账务不删除，不降级数据库来回滚。
3. 用普通账号只读核验能力、身份和恢复端点，不制造生产测试付款。旧服务器没有新恢复端点时，新连接器保留待办并报错，不绕过权限。
4. 用 `node scripts/prepare-operator-release.mjs <新包> <旧包>` 生成独立交付目录：`release.json`、`upgrade-config.toml`、`rollback-config.toml`。配置默认禁用；管理员核对目标站点、包清单及服务端发布后再启用。哈希不是数字签名，需要可信分发渠道。
5. 保留旧目录，将现有单个 MCP 配置改为完整新包路径，不能重复添加服务器。重启应用后检查版本、本人身份、待办；不把密码交给 AI。此处未代替用户实际安装或改其全局配置。

## 回滚清单

- 暂停新确认，核对待决请求；必要时关闭 `SACSI_OPERATOR_CONFIRMATIONS_ENABLED`。保留所有原编号、密文、数据库确认历史和财务审计。
- 回退应用发布及 MCP 包路径，不回退/删除增量表或财务记录。回滚配置默认禁用，管理员完成核对后启用。
- 0.2.0 不认识 0.4.0 本地待办和组合业务；回滚期间这些业务暂停，不能改用旧单笔工具拆开或另起编号。回到 0.4.0 原 Windows 用户后原待办仍可读取。
- 用户真实收款不靠数据库删行“撤回”；更正仍按原业务冲正/确认流程。

## 明确不包含

生产上线、真实员工试用（按用户决定延期）、跨 Windows 用户或跨设备解密、离线 AI/图片识别、自动离线付款、旧收据独立缺陷修复。系统只能审计登录账号，无法证明共用同一业务账号时实际坐在电脑前的人。

## 本机交付物

- 生产候选包：`work/operator-0.4.0-production-candidate-ifAk2n`，已核对全部哈希、私有环境泄漏和独立启动。
- 本地验收包：`work/operator-0.4.0-local-CS3EBB`，已验证真实 DPAPI、异常进程锁、真实 Auth 及丢失响应恢复。
- 发布/回滚材料：`work/operator-release-ZDh5HO`；旧版对照 `work/operator-0.2.0-production-candidate-PT78lJ`。均未安装到实际员工目录，未修改 Codex 配置。
- 分发压缩包：`work/operator-release-ZDh5HO/SACSI-operator-0.4.0-candidate.zip`，SHA-256：`dca22a0a50ae77fe1aab0279dd58fd1a737769a44042618c504831623dd093f7`。候选包不是已经上线的正式发行版。
