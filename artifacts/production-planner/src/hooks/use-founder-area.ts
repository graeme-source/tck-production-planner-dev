import { useAuth } from "@/contexts/auth-context";
import {
  FOUNDER_FEATURES,
  allowedFounderTabs,
  decideFounderFeatureAccess,
  isFounderEmail,
} from "@workspace/feature-registry";

/**
 * Who can open which part of The Business (Graeme, 2026-09-29).
 *
 * The founder opens everything. Anyone else opens only the tabs the founder
 * has granted them (Numbers → founder.numbers, Sales & Marketing →
 * founder.sales) — admin role alone opens nothing here. Grants come from
 * the /auth/me payload (`features`), the same list the server checks, and
 * the rule itself is shared with the server (@workspace/feature-registry).
 */
export function useFounderArea() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const email = user?.email ?? null;
  const grantedKeys = user?.features ?? [];
  const tabs = allowedFounderTabs({ email, grantedKeys });
  return {
    /** False while signing in — pages should wait rather than redirect. */
    ready: state.status !== "loading",
    isFounder: isFounderEmail(email),
    canNumbers: decideFounderFeatureAccess({ email, grantedKeys, featureKey: FOUNDER_FEATURES.numbers }),
    canSales: decideFounderFeatureAccess({ email, grantedKeys, featureKey: FOUNDER_FEATURES.sales }),
    tabs,
    /** Where "The Business" lands for this person; null = no way in. */
    home: tabs[0]?.href ?? null,
  };
}
