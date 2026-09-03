import { defineConfig } from "drizzle-kit";
import path from "node:path";

const dataDir = path.resolve(process.env.DATA_DIR || "./data");

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: path.join(dataDir, "haitun-post-studio.db"),
  },
});
