import { and, eq } from "drizzle-orm";
import { db, projectPreferences, type ProjectPreference } from "@/db";

const PROJECT_OPEN_TOUCH_INTERVAL_MS = 60_000;
const recentlyTouched = new Map<string, number>();

export function projectPreferenceMap(
  userId: string
): Map<string, ProjectPreference> {
  return new Map(
    db
      .select()
      .from(projectPreferences)
      .where(eq(projectPreferences.userId, userId))
      .all()
      .map((preference) => [preference.projectId, preference])
  );
}

export function touchProjectOpened(
  userId: string,
  projectId: string,
  now = new Date()
): void {
  const key = `${userId}:${projectId}`;
  if (
    now.getTime() - (recentlyTouched.get(key) ?? 0) <
    PROJECT_OPEN_TOUCH_INTERVAL_MS
  ) {
    return;
  }

  db.insert(projectPreferences)
    .values({
      userId,
      projectId,
      favorite: false,
      lastOpenedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [projectPreferences.userId, projectPreferences.projectId],
      set: { lastOpenedAt: now, updatedAt: now },
    })
    .run();
  recentlyTouched.set(key, now.getTime());
}

export function setProjectFavorite(
  userId: string,
  projectId: string,
  favorite: boolean,
  now = new Date()
): ProjectPreference {
  db.insert(projectPreferences)
    .values({
      userId,
      projectId,
      favorite,
      lastOpenedAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [projectPreferences.userId, projectPreferences.projectId],
      set: { favorite, updatedAt: now },
    })
    .run();

  return db
    .select()
    .from(projectPreferences)
    .where(
      and(
        eq(projectPreferences.userId, userId),
        eq(projectPreferences.projectId, projectId)
      )
    )
    .get()!;
}

export { PROJECT_OPEN_TOUCH_INTERVAL_MS };
