import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { shouldResetCachesOnIdentityChange } from "@/lib/session-identity";
import { shouldPromptForSensitivePin, gateUsesPrivatePin, type SensitiveScope } from "@/lib/sensitive-pin";
import { addDeviceUserId } from "@/lib/device-users";
import { toast } from "@/hooks/use-toast";
import { idleTimeoutMs, type IdleTimeoutSettings } from "@/lib/idle-timeout";
import { londonDay, crossedLondonMidnight } from "@/lib/day-rollover";
import { nextStreakStart, shouldDeferCutover, cutoverPassedWhileAway } from "@/lib/pin-cutover-client";
import { PIN_REQUIRED_EVENT } from "@/lib/pin-required-fetch";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "manager" | "viewer";
  avatarUrl: string | null;
  hasPin: boolean;
  /** Has a private PIN for the People section (migration 0123). */
  hasPrivatePin?: boolean;
  isProductionPlanner?: boolean;
  isBookkeeper?: boolean;
  /** Feature keys this user can use right now (grants + optional SOP gate). */
  features?: string[];
  onboardingRequired?: boolean;
  onboardingCompletedAt?: string | null;
  // ISO timestamp of the forced password-reset deadline, or null when the
  // user has no pending reset (founder, or already changed under the policy).
  passwordResetDeadline?: string | null;
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
  /** Prompt for PIN if the sensitive-unlock window has expired. Idempotent — safe to call on every mount.
   *  scope "people" asks for the private PIN when the person has set one. */
  requireSensitivePin: (opts?: { includeAdmins?: boolean; fresh?: boolean; scope?: SensitiveScope }) => void;
  /** The People section's private-PIN prompt is showing. */
  peoplePinPrompt: boolean;
  verifyPeoplePin: (pin: string) => Promise<PinResult>;
  /** "Not now" on the People PIN prompt — closes it; the page sends them away. */
  cancelPeoplePin: () => void;
};

// How long a PIN entry grants access to sensitive pages before re-prompting.
const SENSITIVE_UNLOCK_TTL_MS = 5 * 60 * 1000;

// How long a person must be genuinely INACTIVE before anything is allowed to
// PIN-lock or reload their session (Graeme's rule, 2026-08-20 — was 1 hour):
// an active user must never be interrupted. This one threshold gates the idle
// lock, the 10pm/4am PIN cutover, and the 10pm bundle refresh. Activity is
// persisted to localStorage so it (a) survives a browser restart — the
// overnight-PC fix — and (b) is shared ACROSS TABS, so typing in one tab
// keeps a second tab from deciding the session is idle (that cross-tab gap
// locked Graeme out mid-recipe and cost him unsaved work).
// Per-station now, not one number for the whole app: a screen that's watched
// but rarely touched (Dough Prep, Dough Sheeting) was locking people out
// mid-shift, while an iPad left on the packing bench stayed logged in for
// hours. See lib/idle-timeout.ts for the rules; this reads whatever Settings
// has stored and falls back to the shipped defaults until it loads.
let idleSettings: IdleTimeoutSettings | null = null;

/** The allowance for whatever screen is open right now. Read at the moment of
 *  each check rather than captured once, so walking from the packing iPad to
 *  a dough screen takes that screen's timeout with it. */
function currentIdleTimeoutMs(): number {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  return idleTimeoutMs(path, idleSettings);
}
const LAST_ACTIVITY_KEY = "tck_last_activity";
function readStoredActivity(): number {
  try {
    const v = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    if (Number.isFinite(v) && v > 0 && v <= Date.now()) return v;
  } catch { /* private mode */ }
  return 0;
}

// ── Daily PIN cutover bookkeeping (2026-09-25) ────────────────────────
// The 4am/10pm cutover may only wait for someone who was ALREADY working
// when the reset struck (lib/pin-cutover-client.ts). Two things make that
// knowable, both shared across tabs and surviving a reload:
//  - ACTIVITY_STREAK_KEY: when the current unbroken run of activity began.
//  - NEXT_PIN_RESET_KEY: the next reset moment, as /api/auth/me last said.
//    Lets a screen that wakes, refocuses or reloads lock straight away,
//    before the server answers and before the first tap looks like work.
const ACTIVITY_STREAK_KEY = "tck_activity_streak_start";
const NEXT_PIN_RESET_KEY = "tck_pin_next_reset";
function readStoredNumber(key: string): number {
  try {
    const v = Number(localStorage.getItem(key));
    if (Number.isFinite(v) && v > 0) return v;
  } catch { /* private mode */ }
  return 0;
}
function writeStored(key: string, value: number | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch { /* private mode */ }
}
function parseIsoMs(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// ── Next-morning dashboard bounce ─────────────────────────────────────
// People opened a station the next day and landed on YESTERDAY'S production
// page: the browser restores the URL it was on, and every resume path (PIN
// unlock, fresh login, restored session) carried on in place (Graeme,
// 2026-09-04). There is no stored "last location" to wipe at midnight —
// instead, the moment someone comes back on a NEW London day, they start on
// the dashboard.
//
// Two snapshots taken synchronously at bundle load, BEFORE any tap can
// overwrite the stored activity timestamp (the first touch of the morning
// persists immediately, so reading later would always say "today"):
//  - RESUMED_FROM_PREVIOUS_DAY: this page load is the first since a
//    previous working day → bounce as soon as the session authenticates.
//  - PAGE_LOADED_DAY: lets login/unlock detect a tab that has physically
//    lived across midnight without reloading (screen left on overnight).
const PAGE_LOADED_DAY = londonDay(Date.now());
const RESUMED_FROM_PREVIOUS_DAY = crossedLondonMidnight(readStoredActivity(), Date.now());
function crossedMidnightSinceLoad(): boolean {
  return londonDay(Date.now()) !== PAGE_LOADED_DAY;
}
/** Full navigation to the dashboard, same shape as the 10pm cutover: the
 *  cache-buster refetches index.html, so the morning also picks up the
 *  latest bundle. No-op when already home (or still logging in). */
function bounceToDashboard() {
  const path = window.location.pathname;
  if (path === "/" || path.startsWith("/login")) return;
  const url = new URL("/", window.location.origin);
  url.searchParams.set("v", Date.now().toString());
  window.location.assign(url.toString());
}

// Once a PIN lock has actually been APPLIED on this device, it must survive
// a page reload — tapping the PIN pad counts as "activity", so without this
// flag a locked station could be re-entered by simply refreshing the page
// (the active-user deferral would kick in). The flag is set whenever the
// overlay is applied for a server-backed lock and cleared only by a
// successful PIN entry or full login.
const PIN_LOCK_APPLIED_KEY = "tck_pin_lock_applied";
function markPinLockApplied() {
  try { localStorage.setItem(PIN_LOCK_APPLIED_KEY, "1"); } catch { /* private mode */ }
}
function clearPinLockApplied() {
  try { localStorage.removeItem(PIN_LOCK_APPLIED_KEY); } catch { /* private mode */ }
}
function isPinLockApplied(): boolean {
  try { return localStorage.getItem(PIN_LOCK_APPLIED_KEY) === "1"; } catch { return false; }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const queryClient = useQueryClient();

  // The station PCs are shared — people swap in and out by PIN all day.
  // Cached queries are keyed the same for everyone, so when a DIFFERENT
  // person signs in (or someone signs out) the previous person's data must
  // go: without this, Lorna's to-dos rendered under Major's name on the
  // packing screen until the next scheduled refetch (2026-09-04). The rule
  // for when to wipe lives in lib/session-identity.ts with its tests; the
  // same person re-verifying the daily PIN lock keeps their cache.
  const previousUserIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.status === "loading") return;
    const nextUserId = state.status === "authenticated" ? state.user.id : null;
    if (shouldResetCachesOnIdentityChange(previousUserIdRef.current, nextUserId)) {
      queryClient.clear();
    }
    previousUserIdRef.current = nextUserId;
  }, [state, queryClient]);

  // Load the per-station idle allowances once. Until they arrive the shipped
  // defaults apply, so a slow or failed fetch can never make a screen lock
  // sooner than it should — it just behaves as configured out of the box.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/app-settings/station_idle_minutes", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then((row: { value?: string } | null) => {
        if (cancelled || !row?.value) return;
        const parsed = JSON.parse(row.value) as IdleTimeoutSettings;
        if (parsed && typeof parsed === "object") idleSettings = parsed;
      })
      .catch(() => { /* defaults stand */ });
    return () => { cancelled = true; };
  }, []);
  const [pinLocked, setPinLocked] = useState(false);
  // Mirror of pinLocked for the stable checkSession callback (empty deps —
  // it must not re-create on every lock change).
  const pinLockedRef = useRef(false);
  useEffect(() => { pinLockedRef.current = pinLocked; }, [pinLocked]);
  // Freshest known activity: this tab's in-memory timestamp OR whatever any
  // other tab persisted. Every idle decision goes through here.
  const lastActivityRef = useRef<number>(readStoredActivity() || Date.now());
  const lastPersistRef = useRef<number>(0);
  // Start of the current unbroken activity streak (see ACTIVITY_STREAK_KEY).
  // Written through to localStorage on every change, so the stored value is
  // the freshest across tabs; this tab's ref covers private mode.
  const streakStartRef = useRef<number>(readStoredNumber(ACTIVITY_STREAK_KEY));
  const getStreakStart = useCallback(() => {
    return readStoredNumber(ACTIVITY_STREAK_KEY) || streakStartRef.current;
  }, []);
  const getLastActivity = useCallback(() => {
    return Math.max(lastActivityRef.current, readStoredActivity());
  }, []);
  // Timestamp of the last successful PIN entry. Used to gate sensitive pages
  // (Analytics, Settings) so that leaving a device unattended doesn't expose
  // HR / config data even within an authenticated session.
  const sensitiveUnlockedAtRef = useRef<number>(0);
  // People section unlocked with the PRIVATE PIN (only used by people who
  // have one). Station PIN logins/unlocks deliberately don't touch it.
  const peopleUnlockedAtRef = useRef<number>(0);
  const [peoplePinPrompt, setPeoplePinPrompt] = useState(false);

  const consecutiveFailsRef = useRef(0);
  const offlineToastedRef = useRef(false);
  // Tracks the previous server-reported pinRequired flag so we can detect the
  // exact moment the 10pm / 4am cutover fires. When it flips false → true we
  // perform a full-page navigation to /dashboard, which (a) kicks the user
  // off yesterday's plan URL and (b) forces index.html to be re-fetched so
  // the client picks up the latest hashed asset bundle. Both problems solved
  // in one move.
  const prevPinRequiredRef = useRef<boolean | null>(null);

  // Put the cutover lock up and, the first time, bounce to the dashboard
  // (full navigation → fresh bundle, off yesterday's URL).
  const applyCutoverLock = useCallback(() => {
    const wasLocked = prevPinRequiredRef.current;
    prevPinRequiredRef.current = true;
    setPinLocked(true);
    markPinLockApplied();
    if (wasLocked !== true) {
      const path = window.location.pathname;
      if (path !== "/" && !path.startsWith("/login")) {
        const url = new URL("/", window.location.origin);
        url.searchParams.set("v", Date.now().toString());
        window.location.assign(url.toString());
      }
    }
  }, []);

  // Wake / focus / reload check: if the reset the server told us about has
  // passed while nobody was working, lock NOW — before the round-trip to
  // /api/auth/me, and before the first tap of the morning can make the
  // device look busy. checkSession then confirms (and clears the lock if
  // the server disagrees, e.g. a device clock running fast).
  const lockIfCutoverPassedWhileAway = useCallback(() => {
    if (pinLockedRef.current) return;
    if (cutoverPassedWhileAway({
      now: Date.now(),
      nextResetAt: readStoredNumber(NEXT_PIN_RESET_KEY) || null,
      lastActivity: getLastActivity(),
      streakStart: getStreakStart(),
      lockAlreadyApplied: isPinLockApplied(),
    })) {
      applyCutoverLock();
    }
  }, [applyCutoverLock, getLastActivity, getStreakStart]);

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
        const data: AuthUser & { pinRequired?: boolean; pinResetAt?: string; pinNextResetAt?: string } = await res.json();
        const { pinRequired, pinResetAt, pinNextResetAt, ...user } = data;
        writeStored(NEXT_PIN_RESET_KEY, parseIsoMs(pinNextResetAt));
        addDeviceUserId(user.id);
        setState({ status: "authenticated", user });

        // Server-side PIN cutover (10pm UK / 4am UTC). Applying it means
        // locking AND bouncing to the dashboard with a cache-buster —
        // location.assign is a full navigation, which refetches index.html
        // (Vite's hashed filenames guarantee the latest bundle) and kicks
        // any tab off yesterday's /plans/... URL. The dashboard route is
        // "/" — "/dashboard" doesn't exist and rendered the 404 page.
        //
        // BUT a full navigation destroys unsaved client state, so the
        // cutover is DEFERRED for someone who was already working when the
        // reset struck and hasn't stopped (Graeme lost a half-built recipe
        // to the 10pm cutover, 2026-08-20). Activity AFTER the reset never
        // counts: the old rule ("active in the last N minutes") let the
        // first taps on an iPad woken in the morning dodge the lock, and a
        // session signed in as Grant overnight recorded 16 batches before
        // he arrived (25 Sep 2026). Rule + tests: lib/pin-cutover-client.ts.
        // An already-applied lock always stays applied — typing PIN digits
        // is "activity" but must never dismiss the overlay.
        if (!pinRequired) {
          prevPinRequiredRef.current = false;
          setPinLocked(false);
          clearPinLockApplied();
        } else if (pinLockedRef.current) {
          prevPinRequiredRef.current = true;
        } else if (shouldDeferCutover({
          now: Date.now(),
          resetAt: parseIsoMs(pinResetAt),
          lastActivity: getLastActivity(),
          streakStart: getStreakStart(),
          lockAlreadyApplied: isPinLockApplied(),
        })) {
          // Working straight through the reset — defer. (An applied lock
          // re-locks on reload regardless of activity; otherwise tapping
          // the PIN pad then refreshing would walk straight past it.)
          // prevPinRequiredRef deliberately unchanged so the apply branch
          // still sees the transition later.
        } else {
          applyCutoverLock();
        }
      } else if (res.status === 401) {
        consecutiveFailsRef.current = 0;
        writeStored(NEXT_PIN_RESET_KEY, null);
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
        const idleMs = Date.now() - getLastActivity();
        if (idleMs >= currentIdleTimeoutMs() && state.status === "authenticated" && !pinLocked) {
          setPinLocked(true);
          markPinLockApplied();
          fetch("/api/auth/pin/lock", { method: "POST", credentials: "include" })
            .catch((err) => { console.warn("[Auth] Idle lock failed:", err); });
        }
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkSession, state, pinLocked, getLastActivity]);

  // ── Inactivity timeout & visibility-change lock ───────────────────────
  // The refs live near the top of the component (checkSession needs them);
  // here are the listeners that feed them and the checks that act on them.
  // Persisting to localStorage (throttled — pointer/scroll events fire
  // constantly, and 30s of staleness is nothing against a 15-minute
  // timeout) is what makes the timestamp survive a browser restart (the
  // overnight-PC fix) and count across tabs.

  // Update activity timestamp on any user interaction
  useEffect(() => {
    const touch = () => {
      const now = Date.now();
      // Streak first, against the activity as it stood BEFORE this touch.
      const streak = nextStreakStart({ lastActivity: getLastActivity(), streakStart: getStreakStart() }, now);
      if (streak !== streakStartRef.current) {
        streakStartRef.current = streak;
        writeStored(ACTIVITY_STREAK_KEY, streak);
      }
      lastActivityRef.current = now;
      if (now - lastPersistRef.current > 30_000) {
        lastPersistRef.current = now;
        try { localStorage.setItem(LAST_ACTIVITY_KEY, String(now)); } catch { /* private mode */ }
      }
    };
    // Persist immediately when the tab goes to the background — the cleanest
    // "last seen" we can record before a shutdown we won't get to observe.
    const persistOnHide = () => {
      if (document.visibilityState === "hidden") {
        try { localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivityRef.current)); } catch { /* private mode */ }
      }
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const evt of events) document.addEventListener(evt, touch, { passive: true });
    document.addEventListener("visibilitychange", persistOnHide);
    return () => {
      for (const evt of events) document.removeEventListener(evt, touch);
      document.removeEventListener("visibilitychange", persistOnHide);
    };
  }, [getLastActivity, getStreakStart]);

  // Boot check: a freshly launched browser (PC turned on in the morning)
  // fires neither the 5-minute poll nor a visibilitychange, so without this
  // the stored idle time would only be acted on minutes into the day. Runs
  // once, as soon as the restored session reports authenticated.
  const bootIdleCheckedRef = useRef(false);
  useEffect(() => {
    if (bootIdleCheckedRef.current) return;
    if (state.status !== "authenticated") return;
    bootIdleCheckedRef.current = true;
    // First page load of a new working day → start on the dashboard, not
    // wherever yesterday finished. Runs even when the PIN overlay is up:
    // the applied lock survives the navigation, so the pad simply reappears
    // over the dashboard and unlocking lands somewhere current.
    if (RESUMED_FROM_PREVIOUS_DAY) {
      bounceToDashboard();
      return;
    }
    if (pinLocked) return;
    const idleMs = Date.now() - getLastActivity();
    if (idleMs >= currentIdleTimeoutMs()) {
      setPinLocked(true);
      markPinLockApplied();
      fetch("/api/auth/pin/lock", { method: "POST", credentials: "include" })
        .catch((err) => { console.warn("[Auth] Boot idle lock failed:", err); });
    }
  }, [state, pinLocked, getLastActivity]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;

      // A reset that passed while the screen was asleep locks immediately.
      lockIfCutoverPassedWhileAway();

      // Always re-check session so server-side time-based locks are picked up
      checkSession(true);

      // Idle for 15+ minutes ACROSS ALL TABS → PIN lock. getLastActivity
      // reads the shared timestamp, so switching to a tab that hasn't been
      // touched in an hour no longer locks a session that was active in
      // another tab seconds ago.
      const idleMs = Date.now() - getLastActivity();
      if (idleMs >= currentIdleTimeoutMs() && state.status === "authenticated" && !pinLocked) {
        setPinLocked(true);
        markPinLockApplied();
        fetch("/api/auth/pin/lock", { method: "POST", credentials: "include" })
          .catch((err) => { console.warn("[Auth] Pin lock failed:", err); });
      }
    };
    // focus / pageshow too: an iPad web app restored from the app switcher,
    // or a page brought back from the back-forward cache, doesn't always
    // fire visibilitychange.
    const handleFocus = () => {
      lockIfCutoverPassedWhileAway();
      checkSession(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handleFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handleFocus);
    };
  }, [state, pinLocked, checkSession, getLastActivity, lockIfCutoverPassedWhileAway]);

  // The server refused a write that records work against a person because
  // this session's PIN is due (423 PIN_REQUIRED — lib/pin-required-fetch.ts).
  // Put the pad up; no navigation, so nothing typed on the screen is lost.
  // Whoever is really there enters their PIN (or switches user) and taps
  // again. One toast per burst — a screen can fire several writes at once.
  const lastPinToastRef = useRef(0);
  useEffect(() => {
    const onPinRequired = () => {
      setPinLocked(true);
      markPinLockApplied();
      prevPinRequiredRef.current = true;
      if (Date.now() - lastPinToastRef.current > 5_000) {
        lastPinToastRef.current = Date.now();
        toast({
          title: "Enter your PIN, then tap again",
          description: "That wasn't saved — today's PIN is needed first, so it goes down under the right name.",
          variant: "destructive",
        });
      }
    };
    window.addEventListener(PIN_REQUIRED_EVENT, onPinRequired);
    return () => window.removeEventListener(PIN_REQUIRED_EVENT, onPinRequired);
  }, []);

  // Page load: the same local check, straight away, from what the last
  // session check stored — a reload in the morning doesn't wait for
  // /api/auth/me (whose answer could arrive after the first tap).
  useEffect(() => {
    lockIfCutoverPassedWhileAway();
  }, [lockIfCutoverPassedWhileAway]);

  // ── Scheduled hard refresh at 10pm UK wall-clock ──────────────────────
  // The auth-triggered redirect in checkSession already handles every
  // authenticated tab — when pinRequired flips at 10pm, we navigate to
  // /dashboard, which fetches a fresh index.html and therefore the latest
  // hashed bundle.
  //
  // This closes the gap for tabs that are NOT authenticated at 10pm
  // (sitting on /login, or a PWA someone signed out of but never closed).
  // Those tabs never see pinRequired because /api/auth/me returns 401, so
  // they'd keep running whatever JS was loaded at sign-in time. A simple
  // setTimeout scheduled for the next 10pm UK is enough — modern browsers
  // throttle background tabs by at most ~1 minute, and a frozen tab
  // resumes pending timers when it becomes visible again, so every active
  // client picks up the latest bundle shortly after 10pm regardless of
  // auth state.
  useEffect(() => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false, timeZone: "Europe/London",
    }).formatToParts(new Date());
    const h = Number(parts.find(p => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find(p => p.type === "minute")?.value ?? "0");
    const s = Number(parts.find(p => p.type === "second")?.value ?? "0");
    const currentSec = h * 3600 + m * 60 + s;
    const targetSec = 22 * 3600; // 10pm UK local wall-clock
    let delayMs = (targetSec - currentSec) * 1000;
    if (delayMs <= 0) delayMs += 24 * 60 * 60 * 1000;

    // A reload destroys unsaved client state, so it must NEVER hit someone
    // mid-work: at 10pm, if this tab's user has been active inside the idle
    // window, retry every 5 minutes and reload only once they've stepped
    // away (Graeme lost a half-built recipe to interruptions like this,
    // 2026-08-20).
    let id = 0;
    const fireWhenIdle = () => {
      if (Date.now() - getLastActivity() < currentIdleTimeoutMs()) {
        id = window.setTimeout(fireWhenIdle, 5 * 60 * 1000);
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set("v", Date.now().toString());
      window.location.replace(url.toString());
    };
    id = window.setTimeout(fireWhenIdle, delayMs);
    return () => window.clearTimeout(id);
  }, [getLastActivity]);

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
        clearPinLockApplied();
        sensitiveUnlockedAtRef.current = Date.now();
        // The stored "next reset" is now in the past; a focus event must
        // not read it as a missed cutover. Fetch the new schedule.
        writeStored(NEXT_PIN_RESET_KEY, null);
        void checkSession(true);
        // A tab that has sat on the login screen across midnight is still
        // parked on yesterday's URL underneath — send it home.
        if (crossedMidnightSinceLoad()) bounceToDashboard();
        return { user };
      }
      const data = await res.json().catch(() => ({}));
      return { error: data.error ?? "Login failed" };
    } catch (err) {
      console.warn("[Auth] Login network error:", err);
      return { error: "Network error — please try again" };
    }
  }, [checkSession]);

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
        clearPinLockApplied();
        sensitiveUnlockedAtRef.current = Date.now();
        // The stored "next reset" is now in the past; a focus event must
        // not read it as a missed cutover. Fetch the new schedule.
        writeStored(NEXT_PIN_RESET_KEY, null);
        void checkSession(true);
        if (crossedMidnightSinceLoad()) bounceToDashboard();
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
  }, [checkSession]);

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
        clearPinLockApplied();
        sensitiveUnlockedAtRef.current = Date.now();
        // The stored "next reset" is now in the past; a focus event must
        // not read it as a missed cutover. Fetch the new schedule.
        writeStored(NEXT_PIN_RESET_KEY, null);
        void checkSession(true);
        // Screen left on overnight: the page never reloaded, so the boot
        // check can't see the new day — but the tab itself knows it was
        // loaded yesterday. Unlocking on a new day starts on the dashboard.
        if (crossedMidnightSinceLoad()) bounceToDashboard();
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
  }, [checkSession]);

  // Gate for sensitive pages. If the last PIN entry was within the TTL window,
  // no-op. Otherwise, trigger the PIN overlay — the user re-enters their PIN
  // and `verifyPin` resets the window. No-op for users without a PIN set
  // (shouldn't happen: PIN setup is enforced at login).
  // Admins are exempt from the sensitive-page PIN gate entirely — they can
  // move freely between analytics and other sensitive pages without re-entry.
  // includeAdmins: pages holding people-data (the Employee Hub's reviews and
  // recorded feedback) prompt EVERYONE — an admin's left-behind iPad is the
  // one with every employee's records on it. The default keeps the admin
  // exemption for analytics-style pages. Rule + tests: lib/sensitive-pin.ts.
  const requireSensitivePin = useCallback((opts?: { includeAdmins?: boolean; fresh?: boolean; scope?: SensitiveScope }) => {
    if (state.status !== "authenticated") return;
    if (pinLocked || peoplePinPrompt) return; // already prompting
    // People pages ask for the private PIN once one is set (Graeme,
    // 2026-09-24): its own unlock window, never opened by a station PIN.
    const privatePin = gateUsesPrivatePin(opts?.scope ?? "general", state.user.hasPrivatePin);
    const prompt = shouldPromptForSensitivePin({
      role: state.user.role,
      includeAdmins: opts?.includeAdmins ?? false,
      msSinceUnlock: Date.now() - (privatePin ? peopleUnlockedAtRef.current : sensitiveUnlockedAtRef.current),
      ttlMs: SENSITIVE_UNLOCK_TTL_MS,
      fresh: opts?.fresh ?? false,
    });
    if (!prompt) return;
    if (privatePin) setPeoplePinPrompt(true);
    else setPinLocked(true);
  }, [state, pinLocked, peoplePinPrompt]);

  const verifyPeoplePin = useCallback(async (pin: string): Promise<PinResult> => {
    try {
      const res = await fetch("/api/auth/people-pin/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        peopleUnlockedAtRef.current = Date.now();
        setPeoplePinPrompt(false);
        return {};
      }
      const data = await res.json().catch(() => ({}));
      return { error: data.error ?? "Incorrect PIN", attemptsLeft: data.attemptsLeft, lockedUntil: data.lockedUntil, remainingSeconds: data.remainingSeconds };
    } catch (err) {
      console.warn("[Auth] People PIN verify network error:", err);
      return { error: "Network error — please try again" };
    }
  }, []);

  const cancelPeoplePin = useCallback(() => setPeoplePinPrompt(false), []);

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
    markPinLockApplied();
    // Manual lock also invalidates the sensitive unlock windows.
    sensitiveUnlockedAtRef.current = 0;
    peopleUnlockedAtRef.current = 0;
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    writeStored(NEXT_PIN_RESET_KEY, null);
    setState({ status: "unauthenticated" });
    setPinLocked(false);
    setPeoplePinPrompt(false);
    sensitiveUnlockedAtRef.current = 0;
    peopleUnlockedAtRef.current = 0;
  }, []);

  return (
    <AuthContext.Provider value={{ state, pinLocked, login, pinLogin, verifyPin, lockStation, logout, refreshUser, requireSensitivePin, peoplePinPrompt, verifyPeoplePin, cancelPeoplePin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
