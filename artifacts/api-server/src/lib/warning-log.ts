/**
 * Who dismissed an operational warning, and when (Graeme, 20 Nov 2026 —
 * #140013: the 2:16 check named it, and there was no telling whether anyone
 * dismissed the alert). Written by the server for warnings it owns (the
 * 2:16 check, a kanban "Not today") and by the screens for the ones kept on
 * the iPad (POST /api/warning-log). Never fails the action it records.
 */
import { eq } from "drizzle-orm";
import { db, usersTable, warningDismissalsTable } from "@workspace/db";

export async function userNameOf(userId: number | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return u?.name ?? null;
}

export async function recordWarningAction(args: {
  warning: string;
  action: string;
  detail?: string | null;
  page?: string | null;
  userId: number | null | undefined;
}): Promise<{ userName: string | null }> {
  try {
    const userName = await userNameOf(args.userId);
    await db.insert(warningDismissalsTable).values({
      warning: args.warning, action: args.action, detail: args.detail?.slice(0, 2000) ?? null,
      page: args.page ?? null, userId: args.userId ?? null, userName,
    });
    return { userName };
  } catch (err) {
    console.error("[warning-log] not recorded:", err instanceof Error ? err.message : String(err));
    return { userName: null };
  }
}
