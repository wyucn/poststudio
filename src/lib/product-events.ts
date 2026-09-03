import { randomUUID } from "node:crypto";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { db, productEvents } from "@/db";
import * as schema from "@/db/schema";

export type ProductEventAction = "download" | "reuse" | "regenerate";

export interface ProductEventInput {
  action: ProductEventAction;
  projectId: string;
  userId: string;
  taskId?: string | null;
  assetId?: string | null;
  modelKey?: string | null;
  createdAt?: Date;
}

export type ProductEventDatabase = BetterSQLite3Database<typeof schema>;

export function insertProductEvent(
  database: ProductEventDatabase,
  input: ProductEventInput
): void {
  database
    .insert(productEvents)
    .values({
      id: randomUUID(),
      action: input.action,
      projectId: input.projectId,
      userId: input.userId,
      taskId: input.taskId ?? null,
      assetId: input.assetId ?? null,
      modelKey: input.modelKey ?? null,
      createdAt: input.createdAt ?? new Date(),
    })
    .run();
}

export function recordProductEvent(input: ProductEventInput): void {
  insertProductEvent(db, input);
}
