export function humanResult(command,result) {
  if(command==='logout') return '已退出连接器账号。共用电脑还请退出浏览器中的 SACSI 登录。';
  if(command==='login' || command==='capabilities') {
    const identity=result.identity??{};
    const allowed=name=>result.actions?.some(a=>a.name===name && a.authorized && a.availability==='implemented');
    return ['SACSI 连接成功',`当前身份：${identity.displayName??'未知'}（${identity.role??'未知'}）`,
      `账号标识：${identity.userId??'未知'}`,`日租查询：${allowed('query_daily_booking')?'有权限':'不可用'}`,
      `截图收款权限：${allowed('record_daily_payment')?'有权限，仍需网页确认':'不可用'}`,
      '注意：连接成功不代表服务器截图确认功能已发布。请先由管理员完成上线核验。',
      '确认是本人身份后，可回到 Codex 对话。请勿共用他人账号。'].join('\n');
  }
  return JSON.stringify(result);
}
export function humanError(code) {
  const messages={login_required:'尚未登录，请双击 login.cmd，由本人输入 SACSI 账号。',
    invalid_credentials:'账号或密码不正确，请核对后重新登录。',http_400:'登录未成功，请检查账号、密码或联系管理员。',
    connector_busy_or_stale_lock:'有操作正在进行或上次操作异常中断。请联系管理员，勿自行删锁或重复录入。',
    server_unreachable:'暂时无法连接服务器，请检查网络。',
    outcome_unknown_keep_original_request_id:'网络中断，结果尚不明确。请保留原请求号核查，不要重新编号录入。',
    login_cancelled:'已取消登录。',connector_upgrade_required:'连接器需要升级，请联系管理员。'};
  return `${messages[code]??'操作未完成，请保留错误编号联系管理员。'}\n错误编号：${code}\n不要向 AI 或他人发送密码、访问令牌。`;
}
