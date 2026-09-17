import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { shouldDemandPinOnEntry } from "@/lib/sensitive-pin";

/**
 * Demand the sensitive-page PIN once per ENTRY to a page.
 *
 * Every people-data page needs this and none of them should hand-roll it:
 * `requireSensitivePin` changes identity whenever the lock state changes, so
 * calling it straight from a page effect re-fires the moment the PIN is
 * accepted and (with `fresh`) re-locks the screen forever. The ref here
 * holds the decision steady across those re-runs. Rule + regression test:
 * lib/sensitive-pin.ts.
 *
 * `entryKey` is what counts as a new visit — pass the tab name on a tabbed
 * page so moving between sensitive tabs asks again, but unlocking the one
 * you're on does not.
 */
export function useSensitivePinGate(opts: {
  enabled?: boolean;
  includeAdmins?: boolean;
  fresh?: boolean;
  entryKey?: string;
}) {
  const { enabled = true, includeAdmins = false, fresh = false, entryKey = "page" } = opts;
  const { state, requireSensitivePin } = useAuth();
  const demandedFor = useRef<string | null>(null);

  useEffect(() => {
    const authenticated = state.status === "authenticated";
    // Leaving the gated area re-arms the gate, so coming back asks again.
    if (!authenticated || !enabled) {
      if (!enabled) demandedFor.current = null;
      return;
    }
    if (!shouldDemandPinOnEntry({ authenticated, enabled, demandedFor: demandedFor.current, entryKey })) return;
    demandedFor.current = entryKey;
    requireSensitivePin({ includeAdmins, fresh });
  }, [state.status, enabled, entryKey, includeAdmins, fresh, requireSensitivePin]);
}
