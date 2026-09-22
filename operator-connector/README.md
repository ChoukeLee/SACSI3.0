# SACSI 员工连接器 0.2.0

Windows 独立连接器：不依赖开发仓库、Git、npm 或员工自行连接数据库。交付包自带 Node 运行时，只保存公开的连接配置。支持本地验收包及生产候选包；候选包不代表服务端已放行。

员工操作见 [试用说明](EMPLOYEE_GUIDE.md)。双击 `login.cmd` 登录、`check.cmd` 检查身份、`logout.cmd` 退出；`setup.cmd` 生成 Codex MCP 配置片段，不覆盖用户原配置。安装仍需管理员协助一次。

Codex 订阅账号与 SACSI 业务身份相互独立。员工可以在同一台电脑、同一个 Codex 客户端中工作，但执行 SACSI 业务前必须让连接器和网页登录实际操作人的 SACSI 账号；共用 Chouke 的 SACSI 账号只会留下 Chouke 的审计身份。

## Codex MCP 接入

本地 stdio MCP，协议 `2025-06-18`。工具：`capabilities`、`new_request_id`、`query_daily_booking`、`prepare_daily_payment`、`query_collection_position`、`prepare_collection_batch`、`collection_status`。没有登录密码工具、确认付款工具或 SQL 工具。不监听网络端口，不额外调用付费模型。模型自身的使用额度仍由员工的 Codex 账号承担。

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
- 网络错误不自动重发写入。保留原请求号核查结果；不进行离线付款队列（后续阶段）。
- 每次执行先检查服务器协议与实时授权；功能标为计划中/未授权时拒绝。服务器仍会再次检查权限。
- 0.2.0 新增多行截图、日租/长租/出售整批收款及组合分账。新服务端和数据库迁移未放行时，新工具返回 `collection_upgrade_required`，旧日租工具仍兼容。
- 批次最多 30 行、100 个应收分项；整批一个原子事务。每行必须明确合同/订单、收款日期、收款方式、XOF 总额及应收分配。一个目标在一批中只能出现一次，重复行需先人工澄清或合并。
- `query_collection_position` 可按合同或楼栋房号查证；长租可提供 `periodStart/periodEnd/totalXof` 获取月租金与物业费规则建议，提供 `selectedReceivableIds/totalXof` 获取未收余额分账建议。两类建议不能代替确认。
- 只结算已有可支付应收；不自动新建应收、不推定汇率、免租或未开业规则。长租租金须明确 `paidThroughDate`，不能跳过未清账期。日租开放日期订单继续走原有人工流程。
- `collection_status` 使用原请求号找回确认链接、核查结果；超时不能换号。修改或过期重做需原请求号与旧确认 ID，新旧确认单互斥。
- DPAPI 防止令牌以明文存盘或随文件搬走；不能防御已控制同一 Windows 账号的恶意软件。

## 更新

员工保留此独立包，不同步 Git。管理员在发布节点提供版本化包和 SHA-256 清单；原 Windows 用户的站点会话可继续使用。哈希清单用于比对，**不是代码签名或可信发布渠道的替代品**。线上包必须另行审核站点配置和发布权限，本地包不得直接改地址后发放。
