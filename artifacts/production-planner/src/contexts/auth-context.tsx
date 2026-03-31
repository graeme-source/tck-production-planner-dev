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
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [pinLocked, setPinLocked] = useState(false);

  const consecutiveFailsRef = useRef(0);
  const offlineToastedRef = useRef(false);

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
      } else if (res.status === 401) {
        consecutiveFailsRef.current = 0;
        setState({ status: "unauthenticated" });
        setPinLocked(false);
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
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkSession]);

  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      || ("ontouchstart" in window && window.innerWidth < 1024);

    if (!isMobile) return;

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === "visible" && hiddenAtRef.current !== null) {
        hiddenAtRef.current = null;
        if (state.status === "authenticated" && state.user.hasPin && !pinLocked) {
          setPinLocked(true);
          fetch("/api/auth/pin/lock", { method: "POST", credentials: "include" }).catch((err) => { console.warn("[Auth] Pin lock failed:", err); });
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [state, pinLocked]);

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
  // and stamps pinVerifiedAt so they won't be prompted again until tomorrow's 5am.
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
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setState({ status: "unauthenticated" });
    setPinLocked(false);
  }, []);

  return (
    <AuthContext.Provider value={{ state, pinLocked, login, pinLogin, verifyPin, lockStation, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
