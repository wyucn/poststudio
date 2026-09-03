import assert from "node:assert/strict";
import test from "node:test";
import { errorDiagnostic, redactSensitiveText } from "./error-safety";

test("server log redaction removes tokens, credentials and URLs", () => {
  const source =
    'Authorization=Bearer abcdefghijklmnop api_key=ark-secret password=hunter2 ' +
    '"access_token":"ms-76e681a2-495a-4262-b93d-752aa11493d7" ' +
    '"token":"plain-token-value" client_secret=client-secret-value ' +
    "COZE_API_TOKEN=coze-token-value https://vendor.example/result?id=secret " +
    "wss://socket.example/session postgresql://user:pass@db.example/app";
  const redacted = redactSensitiveText(source);

  for (const secret of [
    "abcdefghijklmnop",
    "ark-secret",
    "hunter2",
    "ms-76e681a2-495a-4262-b93d-752aa11493d7",
    "plain-token-value",
    "client-secret-value",
    "coze-token-value",
    "vendor.example",
    "socket.example",
    "user:pass",
  ]) {
    assert.equal(redacted.includes(secret), false);
  }
  assert.match(redacted, /\[REDACTED\]/);
  assert.match(redacted, /\[URL_REDACTED\]/);
});

test("error diagnostics expose only bounded redacted fields", () => {
  const error = new Error("request https://vendor.example failed with secret=abcd1234");
  error.stack = `Error: ${error.message}\n at provider (https://vendor.example/sdk.js:1:1)`;
  const diagnostic = errorDiagnostic(error);

  assert.equal(diagnostic.name, "Error");
  assert.equal(diagnostic.message.includes("vendor.example"), false);
  assert.equal(diagnostic.message.includes("abcd1234"), false);
  assert.equal(diagnostic.stack?.includes("vendor.example"), false);
});
