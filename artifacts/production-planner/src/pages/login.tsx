import { useState, useMemo, useEffect, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Loader2, ArrowLeft, X, UserPlus } from "lucide-react";
import { leanQuotes } from "@/data/lean-quotes";
import { getDeviceUserIds, removeDeviceUserId } from "@/lib/device-users";
import { UserAvatar } from "@/components/user-avatar";
import { PinNumpad } from "@/components/pin-numpad";
import { cn } from "@/lib/utils";

type DeviceUser = {
  id: number;
  name: string;
  role: string;
  avatarUrl: string | null;
  hasPin: boolean;
};

type LoginMode = "picker" | "credential" | "pin";

export default function Login() {
  const { login, pinLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deviceUsers, setDeviceUsers] = useState<DeviceUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [mode, setMode] = useState<LoginMode>("picker");
  const [selectedUser, setSelectedUser] = useState<DeviceUser | null>(null);
  const [pinError, setPinError] = useState("");
  const [pinLockedUntil, setPinLockedUntil] = useState<string | undefined>();
  const [pinRemainingSeconds, setPinRemainingSeconds] = useState<number | undefined>();
  const quote = useMemo(() => leanQuotes[Math.floor(Math.random() * leanQuotes.length)], []);

  useEffect(() => {
    async function loadUsers() {
      const ids = getDeviceUserIds();
      if (ids.length === 0) {
        setDeviceUsers([]);
        setMode("credential");
        setLoadingUsers(false);
        return;
      }

      try {
        const params = ids.map(id => `ids[]=${id}`).join("&");
        const res = await fetch(`/api/auth/devices/users?${params}`);
        if (res.ok) {
          const users: DeviceUser[] = await res.json();
          setDeviceUsers(users);
          setMode(users.length > 0 ? "picker" : "credential");
        } else {
          setMode("credential");
        }
      } catch {
        setMode("credential");
      }
      setLoadingUsers(false);
    }

    loadUsers();
  }, []);

  const handleSelectUser = (user: DeviceUser) => {
    setSelectedUser(user);
    setPinError("");
    setPinLockedUntil(undefined);
    setPinRemainingSeconds(undefined);
    setMode("pin");
  };

  const handlePinComplete = async (pin: string) => {
    if (!selectedUser) return;
    const result = await pinLogin(selectedUser.id, pin);
    if (result.error) {
      setPinError(result.error);
      if (result.lockedUntil) {
        setPinLockedUntil(result.lockedUntil);
        setPinRemainingSeconds(result.remainingSeconds);
      }
    }
  };

  const handleRemoveUser = (userId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    removeDeviceUserId(userId);
    const updated = deviceUsers.filter(u => u.id !== userId);
    setDeviceUsers(updated);
    if (updated.length === 0) {
      setMode("credential");
    }
  };

  const handleCredentialSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    }
  };

  const handleBackToPicker = () => {
    setSelectedUser(null);
    setPinError("");
    setPinLockedUntil(undefined);
    setMode(deviceUsers.length > 0 ? "picker" : "credential");
  };

  if (loadingUsers) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-8">
          <img
            src={`${import.meta.env.BASE_URL}tck-logo-dark.png`}
            alt="The Calzone Kitchen"
            className="h-20 w-auto object-contain"
          />
          <span className="text-xs text-muted-foreground tracking-widest uppercase font-medium">Production Planner</span>
          <p className="text-sm italic text-muted-foreground/70 text-center mt-3 max-w-xs leading-relaxed">
            "{quote.text}"
            <span className="block text-xs mt-1 not-italic">— {quote.author}</span>
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          {mode === "picker" && (
            <>
              <h1 className="text-lg font-semibold mb-1">Who are you?</h1>
              <p className="text-sm text-muted-foreground mb-5">Select your account to sign in</p>

              <div className="grid grid-cols-2 gap-3 mb-4">
                {deviceUsers.map(user => (
                  <div
                    key={user.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectUser(user)}
                    onKeyDown={(e) => e.key === "Enter" && handleSelectUser(user)}
                    className={cn(
                      "relative flex flex-col items-center gap-2 p-4 rounded-xl border border-border",
                      "hover:bg-secondary/50 hover:border-primary/40 transition-all duration-200 group cursor-pointer",
                      "active:scale-95"
                    )}
                  >
                    <button
                      type="button"
                      onClick={(e) => handleRemoveUser(user.id, e)}
                      className="absolute top-2 right-2 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground hover:bg-secondary"
                      title="Remove from this device"
                      aria-label="Remove from this device"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <UserAvatar
                      name={user.name}
                      avatarUrl={user.avatarUrl}
                      size="lg"
                    />
                    <div className="text-center min-w-0 w-full">
                      <p className="text-sm font-semibold truncate">{user.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setMode("credential")}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-muted-foreground hover:text-foreground border border-dashed border-border rounded-xl hover:border-border/80 transition-all duration-200"
              >
                <UserPlus className="w-4 h-4" />
                Use a different account
              </button>
            </>
          )}

          {mode === "pin" && selectedUser && (
            <>
              <div className="flex items-center gap-3 mb-5">
                <button
                  onClick={handleBackToPicker}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                  <UserAvatar name={selectedUser.name} avatarUrl={selectedUser.avatarUrl} size="sm" />
                  <div>
                    <p className="text-sm font-semibold leading-tight">{selectedUser.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{selectedUser.role}</p>
                  </div>
                </div>
              </div>

              <PinNumpad
                onComplete={handlePinComplete}
                error={pinError}
                lockedUntil={pinLockedUntil}
                remainingSeconds={pinRemainingSeconds}
                label="Enter your 4-digit PIN"
              />

              <button
                onClick={() => setMode("credential")}
                className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Use password instead
              </button>
            </>
          )}

          {mode === "credential" && (
            <>
              <div className="flex items-center gap-2 mb-4">
                {deviceUsers.length > 0 && (
                  <button
                    onClick={() => setMode("picker")}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    aria-label="Back"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <div>
                  <h1 className="text-xl font-semibold mb-0.5">Sign in</h1>
                  <p className="text-sm text-muted-foreground">Enter your credentials to continue</p>
                </div>
              </div>

              <form onSubmit={handleCredentialSubmit} className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="••••••••"
                  />
                </div>

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? "Signing in…" : "Sign in"}
                </button>
              </form>

              <div className="mt-4 text-center">
                <a
                  href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/forgot-password`}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Forgot your password?
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
