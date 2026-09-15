const MAX_REQUEST_LENGTH = 2_000;
const MAX_DETAIL_LENGTH = 1_000;

function redactSecrets(value: string) {
  return value
    .replace(/\b(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|OPENAI_API_KEY|DEEPSEEK_API_KEY)\s*=\s*[^\s]+/gi, "$1=[已隐藏]")
    .replace(/\b(sk|sb_secret)_[a-zA-Z0-9_-]{12,}\b/g, "$1_[已隐藏]");
}

function safeText(value: string | undefined, maximum: number, fallback: string) {
  const normalized = redactSecrets(value?.trim() || fallback);
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum)}…`;
}

export interface OperatorAssistanceReportInput {
  operatorName: string;
  operatorUserId?: string;
  originalRequest: string;
  reason: string;
  businessContext?: string;
  proposedNextStep?: string;
  requestId?: string;
  connectorVersion?: string;
  generatedAt?: Date;
}

/** Produces a concise, WeChat-friendly report without credentials. */
export function buildOperatorAssistanceReport(input: OperatorAssistanceReportInput) {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  return [
    "【SACSI 请求协助】",
    `操作人：${safeText(input.operatorName, 120, "未知")}`,
    `时间：${generatedAt}`,
    `请求编号：${safeText(input.requestId, 120, "未生成")}`,
    `连接器版本：${safeText(input.connectorVersion, 80, "未知")}`,
    `原始需求：${safeText(input.originalRequest, MAX_REQUEST_LENGTH, "未提供")}`,
    `暂停原因：${safeText(input.reason, MAX_DETAIL_LENGTH, "无法安全执行")}`,
    `业务情况：${safeText(input.businessContext, MAX_DETAIL_LENGTH, "未提供")}`,
    `建议下一步：${safeText(input.proposedNextStep, MAX_DETAIL_LENGTH, "请管理员判断后处理")}`,
    "状态：未执行任何系统变更",
  ].join("\n");
}

