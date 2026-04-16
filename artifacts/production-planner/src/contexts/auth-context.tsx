import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { addDeviceUserId } from "@/lib/device-users";
import { toast } from "@/hooks/use-toast";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "manager" | "viewer";
  avatarUrl: string | null;
  hasPin: boolean;
};

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated" };

type PinResult = { error?: string; attemptsLeft?: number; lockedUntil?: string; remainingSeconds?: number };

type AuthContextValue = {
  state: AuthState;
  pinLocked: boolean;
  login: (email: string, password: string) => Promise<{ error?: string; user?: AuthUser }>;
  pinLogin: (userId: number, pin: string) => Promise<PinResult>;
  verifyPin: (pin: string) => Promise<PinResult>;
  lockStation: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Prompt for PIN if the sensitive-unlock window has expired. Idempotent — safe to call on every mount. */
  requireSensitivePin: () => void;
};

// How long a PIN entry grants access to sensitive pages before re-prompting.
const SENSITIVE_UNLOCK_TTL_MS = 5 * 60 * 1000;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [pinLocked, setPinLocked] = useState(false);
  // Timestamp of the last successful PIN entry. Used to gate sensitive pages
  // (Analytics, Settings) so that leaving a device unattended doesn't expose
  // HR / config data even within an authenticated session.
  const sensitiveUnlockedAtRef = useRef<number>(0);

  const consecutiveFailsRef = useRef(0);
  const offlineToastedRef = useRef(false);
  // Tracks the previous server-reported pinRequired flag so we can detect the
  // exact moment the 10pm / 4am cutover fires. When it flips false → true we
  // perform a full-page navigation to /dashboard, which (a) kicks the user
  // off yesterday's plan URL and (b) forces index.html to be re-fetched so
  // the client picks up the latest hashed asset bundle. Both problems solved
  // in one move.
  const prevPinRequiredRef = useRef<boolean | null>(null);

  const checkSession = useCallback(async (isPeriodicRefresh = false) => {
    const BACKOFFS = [1000, 2000, 4000];
    const MAX_FAILS = 6;

    const handleRetryOrFallback = async () => {
      const retryIndex = consecutiveFailsRef.current;
      if (retryIndex < BACKOFFS.length) {
        const delay = BACKOFFS[retryIndex];
        await new Promise(r => setTimeout(r, delay));
        consecutiveFailsRef.current++;
        return checkSession(isPeriodicRefresh);
      }
      consecutiveFailsRef.current++;
      if (consecutiveFailsRef.current >= MAX_FAILS) {
        console.warn(`[Auth] ${MAX_FAILS} consecutive failures — keeping current session, will retry on next poll`);
        consecutiveFailsRef.current = 0;
      }
    };

    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        consecutiveFailsRef.current = 0;
        const data: AuthUser & { pinRequired?: boolean } = await res.json();
        const { pinRequired, ...user } = data;
        addDeviceUserId(user.id);
        setState({ status: "authenticated", user });
        setPinLocked(!!pinRequired);

        // Detect the server-side PIN cutover (10pm UK / 4am UTC). On the
        // transition from not-locked → locked, bounce to /dashboard with a
        // cache-buster. location.assign triggers a full navigation which
        // refetches index.html, and since Vite hashes asset filenames the
        // browser is guaranteed to load the latest bundle. This also kicks
        // any tab sitting on an old /plans/:planId/station/... URL off
        // yesterday's plan so nobody resumes stale production.
        const wasLocked = prevPinRequiredRef.current;
        prevPinRequiredRef.current = !!pinRequired;
        if (pinRequired && wasLocked !== true) {
          const path = window.location.pathname;
          if (!path.startsWith("/dashboard") && !path.startsWith("/login")) {
            const url = new URL("/dashboard", window.location.origin);
            url.searchParams.set("v", Date.now().toString());
            window.location.assign(url.toString());
          }
        }
      } else if (res.status === 401) {
        consecutiveFailsRef.current = 0;
        setState({ status: "unauthenticated" });
        setPinLocked(false);
        prevPinRequiredRef.current = null;
      } else {
        console.warn(`[Auth] Session check returned ${res.status}`);
        await handleRetryOrFallback();
      }
    } catch (err) {
      const isOffline = !navigator.onLine;
      if (isOffline) {
        console.warn("[Auth] Network offline, keeping current session");
        if (!offlineToastedRef.current) {
          offlineToastedRef.current = true;
          toast({ title: "You appear to be offline", description: "Session will refresh when connection returns.", variant: "destructive" });
        }
        return;
      }
      offlineToastedRef.current = false;
      console.warn("[Auth] Session check network error:", err);
      await handleRetryOrFallback();
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        checkSession(true);
        // Also check idle timeout on each poll (catches tabs left open all night)
        const idleMs = Date.now() - lastActivityRef.current;
        if (idleMs >= IDLE_TIMEOUT_MS && state.status === "authenticated" && !pinLocked) {
          setPinLocked(true);
          fetch("/api/auth/pin/lock", { method: "POST", credentials: "include" })
            .catch((err) => { console.warn("[Auth] Idle lock failed:", err); });
        }
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkSession, state, pinLocked]);

  // ── Inactivity timeout & visibility-change lock ───────────────────────
  // Tracks last user interaction. When the tab becomes visible again (any
  // device — iPad, PC, etc.) we check: if idle for 1+ hour, force a PIN
  // lock. We also always re-check the session so server-side resets (10pm
  // evening lock, 4am morning lock) are picked up immediately.
  const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
  const lastActivityRef = useRef<number>(Date.now());

  // Update activity timestamp on any user interaction
  useEffect(() => {
    const touch = () => { lastActivityRef.current = Date.now(); };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const evt of events) document.addEventListener(evt, touch, { passive: true });
    return () => { for (const evt of events) document.removeEventListener(evt, touch); };
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;

      // Always re-check session so server-side time-based locks are picked up
      checkSession(true);

      // If idle for 1+ hour, force PIN lock (works on all devices)
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= IDLE_TIMEOUT_MS && state.status === "authenticated" && !pinLocked) {
        setPinLocked(true);
        fetch("/api/auth/pin/lock", { method: "POST", credentials: "include" })
          .catch((err) => { console.warn("[Auth] Pin lock failed:", err); });
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [state, pinLocked, checkSession]);

  const refreshUser = useCallback(async () => {
    await checkSession();
  }, [checkSession]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const user: AuthUser = await res.json();
        addDeviceUserId(user.id);
        setState({ status: "authenticated", user });
        setPinLocked(false);
        sensitiveUnlockedAtRef.current = Date.now();
        return { user };
      }
      const data = await res.json().catch(() => ({}));
      return { error: data.error ?? "Login failed" };
    } catch (err) {
      console.warn("[Auth] Login network error:", err);
      return { error: "Network error — please try again" };
    }
  }, []);

  const pinLogin = useCallback(async (userId: number, pin: string) => {
    try {
      const res = await fetch("/api/auth/pin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pin }),
      });
      if (res.ok) {
        const user: AuthUser = await res.json();
        addDeviceUserId(user.id);
        setState({ status: "authenticated", user });
        setPinLocked(false);
        sensitiveUnlockedAtRef.current = Date.now();
        return {};
      }
      const data = await res.json().catch(() => ({}));
      return {
        error: data.error ?? "Login failed",
        attemptsLeft: data.attemptsLeft,
        lockedUntil: data.lockedUntil,
        remainingSeconds: data.remainingSeconds,
      };
    } catch (err) {
      console.warn("[Auth] PIN login network error:", err);
      return { error: "Network error — please try again" };
    }
  }, []);

  // In-session PIN verification for the daily lock overlay.
  // The user is already authenticated — this just re-confirms their identity
  // and stamps pinVerifiedAt so they won't be prompted again until the next
  // reset (10pm UK evening lock or 4am UTC morning lock, whichever comes first).
  const verifyPin = useCallback(async (pin: string): Promise<PinResult> => {
    try {
      const res = await fetch("/api/auth/pin/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        setPinLocked(false);
        sensitiveUnlockedAtRef.current = Date.now();
        return {};
      }
      const data = await res.json().catch(() => ({}));
      return {
        error: data.error ?? "Incorrect PIN",
        attemptsLeft: data.attemptsLeft,
        lockedUntil: data.lockedUntil,
        remainingSeconds: data.remainingSeconds,
      };
    } catch (err) {
      console.warn("[Auth] PIN verify network error:", err);
      return { error: "Network error — please try again" };
    }
  }, []);

  // Gate for sensitive pages. If the last PIN entry was within the TTL window,
  // no-op. Otherwise, trigger the PIN overlay — the user re-enters their PIN
  // and `verifyPin` resets the window. No-op for users without a PIN set
  // (shouldn't happen: PIN setup is enforced at login).
  const requireSensitivePin = useCallback(() => {
    if (state.status !== "authenticated") return;
    if (pinLocked) return; // already prompting
    const age = Date.now() - sensitiveUnlockedAtRef.current;
    if (age < SENSITIVE_UNLOCK_TTL_MS) return;
    setPinLocked(true);
  }, [state, pinLocked]);

  // Manually lock the station — clears pinVerifiedAt server-side and locally.
  // We lock the UI regardless of the server response (security-first): if the
  // network is down, staff still can't proceed without PIN entry. The next
  // successful /pin/verify call will re-sync the server state.
  const lockStation = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/pin/lock", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        console.warn("Lock station: server returned non-OK, locking UI anyway");
      }
    } catch (err) {
      console.warn("[Auth] Lock station: network error, locking UI anyway:", err);
    }
    setPinLocked(true);
    // Manual lock also invalidates the sensitive unlock window.
    sensitiveUnlockedAtRef.current = 0;
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setState({ status: "unauthenticated" });
    setPinLocked(false);
    sensitiveUnlockedAtRef.current = 0;
  }, []);

  return (
    <AuthContext.Provider value={{ state, pinLocked, login, pinLogin, verifyPin, lockStation, logout, refreshUser, requireSensitivePin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
