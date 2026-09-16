export function confirmationFeedback(code: unknown): { message: string; retry: boolean; login?: boolean } {
  switch (code) {
    case "browser_confirmation_required": return { message: "确认入口的来源校验未通过，本次未入账。请从原确认链接打开页面；若仍失败，请联系维护者核对系统地址。", retry: false };
    case "confirmationSuperseded": return { message: "此确认单已被新单替代，旧页面不能再入账。请刷新页面查看新确认单，重新核对内容。", retry: false };
    case "confirmationAlreadyExecuted": return { message: "此请求已经执行，不能重新准备。请保留原请求号复查付款，不要另录。", retry: false };
    case "confirmationExpired": return { message: "确认单已过期，本次未入账。请返回录入对话重新核对预览，保留原请求编号。", retry: false };
    case "confirmationSnapshotChanged": return { message: "订单账务已变化，本次未入账。请返回录入对话查看最新已收与未收，再重新核对预览。不要直接另录一笔。", retry: false };
    case "confirmationRequestConflict": return { message: "请求编号与已有记录冲突，本次未入账。请保留原单联系维护者核查，不要换请求号重录。", retry: false };
    case "confirmationForbidden": case "account_not_configured": return { message: "当前账号无权确认这笔收款。请联系维护者核查账号权限。", retry: false };
    case "confirmationNotFound": return { message: "当前账号无法读取此确认单。请使用创建此单的 SACSI 账号登录。", retry: false, login: true };
    case "missing_or_invalid_session": return { message: "登录已失效，请重新登录后回到此确认单。不要新建付款。", retry: false, login: true };
    case "confirmation_deployment_changed": case "confirmations_not_enabled": return { message: "系统版本或确认入口已变化，暂时无法继续。请保留原单联系维护者。", retry: false };
    case "confirmationResultInvalid": case "confirmation_result_unverified": return { message: "付款结果复查未通过，不能判定当前账务状态。请保留原单联系维护者，勿另录付款。", retry: false };
    case "confirmationScopeUnsupported": case "invalidConfirmationRequest": case "invalid_confirmation_record":
    case "bookingNotFound": case "bookingFinanceInconsistent": case "paymentExceedsOutstanding":
    case "invalidPaymentAmount": case "invalidPaymentDate": case "invalidReceiptNo":
      return { message: "当前订单或收款内容未通过校验，本次未入账。请返回录入对话核查，不要直接重录。", retry: false };
    default: return { message: "暂时无法确认执行结果。请保留原确认单，稍后按原单重试；不要换请求号或另录付款。", retry: true };
  }
}
