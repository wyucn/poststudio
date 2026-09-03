import { randomUUID } from "node:crypto";
import { ArkError } from "@/lib/ark/client";
import { CozeError } from "@/lib/coze/client";
import { HttpError } from "@/lib/http-error";

export interface TaskFailureOptions {
  code?: string;
  userMessage?: string;
  shouldLog?: boolean;
}

export interface ClassifiedTaskFailure {
  userMessage: string;
  code: string;
  requestId: string;
  shouldLog: boolean;
}

function arkFailure(error: ArkError): Pick<ClassifiedTaskFailure, "userMessage" | "code"> {
  const providerCode = error.code?.toLowerCase() ?? "";
  const providerMessage = error.message.toLowerCase();
  if (/sensitive|safety|content|risk|moderation/.test(`${providerCode} ${providerMessage}`)) {
    return {
      userMessage: "提示词或参考素材未通过模型安全检查，请复用配置并修改内容后重新生成。",
      code: "ARK_CONTENT_REJECTED",
    };
  }
  if (error.status === 400 || error.status === 422) {
    return {
      userMessage: "模型无法处理当前参数或参考素材，请复用配置并调整设置后重新生成。",
      code: "ARK_REQUEST_REJECTED",
    };
  }
  if (error.status === 401 || error.status === 403) {
    return {
      userMessage: "模型服务鉴权异常，请联系管理员检查服务配置。",
      code: "ARK_AUTH_ERROR",
    };
  }
  if (error.status === 429) {
    return {
      userMessage: "模型服务当前繁忙或额度受限，请稍后重试。",
      code: "ARK_RATE_LIMITED",
    };
  }
  if (error.status === 408 || error.status === 504 || /timeout|超时/.test(providerMessage)) {
    return {
      userMessage: "模型服务响应超时，请稍后重试。",
      code: "ARK_TIMEOUT",
    };
  }
  return {
    userMessage: "模型生成暂时失败，请稍后重试。",
    code: "ARK_PROVIDER_ERROR",
  };
}

/** Classify an internal exception without exposing its raw message to clients. */
export function classifyTaskFailure(
  error: unknown,
  options: TaskFailureOptions = {},
  createRequestId: () => string = randomUUID
): ClassifiedTaskFailure {
  const requestId = createRequestId();
  if (options.userMessage) {
    return {
      userMessage: options.userMessage,
      code: options.code ?? "TASK_FAILED",
      requestId,
      shouldLog: options.shouldLog ?? true,
    };
  }
  if (error instanceof HttpError) {
    return {
      userMessage: error.message,
      code: options.code ?? error.code,
      requestId,
      shouldLog: options.shouldLog ?? error.status >= 500,
    };
  }
  if (error instanceof ArkError) {
    const classified = arkFailure(error);
    return {
      ...classified,
      code: options.code ?? classified.code,
      requestId,
      shouldLog: options.shouldLog ?? true,
    };
  }
  if (error instanceof CozeError) {
    const timeout = error.status === 408 || error.status === 504 || /timeout|超时/i.test(error.message);
    const rateLimited = error.status === 429 || /rate|quota|限流|额度/i.test(error.message);
    const auth = error.status === 401 || error.status === 403;
    return {
      userMessage: auth
        ? "音频服务鉴权异常，请联系管理员检查服务配置。"
        : rateLimited
          ? "音频服务当前繁忙或额度受限，请稍后重试。"
          : timeout
            ? "音频服务响应超时，请稍后重试。"
            : "音频服务暂时不可用，请稍后重试。",
      code:
        options.code ??
        (auth
          ? "COZE_AUTH_ERROR"
          : rateLimited
            ? "COZE_RATE_LIMITED"
            : timeout
              ? "COZE_TIMEOUT"
              : "COZE_PROVIDER_ERROR"),
      requestId,
      shouldLog: options.shouldLog ?? true,
    };
  }

  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (/coze|扣子/i.test(message)) {
    return {
      userMessage: /timeout|超时|abort/i.test(message)
        ? "剪辑或音频服务响应超时，请稍后重试。"
        : "剪辑或音频服务暂时不可用，请稍后重试。",
      code:
        options.code ??
        (/timeout|超时|abort/i.test(message)
          ? "COZE_TIMEOUT"
          : "COZE_PROVIDER_ERROR"),
      requestId,
      shouldLog: options.shouldLog ?? true,
    };
  }
  if (/qwen3-tts|modelscope|meta tensor/i.test(message)) {
    const notConfigured = /尚未配置|未配置/i.test(message);
    return {
      userMessage: notConfigured
        ? "当前声音克隆实例尚未配置，请切换实例或联系管理员。"
        : /meta tensor/i.test(message)
          ? "声音克隆服务正在重新加载模型，请稍后重试。"
          : "声音克隆服务暂时不可用，请稍后重试。",
      code:
        options.code ??
        (notConfigured
          ? "QWEN_INSTANCE_NOT_CONFIGURED"
          : /meta tensor/i.test(message)
            ? "QWEN_MODEL_LOAD_FAILED"
            : "QWEN_PROVIDER_ERROR"),
      requestId,
      shouldLog: options.shouldLog ?? true,
    };
  }
  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    /timeout|timed out|超时|aborted/i.test(message)
  ) {
    return {
      userMessage: "生成服务响应超时，请稍后重试。",
      code: options.code ?? "PROVIDER_TIMEOUT",
      requestId,
      shouldLog: options.shouldLog ?? true,
    };
  }
  return {
    userMessage: "生成任务暂时无法完成，请稍后重试；若问题持续，请联系管理员。",
    code: options.code ?? "TASK_FAILED",
    requestId,
    shouldLog: options.shouldLog ?? true,
  };
}
