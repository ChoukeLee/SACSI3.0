# SACSI 员工连接器 0.1.0

Windows 独立连接器：不依赖开发仓库、Git、npm 或员工自行连接数据库。交付包自带 Node 运行时，只保存公开的连接配置。当前构建脚本生成的是 **本地验收包**，不能交给员工当作线上系统使用。

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
- 本版本交付范围为日租查询与单笔截图收款；长租/出售/批量不是本连接器已交付能力。
- DPAPI 防止令牌以明文存盘或随文件搬走；不能防御已控制同一 Windows 账号的恶意软件。

## 更新

员工保留此独立包，不同步 Git。管理员在发布节点提供版本化包和 SHA-256 清单；原 Windows 用户的站点会话可继续使用。哈希清单用于比对，**不是代码签名或可信发布渠道的替代品**。线上包必须另行审核站点配置和发布权限，本地包不得直接改地址后发放。
