import { db } from "@/db";
import { errorResponse, isAdmin, requireUser } from "@/lib/services";
import { TtlPromiseCache } from "@/lib/stats/cache";
import { parseStatsQuery } from "@/lib/stats/contracts";
import {
  loadDashboardStatsRankings,
  loadDashboardStatsSnapshot,
  statsSnapshotCacheKey,
  type DashboardStatsSnapshot,
} from "@/lib/stats/dashboard";

const STATS_CACHE_TTL_MS = 15_000;

const globalForStats = globalThis as unknown as {
  __haitunDashboardStatsCache?: TtlPromiseCache<DashboardStatsSnapshot>;
};

const statsCache =
  globalForStats.__haitunDashboardStatsCache ??
  new TtlPromiseCache<DashboardStatsSnapshot>(STATS_CACHE_TTL_MS);
globalForStats.__haitunDashboardStatsCache = statsCache;

/** 平台用量统计：SQL 聚合基础指标，短时缓存昂贵快照，排行独立分页。 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const scope = isAdmin(user) ? "all" : "mine";
    const query = parseStatsQuery(req.url);
    const loadInput = {
      scope,
      userId: user.id,
      days: query.days,
    } as const;
    const cached = statsCache.getOrLoad(
      statsSnapshotCacheKey(loadInput),
      () => loadDashboardStatsSnapshot(db, loadInput)
    );
    const snapshot = await cached.value;
    const rankings = loadDashboardStatsRankings(db, snapshot, query);

    return Response.json(
      { ...snapshot.data, ...rankings },
      {
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
          "X-Stats-Cache": cached.hit ? "HIT" : "MISS",
          "X-Stats-Cache-Ttl-Ms": String(STATS_CACHE_TTL_MS),
        },
      }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
