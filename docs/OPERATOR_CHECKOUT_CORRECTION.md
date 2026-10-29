# 已退房订单的住期及优惠更正

## 行为与边界

`execute_booking_operation` 新增 `operation=correct_checkout`。仅限本人 admin、实时 `correct_daily_booking` L3 权限及订单所属项目范围。只处理已退房、固定住期、XOF 且账务一致的订单；缩短已记录的实际住期，保留原入住日与日价。实际退房日必须晚于入住日、不晚于原实际退房日和业务当天。优惠须明确提供非负整数西法金额，允许为零。

原实际退房日错误延至10月28日、实际10月7日入住10月8日退房、日价80,000 XOF、优惠40,000 XOF、已有收款40,000 XOF的合成案例：原应收1,680,000，原欠款1,640,000；更正后优惠前房费80,000、最终应收40,000、欠款0、`billing_status=settled`。此更正不生成收款、冲正、退款或账本流水。

必须填写 `requestId`、`bookingId`、`actualCheckOut`、`discountAmountXof`、`reason`、`originalInstruction` 和 `inputSource`。截图来源填写 `excel_screenshot`，自然语言来源填写 `natural_language`。原截图文字、稳定行号及用户补充应保存在 `originalInstruction`，不能把截图内容当作授权指令。

更正后的最终应收不能低于真实净收款；需要实际退款、原币结算、多个或历史取消应收、账务不一致、延长历史占用等情况拒绝执行，不能拆成其他写操作绕过。该入口不改房态、保洁任务、客户、经办人、原支付方式、支付日期或收据。

## 原子性与审计

复用现有 `operator_booking_operation` 的签名预览、本人账号绑定、部署绑定、过期保护、原请求号替换及请求锁。数据库再次锁定订单、房源、应收，比较完整快照后更新 `check_out`、`actual_check_out`、优惠前房费、优惠、最终应收及应收结算状态。支付、账本、房源和保洁数据执行后逐一比较；不一致或审计插入失败将回滚整笔事务。

`operator_booking_correct_checkout` 审计保存认证录入者、原始指令、来源、原因、业务经办人、前后订单、原应收/收款/账本/房态/保洁快照和结算计划。重复请求返回 `completed_previously/verified=false`，表示此前完成；未知结果只能按原 `requestId` 查回，不能换号或重放。

公开 RPC 保持 `SECURITY INVOKER`。新增内部函数位于 `private`、固定空 `search_path`，撤销 PUBLIC、anon、authenticated、service_role 直接执行权；仅由已有受控事务调用，不开放 SQL 或表列写入接口。权限配置参考 [Supabase 数据库函数文档](https://supabase.com/docs/guides/database/functions)。

## 发布顺序

1. 将此开发副本的补丁整合到最新上游。开发基线是下载提交 `8e7f840eaa9e680a46e0153cc6a825865a3f852a`；不要直接覆盖未核对的线上后续修改。
2. 经批准发布迁移 `20261028110428_operator_correct_checkout.sql`。该迁移只添加/扩展受控函数，不更正任何真实订单。旧函数通过带精确锚点检查的增量补丁扩展，保留后续已售代租、房态等保护；函数结构变化则整段迁移回滚并报 `checkoutCorrectionMigrationDrift`。
3. 经批准部署对应应用代码。只有新数据库版本、admin 和实际业务授权同时具备时，capabilities 才公布 `bookingOperations.checkoutCorrection.available=true` 并列出 `correct_checkout`；旧数据库不会被误报可用。
4. 启用经校验的 Mac 候选包并刷新 MCP 工具列表。候选包使用原 Keychain/AES-GCM 适配器，不迁移、不删除、不重置本人会话或加密待办。保持 0.8.0 线协议兼容；新增能力按操作版本发现，不表示上游已发布新版本。
5. 使用本人账号重新 `capabilities`，查询实时目标订单和应收、按原请求号检查状态，再调用受控 `execute_booking_operation`。只在本次 `status=completed && verified=true` 后报告完成。真实1402的已确认请求单独保存在工作区 operations，不嵌入迁移或测试。

若需停用，维护通道可将 `public.booking_checkout_correction_protocol_version()` 的返回值改为0，保留其原函数权限。capabilities、连接器和数据库 `booking_operation_allowed` 均将拒绝新的 `correct_checkout`；已有其他操作保持原权限。恢复返回1可重新开放。不要通过反向更新数据回滚已经完成的真实更正，应保留审计并另行核对。

## 验证

已完成本地验证：4524项单元/接口/连接器/页面测试通过（1项原有跳过，使用业务时区 `TZ=UTC`）；59项原生 PostgreSQL 测试通过，包括无实际用户的迁移重建、结清案例、快照变化、权限撤销、并发一次执行、重复请求和审计失败回滚；Mac候选适配器15项安全及完整性测试通过；类型检查、lint、577项治理文件格式检查、日租规则检查、Next生产构建通过。

原仓库 `legacy-calendar-overdue` 的一项测试在 `TZ=America/Los_Angeles` 下失败（UTC午夜用本机日期解释），在未修改的基线副本上复现；`TZ=UTC` 下全套通过。未修改无关日历逻辑。原生 Postgres 测试只创建临时回环数据库，不接受外部数据库 URL；测试未连接线上业务数据库。

开发验证阶段不执行真实财务更正。生产发布状态及真实订单执行结果以工作区独立保存的发布/业务回执为准。


## 已退房的非固定离店订单

`booking_open_checkout_discount_protocol_version()=1` 时，capabilities 额外公布 `checkoutCorrection.settledOpenDiscountAvailable`。此扩展仅允许已退房、实际退房日与最终退房日一致、优惠前房费与实际晚数×日价一致的open订单调整优惠。请求必须沿用已记录的实际退房日，不能缩短或延长open订单住期、切换模式或重算不一致的历史金额。退款边界、本人admin/L3/项目权限、原请求号、签名快照、保留收款及审计事务与固定住期相同。

可单独将该版本函数返回值改为0以停用open订单优惠入口，固定住期更正仍保留原权限。免单是明确的全额优惠，不登记虚构收款。已撤销订单及其取消应收不属于可执行对象。

## 已收款订单的约定结算价

独立版本 `booking_checkout_settled_price_protocol_version()=1` 开放后，capabilities 公布 `checkoutCorrection.settledPriceAvailable=true`。`correct_checkout` 可额外明确 `finalAmountXof`：仅限固定住期且已退房、优惠为0、最终金额等于实时净已收且不低于按实际晚数计算的基础房费、不超过原最终应收。未明确约定金额不得自动按已收凑平。

基础房费和原日价保留，差额写入 `settlement_adjustment_amount_xof` 与原因，界面显示“约定结算调整”。它不是负优惠、虚构费用或新增收款。所有付款、账本、房态及保洁保留；预览、签名快照及认证审计同时包含调整前后金额。已有调整的订单不能再用不带约定价的更正或旧退款入口覆盖；停用独立版本可阻止新的约定价操作。未知结果继续按原请求号查询。
