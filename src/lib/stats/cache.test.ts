import assert from "node:assert/strict";
import test from "node:test";
import { TtlPromiseCache } from "./cache";
import { parseStatsQuery, statsPageInfo } from "./contracts";

test("stats query parsing clamps ranges and independent rank pages", () => {
  assert.deepEqual(
    parseStatsQuery(
      "http://localhost/api/stats?days=999&projectPage=3&userPage=4&pageSize=200"
    ),
    { days: 365, projectPage: 3, userPage: 4, pageSize: 50 }
  );
  assert.deepEqual(
    parseStatsQuery(
      "http://localhost/api/stats?days=0&projectPage=-2&userPage=nope&pageSize=0"
    ),
    { days: 0, projectPage: 1, userPage: 1, pageSize: 1 }
  );
});

test("stats page info clamps stale pages after totals shrink", () => {
  assert.deepEqual(statsPageInfo(21, 9, 10), {
    page: 3,
    pageSize: 10,
    total: 21,
    totalPages: 3,
    hasPrevious: true,
    hasNext: false,
  });
  assert.deepEqual(statsPageInfo(0, 4, 10), {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    hasPrevious: false,
    hasNext: false,
  });
});

test("TTL cache coalesces concurrent loads and expires deterministically", async () => {
  const cache = new TtlPromiseCache<number>(100, 2);
  let loads = 0;
  const loader = async () => {
    loads++;
    return 42;
  };

  const first = cache.getOrLoad("same", loader, 1_000);
  const concurrent = cache.getOrLoad("same", loader, 1_001);
  assert.equal(first.hit, false);
  assert.equal(concurrent.hit, true);
  assert.equal(await first.value, 42);
  assert.equal(await concurrent.value, 42);
  assert.equal(loads, 1);

  const expired = cache.getOrLoad("same", loader, 1_100);
  assert.equal(expired.hit, false);
  assert.equal(await expired.value, 42);
  assert.equal(loads, 2);

  await assert.rejects(
    cache.getOrLoad("failure", () => Promise.reject(new Error("boom")), 1_101)
      .value,
    /boom/
  );
  await Promise.resolve();
  assert.equal(cache.size, 1);
});
