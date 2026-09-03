const MAX_LOG_TEXT = 6_000;
const SENSITIVE_KEY =
  String.raw`[A-Za-z0-9_.-]*(?:api[_-]?key|access[_-]?token|service[_-]?key|client[_-]?secret|authorization|password|passwd|secret|token|cookie|session)[A-Za-z0-9_.-]*`;
const DOUBLE_QUOTED_SECRET = new RegExp(
  `("${SENSITIVE_KEY}"\\s*:\\s*")[^"]*(")`,
  "gi"
);
const SINGLE_QUOTED_SECRET = new RegExp(
  `('${SENSITIVE_KEY}'\\s*:\\s*')[^']*(')`,
  "gi"
);
const ASSIGNED_SECRET = new RegExp(
  `\\b(${SENSITIVE_KEY})\\s*([=:])\\s*(?:"[^"]*"|'[^']*'|[^\\s,;]+)`,
  "gi"
);

/** Remove credentials, tokens and externally supplied URLs before server logging. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(?:ak|ms|sk)-[A-Za-z0-9._-]{12,}\b/gi, "[TOKEN_REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      "[TOKEN_REDACTED]"
    )
    .replace(DOUBLE_QUOTED_SECRET, "$1[REDACTED]$2")
    .replace(SINGLE_QUOTED_SECRET, "$1[REDACTED]$2")
    .replace(ASSIGNED_SECRET, "$1$2[REDACTED]")
    .replace(
      /\b(?:https?|wss?|ftp|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi,
      "[URL_REDACTED]"
    )
    .slice(0, MAX_LOG_TEXT);
}

export interface ErrorDiagnostic {
  name: string;
  message: string;
  stack?: string;
  status?: string;
  providerCode?: string;
}

/** Convert an arbitrary exception to a bounded, redacted log-only structure. */
export function errorDiagnostic(error: unknown): ErrorDiagnostic {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: redactSensitiveText(String(error)) };
  }
  const extended = error as Error & { status?: unknown; code?: unknown };
  return {
    name: error.name || "Error",
    message: redactSensitiveText(error.message),
    stack: error.stack ? redactSensitiveText(error.stack) : undefined,
    status:
      extended.status === undefined
        ? undefined
        : redactSensitiveText(String(extended.status)),
    providerCode:
      extended.code === undefined
        ? undefined
        : redactSensitiveText(String(extended.code)),
  };
}
