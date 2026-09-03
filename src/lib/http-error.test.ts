import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, publicError } from "./http-error";

test("expected HTTP errors preserve actionable messages", () => {
  const result = publicError(new HttpError(413, "参考素材超过 20 MB", "MEDIA_TOO_LARGE"));

  assert.equal(result.status, 413);
  assert.deepEqual(result.body, {
    error: "参考素材超过 20 MB",
    code: "MEDIA_TOO_LARGE",
  });
  assert.equal(result.shouldLog, false);
});

test("unknown errors never expose internal details", () => {
  const result = publicError(
    new Error("postgres://admin:secret@example.internal/database"),
    () => "trace-123"
  );

  assert.equal(result.status, 500);
  assert.equal(result.body.code, "INTERNAL_ERROR");
  assert.equal(result.body.requestId, "trace-123");
  assert.equal(result.body.error.includes("secret"), false);
  assert.equal(result.shouldLog, true);
});
