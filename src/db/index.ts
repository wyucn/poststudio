import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// turbopackIgnore：DATA_DIR 是运行期数据目录，非打包资产。
// 不加则 Turbopack 会把这个动态路径当作需追踪的文件，进而误追踪整个项目。
export const DATA_DIR = path.resolve(
  /* turbopackIgnore: true */ process.env.DATA_DIR || "./data"
);

const globalForDb = globalThis as unknown as {
  __haitunDb?: BetterSQLite3Database<typeof schema>;
};

function createDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new Database(path.join(DATA_DIR, "haitun-post-studio.db"));
  sqlite.pragma(
    `journal_mode = ${process.env.E2E_MODE === "1" ? "DELETE" : "WAL"}`
  );
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export const db = globalForDb.__haitunDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__haitunDb = db;

export * from "./schema";
