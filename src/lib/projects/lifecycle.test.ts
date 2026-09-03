import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDeleteConfirmation,
  assertLifecycleAction,
  duplicateProjectNameInList,
  normalizeProjectName,
} from "./lifecycle";

const active = {
  id: "active",
  name: "品牌广告 2",
  createdBy: "owner",
  archivedAt: null,
  deletedAt: null,
};

test("project names normalize compatible Unicode and whitespace", () => {
  assert.equal(normalizeProjectName("  品牌广告　２  "), "品牌广告 2");
  assert.equal(normalizeProjectName("Brand\n  Campaign"), "brand campaign");
});

test("duplicate project names stay within the owner namespace", () => {
  const duplicate = duplicateProjectNameInList(
    [
      active,
      { ...active, id: "archived", archivedAt: new Date(1) },
      { ...active, id: "deleted", deletedAt: new Date(1) },
      { ...active, id: "other-owner", createdBy: "other" },
    ],
    "owner",
    "品牌广告　2",
    "new-project"
  );
  assert.equal(duplicate?.id, "active");
  assert.equal(
    duplicateProjectNameInList([active], "owner", active.name, active.id),
    null
  );
});

test("lifecycle transitions require safe ordering", () => {
  assert.doesNotThrow(() => assertLifecycleAction(active, "archive"));
  assert.throws(
    () => assertLifecycleAction({ ...active, archivedAt: new Date(1) }, "archive"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "PROJECT_ALREADY_ARCHIVED"
  );
  assert.throws(() => assertLifecycleAction(active, "restore"));
  assert.throws(() => assertLifecycleAction(active, "delete"));
  assert.doesNotThrow(() =>
    assertLifecycleAction({ ...active, archivedAt: new Date(1) }, "delete")
  );
});

test("project deletion requires an exact server-side name confirmation", () => {
  assert.doesNotThrow(() => assertDeleteConfirmation(active.name, active.name));
  assert.throws(
    () => assertDeleteConfirmation(active.name, "brand campaign"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "PROJECT_DELETE_CONFIRMATION_MISMATCH"
  );
});
