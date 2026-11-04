# 明确月份缺失账单与实收登记 v1

处理已起租且生效的 XOF 月租合同：用户明确一个完整自然月及已收全额月租，原系统却没有该月账单。`collect_missing_monthly_rent_rpc` 在一笔数据库事务中创建有明确服务期的账单，并调用现有 `lease_collection_rpc` 完成收款、分账、流水及审计；任何一步失败全部回滚。

本功能不更改租期、客户、租金、押金、其他账单、房态或已缴至日期。旧账未登记、账期存在缺口时，本笔月份可独立入账，原台账覆盖日期保留，历史差异须单独核对。不得把未知旧月份推算为已付或代录旧收款。

## 权限与范围

- 本人 authenticated JWT；admin、组合收款 L3、租金收款 L2 和房源范围同时通过。
- 独立 `private.missing_rent_collection_protocol` v1 开关；关闭后拒绝本功能，现有业务不受影响。
- 仅 XOF 月付合同、完整自然月、正整数金额且等于合同月租。已确认租期不允许超出。更复杂账期仍需专项支持。
- 原账单在月份内到期、服务期重叠（包括已取消账单），或同合同同收款日同金额已有租金付款，均拒绝并要求核对。
- 整件请求保留一个 UUID。快照令牌绑定原合同、收款、账单和分账/账本；执行时锁定父合同及相关记录并重新核验。请求号与本人、合同、完整输入绑定，不允许变更原请求重放。
- 业务 SQL 不通过管理员直接记账。本迁移仅发布函数及协议表，不插入任何租户账单/收款。业务调用仍使用本人的 JWT，不使用 service_role。

## Mac 补充执行入口

新增 `operator-connector/missing-monthly-rent.mjs` 为固定函数名的窄客户端；`missing-monthly-rent-cli.mjs` 复用已安装且完整性校验通过的 `connector-0.8.0-mac-checkout-revision`，沿用 Keychain/本人加密会话及跨进程锁。原安装包、原加密待办和配置不替换或删除，不声称旧 capabilities 已加入此工作流；独立数据库协议及权限是本功能的实时能力入口。

输入仅支持 `requestId,contractId,periodStart,periodEnd,amountXof,paymentDate,paymentMethod,reason,inputSource`，可选 `externalReceiptNo`。来源必须如实标注截图或自然语言。现金修订不沿用旧支票号。

1. `node operator-connector/missing-monthly-rent-cli.mjs prepare /absolute/request.json`：仅只读查询，并保存不可覆盖的准备文件。
2. `execute`：写前持久化未知状态，按本人身份调用一次整件 RPC。提交前原号查到已完成即只读恢复，不再次提交。
3. `status`：只读查原请求及实时账单/付款。核验 actor、金额、币种、日期、方式、服务期、账单核销、付款关联、原覆盖日期后才能报告 completed/verified。

网络错误、进程退出、无法解析响应都保留未知状态；不得删除准备/状态文件、换请求号或自动重放。服务端同号同输入重试仍具幂等保护。原本机 note 待办可能包含历史支票信息，最新用户现金修订以业务请求文件为准，原 note 作为历史依据保留。

## 验证

`tests/missing-monthly-rent.native.ts` 使用全新本机 PostgreSQL 覆盖原子性、原账保留、权限/开关/范围、严格输入、快照变化、重叠/重复和并发。`tests/missing-monthly-rent-connector.test.ts` 覆盖窄输入、截图来源、实时查回、协议缺失和未知结果保护。
