export const PROJECT_NAME_DUPLICATE_CODE = "PROJECT_NAME_DUPLICATE";
export const PROJECT_DELETE_CONFIRMATION_CODE =
  "PROJECT_DELETE_CONFIRMATION_MISMATCH";

export type ProjectLifecycleAction =
  | "archive"
  | "restore"
  | "delete"
  | "transfer-owner";
