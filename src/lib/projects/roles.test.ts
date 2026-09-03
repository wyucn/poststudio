import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditProjectRole,
  canManageProjectMembers,
  canManageTask,
  resolveProjectRole,
} from "./roles";

test("project roles resolve owner from the project owner authority", () => {
  assert.equal(resolveProjectRole("owner", "owner", "viewer"), "owner");
  assert.equal(resolveProjectRole("owner", "editor", "editor"), "editor");
  assert.equal(resolveProjectRole("owner", "viewer", "viewer"), "viewer");
  assert.equal(resolveProjectRole("owner", "unknown", "owner"), "viewer");
});

test("viewer is read-only and only the owner manages members", () => {
  assert.equal(canEditProjectRole("owner"), true);
  assert.equal(canEditProjectRole("editor"), true);
  assert.equal(canEditProjectRole("viewer"), false);
  assert.equal(canManageProjectMembers("owner"), true);
  assert.equal(canManageProjectMembers("editor"), false);
  assert.equal(canManageProjectMembers("viewer"), false);
});

test("editors can manage only their own terminal task actions", () => {
  assert.equal(canManageTask("owner", "other", "me"), true);
  assert.equal(canManageTask("editor", "me", "me"), true);
  assert.equal(canManageTask("editor", "other", "me"), false);
  assert.equal(canManageTask("viewer", "me", "me"), false);
});
