import assert from "node:assert/strict";
import test from "node:test";
import { OPERATION_LABEL, operationNotification } from "./health";

test("operation alerts fire once and recover only after a successful run", () => {
  assert.equal(operationNotification(false, "failed"), "alert");
  assert.equal(operationNotification(true, "failed"), null);
  assert.equal(operationNotification(true, "skipped"), null);
  assert.equal(operationNotification(true, "ok"), "recovery");
  assert.equal(operationNotification(false, "ok"), null);
  assert.equal(OPERATION_LABEL["data-integrity"], "数据库一致性巡检");
});
