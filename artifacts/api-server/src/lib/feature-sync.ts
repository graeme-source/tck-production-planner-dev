import { db, appFeaturesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { FEATURE_REGISTRY } from "@workspace/feature-registry";

/**
 * Make sure every feature in the registry has a row in app_features.
 *
 * Grants reference app_features by key, so a feature can't be handed out
 * until its row exists. The registry (lib/feature-registry) is the library —
 * this just mirrors it into the database so the foreign key is satisfied and
 * the SOP a feature needs has somewhere to live.
 *
 * Deliberately conservative, because a seeder that overwrites curated data is
 * how we lost the lean curriculum in August:
 *  - inserts new keys, updates only the name and description (labels);
 *  - NEVER touches required_sop_id, which an admin sets in the app;
 *  - NEVER deletes. A key dropped from the registry keeps its row and its
 *    grants, and the API reports it as retired so it can be cleared by hand.
 *
 * Runs once per process, on the first read of the features API.
 */
let synced: Promise<void> | null = null;

export function ensureFeaturesSynced(): Promise<void> {
  if (!synced) {
    synced = syncNow().catch(err => {
      // Let the next request try again rather than wedging the screen.
      synced = null;
      throw err;
    });
  }
  return synced;
}

async function syncNow(): Promise<void> {
  const existing = await db.select({ key: appFeaturesTable.key }).from(appFeaturesTable);
  const known = new Set(existing.map(r => r.key));
  let added = 0;

  for (const f of FEATURE_REGISTRY) {
    if (known.has(f.key)) {
      await db
        .update(appFeaturesTable)
        .set({ name: f.name, description: f.description, updatedAt: new Date() })
        .where(eq(appFeaturesTable.key, f.key));
    } else {
      await db.insert(appFeaturesTable)
        .values({ key: f.key, name: f.name, description: f.description })
        .onConflictDoNothing();
      added++;
    }
  }
  if (added > 0) console.log(`[Features] Registry sync: added ${added} feature(s).`);
}
