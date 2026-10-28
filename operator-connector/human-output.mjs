export function humanResult(command,result) {
  if(command==='capture')return `已在本机加密保存待办，未入账。\n请求号：${result.requestId}\n联网后让 Codex 读取此待办并补齐资料，必须保留原请求号。`;
  if(command==='recover-lock')return '已恢复异常退出遗留的锁（或原本没有锁）。未发送任何付款；请按原请求号核对待办。';
  if(command==='pending')return ['本机待处理记录（非入账凭证）',...(result.items??[]).map(item=>`${item.requestId} | ${item.kind} | ${{needs_details:'待补信息',preparing:'准备中/可能中断',unknown:'结果未知，需联网核对',awaiting_confirmation:'待网页确认/核对',completed_history:'服务器曾记录完成，勿重录'}[item.state]??item.state} | ${item.updatedAt}`),'回到 Codex，让它按原请求号恢复。不会自动补记收款。'].join('\n');
  if(command==='logout') return '已退出连接器账号。共用电脑还请退出浏览器中的 SACSI 登录。';
  if(command==='login' || command==='capabilities') {
    const identity=result.identity??{};
    const allowed=name=>result.actions?.some(a=>a.name===name && a.authorized && a.availability==='implemented');
    return ['SACSI 连接成功',`当前身份：${identity.displayName??'未知'}（${identity.role??'未知'}）`,
      `账号标识：${identity.userId??'未知'}`,`日租查询：${allowed('query_daily_booking')?'有权限':'不可用'}`,
      `截图收款权限：${allowed('record_daily_payment')?result.directExecution?.available?'有权限，明确指令后在 Codex 直接办理':'有权限，当前服务器仍使用网页确认':'不可用'}`,
      `USD/CNY长租原币收款：${result.directExecution?.available && result.directExecution.workflows?.includes('native_collection')?'已开放专用工具，不折算XOF':'未开放，不能改用XOF工具'}`,
      `建材城受控维护：${identity.role==='admin' && result.cimacMaintenanceWorkflow?.available===true && result.directExecution?.workflows?.includes('cimac_maintenance')?'管理员专用已开放':'未开放，不可改用SQL或其他收款工具绕过'}`,
      '此处显示的是 SACSI 业务身份，与 Codex 订阅账号无关。共用电脑时，实际录入人必须切换为自己的 SACSI 账号。',
      result.directExecution?.available?'直接办理只使用当前账号已有业务权限；缺项或冲突时停止，退款和冲正不是实际转账。':'注意：连接成功不代表直接办理已上线，服务器未开放时不会自动绕过网页确认。',
      '确认是本人身份后，可回到 Codex 对话。请勿共用他人账号。'].join('\n');
  }
  return JSON.stringify(result);
}
export function humanError(code) {
  const messages={login_required:'尚未登录，请双击 login.cmd，由本人输入 SACSI 账号。',
    connector_lock_not_recoverable:'操作仍在运行，或锁来自旧版/格式未知。未删除锁；请联系管理员核查，不要反复重试入账。',
    pending_storage_unreadable_do_not_reset:'本地待办无法解密或已损坏，请保留文件联系管理员，不要删除后重录。',
    pending_format_upgrade_required:'待办格式来自较新版本，请使用原版本恢复，不要重置数据。',
    pending_kind_upgrade_required:'待办业务类型不支持，已停止且未改作日租付款。请保留密文并使用对应新版查询，不要重置或重录。',
    pending_request_changed_reconcile_first:'原请求内容发生变化，请先找回原单，再核对是否需要替换，勿换号重录。',
    pending_storage_failed_keep_original_request_id:'待办保存失败，结果可能未知。保留原请求号，不要再次创建收款。',
    invalid_credentials:'账号或密码不正确，请核对后重新登录。',http_400:'登录未成功，请检查账号、密码或联系管理员。',
    connector_busy_or_stale_lock:'有操作正在进行或上次操作异常中断。请联系管理员，勿自行删锁或重复录入。',
    server_unreachable:'暂时无法连接服务器，请检查网络。',
    outcome_unknown_keep_original_request_id:'网络中断，结果尚不明确。请保留原请求号核查，不要重新编号录入。',
    direct_execution_not_enabled:'服务端尚未启用直接办理；本次没有改用网页确认或尝试业务写入。请联系管理员完成发布。',
    checkout_correction_upgrade_required:'本人账号或服务端尚未开放已退房订单更正，未发送写入。请先完成数据库、应用和连接器发布。',
    native_collection_not_available:'服务端尚未开放USD/CNY长租原币收款，未改用XOF工具、网页确认或尝试收款。请联系管理员完成发布。',
    cimac_maintenance_not_available:'本人账号或服务端尚未开放建材城管理员受控维护，未改用SQL、通用RPC或其他业务写入。',
    invalidCimacMaintenance:'建材城维护字段、日期、原币金额或整组分项不合法，未尝试写入。只允许受控业务类型，不支持任意表或列。',
    cimac_maintenance_outcome_unknown:'建材城维护结果尚未核实，可能已执行；请保留原请求号查询，禁止换号或自动重放。',
    cimacMaintenancePermissionDenied:'本人账号没有建材城管理员维护权限，不可借用他人账号或改用SQL绕过。',
    invalid_native_collection_amount:'原币金额必须为大于零、最多两位小数的十进制字符串，不能填汇率或换算XOF。',
    native_collection_allocation_mismatch:'原币收款总额与分项合计不一致，未发送收款。请核对所有分项，不要丢弃冲突项。',
    native_collection_collector_basis_required:'实际收款人与依据必须同时填写或同时留空，不能猜测为当前录入人。',
    direct_execution_outcome_unknown:'提交后的结果暂未核实，可能已经入账。请按原请求号查询，禁止换号或自动重试。',
    direct_database_upgrade_required:'服务端缺少本次业务需要的数据库迁移，未尝试写入。请管理员完成发布，不要换请求号。',
    pending_server_identity_mismatch:'查回的服务器请求号与本地原单不一致，已停止恢复；保留原请求号请管理员核对。',
    direct_execution_upgrade_required:'当前服务器或连接器还不支持这类直接办理，请联系管理员升级；不要另换请求号重录。',
    direct_result_invalid_keep_original_request_id:'提交结果未通过核验，可能已经执行。保留原请求号查询，不要重新编号或重复入账。',
    execution_result_invalid_keep_original_request_id:'服务器结果不完整，业务可能已经执行。保留原请求号查询，不要重复入账。',
    execution_verification_failed_keep_original_request_id:'结果核验未通过，保留原请求号核查，不能当作未执行后重新录入。',
    login_cancelled:'已取消登录。',connector_upgrade_required:'连接器需要升级，请联系管理员。'};
  return `${messages[code]??'操作未完成，请保留错误编号联系管理员。'}\n错误编号：${code}\n不要向 AI 或他人发送密码、访问令牌。`;
}
