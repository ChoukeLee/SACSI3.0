# 第四阶段：多行截图与组合收款

## 最新结项状态（2026-09-22）

第四阶段技术验收与生产接口放行已完成。下文“发布前剩余环境验证”保留为历史记录，Docker 阻塞已在重启后解除。

- 隔离 Supabase 的真实 Auth → 签名预览 → PostgREST 草稿 → Next.js Cookie 确认链路连续两次通过；Bearer 确认拒绝、重复确认不重复入账、分项审计身份验证通过。首轮因网页尚未启动就绪而连接失败，不计通过。
- 合成账号与本轮数据按随机 ID 清理，生产测试业务写入为 0。此前 795 项测试、21 项原生数据库测试及构建证据仍见下文，本次没有修改业务代码。
- GitHub/Vercel 业务版本为 `18250319fc088d3e310787b4bfa4ed5e6355d36d`；生产迁移 `operator_batch_collections` 已发布，平台记录版本为 `20260922174635`，对应仓库文件 `20260922171433_operator_batch_collections.sql`，不重命名历史文件。
- 线上已登录连接器返回 `collectionWorkflow.available=true`；协议为 1。原单状态只读查询通过、匿名 prepare 返回 401、Bearer confirm 返回 403；新增批次表为 0 行、RLS 开启，7 个公开 RPC 均为 security invoker、空 search_path 且 anon 无执行权。
- 0.2.0 连接包清单、哈希及 7 工具独立握手复查通过；安装到本机 `AppData/Local/SACSI/connector/0.2.0`，只更改 `sacsi_operator` 的 command/args。旧 0.1.2 和原配置备份保留。需重启 Codex 载入新进程；当前已打开会话不冒充已热更新。
- 安全 advisors 前后对照：原有匿名 definer 8 项、authenticated definer 25 项、密码泄漏保护 1 项 WARN 未新增；新增私有批次表无 RLS policy 为有意禁止客户端直读的 INFO。原有警告未在本轮擅自更改，不声称整个系统零警告。
- 小颖/黄姐实操仍按第三阶段用户决定延期；第五阶段离线恢复和升级回滚演练不在本次结项范围。

回退时先停用新批次入口或切回 0.1.2 连接包；保留新增表和审计，禁止删除已经形成的收款或批次记录。

以下为发布前开发记录：2026-09-22，本地开发版本 0.2.0。第三阶段两项人员验收由用户确认延期。开发期间没有生产业务写入、没有开通付费资源；最新发布状态以上方结项记录为准。

## 已实现

- 外部 Codex 理解多行图片，保留每行原文；通过 `query_collection_position` 读取实时合同/订单、客户、应收、物业费规则和销售分期。多合同匹配返回候选，不擅选。
- 分账建议同时支持合同月单价与有生效区间的物业费规则、已选应收项未收余额。384 万西法、月租 60 万、物业 4 万、六个月得到 360 万租金 + 24 万物业费。免租、期间不是整月、规则重叠、缺少规则或总额不一致均返回澄清问题。
- 每批最多 30 行、100 个分项；明确 XOF、收款日、方式、目标、总额与具体应收 ID。重复目标/重复应收拒绝，逐行合计与整批合计必须一致。
- `prepare_collection_batch` 生成账号、版本、期限、请求和实时快照绑定的签名预览与网页确认单，不执行付款。网页同账号确认，HTTP 拒绝 Bearer 和跨来源请求。
- 整批单一 PostgreSQL 事务：日租沿用原子日租财务逻辑；长租按指定应收分项记租金/物业费/押金；出售按唯一匹配分期更新应收与期款状态。长租更新明确的已缴至，禁止越过仍有欠款的租金应收。押金到足额后更新到账状态。
- 任意一行失败整批回滚。数据库内复查付款、流水、应收增量、账号审计；整批与每个子项有稳定请求号。相同请求号不同内容冲突，重复确认只返回原结果。
- 原请求号查询 `collection_status` 恢复链接与结果；过期/修改可携旧确认 ID 重做，旧页作废。失败或结果未知不能换号重录。
- 审计记录账号 ID/邮箱/角色、整批和子项请求号、截图行、原始文字、原应收依据、金额及前后值；审计页显示分项收款与行号。

## 明确业务边界

本阶段结算已有的可支付应收；不能自动造应收、猜汇率、编造免租/折扣。合同计费建议不是账务凭证，仍须与现有应收及已收核对。未开业合同、开放日期日租、未确认出售总价、缺失或重复的分期映射会停止并要求协助。截图不存入服务器，识别文本及计算依据保存于确认单和审计。离线待办与升级回滚属于第五阶段。

## 可复现验证

- `npx vitest run tests/operator-collection-database.test.ts tests/operator-collection-route.test.ts tests/operator-mcp.test.ts tests/operator-connector.test.ts`
- `npm run test:operator-concurrency`：原日租并发测试及新整批并发、完整应用结构原生 PostgreSQL 测试。
- `npm test`、`npm run validate`。
- `node scripts/preview-audit.mjs` 后打开 `http://127.0.0.1:4177/collections.html`：合成多行确认页，不连接数据库，确认按钮仅演示。
- `node scripts/package-production-operator.mjs` 和 `node scripts/check-operator-package.mjs <目录>`：仅产出候选包和核对清单，不上线。
- Docker 恢复后启动 `node scripts/start-local-operator-web.mjs`，另一个终端运行 `node scripts/check-local-collections.mjs --apply`。脚本只接受固定回环隔离库，使用临时真实 Auth 账号走签名预览、草稿、Cookie HTTP 确认、防重和审计，并清理本轮合成数据；目前只通过语法检查，执行在 Docker 隔离检查处停止，未记为通过。

本轮证据：全量 795 项通过、1 项跳过；原生 PostgreSQL 共 21 项通过（含 3 项新批次并发和 1 项完整应用结构验收）；类型检查、日租规则和 Next.js 生产构建通过。HTTP→实际 SQL 的集成覆盖提交后丢失响应与同单恢复；浏览器合成预览确认了两行分账显示、勾选门槛和确认反馈。已保留工作区既有房态/经办人修改，并把对应名单测试补上已有的“5号前台”，这不是本阶段新增人员决定。

候选包：`work/SACSI-operator-0.2.0-candidate.zip`，SHA-256 `8d4732bb90c8b6d7f48cf5113b7bdcbd4580bc92d0a3a414c2eb1451b074d856`；包文件清单、哈希、私密环境值排除与独立工作目录的 7 个 MCP 工具握手检查通过。没有替换当前安装的 0.1.2。

完整结构测试加载 `20260916.application-schema.json` 的表、约束、触发器、RLS 和权限，再应用待发布 SQL；没有生产业务数据。测试 JWT 是本地构造的 Auth 上下文，不能称为真实 Supabase 登录验收。

## 发布前剩余环境验证

本机 Docker 启动失败：`sailor-ingest.sock` 残留重解析点无法访问，后端退出。已核对后端进程停止并尝试用原生 PowerShell 清理该单一临时 socket，但执行策略拒绝（`blocked by policy`）；未换工具绕过、未删除文件、未删除 Docker 数据或恢复出厂设置。已使用独立、仅回环监听的原生 PostgreSQL 验证完整应用结构和并发事务；Docker 恢复后仍需补充真实 Supabase Auth/PostgREST 到 Next.js 的新批次端到端联调。旧第三阶段登录验证不能替代本次新链路验收。

生产发布必须先完成上述联调，再部署 `20260922171433_operator_batch_collections.sql`、服务端和 0.2.0 包；新连接器检查 `collectionWorkflow.available`，旧数据库不具备能力时明确拒绝新工具。生产不能使用合成付款测试。当前技术开发可审阅，但阶段全项验收/生产放行尚未签署。
