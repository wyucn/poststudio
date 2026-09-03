import type { ProjectListDto } from "@/lib/client/types";

export type ProjectScope = "all" | "created" | "participating";
export type ProjectSort = "recent" | "updated" | "name";

export interface ProjectDiscoveryOptions {
  query?: string;
  scope?: ProjectScope;
  sort?: ProjectSort;
  favoritesOnly?: boolean;
}

const projectNameCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

function timeValue(value: number | string | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function filterAndSortProjects<T extends ProjectListDto>(
  projects: readonly T[],
  options: ProjectDiscoveryOptions = {}
): T[] {
  const query = options.query?.trim().toLocaleLowerCase("zh-CN") ?? "";
  const scope = options.scope ?? "all";
  const sort = options.sort ?? "recent";

  return projects
    .filter((project) => {
      if (options.favoritesOnly && !project.favorite) return false;
      if (scope === "created" && !project.createdByMe) return false;
      if (scope === "participating" && !project.participating) return false;
      if (!query) return true;
      return `${project.name} ${project.description ?? ""}`
        .toLocaleLowerCase("zh-CN")
        .includes(query);
    })
    .sort((left, right) => {
      if (sort === "name") {
        return (
          projectNameCollator.compare(left.name, right.name) ||
          left.id.localeCompare(right.id)
        );
      }

      const leftTime =
        sort === "recent"
          ? timeValue(left.lastOpenedAt)
          : timeValue(left.updatedAt);
      const rightTime =
        sort === "recent"
          ? timeValue(right.lastOpenedAt)
          : timeValue(right.updatedAt);
      if (leftTime !== rightTime) return rightTime - leftTime;

      const leftUpdated = timeValue(left.updatedAt);
      const rightUpdated = timeValue(right.updatedAt);
      return (
        rightUpdated - leftUpdated ||
        projectNameCollator.compare(left.name, right.name) ||
        left.id.localeCompare(right.id)
      );
    });
}

export function projectTimeValue(
  value: number | string | Date | null | undefined
): number {
  return timeValue(value);
}
