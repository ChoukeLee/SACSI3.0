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
      `截图收款权限：${allowed('record_daily_payment')?'有权限，仍需网页确认':'不可用'}`,
      '此处显示的是 SACSI 业务身份，与 Codex 订阅账号无关。共用电脑时，实际录入人必须切换为自己的 SACSI 账号。',
      '注意：连接成功不代表服务器截图确认功能已发布。请先由管理员完成上线核验。',
      '确认是本人身份后，可回到 Codex 对话。请勿共用他人账号。'].join('\n');
  }
  return JSON.stringify(result);
}
export function humanError(code) {
  const messages={login_required:'尚未登录，请双击 login.cmd，由本人输入 SACSI 账号。',
    connector_lock_not_recoverable:'操作仍在运行，或锁来自旧版/格式未知。未删除锁；请联系管理员核查，不要反复重试入账。',
    pending_storage_unreadable_do_not_reset:'本地待办无法解密或已损坏，请保留文件联系管理员，不要删除后重录。',
    pending_format_upgrade_required:'待办格式来自较新版本，请使用原版本恢复，不要重置数据。',
    pending_request_changed_reconcile_first:'原请求内容发生变化，请先找回原单，再核对是否需要替换，勿换号重录。',
    pending_storage_failed_keep_original_request_id:'待办保存失败，结果可能未知。保留原请求号，不要再次创建收款。',
    invalid_credentials:'账号或密码不正确，请核对后重新登录。',http_400:'登录未成功，请检查账号、密码或联系管理员。',
    connector_busy_or_stale_lock:'有操作正在进行或上次操作异常中断。请联系管理员，勿自行删锁或重复录入。',
    server_unreachable:'暂时无法连接服务器，请检查网络。',
    outcome_unknown_keep_original_request_id:'网络中断，结果尚不明确。请保留原请求号核查，不要重新编号录入。',
    login_cancelled:'已取消登录。',connector_upgrade_required:'连接器需要升级，请联系管理员。'};
  return `${messages[code]??'操作未完成，请保留错误编号联系管理员。'}\n错误编号：${code}\n不要向 AI 或他人发送密码、访问令牌。`;
}
