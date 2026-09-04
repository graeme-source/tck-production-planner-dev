import { useAuth } from "@/contexts/auth-context";
import { usePagePermissions } from "@/hooks/use-page-permissions";
import { decideAccess, featureByKey, featureForSection, type Role } from "@workspace/feature-registry";

/**
 * One question, asked the same way everywhere: can this person use this?
 *
 * `can("settings.sensors")` replaces `user?.role === "admin"` at the point of
 * use. The answer is the role's general level OR anything handed to this
 * person in Settings → Team & Access, so opening one area up to one person no
 * longer means promoting them to admin.
 *
 * The server asks the identical question through userCan()/requireFeature();
 * both sides share the rule in @workspace/feature-registry so a screen can't
 * render something the API will refuse.
 */
export function useFeatureAccess() {
  const { state } = useAuth();
  const { minRoleFor } = usePagePermissions();

  const userRole = state.status === "authenticated" ? state.user.role : "viewer";
  const grantedKeys = state.status === "authenticated" ? (state.user.features ?? []) : [];

  function can(featureKey: string): boolean {
    const def = featureByKey(featureKey);
    // A page's baseline is whatever the access-level selector says today.
    const baselineMinRole = def?.kind === "page" && def.page
      ? (minRoleFor(def.page) as Role)
      : undefined;
    return decideAccess({ userRole, grantedKeys, featureKey, baselineMinRole });
  }

  /** Convenience for the Settings page: can this person open this section? */
  function canSection(section: string): boolean {
    const def = featureForSection(section);
    // A section nobody put in the registry is open — "My Profile" is yours.
    return def ? can(def.key) : true;
  }

  return { can, canSection, userRole, grantedKeys };
}
