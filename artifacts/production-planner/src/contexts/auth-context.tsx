import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { addDeviceUserId } from "@/lib/device-users";

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

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data: AuthUser & { pinRequired?: boolean } = await res.json();
        const { pinRequired, ...user } = data;
        addDeviceUserId(user.id);
        setState({ status: "authenticated", user });
        setPinLocked(!!pinRequired);
      } else {
        setState({ status: "unauthenticated" });
        setPinLocked(false);
      }
    } catch {
      setState({ status: "unauthenticated" });
      setPinLocked(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

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
    } catch {
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
    } catch {
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
    } catch {
      return { error: "Network error — please try again" };
    }
  }, []);

  // Manually lock the station — clears pinVerifiedAt server-side.
  const lockStation = useCallback(async () => {
    try {
      await fetch("/api/auth/pin/lock", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore network errors — lock the UI anyway
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
