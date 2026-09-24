# SACSI 员工连接器 0.5.0

0.5.0 发布验收记录见仓库 `docs/OPERATOR_BUSINESS_STAGE2.md`。本文说明当前源码能力，员工实际使用的版本以独立安装包为准；源码更新不等于安装包已替换，业务是否可用仍以服务端实时能力检查为准。

Windows 独立连接器：不依赖开发仓库、Git、npm 或员工自行连接数据库。交付包自带 Node 运行时，只保存公开的连接配置。支持本地验收包及生产候选包；候选包不代表服务端已放行。

员工操作见 [试用说明](EMPLOYEE_GUIDE.md)。双击 `login.cmd` 登录、`check.cmd` 检查身份、`logout.cmd` 退出；`setup.cmd` 生成 Codex MCP 配置片段，不覆盖用户原配置。安装仍需管理员协助一次。

Codex 订阅账号与 SACSI 业务身份相互独立。员工可以在同一台电脑、同一个 Codex 客户端中工作，但执行 SACSI 业务前必须让连接器和网页登录实际操作人的 SACSI 账号；共用 Chouke 的 SACSI 账号只会留下 Chouke 的审计身份。

## Codex MCP 接入

本地 stdio MCP，协议 `2025-06-18`。保留 0.4.0 的 15 个工具，新增 `query_booking_options`、`plan_booking_operation`、`prepare_booking_operation`、`booking_operation_status`，共 19 个工具。没有登录密码工具、确认付款工具或 SQL 工具。不监听网络端口，不额外调用付费模型。

## 0.5.0 业务操作

新建固定住期预订、仅入住不收款、取消无收款预订、修改住期/日价、转移未入住无收款预订、纠正已入住或有收款订单录错的房号、错误收款冲正、已退房实际退款、无收款误入住撤销。所有写操作先产生本人网页确认单，高风险页面另行核对原因与影响。

- `create` 明确 `unitId`、`bookingAgentId`、`checkIn`、`checkOut`、`nightlyPriceXof`，客人姓名使用独立 `guestName`；不把经办人当实际登录身份。
- `change_stay` 明确调整后入住日、退房日和日价，保留已有优惠；不能自动制造退款或隐藏欠款。
- `transfer` 是未入住无收款预订换房；`correct_room` 是整单原房号录错的纠正，不是实际搬房。已完成退房或已有保洁历史转协助。
- `reverse` 明确原收款 ID 和原因，是纠错，不是实际退钱。
- `refund` 只记录已退房、XOF 订单的实际退款，明确金额、日期、方式、调整后最终应收和原因，不调用银行。超过已收减最终应收的部分拒绝。退款后普通旧页面不能直接整笔冲正原收款。
- 所有操作保留原 `requestId`，待办种类为 `booking_operation`；已完成再次查询只报告历史状态，不能宣称复查了之后的全部账务。
- 服务器必须返回 `bookingOperations.available=true`。候选包不代表线上启用；旧 0.4.0 不支持新业务待办，回退期间停止处理这种待办，保留密文并用 0.5.0 恢复。
- 长租、物业费、出售收款继续使用 `query_collection_position` / `prepare_collection_batch`，不另造财务录入路径。

按 [OpenAI 官方 MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) 配置绝对路径的 `node.exe` 与 `mcp-server.mjs`。移动包后重新运行 setup 并更新配置。连接器和浏览器各自登录，网页确认必须与连接器同一账号。

## 使用

1. 首次在包目录运行 `.\node.exe .\cli.mjs login`，输入本人 SACSI 账号。密码不显示、不落盘，也不要交给 AI 对话保存。无需放宽 PowerShell 执行策略。
2. 外部录入工具通过包内 `node.exe cli.mjs capabilities` 查看本人的实时能力。
3. 查询/截图收款请求以 JSON 经标准输入传给 `node.exe cli.mjs execute`。请求必须预先保存同一个 `requestId`；断网重试不得新建编号。协议版本由连接器填入。
4. 截图收款只返回预览和本人网页确认链接，不自动点击确认，不把“已生成确认单”描述为“已入账”。
5. 离开共用设备前运行 `node.exe cli.mjs logout`。远程注销失败会报错，但仍清除本地会话；需联网后在系统中处理其他有效会话。

查询格式：`actionName: query_daily_booking`，`input: {bookingId: UUID}` 或 `{buildingCode: 楼栋, unitNo: 房号}`。截图收款格式：`actionName: record_daily_payment`，`inputSource: excel_screenshot`，`input: {bookingId, amountXof, paymentDate, receiptNo}`。共同字段：UUID v4 `requestId`、`scope: business_data`、`exceptionalBusinessCase: false`、`originalInstruction`、`inputSource`。

## 安全与边界

- 仅普通账号访问令牌；不接收 service role，不提供任意 SQL/RPC，不提供截图确认接口。
- 会话以 Windows 当前用户 DPAPI 加密，放在 `%LOCALAPPDATA%\SACSI\operator\<站点标识>`；密码不保存。换电脑或 Windows 用户不能直接搬用该会话。
- 同一站点每次操作串行加锁，避免刷新令牌竞争。操作中断遗留锁会拒绝继续；管理员确认没有连接器进程后，才可删除该站点的 `operation.lock`。不会自动抢占未知操作。
- 准备确认单前，先用 DPAPI 加密保存原请求；网络错误不自动重发。离线待办不是付款队列，恢复不会代为网页确认。`recover_pending` 经用户要求才查询原单；仅服务器明确未找到时，用原号重新准备确认单。
- 每次执行先检查服务器协议与实时授权；功能标为计划中/未授权时拒绝。服务器仍会再次检查权限。
- 0.2.0 新增多行截图、日租/长租/出售整批收款及组合分账。新服务端和数据库迁移未放行时，新工具返回 `collection_upgrade_required`，旧日租工具仍兼容。
- 批次最多 30 行、100 个应收分项；整批一个原子事务。每行必须明确合同/订单、收款日期、收款方式、XOF 总额及应收分配。一个目标在一批中只能出现一次，重复行需先人工澄清或合并。
- `query_collection_position` 可按合同或楼栋房号查证；长租可提供 `periodStart/periodEnd/totalXof` 获取月租金与物业费规则建议，提供 `selectedReceivableIds/totalXof` 获取未收余额分账建议。两类建议不能代替确认。
- 只结算已有可支付应收；不自动新建应收、不推定汇率、免租或未开业规则。长租租金须明确 `paidThroughDate`，不能跳过未清账期。日租开放日期订单继续走原有人工流程。
- `collection_status` 使用原请求号找回确认链接、核查结果；超时不能换号。修改或过期重做需原请求号与旧确认 ID，新旧确认单互斥。
- DPAPI 防止令牌以明文存盘或随文件搬走；不能防御已控制同一 Windows 账号的恶意软件。

## 更新

员工保留此独立包，不同步 Git。管理员在发布节点提供版本化包和 SHA-256 清单；原 Windows 用户的站点会话可继续使用。哈希清单用于比对，**不是代码签名或可信发布渠道的替代品**。线上包必须另行审核站点配置和发布权限，本地包不得直接改地址后发放。
# 0.3.0 开发说明

0.3.0 引入 `search_daily_bookings` 与 `plan_daily_change` 两个只读工具，以及 `prepare_daily_workflow`（准备整件业务确认单）、`daily_workflow_status`（按原号查状态），0.5.0 保留这些能力。后两项还要求服务器和数据库声明 `dailyWorkflow.executionAvailable=true`。固定住期的续住收款、退房收款由本人在网页确认后原子执行，不得拆成独立写操作绕过。金额、住期、付款日期、方式必须明确；超额收款、特殊折扣、账务不一致转人工。

## 0.4.0：待办和恢复

- `pending.cmd`：查看本机当前登录账号的待办。`capture.cmd`：完全断网时手工保存单行凭证说明，先确认本地保存的账号身份；没有既有登录会话时不能冒用其他账号保存。
- 待办存于站点目录的 `pending-v1/<账号摘要>.dpapi`，按 Windows 用户、站点和 SACSI 账号隔离。加密文件写完并刷新后才替换旧文件。每账号最多 500 条、4 MiB 明文内容；达到上限时拒绝发送，联系管理员备份核对，不能删库重录。
- 只保存原输入、稳定请求号、确认 ID/链接、阶段与时间。不保存密码、预览签名、服务器客户查询结果或图片；原截图需继续保存。DPAPI 不能抵御已控制同一 Windows 用户的程序，不支持直接搬到另一台电脑解密。
- 退出登录删除令牌、不删除待办；重新登录原 SACSI 账号后恢复。身份在离线时只是本地缓存，网络恢复必须重新认证并核查权限。
- `recover-lock.cmd` 仅人工运行：使用排他文件句柄检查锁中进程确已退出后，删除该遗留锁。运行中的进程、复用 PID、旧版空锁或未知格式均拒绝；不抢占操作，不删待办。
- 启动时核对包内哈希和可执行文件清单。哈希不是数字签名，只能与可信渠道提供的清单共同使用。新版或损坏待办格式拒绝读取，不自动重置。
- 发布/回滚用独立完整目录；不覆盖运行中的包或个人会话。旧版看不到新待办，不可在回滚后另起请求重录未决业务。详见仓库 `docs/OPERATOR_STAGE5_ACCEPTANCE.md`。
