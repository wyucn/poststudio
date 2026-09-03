import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectListDto } from "@/lib/client/types";
import { filterAndSortProjects } from "./discovery";

function project(
  input: Partial<ProjectListDto> & Pick<ProjectListDto, "id" | "name">
): ProjectListDto {
  return {
    id: input.id,
    name: input.name,
    description: input.description ?? null,
    createdBy: input.createdBy ?? "owner",
    visibility: input.visibility ?? "private",
    createdAt: input.createdAt ?? 100,
    updatedAt: input.updatedAt ?? 100,
    mine: input.mine ?? true,
    createdByMe: input.createdByMe ?? false,
    participating: input.participating ?? false,
    favorite: input.favorite ?? false,
    lastOpenedAt: input.lastOpenedAt ?? null,
    archivedAt: input.archivedAt ?? null,
    currentUserRole: input.currentUserRole ?? "viewer",
    canEdit: input.canEdit ?? true,
    canManage: input.canManage ?? false,
    isDefault: input.isDefault ?? false,
  };
}

const projects = [
  project({
    id: "created",
    name: "品牌广告 2",
    description: "夏季发布",
    createdByMe: true,
    favorite: true,
    lastOpenedAt: 200,
    updatedAt: 250,
  }),
  project({
    id: "participating",
    name: "品牌广告 10",
    description: "秋季发布",
    participating: true,
    lastOpenedAt: 500,
    updatedAt: 180,
  }),
  project({
    id: "public",
    name: "公共素材",
    mine: false,
    canEdit: false,
    updatedAt: 600,
  }),
];

test("project discovery filters search, favorites, and exclusive ownership scopes", () => {
  assert.deepEqual(
    filterAndSortProjects(projects, { query: "秋季" }).map((item) => item.id),
    ["participating"]
  );
  assert.deepEqual(
    filterAndSortProjects(projects, { favoritesOnly: true }).map(
      (item) => item.id
    ),
    ["created"]
  );
  assert.deepEqual(
    filterAndSortProjects(projects, { scope: "created" }).map((item) => item.id),
    ["created"]
  );
  assert.deepEqual(
    filterAndSortProjects(projects, { scope: "participating" }).map(
      (item) => item.id
    ),
    ["participating"]
  );
});

test("project discovery sorts by last opened, updated time, and natural name", () => {
  assert.deepEqual(
    filterAndSortProjects(projects, { sort: "recent" }).map((item) => item.id),
    ["participating", "created", "public"]
  );
  assert.deepEqual(
    filterAndSortProjects(projects, { sort: "updated" }).map((item) => item.id),
    ["public", "created", "participating"]
  );
  assert.deepEqual(
    filterAndSortProjects(projects, { sort: "name" }).map((item) => item.id),
    ["public", "created", "participating"]
  );
});
