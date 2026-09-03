import { randomUUID } from "node:crypto";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = `HTTP_${status}`
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface PublicErrorBody {
  error: string;
  code: string;
  requestId?: string;
}

export interface PublicErrorResult {
  status: number;
  body: PublicErrorBody;
  requestId?: string;
  shouldLog: boolean;
}

/**
 * Convert internal exceptions to the stable, non-sensitive API error contract.
 * Expected HttpError messages are safe to show; all unknown/provider errors are
 * correlated in server logs and replaced with a generic user-facing message.
 */
export function publicError(
  error: unknown,
  createRequestId: () => string = randomUUID
): PublicErrorResult {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code },
      shouldLog: false,
    };
  }

  const requestId = createRequestId();
  return {
    status: 500,
    body: {
      error: "服务暂时无法完成请求，请稍后重试；若问题持续，请将错误编号提供给管理员。",
      code: "INTERNAL_ERROR",
      requestId,
    },
    requestId,
    shouldLog: true,
  };
}
