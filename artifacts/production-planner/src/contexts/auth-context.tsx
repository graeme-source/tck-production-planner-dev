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

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string) => Promise<{ error?: string; user?: AuthUser }>;
  pinLogin: (userId: number, pin: string) => Promise<{ error?: string; attemptsLeft?: number; lockedUntil?: string; remainingSeconds?: number }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const user: AuthUser = await res.json();
        addDeviceUserId(user.id);
        setState({ status: "authenticated", user });
      } else {
        setState({ status: "unauthenticated" });
      }
    } catch {
      setState({ status: "unauthenticated" });
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

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setState({ status: "unauthenticated" });
  }, []);

  return (
    <AuthContext.Provider value={{ state, login, pinLogin, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
