import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { nextPinGatePhase, shouldDemandPinOnEntry, type PinGatePhase, type SensitiveScope } from "@/lib/sensitive-pin";

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
 *
 * Returns true once this entry's prompt has been answered (or none was
 * needed) — a page that must not even load its data behind the PIN pad
 * renders nothing until then (the Employee Hub).
 */
export function useSensitivePinGate(opts: {
  enabled?: boolean;
  includeAdmins?: boolean;
  fresh?: boolean;
  entryKey?: string;
  /** "people" = the People section: asks for the private PIN if set. */
  scope?: SensitiveScope;
}): boolean {
  const { enabled = true, includeAdmins = false, fresh = false, entryKey = "page", scope = "general" } = opts;
  const { state, requireSensitivePin, pinLocked, peoplePinPrompt, peoplePinSetupPrompt } = useAuth();
  const demandedFor = useRef<string | null>(null);
  const [phase, setPhase] = useState<PinGatePhase>("idle");
  const prompting = pinLocked || peoplePinPrompt || peoplePinSetupPrompt;

  useEffect(() => {
    const authenticated = state.status === "authenticated";
    // Leaving the gated area re-arms the gate, so coming back asks again.
    if (!authenticated || !enabled) {
      if (!enabled) demandedFor.current = null;
      setPhase("idle");
      return;
    }
    if (!shouldDemandPinOnEntry({ authenticated, enabled, demandedFor: demandedFor.current, entryKey })) return;
    demandedFor.current = entryKey;
    setPhase(requireSensitivePin({ includeAdmins, fresh, scope }) ? "asked" : "open");
  }, [state.status, enabled, entryKey, includeAdmins, fresh, scope, requireSensitivePin]);

  useEffect(() => {
    setPhase(p => nextPinGatePhase(p, prompting));
  }, [prompting, phase]);

  return phase === "open";
}
