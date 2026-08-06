import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useListUsers, useListCategoryDefaults, useListDptSettings, useListTimingStandards, useListRecipes, useListIngredients } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { usePagePermissions, useSavePagePermissions } from "@/hooks/use-page-permissions";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import {
  Plus, Trash2, Edit2, Loader2, Users, ShieldCheck, Eye, Wrench,
  CheckCircle2, XCircle, KeyRound, Package, ChevronDown, ChevronUp,
  Lock, Timer, BarChart2, Coffee, Clock, Truck, Mail, Warehouse,
  Camera, User, CircleDot, ToggleRight, Boxes, UtensilsCrossed,
  AlertTriangle, Scale, ThermometerSnowflake, BookOpen, Megaphone, CalendarDays,
  Copy, Check, IdCard, FileText, ExternalLink, Bell, RefreshCw, Smartphone, Thermometer,
  AlarmClock,
} from "lucide-react";
import { STATIONS } from "@/pages/station/shared/constants";
import { TIMED_REMINDERS_KEY, parseReminders, type TimedReminder } from "@/pages/station/shared/timed-reminders";
import {
  isPushSupported, isStandalone, isSubscribedOnThisDevice,
  enablePushOnThisDevice, disablePushOnThisDevice, sendTestPush,
} from "@/lib/push";
import { StandardsSopsDialog } from "@/components/standards-sops-dialog";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui/number-input";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { upsertDptSettingByRecipe, updateTimingStandard, getListDptSettingsQueryKey, getListTimingStandardsQueryKey } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { PinNumpad } from "@/components/pin-numpad";
import { AvatarCropModal } from "@/components/avatar-crop-modal";
import { useSearch, useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Role = "admin" | "manager" | "viewer";

const ROLES: { value: Role; label: string; description: string; icon: typeof ShieldCheck; color: string }[] = [
  {
    value: "admin",
    label: "Admin",
    description: "Full access — manage users, all data, and settings",
    icon: ShieldCheck,
    color: "text-red-500 bg-red-50",
  },
  {
    value: "manager",
    label: "Manager",
    description: "Create and edit recipes, plans, stock, and sales — no user management",
    icon: Wrench,
    color: "text-amber-500 bg-amber-50",
  },
  {
    value: "viewer",
    label: "Viewer",
    description: "Read-only access — can view all data but cannot make changes",
    icon: Eye,
    color: "text-blue-500 bg-blue-50",
  },
];

const passwordFieldSchema = z.string()
  .min(9, "Password must be more than 8 characters")
  .regex(/[A-Z]/, "Password must include a capital letter")
  .regex(/[0-9]/, "Password must include a number");

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email required"),
  password: passwordFieldSchema,
  role: z.enum(["admin", "manager", "viewer"]),
  isActive: z.boolean(),
});

const editSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email required"),
  password: passwordFieldSchema.optional().or(z.literal("")),
  role: z.enum(["admin", "manager", "viewer"]),
  isActive: z.boolean(),
});

type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;

type AppUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
};

function RoleBadge({ role }: { role: Role }) {
  const r = ROLES.find(x => x.value === role)!;
  const Icon = r.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${r.color}`}>
      <Icon className="w-3.5 h-3.5" />
      {r.label}
    </span>
  );
}

// Read-only view of everything stored against a user: their account details
// plus the pre-arrival onboarding submission (contact + emergency contact +
// uploaded documents). Loaded from GET /api/onboarding/:userId (admin/manager).
function UserDetailsDialog({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["onboarding", user.id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/onboarding/${user.id}`, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json() as Promise<{
        submission: {
          phone: string | null;
          address: string | null;
          emergencyContactName: string | null;
          emergencyContactPhone: string | null;
          emergencyContactRelationship: string | null;
          submittedAt: string | null;
        } | null;
        documents: { id: number; kind: string; fileName: string | null }[];
      }>;
    },
  });
  const s = data?.submission;
  const docs = data?.documents ?? [];
  const kindLabel: Record<string, string> = {
    right_to_work: "Right to work / ID",
    food_hygiene: "Food Hygiene certificate",
    other: "Document",
  };
  const Row = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-right break-words">{value || <span className="text-muted-foreground/50">—</span>}</span>
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{user.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-1">
          {/* Account */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Account</p>
            <Row label="Email" value={user.email} />
            <div className="flex justify-between gap-3 py-1.5 border-b border-border">
              <span className="text-xs text-muted-foreground">Access level</span>
              <RoleBadge role={user.role} />
            </div>
            <Row label="Status" value={user.isActive ? "Active" : "Inactive"} />
            <Row label="Created" value={new Date(user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : !s && docs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">{user.name} hasn't submitted their onboarding form yet — no contact or emergency details on file.</p>
          ) : (
            <>
              {/* Contact */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Contact</p>
                <Row label="Mobile" value={s?.phone} />
                <Row label="Address" value={s?.address} />
              </div>
              {/* Emergency contact */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Emergency contact</p>
                <Row label="Name" value={s?.emergencyContactName} />
                <Row label="Phone" value={s?.emergencyContactPhone} />
                <Row label="Relationship" value={s?.emergencyContactRelationship} />
              </div>
              {/* Documents */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Documents</p>
                {docs.length === 0 ? (
                  <p className="text-sm text-muted-foreground/50">None uploaded</p>
                ) : (
                  <ul className="space-y-1.5">
                    {docs.map(d => (
                      <li key={d.id} className="flex items-center justify-between gap-2 text-sm bg-secondary/40 rounded-lg px-3 py-2">
                        <span className="flex items-center gap-2 min-w-0"><FileText className="w-4 h-4 text-primary flex-shrink-0" /><span className="truncate">{kindLabel[d.kind] ?? d.kind}</span></span>
                        <a href={`${BASE}/api/onboarding/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          <ExternalLink className="w-3.5 h-3.5" /> Open
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UserForm({
  mode,
  defaultValues,
  onSubmit,
  isPending,
  onCancel,
}: {
  mode: "create" | "edit";
  defaultValues: CreateValues | EditValues;
  onSubmit: (data: CreateValues | EditValues) => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  const schema = mode === "create" ? createSchema : editSchema;
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<CreateValues | EditValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const selectedRole = watch("role");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="text-sm font-medium mb-1 block">Full Name *</label>
          <input
            {...register("name")}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="e.g. Jane Smith"
          />
          {errors.name && <span className="text-destructive text-xs">{String(errors.name.message)}</span>}
        </div>
        <div className="col-span-2">
          <label className="text-sm font-medium mb-1 block">Email Address *</label>
          <input
            {...register("email")}
            type="email"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="jane@example.com"
          />
          {errors.email && <span className="text-destructive text-xs">{String(errors.email.message)}</span>}
        </div>
        <div className="col-span-2">
          <label className="text-sm font-medium mb-1 block">
            {mode === "edit" ? (
              <span className="flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5" />
                New Password <span className="text-muted-foreground font-normal">(leave blank to keep current)</span>
              </span>
            ) : "Password *"}
          </label>
          <input
            {...register("password")}
            type="password"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder={mode === "edit" ? "Enter new password to change..." : "9+ chars, a capital & a number"}
          />
          {errors.password && <span className="text-destructive text-xs">{String(errors.password.message)}</span>}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-2 block">Access Level *</label>
        <div className="space-y-2">
          {ROLES.map((r) => {
            const Icon = r.icon;
            const selected = selectedRole === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setValue("role", r.value)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-border/80 hover:bg-secondary/20"
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${r.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{r.label}</p>
                  <p className="text-xs text-muted-foreground leading-snug">{r.description}</p>
                </div>
                {selected && <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl">
        <input
          type="checkbox"
          {...register("isActive")}
          id="isActive"
          className="w-4 h-4 rounded accent-primary"
        />
        <label htmlFor="isActive" className="text-sm font-medium cursor-pointer">
          Account is active
          <span className="text-muted-foreground font-normal ml-1">(inactive users cannot log in)</span>
        </label>
      </div>

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {isPending ? "Saving..." : mode === "create" ? "Create User" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

function ProfileSection() {
  const { state, refreshUser } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setCropFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCropUpload = async (blob: Blob) => {
    setUploading(true);
    setCropFile(null);
    try {
      const formData = new FormData();
      formData.append("avatar", blob, "avatar.jpg");
      const res = await fetch(`${BASE}/api/auth/avatar`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (res.ok) {
        await refreshUser();
        toast({ title: "Avatar updated!" });
      } else {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Upload failed", description: data.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Upload failed", description: "Network error", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  if (!user) return null;

  return (
    <div id="profile-section">
      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onUpload={handleCropUpload}
          onClose={() => setCropFile(null)}
        />
      )}
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
        <User className="w-4 h-4 text-primary" /> Profile & Avatar
      </h2>
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-5">
          <div className="relative group">
            <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="xl" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={cn(
                "absolute inset-0 rounded-full flex items-center justify-center",
                "bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity",
                "text-white cursor-pointer disabled:cursor-not-allowed"
              )}
              title="Upload photo"
            >
              {uploading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <Camera className="w-6 h-6" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
          <div>
            <p className="font-semibold text-lg">{user.name}</p>
            <p className="text-sm text-muted-foreground capitalize">{user.role}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="mt-2 text-sm text-primary hover:text-primary/80 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <Camera className="w-3.5 h-3.5" />
              {user.avatarUrl ? "Change photo" : "Upload photo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Read-only link + copy button — used for reset links and invite links.
function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-0 px-3 py-2 bg-background border border-border rounded-lg text-xs font-mono text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <button
        onClick={copy}
        className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/70 transition-colors border border-border"
      >
        {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
      </button>
    </div>
  );
}

function PasswordResetSection() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ emailSent: boolean } | null>(null);

  if (!user) return null;

  const send = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${BASE}/api/auth/my-password-reset`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Couldn't send reset link", description: data.error, variant: "destructive" });
      } else {
        setResult({ emailSent: data.emailSent });
      }
    } catch {
      toast({ title: "Couldn't send reset link", description: "Something went wrong", variant: "destructive" });
    }
    setLoading(false);
  };

  return (
    <div>
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-primary" /> Password
      </h2>
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          We'll email a secure link to <span className="font-medium text-foreground">{user.email}</span> to set a new password. For your security the link is only sent by email — it isn't shown on screen. It expires in 1 hour.
        </p>
        {result ? (
          result.emailSent ? (
            <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Reset link emailed to {user.email}. Check your inbox.
            </p>
          ) : (
            <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> We couldn't send the email. Try again, or ask an admin to set your password.
            </p>
          )
        ) : (
          <button
            onClick={send}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Email me a reset link
          </button>
        )}
      </div>
    </div>
  );
}

function PinSection() {
  const { state, refreshUser } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const [step, setStep] = useState<"idle" | "enter" | "confirm">("idle");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleFirstPin = async (pin: string) => {
    setFirstPin(pin);
    setError("");
    setStep("confirm");
  };

  const handleConfirmPin = async (pin: string) => {
    if (pin !== firstPin) {
      setError("PINs don't match. Please try again.");
      setStep("enter");
      setFirstPin("");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/auth/pin/set`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        await refreshUser();
        toast({ title: user?.hasPin ? "PIN changed!" : "PIN set!" });
        setStep("idle");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to set PIN");
        setStep("enter");
      }
    } catch {
      setError("Network error");
      setStep("enter");
    } finally {
      setSaving(false);
      setFirstPin("");
    }
  };

  if (!user) return null;

  return (
    <div id="pin-section">
      <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-primary" /> Quick-Sign PIN
      </h2>
      <div className="rounded-2xl border border-border bg-card p-6">
        {step === "idle" ? (
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">
                {user.hasPin ? "PIN is set" : "No PIN set"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {user.hasPin
                  ? "You can sign in quickly using your 4-digit PIN on this device."
                  : "Set a 4-digit PIN to sign in quickly from the device login screen."}
              </p>
            </div>
            <button
              onClick={() => { setError(""); setStep("enter"); }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors whitespace-nowrap flex-shrink-0"
            >
              {user.hasPin ? "Change PIN" : "Set PIN"}
            </button>
          </div>
        ) : (
          <div className="max-w-xs mx-auto">
            {step === "enter" && (
              <>
                <p className="text-sm text-center text-muted-foreground mb-4">
                  {user.hasPin ? "Enter your new PIN" : "Choose a 4-digit PIN"}
                </p>
                <PinNumpad onComplete={handleFirstPin} error={error} label="" />
              </>
            )}
            {step === "confirm" && (
              <>
                <p className="text-sm text-center text-muted-foreground mb-4">
                  Confirm your new PIN
                </p>
                <PinNumpad onComplete={handleConfirmPin} loading={saving} label="" />
              </>
            )}
            <button
              onClick={() => { setStep("idle"); setError(""); setFirstPin(""); }}
              className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type SettingsSection = "profile" | "team" | "production" | "storage" | "sops" | "features" | "sensors";

const NAV_ITEMS: { id: SettingsSection; label: string; icon: typeof User }[] = [
  { id: "profile", label: "My Profile", icon: User },
  { id: "team", label: "Team & Access", icon: Users },
  { id: "production", label: "Production", icon: BarChart2 },
  { id: "storage", label: "Storage & Inventory", icon: Warehouse },
  { id: "sops", label: "Standards & SOPs", icon: BookOpen },
  { id: "sensors", label: "Temperature Sensors", icon: Thermometer },
  { id: "features", label: "Features", icon: ToggleRight },
];

function TeamAccessContent({
  users,
  isLoading,
  user,
}: {
  users: AppUser[] | undefined;
  isLoading: boolean;
  user: { role: string } | null;
}) {
  const { createUser, updateUser, deleteUser } = useAppMutations();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [viewingUser, setViewingUser] = useState<AppUser | null>(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "manager" | "viewer">("viewer");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ url: string | null; email: string; emailSent: boolean } | null>(null);

  const createDefaults: CreateValues = {
    name: "", email: "", password: "", role: "viewer", isActive: true,
  };

  const sendInvite = async () => {
    setInviteSending(true);
    setInviteResult(null);
    try {
      const res = await fetch(`${BASE}/api/auth/invites`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: "Invite failed", description: data.error, variant: "destructive" }); }
      else { setInviteResult({ url: data.inviteUrl ?? null, email: data.email, emailSent: data.emailSent }); }
    } catch {
      toast({ title: "Invite failed", description: "Something went wrong", variant: "destructive" });
    }
    setInviteSending(false);
  };

  return (
    <div className="space-y-8">
      {/* Access Level Reference */}
      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" /> Access Level Reference
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ROLES.map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.value} className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${r.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{r.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{r.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* User Management */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Team Members
            {users && (
              <span className="text-xs font-normal text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">
                {users.length} {users.length === 1 ? "user" : "users"}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setIsInviteOpen(true); setInviteResult(null); setInviteEmail(""); setInviteRole("viewer"); }}
              className="px-4 py-2 bg-secondary text-foreground rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-secondary/70 transition-colors border border-border"
            >
              <Mail className="w-4 h-4" /> Invite
            </button>
            <button
              onClick={() => setIsAddOpen(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium shadow-sm shadow-primary/20 flex items-center gap-2 hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add User
            </button>
          </div>
        </div>

        {/* Invite dialog */}
        <Dialog open={isInviteOpen} onOpenChange={(v) => { setIsInviteOpen(v); if (!v) setInviteResult(null); }}>
          <DialogContent className="sm:max-w-[440px] bg-card border-border rounded-2xl">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">Invite Team Member</DialogTitle>
            </DialogHeader>
            {inviteResult ? (
              <div className="space-y-4">
                {inviteResult.emailSent ? (
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                    <p className="text-sm font-medium">Invite email sent to {inviteResult.email}</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <p className="text-sm font-medium">Invite created, but the email didn't send to {inviteResult.email}. Share the link below directly.</p>
                    </div>
                    {inviteResult.url && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Invite link (fallback)</label>
                        <CopyableLink url={inviteResult.url} />
                      </div>
                    )}
                  </>
                )}
                <p className="text-xs text-muted-foreground">The link expires in 48 hours.</p>
                <button onClick={() => { setIsInviteOpen(false); setInviteResult(null); }}
                  className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90">
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Email address</label>
                  <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.com"
                    className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Role</label>
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value as "admin" | "manager" | "viewer")}
                    className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                    <option value="viewer">Viewer — station work only</option>
                    <option value="manager">Manager — plans &amp; reports</option>
                    <option value="admin">Admin — full access</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setIsInviteOpen(false)}
                    className="flex-1 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50">
                    Cancel
                  </button>
                  <button onClick={sendInvite} disabled={!inviteEmail || inviteSending}
                    className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
                    {inviteSending && <Loader2 className="w-4 h-4 animate-spin" />}
                    {inviteSending ? "Sending…" : "Send invite"}
                  </button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Add dialog */}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogContent className="sm:max-w-[520px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">New Team Member</DialogTitle>
            </DialogHeader>
            <UserForm
              mode="create"
              defaultValues={createDefaults}
              isPending={createUser.isPending}
              onCancel={() => setIsAddOpen(false)}
              onSubmit={(data) =>
                createUser.mutate({ data }, { onSuccess: () => setIsAddOpen(false) })
              }
            />
          </DialogContent>
        </Dialog>

        {/* Edit dialog */}
        {editingUser && (
          <Dialog open={!!editingUser} onOpenChange={(v) => { if (!v) setEditingUser(null); }}>
            <DialogContent className="sm:max-w-[520px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">Edit User</DialogTitle>
              </DialogHeader>
              <UserForm
                key={editingUser.id}
                mode="edit"
                defaultValues={{
                  name: editingUser.name,
                  email: editingUser.email,
                  password: "",
                  role: editingUser.role,
                  isActive: editingUser.isActive,
                }}
                isPending={updateUser.isPending}
                onCancel={() => setEditingUser(null)}
                onSubmit={(data) => {
                  const editData = data as EditValues;
                  const payload: { name: string; email: string; role: string; isActive: boolean; password?: string } = {
                    name: editData.name,
                    email: editData.email,
                    role: editData.role,
                    isActive: editData.isActive,
                  };
                  if (editData.password) payload.password = editData.password;
                  updateUser.mutate({ id: editingUser.id, data: payload }, { onSuccess: () => setEditingUser(null) });
                }}
              />
            </DialogContent>
          </Dialog>
        )}

        {/* View details dialog */}
        {viewingUser && (
          <UserDetailsDialog user={viewingUser} onClose={() => setViewingUser(null)} />
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : users?.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No users yet</p>
            <p className="text-sm mt-1">Add your first team member above.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-muted-foreground text-xs">
                <tr>
                  <th className="px-5 py-3 font-medium text-left">Name</th>
                  <th className="px-5 py-3 font-medium text-left">Email</th>
                  <th className="px-5 py-3 font-medium text-left">Access Level</th>
                  <th className="px-5 py-3 font-medium text-left">Status</th>
                  <th className="px-5 py-3 font-medium text-left">Created</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {users?.map((u) => (
                  <tr key={u.id} className="hover:bg-secondary/10 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">{u.email}</td>
                    <td className="px-5 py-3.5">
                      <RoleBadge role={u.role as Role} />
                    </td>
                    <td className="px-5 py-3.5">
                      {u.isActive ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <XCircle className="w-3.5 h-3.5" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs">
                      {new Date(u.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setViewingUser(u as AppUser)}
                          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
                          title="View details"
                        >
                          <IdCard className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingUser(u as AppUser)}
                          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
                          title="Edit user"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete user "${u.name}"? This cannot be undone.`)) {
                              deleteUser.mutate({ id: u.id });
                            }
                          }}
                          className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                          title="Delete user"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Access Control — admin only */}
      {user?.role === "admin" && <AccessControlSection />}

      {/* Broadcast Notification — admin only */}
      {user?.role === "admin" && <BroadcastNotificationSection />}
    </div>
  );
}

const DEFAULT_BROADCAST_MESSAGE =
  "Please refresh your browser — a new version is available with the latest fixes.";

function BroadcastNotificationSection() {
  const [message, setMessage] = useState(DEFAULT_BROADCAST_MESSAGE);
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<{ at: string; count: number } | null>(null);

  const send = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      toast({ title: "Message is empty", variant: "destructive" });
      return;
    }
    if (trimmed.length > 500) {
      toast({ title: "Too long", description: "Keep it under 500 characters.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/notifications/broadcast", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, type: "broadcast" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to send broadcast");
      }
      const data = await res.json() as { sent: number };
      setLastSent({ at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), count: data.sent });
      toast({ title: "Broadcast sent", description: `${data.sent} user${data.sent === 1 ? "" : "s"} will see it within ~15 seconds.` });
    } catch (err) {
      toast({
        title: "Broadcast failed",
        description: err instanceof Error ? err.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex items-center justify-center">
          <Megaphone className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-semibold text-lg">Broadcast notification</h3>
          <p className="text-sm text-muted-foreground">
            Send a flash notification to every logged-in user. They&rsquo;ll see a banner at the top of their screen and can swipe it away or mark it read.
          </p>
        </div>
      </div>

      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        rows={3}
        maxLength={500}
        disabled={sending}
        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        placeholder="Enter the message to send to all users…"
      />
      <div className="flex items-center justify-between mt-3">
        <p className="text-xs text-muted-foreground">
          {lastSent
            ? `Last sent ${lastSent.at} to ${lastSent.count} user${lastSent.count === 1 ? "" : "s"}.`
            : `${message.length} / 500 characters`}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMessage(DEFAULT_BROADCAST_MESSAGE)}
            disabled={sending || message === DEFAULT_BROADCAST_MESSAGE}
            className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-40 transition-colors"
          >
            Reset to default
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !message.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
            Send broadcast
          </button>
        </div>
      </div>
    </div>
  );
}

interface GoveeSettingsT {
  enabled: boolean; tileEnabled: boolean; historyEnabled: boolean; alertsEnabled: boolean;
  checklistAssistEnabled: boolean; fridgeMaxC: number; freezerMaxC: number;
  alertEmail: string; alertRecipientUserIds: number[]; pollMinutes: number; alertBreachMinutes: number;
}
interface GoveeSensorRow {
  device: string; sku: string; name: string; enabled: boolean; storageLocationId: number | null;
  lastTemperatureC: number | null; lastHumidityPercent: number | null; lastOnline: boolean | null;
  lastReadingAt: string | null; locationName: string | null; zone: string | null;
}
interface GoveeLocationOpt { id: number; name: string; zone: string; }
interface GoveeRecipientRow { id: number; name: string; email: string; role: string; hasPushDevice: boolean; isRecipient: boolean; }

function GoveeSensorsSection({ currentUserId }: { currentUserId: number | null }) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [pushConfigured, setPushConfigured] = useState(false);
  const [settings, setSettings] = useState<GoveeSettingsT | null>(null);
  const [sensors, setSensors] = useState<GoveeSensorRow[]>([]);
  const [locations, setLocations] = useState<GoveeLocationOpt[]>([]);
  const [recipients, setRecipients] = useState<GoveeRecipientRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  // Per-device push state
  const [deviceSubscribed, setDeviceSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const pushSupported = isPushSupported();
  const standalone = isStandalone();

  const loadAll = async () => {
    try {
      const [statusRes, sensorsRes, recipientsRes] = await Promise.all([
        fetch(`${BASE}/api/govee/status`, { credentials: "include" }),
        fetch(`${BASE}/api/govee/sensors`, { credentials: "include" }),
        fetch(`${BASE}/api/govee/recipients`, { credentials: "include" }),
      ]);
      const status = await statusRes.json();
      setConfigured(Boolean(status.configured));
      setPushConfigured(Boolean(status.pushConfigured));
      setSettings(status.settings);
      const sensorsData = await sensorsRes.json();
      setSensors(sensorsData.sensors ?? []);
      setLocations(sensorsData.locations ?? []);
      setRecipients(await recipientsRes.json());
    } catch {
      toast({ title: "Couldn't load sensor settings", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadAll(); }, []);
  useEffect(() => { if (pushSupported) isSubscribedOnThisDevice().then(setDeviceSubscribed).catch(() => {}); }, [pushSupported]);

  const saveSettings = async (patch: Partial<GoveeSettingsT>) => {
    if (!settings) return;
    const optimistic = { ...settings, ...patch };
    setSettings(optimistic);
    try {
      const res = await fetch(`${BASE}/api/govee/settings`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      setSettings(await res.json());
    } catch {
      toast({ title: "Couldn't save setting", variant: "destructive" });
      void loadAll();
    }
  };

  const updateSensor = async (device: string, patch: Partial<Pick<GoveeSensorRow, "storageLocationId" | "enabled">>) => {
    setSensors(prev => prev.map(s => s.device === device ? { ...s, ...patch } : s));
    try {
      const res = await fetch(`${BASE}/api/govee/sensors/${encodeURIComponent(device)}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast({ title: "Couldn't update sensor", variant: "destructive" });
      void loadAll();
    }
  };

  const syncSensors = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${BASE}/api/govee/sync`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error();
      const { count } = await res.json();
      toast({ title: `Found ${count} sensor${count === 1 ? "" : "s"}` });
      await loadAll();
    } catch {
      toast({ title: "Sync failed — check the API key", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const toggleRecipient = (userId: number, on: boolean) => {
    if (!settings) return;
    const next = on
      ? Array.from(new Set([...settings.alertRecipientUserIds, userId]))
      : settings.alertRecipientUserIds.filter(id => id !== userId);
    setRecipients(prev => prev.map(r => r.id === userId ? { ...r, isRecipient: on } : r));
    void saveSettings({ alertRecipientUserIds: next });
  };

  const enableThisDevice = async () => {
    setPushBusy(true);
    try {
      await enablePushOnThisDevice();
      setDeviceSubscribed(true);
      toast({ title: "Alerts enabled on this device" });
      void loadAll();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Couldn't enable", variant: "destructive" });
    } finally {
      setPushBusy(false);
    }
  };
  const disableThisDevice = async () => {
    setPushBusy(true);
    try {
      await disablePushOnThisDevice();
      setDeviceSubscribed(false);
      toast({ title: "Alerts disabled on this device" });
      void loadAll();
    } finally {
      setPushBusy(false);
    }
  };
  const testThisDevice = async () => {
    try {
      const n = await sendTestPush();
      toast({ title: n > 0 ? `Test sent to ${n} device${n === 1 ? "" : "s"}` : "No devices enabled yet" });
    } catch {
      toast({ title: "Test failed", variant: "destructive" });
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }

  const toggleRow = (label: string, desc: string, key: keyof GoveeSettingsT, disabled = false) => (
    <div className={cn("flex items-center justify-between gap-4 p-4 bg-card border border-border rounded-xl", disabled && "opacity-50")}>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <Switch checked={Boolean(settings?.[key])} disabled={disabled} onCheckedChange={(c) => saveSettings({ [key]: c } as Partial<GoveeSettingsT>)} />
    </div>
  );

  const masterOff = !settings?.enabled;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold mb-1 flex items-center gap-2">
          <Thermometer className="w-5 h-5 text-primary" /> Temperature Sensors (Govee)
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Pull live fridge/freezer temperatures from your Govee sensors, log history, and alert when a unit goes out of range.
        </p>

        {/* Connection */}
        <div className="flex items-center justify-between gap-4 p-4 bg-card border border-border rounded-xl mb-4">
          <div className="flex items-center gap-2 min-w-0">
            {configured
              ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              : <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />}
            <div className="min-w-0">
              <p className="text-sm font-semibold">{configured ? "Connected to Govee" : "Not connected"}</p>
              <p className="text-sm text-muted-foreground">{configured ? "API key detected." : "Set GOVEE_API_KEY on the server."}</p>
            </div>
          </div>
          <button onClick={syncSensors} disabled={!configured || syncing}
            className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sync sensors
          </button>
        </div>

        {/* Master + feature toggles */}
        <div className="space-y-3">
          {toggleRow("Master switch", "Turn the whole Govee integration on or off.", "enabled")}
          {toggleRow("Live dashboard tile", "Show current fridge/freezer temps on the dashboard.", "tileEnabled", masterOff)}
          {toggleRow("History logging", "Record readings over time for HACCP reports.", "historyEnabled", masterOff)}
          {toggleRow("Out-of-range alerts", "Email + push when a unit breaches its safe range.", "alertsEnabled", masterOff)}
          {toggleRow("Checklist auto-assist", "Prefill the fridge/freezer temperature checklist from sensors.", "checklistAssistEnabled", masterOff)}
        </div>
      </div>

      {/* Sensor mapping */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Sensors</h3>
        {sensors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sensors yet — press “Sync sensors”.</p>
        ) : (
          <div className="space-y-3">
            {sensors.map(s => (
              <div key={s.device} className="p-4 bg-card border border-border rounded-xl">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{s.name || s.device}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.lastTemperatureC != null ? `${s.lastTemperatureC.toFixed(1)}°C` : "—"}
                      {s.lastHumidityPercent != null ? ` · ${s.lastHumidityPercent}% RH` : ""}
                      {s.lastOnline === false ? " · offline" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={s.storageLocationId ?? ""}
                      onChange={(e) => updateSensor(s.device, { storageLocationId: e.target.value ? Number(e.target.value) : null })}
                      className="bg-background border border-border rounded-lg px-2 py-1.5 text-sm max-w-[200px]"
                    >
                      <option value="">— Map to location —</option>
                      {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.zone})</option>)}
                    </select>
                    <Switch checked={s.enabled} onCheckedChange={(c) => updateSensor(s.device, { enabled: c })} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Thresholds */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Safe-range thresholds</h3>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <label className="text-sm">
            <span className="text-muted-foreground">Fridge max (°C)</span>
            <input type="number" step="0.5" defaultValue={settings?.fridgeMaxC}
              onBlur={(e) => saveSettings({ fridgeMaxC: Number(e.target.value) })}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Freezer max (°C)</span>
            <input type="number" step="0.5" defaultValue={settings?.freezerMaxC}
              onBlur={(e) => saveSettings({ freezerMaxC: Number(e.target.value) })}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground mt-2">A unit must stay above its ceiling for {settings?.alertBreachMinutes ?? 20} minutes before an alert fires.</p>
      </div>

      {/* Alerts: email + recipients + this device */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Alert recipients</h3>
        <label className="text-sm block mb-4 max-w-md">
          <span className="text-muted-foreground">Alert email</span>
          <input type="email" defaultValue={settings?.alertEmail}
            onBlur={(e) => saveSettings({ alertEmail: e.target.value })}
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
        </label>

        {/* This device push enrolment */}
        <div className="p-4 bg-card border border-border rounded-xl mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Smartphone className="w-5 h-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Phone notifications on this device</p>
                <p className="text-xs text-muted-foreground">
                  {!pushSupported ? "This browser doesn't support notifications."
                    : !standalone ? "Add the app to your Home Screen first, then open it and enable here."
                    : deviceSubscribed ? "Enabled on this device." : "Not enabled on this device yet."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {deviceSubscribed
                ? <button onClick={disableThisDevice} disabled={pushBusy} className="px-3 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50">{pushBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />} Disable</button>
                : <button onClick={enableThisDevice} disabled={pushBusy || !pushSupported} className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">{pushBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />} Enable on this device</button>}
              {deviceSubscribed && <button onClick={testThisDevice} className="px-3 py-2 rounded-xl border border-border text-sm font-medium">Test</button>}
            </div>
          </div>
          {!pushConfigured && <p className="text-xs text-amber-600 mt-2">Server push keys (VAPID) not configured.</p>}
        </div>

        <p className="text-sm text-muted-foreground mb-2">Tick who should receive push alerts. A person also has to enable alerts on their own device.</p>
        <div className="space-y-2">
          {recipients.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3 bg-card border border-border rounded-xl">
              <div className="min-w-0">
                <p className="text-sm font-semibold flex items-center gap-2">
                  {r.name}
                  {r.id === currentUserId && <span className="text-xs text-muted-foreground">(you)</span>}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {r.hasPushDevice
                    ? <><CheckCircle2 className="w-3 h-3 text-green-500" /> device enabled</>
                    : <><XCircle className="w-3 h-3 text-muted-foreground" /> no device yet</>}
                </p>
              </div>
              <Switch checked={r.isRecipient} onCheckedChange={(c) => toggleRecipient(r.id, c)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { data: users, isLoading } = useListUsers();
  const { state, requireSensitivePin } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const search = useSearch();
  const [, navigate] = useLocation();

  // Require PIN re-entry on entering Settings (5-min unlock window).
  useEffect(() => {
    if (state.status === "authenticated") requireSensitivePin();
  }, [state.status, requireSensitivePin]);

  const params = new URLSearchParams(search);
  const sectionParam = params.get("section") as SettingsSection | null;
  const validSections: SettingsSection[] = ["profile", "team", "production", "storage", "sops", "features", "sensors"];
  const activeSection: SettingsSection = sectionParam && validSections.includes(sectionParam) ? sectionParam : "profile";

  const setSection = (s: SettingsSection) => {
    navigate(`/settings?section=${s}`, { replace: true });
  };

  const dptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sub = params.get("sub");
    if (activeSection === "production" && sub === "dpt" && dptRef.current) {
      setTimeout(() => {
        dptRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [activeSection, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your profile, team, production targets, and storage."
      />

      <div className="flex gap-6 items-start">
        {/* Left nav */}
        <nav className="w-52 flex-shrink-0 sticky top-6">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => setSection(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                    )}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Right content */}
        <div className="flex-1 min-w-0 space-y-8">
          {activeSection === "profile" && (
            <>
              <ProfileSection />
              <PasswordResetSection />
              <PinSection />
            </>
          )}

          {activeSection === "team" && (
            <TeamAccessContent
              users={users as AppUser[] | undefined}
              isLoading={isLoading}
              user={user}
            />
          )}

          {activeSection === "production" && (
            <div className="space-y-8">
              {user?.role === "admin" && <AdminDateOverrideSection />}
              {user?.role === "admin" && <NonDispatchDatesSection />}
              {user?.role === "admin" && <TimedRemindersSection />}
              {user?.role === "admin" && <PrepDoughScheduleSection />}
              <div ref={dptRef}>
                {(user?.role === "admin" || user?.role === "manager") && <DptSettingsSection />}
                {(user?.role === "admin" || user?.role === "manager") && <MacCheeseSettingsSection />}
              </div>
              {user?.role === "admin" && <FactoryNumberSection />}
              {user?.role === "admin" && <ShopifyFreezerSyncSection />}
              {user?.role === "admin" && <FulfilmentManualTickSection />}
              {user?.role === "admin" && <FulfilmentSpeakNameSection />}
              {(user?.role === "admin" || user?.role === "manager") && <BuildingTimerSection />}
              {user?.role === "admin" && <TimingStandardsSection />}
              {user?.role === "admin" && <MixerCapacitySection />}
              {user?.role === "admin" && <ProductionExtrasSection />}
              {user?.role === "admin" && <WeightChillSettingsSection />}
              {user?.role === "admin" && <OvenDefaultsSection />}
              {user?.role === "admin" && <ExtraTomatoBaseSection />}
              {user?.role === "admin" && <IcePackSettingsSection />}
              {user?.role === "admin" && <PastaCookingSection />}
              {user?.role === "admin" && <BreakDefaultsSection />}
              {user?.role === "admin" && <ScheduleDefaultsSection />}
              {user?.role === "admin" && <ApcServiceCodesSection />}
            </div>
          )}

          {activeSection === "sensors" && (
            user?.role === "admin" ? (
              <GoveeSensorsSection currentUserId={user?.id ?? null} />
            ) : (
              <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
                <Lock className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p className="font-medium">Admin access required</p>
                <p className="text-sm mt-1">Only admins can manage temperature sensors.</p>
              </div>
            )
          )}

          {activeSection === "features" && user?.role === "admin" && (
            <div className="space-y-8">
              <FeaturesSection />
              <QuickIdeaTabsSection />
              <DashboardBannerRolesSection />
              <EightPackBannerRolesSection />
              <SystemUpdatesSection />
            </div>
          )}

          {activeSection === "features" && user?.role !== "admin" && (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
              <Lock className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="font-medium">Admin access required</p>
              <p className="text-sm mt-1">Only admins can manage feature flags.</p>
            </div>
          )}

          {activeSection === "storage" && (
            <div className="space-y-8">
              <CategoryDefaultsSection />
              {user?.role === "admin" && <StorageLocationsSection />}
              {user?.role === "admin" && <IngredientStorageAssignmentsSection />}
            </div>
          )}

          {activeSection === "sops" && (
            <div className="space-y-8">
              <StandardsSopsSection />
              <LeanCurriculumSection />
            </div>
          )}

          {activeSection === "features" && user?.role === "admin" && (
            <div className="space-y-8">
              <FeaturesSection />
            </div>
          )}

          {activeSection === "features" && user?.role !== "admin" && (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
              <Lock className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="font-medium">Admin access required</p>
              <p className="text-sm mt-1">Only admins can manage feature flags.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Feature Flags Section ───────────────────────────────────────────

const FEATURE_FLAGS: { key: string; label: string; description: string }[] = [
  {
    key: "feature_checklists",
    label: "Station Checklists",
    description: "Enable daily opening, cleaning, and closing checklists for each station. When enabled, stations auto-open to checklist view at start and end of day.",
  },
  {
    key: "feature_building_station_lock",
    label: "Building Station Lock",
    description: "Auto-assigns builders to building stations. The first builder to open a building station for the day gets locked to it. The other builder must use the remaining station.",
  },
];

function FeaturesSection() {
  const queryClient = useQueryClient();
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/api/app-settings/`, { credentials: "include" })
      .then(r => r.ok ? r.json() : {})
      .then(data => { setFlags(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const toggleFlag = async (key: string, enabled: boolean) => {
    const newVal = enabled ? "true" : "false";
    setFlags(prev => ({ ...prev, [key]: newVal }));
    try {
      const res = await fetch(`${BASE}/api/app-settings/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newVal }),
      });
      if (!res.ok) throw new Error("Failed to save");
      queryClient.invalidateQueries({ queryKey: ["app-settings", "feature-flags"] });
      toast({ title: `Feature ${enabled ? "enabled" : "disabled"}` });
    } catch {
      setFlags(prev => ({ ...prev, [key]: enabled ? "false" : "true" }));
      toast({ title: "Failed to update feature flag", variant: "destructive" });
    }
  };

  return (
    <div>
      <h2 className="text-base font-semibold mb-1 flex items-center gap-2">
        <ToggleRight className="w-5 h-5 text-primary" />
        Feature Flags
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Toggle features on and off across the application.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading...
        </div>
      ) : (
        <div className="space-y-3">
          {FEATURE_FLAGS.map(flag => (
            <div
              key={flag.key}
              className="flex items-center justify-between gap-4 p-4 bg-card border border-border rounded-xl"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">{flag.label}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{flag.description}</p>
              </div>
              <Switch
                checked={flags[flag.key] === "true"}
                onCheckedChange={(checked) => toggleFlag(flag.key, checked)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryDefaultsSection() {
  const { data: defaults, isLoading } = useListCategoryDefaults();
  const { createCategoryDefault, updateCategoryDefault, deleteCategoryDefault } = useAppMutations();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ category: "", defaultPackagingCost: "", defaultLabourCost: "", defaultPackSize: "" });

  const resetForm = () => setForm({ category: "", defaultPackagingCost: "", defaultLabourCost: "", defaultPackSize: "" });

  const handleAdd = () => {
    createCategoryDefault.mutate({
      data: {
        category: form.category,
        defaultPackagingCost: Number(form.defaultPackagingCost) || 0,
        defaultLabourCost: Number(form.defaultLabourCost) || 0,
        defaultPackSize: Number(form.defaultPackSize) || 1,
      }
    }, { onSuccess: () => { setAdding(false); resetForm(); } });
  };

  const handleEdit = (id: number) => {
    updateCategoryDefault.mutate({
      id,
      data: {
        category: form.category,
        defaultPackagingCost: Number(form.defaultPackagingCost) || 0,
        defaultLabourCost: Number(form.defaultLabourCost) || 0,
        defaultPackSize: Number(form.defaultPackSize) || 1,
      }
    }, { onSuccess: () => { setEditingId(null); resetForm(); } });
  };

  const startEdit = (d: { id: number; category: string; defaultPackagingCost: number; defaultLabourCost: number; defaultPackSize?: number }) => {
    setEditingId(d.id);
    setForm({ category: d.category, defaultPackagingCost: String(d.defaultPackagingCost), defaultLabourCost: String(d.defaultLabourCost), defaultPackSize: String(d.defaultPackSize ?? 1) });
    setAdding(false);
  };

  const inputCls = "px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Package className="w-5 h-5 text-primary" /> Category Defaults</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            When a recipe's category matches, pack size, packaging and labour costs are auto-filled in the recipe form.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setEditingId(null); resetForm(); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add Category
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-card border border-primary/30 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-primary">New Category Default</h3>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Category Name</label>
              <input className={inputCls} placeholder="e.g. Calzones" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Pack Size</label>
              <input type="number" step="1" min="1" className={`${inputCls} w-full`} placeholder="1" value={form.defaultPackSize} onChange={e => setForm(f => ({ ...f, defaultPackSize: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Default Packaging (£/pack)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <input type="number" step="0.01" min="0" className={`${inputCls} pl-7 w-full`} placeholder="0.00" value={form.defaultPackagingCost} onChange={e => setForm(f => ({ ...f, defaultPackagingCost: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Default Labour (£/pack)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <input type="number" step="0.01" min="0" className={`${inputCls} pl-7 w-full`} placeholder="0.00" value={form.defaultLabourCost} onChange={e => setForm(f => ({ ...f, defaultLabourCost: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); resetForm(); }} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg border border-border transition-colors">Cancel</button>
            <button
              onClick={handleAdd}
              disabled={!form.category || createCategoryDefault.isPending}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {createCategoryDefault.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Save Default
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : defaults?.length === 0 && !adding ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="font-medium text-sm">No category defaults yet</p>
          <p className="text-xs mt-1">Add one to auto-populate pack size, packaging and labour costs in recipes.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-muted-foreground text-xs">
              <tr>
                <th className="px-5 py-3 font-medium text-left">Category</th>
                <th className="px-5 py-3 font-medium text-right">Pack Size</th>
                <th className="px-5 py-3 font-medium text-right">Default Packaging</th>
                <th className="px-5 py-3 font-medium text-right">Default Labour</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {defaults?.map(d => (
                <tr key={d.id} className="hover:bg-secondary/10 transition-colors">
                  {editingId === d.id ? (
                    <>
                      <td className="px-4 py-2.5">
                        <input className={inputCls} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end">
                          <input type="number" step="1" min="1" className={`${inputCls} w-20 text-right`} value={form.defaultPackSize} onChange={e => setForm(f => ({ ...f, defaultPackSize: e.target.value }))} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="relative flex justify-end">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                          <input type="number" step="0.01" min="0" className={`${inputCls} pl-7 w-32`} value={form.defaultPackagingCost} onChange={e => setForm(f => ({ ...f, defaultPackagingCost: e.target.value }))} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="relative flex justify-end">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                          <input type="number" step="0.01" min="0" className={`${inputCls} pl-7 w-32`} value={form.defaultLabourCost} onChange={e => setForm(f => ({ ...f, defaultLabourCost: e.target.value }))} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setEditingId(null); resetForm(); }} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg border border-border transition-colors text-xs px-3 py-1.5">Cancel</button>
                          <button
                            onClick={() => handleEdit(d.id)}
                            disabled={updateCategoryDefault.isPending}
                            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-5 py-3.5 font-medium">{d.category}</td>
                      <td className="px-5 py-3.5 text-right">{(d as Record<string, unknown>).defaultPackSize as number ?? 1}</td>
                      <td className="px-5 py-3.5 text-right">£{d.defaultPackagingCost.toFixed(2)}</td>
                      <td className="px-5 py-3.5 text-right">£{d.defaultLabourCost.toFixed(2)}</td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => startEdit(d)} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors" title="Edit"><Edit2 className="w-4 h-4" /></button>
                          <button
                            onClick={() => { if (confirm(`Delete default for "${d.category}"?`)) deleteCategoryDefault.mutate({ id: d.id }); }}
                            className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            title="Delete"
                          ><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DptSettingsSection() {
  const { data: dptSettings, isLoading: dptLoading } = useListDptSettings();
  const { data: recipes, isLoading: recipesLoading } = useListRecipes();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [localPacksSold, setLocalPacksSold] = useState<Record<number, number>>({});
  const [totalDailyBatches, setTotalDailyBatches] = useState<number>(0);
  const [totalBatchesLoaded, setTotalBatchesLoaded] = useState(false);

  const settingsByRecipeId = new Map((dptSettings ?? []).map((d: any) => [d.recipeId, d]));

  useEffect(() => {
    if (!totalBatchesLoaded) {
      fetch("/api/app-settings/total_daily_batches", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.value) setTotalDailyBatches(Number(d.value)); setTotalBatchesLoaded(true); })
        .catch(() => setTotalBatchesLoaded(true));
    }
  }, [totalBatchesLoaded]);

  useEffect(() => {
    if (recipes && dptSettings) {
      const map: Record<number, number> = {};
      for (const r of recipes) {
        const setting = settingsByRecipeId.get(r.id);
        map[r.id] = setting?.packsSold ?? 0;
      }
      setLocalPacksSold(map);
    }
  }, [recipes, dptSettings]);

  const isLoading = dptLoading || recipesLoading || !totalBatchesLoaded;
  const allRecipes = [...(recipes ?? [])].sort((a: any, b: any) => a.name.localeCompare(b.name));

  const totalPacksSold = Object.values(localPacksSold).reduce((s, v) => s + v, 0);

  const getSalesPercent = (recipeId: number) => {
    const sold = localPacksSold[recipeId] ?? 0;
    return totalPacksSold > 0 ? (sold / totalPacksSold) * 100 : 0;
  };

  const batchAllocation = useMemo(() => {
    const map: Record<number, number> = {};
    if (totalDailyBatches <= 0 || totalPacksSold <= 0) {
      for (const r of allRecipes) map[r.id] = 0;
      return map;
    }
    const items = allRecipes.map((r: any) => {
      const exact = (getSalesPercent(r.id) / 100) * totalDailyBatches;
      return { id: r.id, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let remaining = totalDailyBatches - items.reduce((s, i) => s + i.floor, 0);
    const sorted = [...items].sort((a, b) => b.remainder - a.remainder);
    const bonus = new Set<number>();
    for (const it of sorted) {
      if (remaining <= 0) break;
      bonus.add(it.id);
      remaining--;
    }
    for (const it of items) map[it.id] = it.floor + (bonus.has(it.id) ? 1 : 0);
    return map;
  }, [allRecipes, totalDailyBatches, totalPacksSold, localPacksSold]);

  const getDefaultBatches = (recipeId: number) => batchAllocation[recipeId] ?? 0;

  const totalDefaultBatches = Object.values(batchAllocation).reduce((s, v) => s + v, 0);

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const settingsRes = await fetch("/api/app-settings/total_daily_batches", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ value: String(totalDailyBatches) }),
      });
      if (!settingsRes.ok) {
        const msg = settingsRes.status === 403 ? "Admin access required. Please log out and log back in." : "Failed to save total daily batches";
        toast({ title: "Error", description: msg, variant: "destructive" });
        return;
      }

      for (const recipe of allRecipes) {
        const sold = localPacksSold[recipe.id] ?? 0;
        await upsertDptSettingByRecipe(recipe.id, { packsSold: sold, isActive: true });
      }

      await queryClient.invalidateQueries({ queryKey: getListDptSettingsQueryKey() });
      setSavedMsg("All settings saved");
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (err: any) {
      const msg = err?.status === 403 ? "Admin access required. Please log out and log back in." : (err?.message ?? "Failed to save DPT settings");
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-primary" /> Default Production Targets
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Enter packs sold per recipe. The system calculates each recipe's share of total sales and assigns default batch counts to new production plans.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
          <button
            onClick={handleSaveAll}
            disabled={saving || isLoading}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Save All
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : !allRecipes.length ? (
        <div className="text-center py-8 text-muted-foreground text-sm">No recipes in the library yet. Add recipes first to configure DPT targets.</div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
            <label className="text-sm font-medium whitespace-nowrap">Total Daily Batches</label>
            <NumberInput
              min={0}
              value={totalDailyBatches}
              onChange={n => setTotalDailyBatches(Math.max(0, n))}
              className="w-24 px-3 py-2 bg-background border border-border rounded-lg text-sm text-right focus-ring font-mono"
            />
            <p className="text-xs text-muted-foreground flex-1">
              The total batch budget for each production day. Distributed across recipes based on their sales %.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-muted-foreground text-xs">
                <tr>
                  <th className="px-5 py-3 font-medium text-left">Recipe</th>
                  <th className="px-5 py-3 font-medium text-right">Packs Sold</th>
                  <th className="px-5 py-3 font-medium text-right">Sales %</th>
                  <th className="px-5 py-3 font-medium text-right">Default Batches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {allRecipes.map((recipe: any) => {
                  const sold = localPacksSold[recipe.id] ?? 0;
                  const pct = getSalesPercent(recipe.id);
                  const batches = getDefaultBatches(recipe.id);
                  return (
                    <tr key={recipe.id} className="hover:bg-secondary/10 transition-colors">
                      <td className="px-5 py-3.5 font-medium" style={recipe.color ? { color: recipe.color } : undefined}>{recipe.name}</td>
                      <td className="px-5 py-3.5 text-right">
                        <NumberInput
                          min={0}
                          value={sold}
                          onChange={n => setLocalPacksSold(prev => ({ ...prev, [recipe.id]: Math.max(0, n) }))}
                          className="w-24 px-2 py-1 border border-border rounded-lg text-sm text-right font-mono focus-ring"
                        />
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className={cn("font-mono", pct === 0 ? "text-muted-foreground" : "text-primary font-semibold")}>
                          {pct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className={cn(
                          "font-mono text-base font-bold",
                          batches > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                        )}>
                          {batches}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-secondary/20 font-semibold border-t border-border">
                <tr>
                  <td className="px-5 py-3">Totals</td>
                  <td className="px-5 py-3 text-right font-mono">{totalPacksSold}</td>
                  <td className="px-5 py-3 text-right font-mono">{totalPacksSold > 0 ? "100%" : "—"}</td>
                  <td className="px-5 py-3 text-right font-mono text-base">
                    <span className={cn(totalDefaultBatches > 0 ? "text-emerald-600 dark:text-emerald-400" : "")}>
                      {totalDefaultBatches}
                    </span>
                    {totalDailyBatches > 0 && totalDefaultBatches !== totalDailyBatches && (
                      <span className="text-xs text-amber-600 dark:text-amber-400 ml-1">
                        (target: {totalDailyBatches})
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function MacCheeseSettingsSection() {
  const { data: recipes, isLoading: recipesLoading } = useListRecipes();
  const [extras, setExtras] = useState<Record<number, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const macRecipes = (recipes ?? []).filter((r: any) => r.category === "Macaroni Cheese").sort((a: any, b: any) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (macRecipes.length === 0 || loaded) return;
    Promise.all(
      macRecipes.map((r: any) =>
        fetch(`/api/app-settings/mac_cheese_extra_packs_${r.id}`, { credentials: "include" })
          .then(resp => resp.ok ? resp.json() : null)
          .then(d => ({ id: r.id, value: d?.value ? Number(d.value) : 5 }))
          .catch(() => ({ id: r.id, value: 5 }))
      )
    ).then(results => {
      const map: Record<number, number> = {};
      for (const r of results) map[r.id] = r.value;
      setExtras(map);
      setLoaded(true);
    });
  }, [macRecipes.length, loaded]);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [id, value] of Object.entries(extras)) {
        await fetch(`/api/app-settings/mac_cheese_extra_packs_${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ value: String(value) }),
        });
      }
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (err: any) {
      toast({ title: "Error", description: err?.message ?? "Failed to save", variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (recipesLoading || !loaded) {
    return <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  if (macRecipes.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <UtensilsCrossed className="w-4 h-4 text-yellow-600" /> Macaroni Cheese Defaults
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Set the default "Extra to make" packs for each mac cheese recipe. This is added on top of sales data when calculating production quantities.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-yellow-50 dark:bg-yellow-900/20 text-muted-foreground text-xs">
            <tr>
              <th className="px-5 py-3 font-medium text-left">Recipe</th>
              <th className="px-5 py-3 font-medium text-right">Extra to Make (packs)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {macRecipes.map((recipe: any) => (
              <tr key={recipe.id} className="hover:bg-secondary/10 transition-colors">
                <td className="px-5 py-3.5 font-medium" style={recipe.color ? { color: recipe.color } : undefined}>{recipe.name}</td>
                <td className="px-5 py-3.5 text-right">
                  <NumberInput
                    min={0}
                    value={extras[recipe.id] ?? 5}
                    onChange={n => setExtras(prev => ({ ...prev, [recipe.id]: Math.max(0, n) }))}
                    className="w-24 px-2 py-1 border border-border rounded-lg text-sm text-right font-mono focus-ring"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        On Thursdays (last production day before weekend), extra is automatically set to 0 regardless of this default.
      </p>
    </div>
  );
}

function TimingStandardsSection() {
  const { data: standards, isLoading } = useListTimingStandards();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const handleSave = async (id: number) => {
    const minInput = document.getElementById(`ts-min-${id}`) as HTMLInputElement;
    const targetInput = document.getElementById(`ts-target-${id}`) as HTMLInputElement;
    setSaving(id);
    try {
      await updateTimingStandard(id, {
        minBatchesPerHour: Number(minInput?.value) || 0,
        targetBatchesPerHour: Number(targetInput?.value) || 0,
      });
      await queryClient.invalidateQueries({ queryKey: getListTimingStandardsQueryKey() });
      setEditingId(null);
      setSavedMsg("Saved"); setTimeout(() => setSavedMsg(null), 2000);
    } finally { setSaving(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Timer className="w-4 h-4 text-primary" /> Station Timing Standards
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Set minimum and target batches per hour for each production station — used for KPI colour coding.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-muted-foreground text-xs">
              <tr>
                <th className="px-5 py-3 font-medium text-left">Station</th>
                <th className="px-5 py-3 font-medium text-right">Min Batches / hr</th>
                <th className="px-5 py-3 font-medium text-right">Target Batches / hr</th>
                <th className="px-5 py-3 font-medium text-right w-28">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {(standards ?? []).map(s => (
                <tr key={s.id} className="hover:bg-secondary/10 transition-colors">
                  <td className="px-5 py-3.5 font-medium">{s.stationLabel}</td>
                  <td className="px-5 py-3.5 text-right">
                    {editingId === s.id ? (
                      <input id={`ts-min-${s.id}`} type="number" step="0.5" min="0" defaultValue={s.minBatchesPerHour} className="w-20 px-2 py-1 border border-border rounded-lg text-sm text-right" />
                    ) : (
                      <span className="font-mono text-amber-600">{s.minBatchesPerHour}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {editingId === s.id ? (
                      <input id={`ts-target-${s.id}`} type="number" step="0.5" min="0" defaultValue={s.targetBatchesPerHour} className="w-20 px-2 py-1 border border-border rounded-lg text-sm text-right" />
                    ) : (
                      <span className="font-mono text-green-600">{s.targetBatchesPerHour}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {editingId === s.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleSave(s.id)}
                          disabled={saving !== null}
                          className="px-2 py-1 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                        >
                          {saving === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Save
                        </button>
                        <button onClick={() => setEditingId(null)} className="px-2 py-1 text-muted-foreground text-xs">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setEditingId(s.id)} className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors" title="Edit"><Edit2 className="w-4 h-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminDateOverrideSection() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/app-settings/admin_plan_date_override`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.value === "true") setEnabled(true); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  const toggle = async () => {
    const newVal = !enabled;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/app-settings/admin_plan_date_override`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: newVal ? "true" : "false" }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setEnabled(newVal);
      toast({ title: newVal ? "Admin date override enabled" : "Admin date override disabled" });
    } catch {
      toast({ title: "Failed to save setting", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Lock className="w-4 h-4 text-primary" /> Admin Date Override
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          When enabled, admin users can create production plans for any weekday — including today and past dates. Non-admin users are unaffected.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Override lead-time restriction</span>
            {enabled && (
              <span className="text-xs font-semibold text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-full">Active</span>
            )}
          </div>
          <button
            onClick={toggle}
            disabled={saving}
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30",
              enabled ? "bg-primary" : "bg-gray-300 dark:bg-gray-600",
              saving && "opacity-50 cursor-not-allowed"
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                enabled ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

function MixerCapacitySection() {
  const [capacity, setCapacity] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/app-settings/mixer_capacity_kg", { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.value) { setCapacity(d.value); setLoaded(true); } })
      .catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    const num = Number(capacity);
    if (!num || num <= 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/app-settings/mixer_capacity_kg", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: String(num) }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSavedMsg("Saved"); setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Wrench className="w-4 h-4 text-primary" /> Mixer Capacity (Flour)
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Set the maximum flour weight your mixer can handle in kg — used to calculate the number of mixes on the Dough Prep station.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium w-40">Capacity (kg)</label>
          <input
            type="number"
            min="1"
            step="1"
            value={capacity}
            onChange={e => setCapacity(e.target.value)}
            placeholder="e.g. 25"
            className="w-28 px-3 py-2 border border-border rounded-lg text-sm text-right"
          />
          <button
            onClick={handleSave}
            disabled={saving || !capacity}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ExtraTomatoBaseSection() {
  const [extra, setExtra] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/app-settings/extra_tomato_base_kg", { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.value) { setExtra(d.value); } setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    const num = Number(extra);
    if (isNaN(num) || num < 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/app-settings/extra_tomato_base_kg", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: String(num) }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSavedMsg("Saved"); setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Wrench className="w-4 h-4 text-primary" /> Extra Tomato Base
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Additional tomato base (kg) added to every production plan's prep requirements — covers wastage, testing, etc.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium w-40">Extra amount (kg)</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={extra}
            onChange={e => setExtra(e.target.value)}
            placeholder="e.g. 2"
            className="w-28 px-3 py-2 border border-border rounded-lg text-sm text-right"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

interface IcePackTier { maxTempBelow: number | null; packs: number; }
interface IcePackRules {
  enabled: boolean;
  location: { name: string; latitude: number; longitude: number };
  largeBoxExtra: number;
  tiers: IcePackTier[];
}
const DEFAULT_ICE_PACK_RULES: IcePackRules = {
  enabled: true,
  location: { name: "Heathrow", latitude: 51.47, longitude: -0.45 },
  largeBoxExtra: 1,
  tiers: [
    { maxTempBelow: 10, packs: 1 },
    { maxTempBelow: 25, packs: 2 },
    { maxTempBelow: null, packs: 3 },
  ],
};

function IcePackSettingsSection() {
  const [rules, setRules] = useState<IcePackRules>(DEFAULT_ICE_PACK_RULES);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ highTemp: number | null; smallBoxPacks?: number; largeBoxPacks?: number; forecastSource?: string; location?: { name: string } } | null>(null);

  const loadPreview = () => {
    fetch("/api/ice-packs/today", { credentials: "include" })
      .then(r => r.json())
      .then(setPreview)
      .catch(() => setPreview(null));
  };

  useEffect(() => {
    fetch("/api/app-settings/ice_pack_rules", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.value) { try { setRules({ ...DEFAULT_ICE_PACK_RULES, ...JSON.parse(d.value) }); } catch { /* keep defaults */ } } })
      .catch(() => { /* keep defaults */ });
    loadPreview();
  }, []);

  // Keep tiers ordered with the open-ended ("and above") tier last.
  const orderedTiers = [...rules.tiers].sort((a, b) => {
    if (a.maxTempBelow === null) return 1;
    if (b.maxTempBelow === null) return -1;
    return a.maxTempBelow - b.maxTempBelow;
  });

  const updateTier = (idx: number, patch: Partial<IcePackTier>) => {
    setRules(r => ({ ...r, tiers: orderedTiers.map((t, i) => (i === idx ? { ...t, ...patch } : t)) }));
  };
  const addTier = () => {
    // Insert a new threshold just below the open-ended tier.
    const bounded = orderedTiers.filter(t => t.maxTempBelow !== null);
    const lastBound = bounded.length ? bounded[bounded.length - 1].maxTempBelow! : 10;
    const open = orderedTiers.find(t => t.maxTempBelow === null) ?? { maxTempBelow: null, packs: 3 };
    setRules(r => ({ ...r, tiers: [...bounded, { maxTempBelow: lastBound + 5, packs: open.packs - 1 }, open] }));
  };
  const removeTier = (idx: number) => {
    if (orderedTiers[idx].maxTempBelow === null) return; // never remove the open-ended tier
    setRules(r => ({ ...r, tiers: orderedTiers.filter((_, i) => i !== idx) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/app-settings/ice_pack_rules", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(rules) }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSavedMsg("Saved"); setTimeout(() => setSavedMsg(null), 2000);
      loadPreview();
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ThermometerSnowflake className="w-4 h-4 text-cyan-500" /> Despatch Ice Packs
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            How many ice packs to put in each box, set from the forecast high temperature over the despatch window (today + tomorrow) at one fixed location. Large boxes always get the small-box count plus the extra below.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
        {/* Enabled toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={rules.enabled} onChange={e => setRules(r => ({ ...r, enabled: e.target.checked }))} className="w-4 h-4" />
          <span className="text-sm font-medium">Show ice-pack instruction on the packing station &amp; scanning app</span>
        </label>

        {/* Today's preview */}
        {preview && preview.highTemp != null && (
          <div className="rounded-lg bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-800 px-4 py-3 text-sm">
            <span className="font-medium">Today: </span>
            high {preview.highTemp}°C{preview.location?.name ? ` at ${preview.location.name}` : ""} →{" "}
            <span className="font-bold tabular-nums">{preview.smallBoxPacks}</span> small box,{" "}
            <span className="font-bold tabular-nums">{preview.largeBoxPacks}</span> large box
            {preview.forecastSource && preview.forecastSource !== "live" ? ` (${preview.forecastSource})` : ""}
          </div>
        )}

        {/* Tiers */}
        <div>
          <div className="text-sm font-medium mb-2">Small-box rule (by forecast high temperature)</div>
          <div className="space-y-2">
            {orderedTiers.map((tier, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                {tier.maxTempBelow === null ? (
                  <span className="w-44">Otherwise (and above)</span>
                ) : (
                  <span className="w-44 flex items-center gap-1">
                    Below
                    <input
                      type="number" step="1"
                      value={tier.maxTempBelow}
                      onChange={e => updateTier(idx, { maxTempBelow: Number(e.target.value) })}
                      className="w-16 px-2 py-1 border border-border rounded-md text-right"
                    />
                    °C
                  </span>
                )}
                <span className="text-muted-foreground">→</span>
                <input
                  type="number" min="0" step="1"
                  value={tier.packs}
                  onChange={e => updateTier(idx, { packs: Number(e.target.value) })}
                  className="w-16 px-2 py-1 border border-border rounded-md text-right"
                />
                <span>ice pack{tier.packs === 1 ? "" : "s"}</span>
                {tier.maxTempBelow !== null && (
                  <button onClick={() => removeTier(idx)} className="ml-1 text-muted-foreground hover:text-destructive" title="Remove this band">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button onClick={addTier} className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <Plus className="w-3.5 h-3.5" /> Add temperature band
          </button>
        </div>

        {/* Large box extra */}
        <div className="flex items-center gap-3 text-sm">
          <label className="font-medium w-44">Large box adds</label>
          <input
            type="number" min="0" step="1"
            value={rules.largeBoxExtra}
            onChange={e => setRules(r => ({ ...r, largeBoxExtra: Number(e.target.value) }))}
            className="w-16 px-2 py-1 border border-border rounded-md text-right"
          />
          <span>extra ice pack{rules.largeBoxExtra === 1 ? "" : "s"} vs small box</span>
        </div>

        {/* Location */}
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="text-sm font-medium">Forecast location</div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Name</span>
              <input value={rules.location.name} onChange={e => setRules(r => ({ ...r, location: { ...r.location, name: e.target.value } }))} className="w-32 px-2 py-1 border border-border rounded-md" />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Lat</span>
              <input type="number" step="0.001" value={rules.location.latitude} onChange={e => setRules(r => ({ ...r, location: { ...r.location, latitude: Number(e.target.value) } }))} className="w-24 px-2 py-1 border border-border rounded-md text-right" />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Long</span>
              <input type="number" step="0.001" value={rules.location.longitude} onChange={e => setRules(r => ({ ...r, location: { ...r.location, longitude: Number(e.target.value) } }))} className="w-24 px-2 py-1 border border-border rounded-md text-right" />
            </label>
          </div>
        </div>

        <div className="pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductionExtrasSection() {
  const KEYS = [
    { key: "daily_extra_pack_ball_count",   label: "Extra Pack Balls",  unit: "balls",  defaultVal: "2",   min: 0, step: 1,   description: "Number of extra 230g dough balls prepped daily for leftover filling packs" },
    { key: "daily_extra_pack_ball_weight_g",label: "",                  unit: "g each", defaultVal: "230", min: 50, step: 5,  description: "" },
    { key: "daily_snack_ball_count",        label: "Snack Dough Ball",  unit: "balls",  defaultVal: "1",   min: 0, step: 1,   description: "Number of lighter dough balls prepped daily for snack portions" },
    { key: "daily_snack_ball_weight_g",     label: "",                  unit: "g each", defaultVal: "200", min: 50, step: 5,  description: "" },
  ] as const;
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(
      KEYS.map(({ key, defaultVal }) =>
        fetch(`/api/app-settings/${key}`, { credentials: "include" })
          .then(r => r.ok ? r.json() : null)
          .then(d => ({ key, value: d?.value ?? defaultVal }))
      )
    ).then(results => {
      const v: Record<string, string> = {};
      for (const r of results) v[r.key] = r.value;
      setVals(v);
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        KEYS.map(({ key, defaultVal }) =>
          fetch(`/api/app-settings/${key}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: String(Number(vals[key] ?? defaultVal)) }),
          })
        )
      );
      setSavedMsg("Saved"); setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  const extraPackCount  = Number(vals["daily_extra_pack_ball_count"]  ?? 2);
  const extraPackWeight = Number(vals["daily_extra_pack_ball_weight_g"] ?? 230);
  const snackCount      = Number(vals["daily_snack_ball_count"]         ?? 1);
  const snackWeight     = Number(vals["daily_snack_ball_weight_g"]      ?? 200);
  const totalExtraG     = extraPackCount * extraPackWeight + snackCount * snackWeight;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" /> Daily Fixed Extras
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fixed dough balls prepped every day beyond the recipe batches — for leftover filling packs and snack portions.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
        {/* Extra pack balls */}
        <div>
          <p className="text-sm font-semibold mb-2">Extra Pack Balls (leftover filling)</p>
          <p className="text-xs text-muted-foreground mb-3">Sheeted for extra packs when filling is available — 230g each by default.</p>
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium w-20">Count</label>
              <input
                type="number" min="0" step="1"
                value={vals["daily_extra_pack_ball_count"] ?? "2"}
                onChange={e => setVals(v => ({ ...v, daily_extra_pack_ball_count: e.target.value }))}
                className="w-20 px-3 py-2 border border-border rounded-lg text-sm text-right"
              />
              <span className="text-xs text-muted-foreground">balls</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium w-20">Weight</label>
              <input
                type="number" min="50" step="5"
                value={vals["daily_extra_pack_ball_weight_g"] ?? "230"}
                onChange={e => setVals(v => ({ ...v, daily_extra_pack_ball_weight_g: e.target.value }))}
                className="w-24 px-3 py-2 border border-border rounded-lg text-sm text-right"
              />
              <span className="text-xs text-muted-foreground">g each</span>
            </div>
          </div>
        </div>

        {/* Snack ball */}
        <div className="border-t border-border/60 pt-4">
          <p className="text-sm font-semibold mb-2">Snack Dough Ball</p>
          <p className="text-xs text-muted-foreground mb-3">Lighter ball for snack portions — 200g by default.</p>
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium w-20">Count</label>
              <input
                type="number" min="0" step="1"
                value={vals["daily_snack_ball_count"] ?? "1"}
                onChange={e => setVals(v => ({ ...v, daily_snack_ball_count: e.target.value }))}
                className="w-20 px-3 py-2 border border-border rounded-lg text-sm text-right"
              />
              <span className="text-xs text-muted-foreground">ball</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium w-20">Weight</label>
              <input
                type="number" min="50" step="5"
                value={vals["daily_snack_ball_weight_g"] ?? "200"}
                onChange={e => setVals(v => ({ ...v, daily_snack_ball_weight_g: e.target.value }))}
                className="w-24 px-3 py-2 border border-border rounded-lg text-sm text-right"
              />
              <span className="text-xs text-muted-foreground">g each</span>
            </div>
          </div>
        </div>

        {/* Summary + save */}
        <div className="border-t border-border/60 pt-4 flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-muted-foreground">
            Total extra dough: <span className="font-semibold text-foreground">{totalExtraG}g ({(totalExtraG / 1000).toFixed(3)} kg)</span> per day
          </p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Oven batch weight + HACCP chill settings. Backed by four app_settings keys:
 *   tray_weight_g, chill_target_temp_c, weight_tolerance_under_g, weight_tolerance_over_g
 *
 * These drive the oven-station weight-entry modal (target = pack_size ×
 * portion cooked weight + tray weight) and the HACCP cooling report.
 */
function WeightChillSettingsSection() {
  const KEYS = [
    { key: "tray_weight_g",              defaultVal: "36" },
    { key: "chill_target_temp_c",        defaultVal: "4" },
    { key: "weight_tolerance_under_g",   defaultVal: "0" },
    { key: "weight_tolerance_over_g",    defaultVal: "0" },
  ] as const;
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(
      KEYS.map(({ key, defaultVal }) =>
        fetch(`/api/app-settings/${key}`, { credentials: "include" })
          .then(r => r.ok ? r.json() : null)
          .then(d => ({ key, value: d?.value ?? defaultVal }))
          .catch(() => ({ key, value: defaultVal }))
      )
    ).then(results => {
      const v: Record<string, string> = {};
      for (const r of results) v[r.key] = r.value;
      setVals(v);
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        KEYS.map(({ key, defaultVal }) =>
          fetch(`/api/app-settings/${key}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: String(Number(vals[key] ?? defaultVal)) }),
          })
        )
      );
      setSavedMsg("Saved"); setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Scale className="w-4 h-4 text-primary" /> Pack Weights & HACCP Chill
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tray weight and tolerances drive the oven-station pack weighing check. Chill target temperature is the HACCP cool-down threshold.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
        <div>
          <p className="text-sm font-semibold mb-2">Tray weight</p>
          <p className="text-xs text-muted-foreground mb-3">Empty packaging weight added to every target (2 portions + tray = target pack weight).</p>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium w-24">Weight</label>
            <input
              type="number" min="0" step="1"
              value={vals["tray_weight_g"] ?? "36"}
              onChange={e => setVals(v => ({ ...v, tray_weight_g: e.target.value }))}
              className="w-24 px-3 py-2 border border-border rounded-lg text-sm text-right"
            />
            <span className="text-xs text-muted-foreground">g</span>
          </div>
        </div>

        <div className="border-t border-border/60 pt-4">
          <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <ThermometerSnowflake className="w-4 h-4 text-cyan-500" /> Chill target temperature
          </p>
          <p className="text-xs text-muted-foreground mb-3">HACCP cool-down threshold — product is only removed from the blast chiller once it reaches this temperature.</p>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium w-24">Temperature</label>
            <input
              type="number" min="0" max="30" step="0.5"
              value={vals["chill_target_temp_c"] ?? "4"}
              onChange={e => setVals(v => ({ ...v, chill_target_temp_c: e.target.value }))}
              className="w-24 px-3 py-2 border border-border rounded-lg text-sm text-right"
            />
            <span className="text-xs text-muted-foreground">°C</span>
          </div>
        </div>

        <div className="border-t border-border/60 pt-4">
          <p className="text-sm font-semibold mb-2">Weight tolerance</p>
          <p className="text-xs text-muted-foreground mb-3">How far an actual pack weight can stray from target before it's flagged out of tolerance (0 disables the check).</p>
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium w-20">Under</label>
              <input
                type="number" min="0" step="1"
                value={vals["weight_tolerance_under_g"] ?? "0"}
                onChange={e => setVals(v => ({ ...v, weight_tolerance_under_g: e.target.value }))}
                className="w-24 px-3 py-2 border border-border rounded-lg text-sm text-right"
              />
              <span className="text-xs text-muted-foreground">g</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium w-20">Over</label>
              <input
                type="number" min="0" step="1"
                value={vals["weight_tolerance_over_g"] ?? "0"}
                onChange={e => setVals(v => ({ ...v, weight_tolerance_over_g: e.target.value }))}
                className="w-24 px-3 py-2 border border-border rounded-lg text-sm text-right"
              />
              <span className="text-xs text-muted-foreground">g</span>
            </div>
          </div>
        </div>

        <div className="border-t border-border/60 pt-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Oven defaults — temp/time per dietary category. Recipes tagged "meat" or
 * "vegetarian" use these on the building station's first-batch overlay so
 * the oven settings are confirmed before assembly continues.
 */
function OvenDefaultsSection() {
  const KEYS = [
    { key: "oven_meat_temp_c",    defaultVal: "220" },
    { key: "oven_meat_time_min",  defaultVal: "8"   },
    { key: "oven_veg_temp_c",     defaultVal: "210" },
    { key: "oven_veg_time_min",   defaultVal: "7"   },
  ] as const;
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(
      KEYS.map(({ key, defaultVal }) =>
        fetch(`/api/app-settings/${key}`, { credentials: "include" })
          .then(r => r.ok ? r.json() : null)
          .then(d => ({ key, value: d?.value ?? defaultVal }))
          .catch(() => ({ key, value: defaultVal }))
      )
    ).then(results => {
      const v: Record<string, string> = {};
      for (const r of results) v[r.key] = r.value;
      setVals(v);
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        KEYS.map(({ key, defaultVal }) =>
          fetch(`/api/app-settings/${key}`, {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: String(Number(vals[key] ?? defaultVal)) }),
          })
        )
      );
      setSavedMsg("Saved"); setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  const Row = ({ label, tempKey, timeKey }: { label: string; tempKey: string; timeKey: string }) => (
    <div className="flex items-end gap-4 flex-wrap">
      <div className="text-sm font-semibold w-28">{label}</div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Temp</label>
        <input
          type="number" min="50" max="350" step="5"
          value={vals[tempKey] ?? ""}
          onChange={e => setVals(v => ({ ...v, [tempKey]: e.target.value }))}
          className="w-20 px-3 py-2 border border-border rounded-lg text-sm text-right"
        />
        <span className="text-xs text-muted-foreground">°C</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Time</label>
        <input
          type="number" min="1" max="60" step="1"
          value={vals[timeKey] ?? ""}
          onChange={e => setVals(v => ({ ...v, [timeKey]: e.target.value }))}
          className="w-20 px-3 py-2 border border-border rounded-lg text-sm text-right"
        />
        <span className="text-xs text-muted-foreground">min</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <UtensilsCrossed className="w-4 h-4 text-primary" /> Oven Defaults
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Per-category cooking time and temperature, shown to the builder on the first batch of each recipe. Tag a recipe as Meat or Vegetarian on its edit page to enable the prompt.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <Row label="Meat" tempKey="oven_meat_temp_c" timeKey="oven_meat_time_min" />
        <Row label="Vegetarian" tempKey="oven_veg_temp_c" timeKey="oven_veg_time_min" />
        <div className="border-t border-border/60 pt-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Factory number accounting loop scope toggle.
 *
 * Reads and writes GET/PUT /api/stock-entries/factory-number-config, which
 * is backed by the `factory_number_core_menu_only` row in app_settings.
 * When enabled, the fulfilment decrement path, the /calculate predicted
 * fridge stock, and the reset endpoint all ignore non-core recipes.
 * Flip it off once every recipe has a Shopify variant mapping set.
 */
function FactoryNumberSection() {
  const [coreMenuOnly, setCoreMenuOnly] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stock-entries/factory-number-config", { credentials: "include" })
      .then(r => r.ok ? r.json() : { coreMenuOnly: true })
      .then((d: { coreMenuOnly: boolean }) => setCoreMenuOnly(d.coreMenuOnly))
      .catch(() => setCoreMenuOnly(true));
  }, []);

  async function handleToggle(next: boolean) {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/stock-entries/factory-number-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coreMenuOnly: next }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = (await res.json()) as { coreMenuOnly: boolean };
      setCoreMenuOnly(data.coreMenuOnly);
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  }

  if (coreMenuOnly === null) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Boxes className="w-4 h-4 text-primary" /> Factory Number Scope
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Controls which recipes participate in the factory-number
          accounting loop (fridge stock increments from wrapping and
          decrements from Shopify fulfilment).
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium">Core menu items only</p>
            {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            {savedMsg && <span className="text-xs text-emerald-600 font-medium">{savedMsg}</span>}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {coreMenuOnly ? (
              <>
                <span className="font-medium text-foreground">Enabled.</span>{" "}
                Only recipes flagged as core menu items have their fridge
                stock tracked. Non-core recipes show live values only with
                no prediction, and Shopify fulfilments of non-core variants
                are not deducted. Turn off once every recipe has a Shopify
                variant mapping configured via the recipe edit dialog.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">Disabled.</span>{" "}
                All recipes participate in the factory-number loop. Any
                recipe without a Shopify variant mapping will log an unmapped
                warning on fulfilment but won't block dispatch.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={coreMenuOnly}
          onCheckedChange={handleToggle}
          disabled={saving}
          aria-label="Toggle core menu only scope"
        />
      </div>
    </div>
  );
}

/**
 * Kill switch for the wrapping-complete → Shopify inventory upload.
 *
 * Reads and writes GET/PUT /api/stock-entries/shopify-freezer-sync-config,
 * which is backed by the `shopify_freezer_sync_enabled` row in app_settings.
 * When disabled, wrapping-complete still freezes wonky packs and updates
 * production_freezer locally, it just skips the Shopify inventory push.
 * Defaults to off — enable only once the sync behaviour has been verified.
 */
function ShopifyFreezerSyncSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stock-entries/shopify-freezer-sync-config", { credentials: "include" })
      .then(r => r.ok ? r.json() : { enabled: false })
      .then((d: { enabled: boolean }) => setEnabled(d.enabled))
      .catch(() => setEnabled(false));
  }, []);

  async function handleToggle(next: boolean) {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/stock-entries/shopify-freezer-sync-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = (await res.json()) as { enabled: boolean };
      setEnabled(data.enabled);
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  }

  if (enabled === null) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Boxes className="w-4 h-4 text-primary" /> Shopify Freezer Stock Sync
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          When a wrapper marks a recipe complete, the app can push the
          product-freezer packs (plus any wonky packs just frozen) to the
          matching Shopify variant's inventory. Disable this kill switch
          to pause the upload without affecting anything else in the app.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium">Upload freezer stock to Shopify</p>
            {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            {savedMsg && <span className="text-xs text-emerald-600 font-medium">{savedMsg}</span>}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {enabled ? (
              <>
                <span className="font-medium text-foreground">Enabled.</span>{" "}
                Wrapping-complete will adjust Shopify inventory by the number
                of packs committed to the product freezer (including any
                wonky packs auto-frozen at the same moment).
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">Disabled.</span>{" "}
                Wrapping-complete freezes wonky packs and updates the
                production-freezer counter locally, but does not touch
                Shopify inventory. Enable this once the sync behaviour has
                been verified.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={saving}
          aria-label="Toggle Shopify freezer stock sync"
        />
      </div>
    </div>
  );
}

/**
 * Lets the picker manually tick line items by tapping the row, in addition
 * to scanning. Some sites want scan-only to enforce that every dispatched
 * unit was physically present at packing time. Backed by the
 * `fulfilment_manual_tick_enabled` row in app_settings.
 */
function FulfilmentManualTickSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/fulfilment/manual-tick-config", { credentials: "include" })
      .then(r => r.ok ? r.json() : { enabled: true })
      .then((d: { enabled: boolean }) => setEnabled(d.enabled))
      .catch(() => setEnabled(true));
  }, []);

  async function handleToggle(next: boolean) {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/fulfilment/manual-tick-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = (await res.json()) as { enabled: boolean };
      setEnabled(data.enabled);
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  }

  if (enabled === null) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Boxes className="w-4 h-4 text-primary" /> Fulfilment — Manual Tick
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Controls whether the picking page lets a packer tap a row to mark
          it picked. Turn off to lock the page to scan-only — every unit
          must be scanned through the barcode reader before the order can
          be completed.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium">Allow manual tap to pick</p>
            {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            {savedMsg && <span className="text-xs text-emerald-600 font-medium">{savedMsg}</span>}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {enabled ? (
              <>
                <span className="font-medium text-foreground">Enabled.</span>{" "}
                Tapping a row adds one to its picked count, same as a scan
                (so a 2-pack still needs two taps before it turns green).
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">Disabled.</span>{" "}
                Rows are not tappable. Items can only be marked picked by
                scanning a barcode through the reader.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={saving}
          aria-label="Toggle manual tap-to-pick on the fulfilment page"
        />
      </div>
    </div>
  );
}

/**
 * Mute switch for the spoken customer name on the picking page. Backed by
 * the `fulfilment_speak_name_enabled` row in app_settings. When off, no
 * speech is synthesised when an order opens.
 */
function FulfilmentSpeakNameSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/fulfilment/speak-name-config", { credentials: "include" })
      .then(r => r.ok ? r.json() : { enabled: true })
      .then((d: { enabled: boolean }) => setEnabled(d.enabled))
      .catch(() => setEnabled(true));
  }, []);

  async function handleToggle(next: boolean) {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/fulfilment/speak-name-config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = (await res.json()) as { enabled: boolean };
      setEnabled(data.enabled);
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  }

  if (enabled === null) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Boxes className="w-4 h-4 text-primary" /> Fulfilment — Speak Customer Name
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          When enabled, the picking page reads the customer's shipping name
          aloud the first time each order opens. Useful as a hands-free
          cross-check against the printed label; turn off in a noisy kitchen.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium">Read customer name aloud</p>
            {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            {savedMsg && <span className="text-xs text-emerald-600 font-medium">{savedMsg}</span>}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {enabled ? (
              <>
                <span className="font-medium text-foreground">Enabled.</span>{" "}
                Each new order is read once in an English voice. Subsequent
                taps on the same order do not repeat it.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">Disabled.</span>{" "}
                The picking page is silent — no spoken name on order open.
                Scan beeps and the order-complete chime are unaffected.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={saving}
          aria-label="Toggle reading the customer name aloud on the fulfilment page"
        />
      </div>
    </div>
  );
}

/**
 * Building timer settings — on/off switch + global default build time.
 *
 * Controls the countdown timer inside the BATCH BUILT button on the
 * building station. When enabled, each batch completion resets a
 * countdown to the current recipe's target_build_seconds (or the
 * default below if that recipe has no target set).
 *
 * Backed by two rows in app_settings:
 *   - building_timer_enabled        ("true" | "false")
 *   - building_timer_default_seconds ("480" = 8 minutes by default)
 *
 * Visible to admins and managers.
 */
function BuildingTimerSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [defaultMinutesStr, setDefaultMinutesStr] = useState<string>("8");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/app-settings/building_timer_enabled", { credentials: "include" })
        .then(r => r.ok ? r.json() : null),
      fetch("/api/app-settings/building_timer_default_seconds", { credentials: "include" })
        .then(r => r.ok ? r.json() : null),
    ]).then(([e, d]) => {
      setEnabled(e?.value === "true");
      if (d?.value) {
        const secs = Number(d.value) || 480;
        setDefaultMinutesStr(String(Math.round((secs / 60) * 10) / 10));
      }
    }).catch(() => setEnabled(false));
  }, []);

  async function saveSetting(key: string, value: string) {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch(`/api/app-settings/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(next: boolean) {
    setEnabled(next);
    await saveSetting("building_timer_enabled", String(next));
  }

  async function handleDefaultBlur() {
    const mins = Number(defaultMinutesStr);
    if (!Number.isFinite(mins) || mins <= 0 || mins > 60) {
      setSavedMsg("Must be 0.1\u201360 minutes");
      return;
    }
    const seconds = Math.round(mins * 60);
    await saveSetting("building_timer_default_seconds", String(seconds));
  }

  if (enabled === null) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Timer className="w-4 h-4 text-primary" /> Building Timer
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Countdown timer inside the BATCH BUILT button on the building
          stations. Starts when a builder taps the button and counts
          down to the recipe&rsquo;s target build time. Pauses during
          break sessions.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium">Enable building timer</p>
            {saving && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            {savedMsg && <span className="text-xs text-emerald-600 font-medium">{savedMsg}</span>}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {enabled ? (
              <>
                <span className="font-medium text-foreground">On.</span>{" "}
                The countdown and progress bar appear inside the BATCH
                BUILT button. At zero, a short beep plays and a snooze
                option appears.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">Off.</span>{" "}
                The button keeps its original layout. Nothing ticks,
                nothing beeps.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={saving}
          aria-label="Toggle building timer"
        />
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <label className="text-sm font-medium block mb-1">Default build time (minutes)</label>
        <p className="text-xs text-muted-foreground mb-3">
          Used for any recipe that doesn&rsquo;t have its own target
          build time set in the Recipes page. Changes take effect on
          the next page load.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.1"
            min="0.1"
            max="60"
            value={defaultMinutesStr}
            onChange={e => setDefaultMinutesStr(e.target.value)}
            onBlur={handleDefaultBlur}
            disabled={saving}
            className="w-32 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 tabular-nums"
          />
          <span className="text-sm text-muted-foreground">minutes</span>
        </div>
      </div>
    </div>
  );
}

function PastaCookingSection() {
  const [waterLPerKg, setWaterLPerKg] = useState<string>("6");
  const [saltGPerKg, setSaltGPerKg] = useState<string>("60");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/app-settings/pasta_cooking_water_l_per_kg", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.value) setWaterLPerKg(d.value); }),
      fetch("/api/app-settings/pasta_cooking_salt_g_per_kg", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.value) setSaltGPerKg(d.value); }),
    ]);
  }, []);

  const handleSave = async () => {
    const w = Number(waterLPerKg);
    const s = Number(saltGPerKg);
    if (!(w >= 0) || !(s >= 0)) return;
    setSaving(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/app-settings/pasta_cooking_water_l_per_kg", {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: String(w) }),
        }),
        fetch("/api/app-settings/pasta_cooking_salt_g_per_kg", {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: String(s) }),
        }),
      ]);
      if (!r1.ok || !r2.ok) throw new Error("Failed to save");
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <UtensilsCrossed className="w-4 h-4 text-primary" /> Pasta Cooking
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Water and salt ratios per kg of pasta. Whenever a recipe uses an ingredient marked
            as &ldquo;Pasta type&rdquo;, the prep sheet appends a synthetic cooking water + salt row
            scaled by the plan&rsquo;s total pasta weight. Doesn&rsquo;t affect ordering, stock, or label weight.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium w-36">Water per kg</label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={waterLPerKg}
              onChange={e => setWaterLPerKg(e.target.value)}
              className="w-24 px-3 py-2 border border-border rounded-lg text-sm text-right"
            />
            <span className="text-sm text-muted-foreground">L / kg pasta</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium w-36">Salt per kg</label>
            <input
              type="number"
              min="0"
              step="1"
              value={saltGPerKg}
              onChange={e => setSaltGPerKg(e.target.value)}
              className="w-24 px-3 py-2 border border-border rounded-lg text-sm text-right"
            />
            <span className="text-sm text-muted-foreground">g / kg pasta</span>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-auto px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Editable list of non-dispatch dates (bank holidays / factory shutdowns).
// These get skipped by the working-day walks in /calculate so a Tuesday
// production after a bank-holiday Monday correctly pulls the previous
// Friday's dispatch instead of the empty Monday slot.
// ── Timed station reminders ────────────────────────────────────────────
// Daily wall-clock banners on station screens with a countdown to a
// deadline — e.g. "stock checks due by 3pm" on Prep from 14:45. Stored as
// a JSON array in app_settings; rendered by StationReminderBanner inside
// the shared station layout. The team can add their own here.
function TimedRemindersSection() {
  const [reminders, setReminders] = useState<TimedReminder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch(`/api/app-settings/${TIMED_REMINDERS_KEY}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(j => { setReminders(parseReminders(j?.value)); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  const update = (id: string, patch: Partial<TimedReminder>) => {
    setReminders(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    setDirty(true);
  };

  const addReminder = () => {
    setReminders(prev => [...prev, {
      id: `reminder_${Date.now()}`,
      title: "New reminder",
      message: "",
      stations: [],
      startTime: "14:45",
      endTime: "15:00",
      enabled: false,
    }]);
    setDirty(true);
  };

  const removeReminder = (id: string) => {
    setReminders(prev => prev.filter(r => r.id !== id));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/app-settings/${TIMED_REMINDERS_KEY}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(reminders) }),
      });
      if (!res.ok) throw new Error("save failed");
      setDirty(false);
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <AlarmClock className="w-4 h-4 text-primary" /> Timed reminders
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Daily warnings on station screens with a countdown to a deadline —
            e.g. stock checks due by 3pm. Shown between the start and end time
            (UK clock) on the chosen stations, only while a plan is live.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {!loaded ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-3">
          {reminders.map(r => (
            <div key={r.id} className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-center gap-3">
                <Switch checked={r.enabled} onCheckedChange={v => update(r.id, { enabled: v })} />
                <input
                  type="text"
                  value={r.title}
                  onChange={e => update(r.id, { title: e.target.value })}
                  placeholder="Title shown in bold"
                  className="flex-1 px-3 py-2 border border-border rounded-lg text-sm font-semibold bg-background"
                />
                <button
                  onClick={() => removeReminder(r.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1.5"
                  title="Delete reminder"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <input
                type="text"
                value={r.message}
                onChange={e => update(r.id, { message: e.target.value })}
                placeholder="Message shown under the title"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background"
              />
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Show from</span>
                  <input
                    type="time"
                    value={r.startTime}
                    onChange={e => update(r.id, { startTime: e.target.value })}
                    className="px-2 py-1.5 border border-border rounded-lg text-sm bg-background"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Count down to</span>
                  <input
                    type="time"
                    value={r.endTime}
                    onChange={e => update(r.id, { endTime: e.target.value })}
                    className="px-2 py-1.5 border border-border rounded-lg text-sm bg-background"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!r.onlyIfStockChecksOutstanding}
                    onChange={e => update(r.id, { onlyIfStockChecksOutstanding: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-muted-foreground">Only if stock checks are still outstanding</span>
                </label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {STATIONS.map(s => {
                  const on = r.stations.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      onClick={() => update(r.id, {
                        stations: on ? r.stations.filter(k => k !== s.key) : [...r.stations, s.key],
                      })}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                        on
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:bg-secondary/60",
                      )}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            onClick={addReminder}
            className="w-full py-2.5 rounded-2xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Add reminder
          </button>
        </div>
      )}
    </div>
  );
}

function NonDispatchDatesSection() {
  const [dates, setDates] = useState<string[]>([]);
  const [newDate, setNewDate] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/app-settings/non_dispatch_dates", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j?.value) { setLoaded(true); return; }
        try {
          const arr = JSON.parse(j.value);
          if (Array.isArray(arr)) {
            setDates(arr.filter((s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s)).sort());
          }
        } catch {}
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const persist = async (next: string[]) => {
    setSaving(true);
    try {
      const res = await fetch("/api/app-settings/non_dispatch_dates", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(next) }),
      });
      if (!res.ok) throw new Error("save failed");
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  const addDate = async () => {
    if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
    if (dates.includes(newDate)) { setNewDate(""); return; }
    const next = [...dates, newDate].sort();
    setDates(next);
    setNewDate("");
    await persist(next);
  };

  const removeDate = async (d: string) => {
    const next = dates.filter(x => x !== d);
    setDates(next);
    await persist(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" /> Non-dispatch days
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Bank holidays and factory shutdowns. Production plans created
            with a date adjacent to one of these days will correctly skip
            it when picking the "previous" / "next" dispatch — sales
            mapping won't roll into an empty Monday.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg text-sm"
          />
          <button
            onClick={addDate}
            disabled={saving || !loaded || !newDate}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add date
          </button>
        </div>
        {dates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No non-dispatch dates configured.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {dates.map(d => (
              <li key={d} className="flex items-center justify-between py-1.5">
                <span className="font-mono text-sm">{d}</span>
                <button
                  onClick={() => removeDate(d)}
                  disabled={saving}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1.5 -mr-1.5"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Per-day-of-week defaults for prep_date and dough_date offsets.
// Each value is the number of CALENDAR days the prep / dough day sits
// before production. 1 = previous day, 3 = three days back (e.g. Mon
// production → Fri prep). Sat dough for Mon production = 2.
function PrepDoughScheduleSection() {
  const DAYS = [
    { key: "monday", label: "Monday" },
    { key: "tuesday", label: "Tuesday" },
    { key: "wednesday", label: "Wednesday" },
    { key: "thursday", label: "Thursday" },
    { key: "friday", label: "Friday" },
  ];
  // These mirror DEFAULT_PREP_OFFSETS / DEFAULT_DOUGH_OFFSETS on the
  // backend — kept in sync so an unset row shows the in-effect default
  // rather than a blank field.
  const DEFAULT_PREP: Record<string, number> = { monday: 3, tuesday: 1, wednesday: 1, thursday: 1, friday: 1 };
  const DEFAULT_DOUGH: Record<string, number> = { monday: 2, tuesday: 1, wednesday: 1, thursday: 1, friday: 1 };

  const [prepOffsets, setPrepOffsets] = useState<Record<string, string>>({});
  const [doughOffsets, setDoughOffsets] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const fetches = DAYS.flatMap(d => [
        fetch(`/api/app-settings/prep_offset_days_${d.key}`, { credentials: "include" })
          .then(r => r.ok ? r.json() : null)
          .then(j => ({ kind: "prep" as const, day: d.key, value: j?.value ?? null })),
        fetch(`/api/app-settings/dough_offset_days_${d.key}`, { credentials: "include" })
          .then(r => r.ok ? r.json() : null)
          .then(j => ({ kind: "dough" as const, day: d.key, value: j?.value ?? null })),
      ]);
      const results = await Promise.all(fetches);
      const prepNext: Record<string, string> = {};
      const doughNext: Record<string, string> = {};
      for (const d of DAYS) {
        prepNext[d.key] = String(DEFAULT_PREP[d.key] ?? 1);
        doughNext[d.key] = String(DEFAULT_DOUGH[d.key] ?? 1);
      }
      for (const r of results) {
        if (r.value != null) {
          if (r.kind === "prep") prepNext[r.day] = String(r.value);
          else doughNext[r.day] = String(r.value);
        }
      }
      setPrepOffsets(prepNext);
      setDoughOffsets(doughNext);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const writes: Promise<Response>[] = [];
      for (const d of DAYS) {
        writes.push(fetch(`/api/app-settings/prep_offset_days_${d.key}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: String(Math.max(0, parseInt(prepOffsets[d.key] || "0", 10) || 0)) }),
        }));
        writes.push(fetch(`/api/app-settings/dough_offset_days_${d.key}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: String(Math.max(0, parseInt(doughOffsets[d.key] || "0", 10) || 0)) }),
        }));
      }
      const results = await Promise.all(writes);
      if (results.some(r => !r.ok)) throw new Error("Save failed");
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" /> Prep &amp; Dough Schedule
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            For each production day-of-week, how many calendar days earlier
            should prep and dough happen by default? E.g. Monday production
            with prep offset 3 = Friday, dough offset 2 = Saturday. Operators
            can override per-plan in the Create Plan dialog.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <th className="pb-2 pr-6">Production Day</th>
                <th className="pb-2 pr-6 text-center">Prep offset (days back)</th>
                <th className="pb-2 text-center">Dough offset (days back)</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map(d => (
                <tr key={d.key} className="border-t border-border/40">
                  <td className="py-2 pr-6 font-medium">{d.label}</td>
                  <td className="py-2 pr-6 text-center">
                    <input
                      type="number"
                      min="0"
                      max="14"
                      step="1"
                      value={prepOffsets[d.key] ?? ""}
                      onChange={e => setPrepOffsets(prev => ({ ...prev, [d.key]: e.target.value }))}
                      className="w-16 px-2 py-1.5 border border-border rounded-lg text-sm text-center"
                      onWheel={e => { if (document.activeElement === e.currentTarget) e.currentTarget.blur(); }}
                    />
                  </td>
                  <td className="py-2 text-center">
                    <input
                      type="number"
                      min="0"
                      max="14"
                      step="1"
                      value={doughOffsets[d.key] ?? ""}
                      onChange={e => setDoughOffsets(prev => ({ ...prev, [d.key]: e.target.value }))}
                      className="w-16 px-2 py-1.5 border border-border rounded-lg text-sm text-center"
                      onWheel={e => { if (document.activeElement === e.currentTarget) e.currentTarget.blur(); }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || !loaded}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save schedule
          </button>
        </div>
      </div>
    </div>
  );
}

function BreakDefaultsSection() {
  const [breakMins, setBreakMins] = useState<string>("15");
  const [lunchMins, setLunchMins] = useState<string>("35");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/app-settings/default_break_minutes", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.value) setBreakMins(d.value); }),
      fetch("/api/app-settings/default_lunch_minutes", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.value) setLunchMins(d.value); }),
    ]).finally(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    const b = Number(breakMins);
    const l = Number(lunchMins);
    if (!b || b <= 0 || !l || l <= 0) return;
    setSaving(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/app-settings/default_break_minutes", {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: String(b) }),
        }),
        fetch("/api/app-settings/default_lunch_minutes", {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: String(l) }),
        }),
      ]);
      if (!r1.ok || !r2.ok) throw new Error("Failed to save");
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Coffee className="w-4 h-4 text-primary" /> Break Durations
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Set the allowed duration for snack breaks and lunch breaks. These apply to all stations simultaneously — tracked against actual time in reports.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium w-36">Snack Break</label>
            <input
              type="number"
              min="1"
              max="120"
              step="1"
              value={breakMins}
              onChange={e => setBreakMins(e.target.value)}
              className="w-20 px-3 py-2 border border-border rounded-lg text-sm text-right"
            />
            <span className="text-sm text-muted-foreground">min</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium w-36">Lunch Break</label>
            <input
              type="number"
              min="1"
              max="120"
              step="1"
              value={lunchMins}
              onChange={e => setLunchMins(e.target.value)}
              className="w-20 px-3 py-2 border border-border rounded-lg text-sm text-right"
            />
            <span className="text-sm text-muted-foreground">min</span>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !loaded}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/** Defaults that drive the day's production-schedule timeline: the building
 *  start time and the changeover gap between recipes. The schedule reads these
 *  to predict each recipe's start/finish and each meat's cook-start time. */
function ScheduleDefaultsSection() {
  const [startTime, setStartTime] = useState<string>("07:00");
  const [changeoverSecs, setChangeoverSecs] = useState<string>("90");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/app-settings/building_start_time", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.value) setStartTime(d.value); }),
      fetch("/api/app-settings/changeover_seconds", { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.value) setChangeoverSecs(d.value); }),
    ]).finally(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    const secs = Number(changeoverSecs);
    if (!/^\d{1,2}:\d{2}$/.test(startTime) || !Number.isFinite(secs) || secs < 0) return;
    setSaving(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/app-settings/building_start_time", {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: startTime }),
        }),
        fetch("/api/app-settings/changeover_seconds", {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: String(secs) }),
        }),
      ]);
      if (!r1.ok || !r2.ok) throw new Error("Failed to save");
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> Day Schedule
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            When the building line starts each day and how long a changeover takes between recipes. These drive the predicted start/finish and meat cook-start times on each plan's day schedule.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium w-36">Building start</label>
            <input
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg text-sm tabular-nums"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium w-36">Changeover</label>
            <input
              type="number"
              min="0"
              max="600"
              step="5"
              value={changeoverSecs}
              onChange={e => setChangeoverSecs(e.target.value)}
              className="w-24 px-3 py-2 border border-border rounded-lg text-sm text-right"
            />
            <span className="text-sm text-muted-foreground">sec</span>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !loaded}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/** Edits the 12 rolling lean lessons that drive the Morning Meeting
 *  Learning slide. Each lesson has three markdown blocks the host walks
 *  through in prep mode before they present. Admin-only. */
function LeanCurriculumSection() {
  interface Lesson {
    id: number;
    weekNumber: number;
    title: string;
    summary: string;
    explanationMd: string;
    whatToShowMd: string;
    deliveryNotesMd: string;
    videoUrl: string | null;
    isActive: boolean;
  }
  const queryClient = useQueryClient();
  const { data: lessons = [], isLoading } = useQuery<Lesson[]>({
    queryKey: ["lean-lessons"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/morning-meetings/lessons`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load lessons");
      return res.json();
    },
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Lesson>>({});
  const editing = lessons.find(l => l.id === editingId) ?? null;

  const startEdit = (l: Lesson) => {
    setEditingId(l.id);
    setDraft({
      title: l.title,
      summary: l.summary,
      explanationMd: l.explanationMd,
      whatToShowMd: l.whatToShowMd,
      deliveryNotesMd: l.deliveryNotesMd,
      videoUrl: l.videoUrl,
      isActive: l.isActive,
    });
  };
  const cancel = () => { setEditingId(null); setDraft({}); };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editingId) return;
      const res = await fetch(`${BASE}/api/morning-meetings/lessons/${editingId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error("Save failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lean-lessons"] });
      cancel();
      toast({ title: "Lesson saved" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="text-xl font-semibold mb-1 flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-purple-500" />
        Lean Curriculum (Morning Meeting)
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Twelve rolling lessons that drive the Morning Meeting&apos;s Learning slide. Today&apos;s lesson
        is picked by week-of-year, so the curriculum cycles automatically.
        Each lesson has three blocks: what it means, what the team sees, and how to deliver it.
      </p>
      {isLoading ? (
        <div className="py-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
      ) : (
        <div className="space-y-2">
          {lessons.map(l => (
            <div key={l.id} className="border border-border rounded-xl">
              <button
                onClick={() => editingId === l.id ? cancel() : startEdit(l)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/30"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-semibold text-muted-foreground tabular-nums w-12 shrink-0">Wk {l.weekNumber}</span>
                  <div className="text-left min-w-0">
                    <p className="font-medium truncate">{l.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{l.summary}</p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 ml-3">{editingId === l.id ? "Cancel" : "Edit"}</span>
              </button>
              {editing && editing.id === l.id && (
                <div className="px-4 pb-4 space-y-3 border-t border-border">
                  <LessonField label="Title" value={draft.title ?? ""} onChange={v => setDraft(d => ({ ...d, title: v }))} />
                  <LessonField label="Summary (one-liner)" value={draft.summary ?? ""} onChange={v => setDraft(d => ({ ...d, summary: v }))} />
                  <LessonField label="What it means (host briefing — Markdown)" value={draft.explanationMd ?? ""} onChange={v => setDraft(d => ({ ...d, explanationMd: v }))} multiline />
                  <LessonField label="What you'll show the team (slide content — Markdown)" value={draft.whatToShowMd ?? ""} onChange={v => setDraft(d => ({ ...d, whatToShowMd: v }))} multiline />
                  <LessonField label="How to deliver (talking points — Markdown)" value={draft.deliveryNotesMd ?? ""} onChange={v => setDraft(d => ({ ...d, deliveryNotesMd: v }))} multiline />
                  <LessonField label="Video URL (optional)" value={draft.videoUrl ?? ""} onChange={v => setDraft(d => ({ ...d, videoUrl: v || null }))} />
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button onClick={cancel} className="px-4 py-2 rounded-lg text-sm border border-border hover:bg-secondary/30">Cancel</button>
                    <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                      {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LessonField({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full min-h-[120px] bg-background border border-border rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      ) : (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      )}
    </div>
  );
}

function StandardsSopsSection() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="text-xl font-semibold mb-1 flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-primary" />
        Standards &amp; SOPs
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Manage the multi-step standards and SOPs that show up on each station. Create new SOPs,
        edit existing ones, tag them to multiple stations, or delete old ones.
      </p>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
      >
        <BookOpen className="w-4 h-4" /> Open SOP library
      </button>
      <StandardsSopsDialog open={open} onClose={() => setOpen(false)} currentStationType={null} />
    </div>
  );
}

function QuickIdeaTabsSection() {
  const [tabs, setTabs] = useState({ kanban: true, idea: true, struggle: true, issue: true, ai: true });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/app-settings/quick_idea_tabs", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.value) { try { setTabs(prev => ({ ...prev, ...JSON.parse(d.value) })); } catch {} } })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const handleToggle = async (key: keyof typeof tabs) => {
    const updated = { ...tabs, [key]: !tabs[key] };
    setTabs(updated);
    setSaving(true);
    try {
      const r = await fetch("/api/app-settings/quick_idea_tabs", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(updated) }),
      });
      if (!r.ok) throw new Error("Failed to save");
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setTabs(tabs); // revert
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  const items: { key: keyof typeof tabs; label: string }[] = [
    { key: "kanban", label: "Pull Kanban" },
    { key: "idea", label: "Improvement Idea" },
    { key: "struggle", label: "Struggle" },
    { key: "issue", label: "Issue" },
    { key: "ai", label: "Ask AI" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <CircleDot className="w-4 h-4 text-blue-500" /> Quick Idea Tabs
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Toggle which tabs appear in the Quick Idea modal (blue button, bottom-right of every page).
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="space-y-3">
        {items.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-4 p-4 bg-card border border-border rounded-xl">
            <span className="text-sm font-semibold">{label}</span>
            <Switch
              checked={tabs[key]}
              onCheckedChange={() => handleToggle(key)}
              disabled={!loaded || saving}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardBannerRolesSection() {
  const DEFAULT_ROLES: Record<string, boolean> = {
    admin: true,
    manager: false,
    employee: false,
    viewer: false,
  };
  const [roles, setRoles] = useState<Record<string, boolean>>(DEFAULT_ROLES);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/app-settings/dashboard_issue_banner_roles", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.value) { try { setRoles(prev => ({ ...prev, ...JSON.parse(d.value) })); } catch {} } })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const handleToggle = async (key: string) => {
    const updated = { ...roles, [key]: !roles[key] };
    const prev = roles;
    setRoles(updated);
    setSaving(true);
    try {
      const r = await fetch("/api/app-settings/dashboard_issue_banner_roles", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(updated) }),
      });
      if (!r.ok) throw new Error("Failed to save");
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setRoles(prev);
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  const items: { key: string; label: string }[] = [
    { key: "admin", label: "Admin" },
    { key: "manager", label: "Manager" },
    { key: "employee", label: "Employee" },
    { key: "viewer", label: "Viewer" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" /> Dashboard Issue Banner
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Choose which roles see the unacknowledged-issues banner at the top of the dashboard.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="space-y-3">
        {items.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-4 p-4 bg-card border border-border rounded-xl">
            <span className="text-sm font-semibold capitalize">{label}</span>
            <Switch
              checked={!!roles[key]}
              onCheckedChange={() => handleToggle(key)}
              disabled={!loaded || saving}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function EightPackBannerRolesSection() {
  const DEFAULT_ROLES: Record<string, boolean> = {
    admin: true,
    manager: true,
    employee: false,
    viewer: false,
  };
  const [roles, setRoles] = useState<Record<string, boolean>>(DEFAULT_ROLES);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/app-settings/dashboard_8pack_banner_roles", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.value) { try { setRoles(prev => ({ ...prev, ...JSON.parse(d.value) })); } catch {} } })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const handleToggle = async (key: string) => {
    const updated = { ...roles, [key]: !roles[key] };
    const prev = roles;
    setRoles(updated);
    setSaving(true);
    try {
      const r = await fetch("/api/app-settings/dashboard_8pack_banner_roles", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(updated) }),
      });
      if (!r.ok) throw new Error("Failed to save");
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    } catch {
      setRoles(prev);
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  const items: { key: string; label: string }[] = [
    { key: "admin", label: "Admin" },
    { key: "manager", label: "Manager" },
    { key: "employee", label: "Employee" },
    { key: "viewer", label: "Viewer" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-500" /> 8-Pack Orders Banner
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Choose which roles see the "orders with 8-pack bags to process" banner on the dashboard.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="space-y-3">
        {items.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-4 p-4 bg-card border border-border rounded-xl">
            <span className="text-sm font-semibold capitalize">{label}</span>
            <Switch
              checked={!!roles[key]}
              onCheckedChange={() => handleToggle(key)}
              disabled={!loaded || saving}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

interface SysUpdate { id: number; title: string | null; body: string; published: boolean; createdAt: string; updatedAt: string; }

function SystemUpdatesSection() {
  const [entries, setEntries] = useState<SysUpdate[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const load = () => fetch(`${BASE}/api/system-updates/admin`, { credentials: "include" })
    .then(r => (r.ok ? r.json() : []))
    .then(setEntries)
    .catch(() => setEntries([]));
  useEffect(() => { load(); }, []);

  const bullets = (b: string) => b.split("\n").map(l => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);

  const add = async () => {
    if (!body.trim()) { setMsg("Add at least one bullet"); setTimeout(() => setMsg(null), 2000); return; }
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/system-updates`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || null, body }),
      });
      if (!r.ok) throw new Error();
      setTitle(""); setBody(""); setMsg("Added"); setTimeout(() => setMsg(null), 2000); load();
    } catch { setMsg("Error saving"); setTimeout(() => setMsg(null), 2000); } finally { setSaving(false); }
  };

  const saveEdit = async (id: number) => {
    await fetch(`${BASE}/api/system-updates/${id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle.trim() || null, body: editBody }),
    });
    setEditingId(null); load();
  };
  const togglePublished = async (e: SysUpdate) => {
    await fetch(`${BASE}/api/system-updates/${e.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: !e.published }),
    });
    load();
  };
  const remove = async (id: number) => {
    if (!confirm("Delete this update?")) return;
    await fetch(`${BASE}/api/system-updates/${id}`, { method: "DELETE", credentials: "include" });
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-primary" /> System Updates
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Bulleted changes shown on the morning-meeting "System Updates" slide. The most recent published entry is displayed. One bullet per line.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Title (optional, e.g. 11 Jun 2026)"
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={5}
          placeholder={"One bullet per line, e.g.\nPacking is now a single screen\nSOPs can be printed to PDF for the factory wall"}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
        />
        <div className="flex items-center gap-3">
          <button onClick={add} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50">
            <Plus className="w-4 h-4" /> Add update
          </button>
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        </div>
      </div>

      {entries === null ? (
        <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No updates yet.</p>
      ) : (
        <div className="space-y-3">
          {entries.map(e => (
            <div key={e.id} className="bg-card border border-border rounded-xl p-4">
              {editingId === e.id ? (
                <div className="space-y-2">
                  <input value={editTitle} onChange={ev => setEditTitle(ev.target.value)} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
                  <textarea value={editBody} onChange={ev => setEditBody(ev.target.value)} rows={5} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm" />
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(e.id)} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm">Save</button>
                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 border border-border rounded-lg text-sm">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{e.title || "(untitled)"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        {e.published ? "" : " · hidden"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch checked={e.published} onCheckedChange={() => togglePublished(e)} />
                      <button onClick={() => { setEditingId(e.id); setEditTitle(e.title || ""); setEditBody(e.body); }} className="p-1.5 text-muted-foreground hover:text-foreground"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => remove(e.id)} className="p-1.5 text-red-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
                    {bullets(e.body).map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApcServiceCodesSection() {
  const [codes, setCodes] = useState({
    smallWeekday: "",
    largeWeekday: "",
    smallFriday: "",
    largeFriday: "",
    weightThreshold: "1000",
  });
  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [testModeToggling, setTestModeToggling] = useState(false);
  const [testModeError, setTestModeError] = useState(false);
  const [apcMode, setApcMode] = useState<"off" | "reconcile" | "full">("off");
  const [apcModeSaving, setApcModeSaving] = useState(false);
  const [apcModeError, setApcModeError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/app-settings/apc_service_code_small_weekday`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_service_code_large_weekday`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_service_code_small_friday`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_service_code_large_friday`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_weight_threshold_grams`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_test_mode`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_mode`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_enabled`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
    ]).then(([sw, lw, sf, lf, wt, tm, mode, legacyEnabled]) => {
      setCodes({
        smallWeekday: sw?.value ?? "",
        largeWeekday: lw?.value ?? "",
        smallFriday: sf?.value ?? "",
        largeFriday: lf?.value ?? "",
        weightThreshold: wt?.value ?? "1000",
      });
      setTestMode(tm?.value === "true");
      // Mirror the server's resolution order: apc_mode wins, else derive from
      // the legacy apc_enabled boolean.
      const raw = mode?.value;
      if (raw === "off" || raw === "reconcile" || raw === "full") setApcMode(raw);
      else setApcMode(legacyEnabled?.value === "false" ? "off" : "full");
    }).catch(() => {
      // Leave defaults if fetch fails
    }).finally(() => setFetching(false));
  }, []);

  const handleApcModeChange = async (next: "off" | "reconcile" | "full") => {
    if (next === apcMode) return;
    setApcModeSaving(true);
    setApcModeError(false);
    try {
      const r = await fetch(`${BASE}/api/app-settings/apc_mode`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: next }),
      });
      if (!r.ok) throw new Error("Failed to save courier mode");
      setApcMode(next);
      // Keep the legacy boolean consistent so any code path still reading
      // apc_enabled agrees with the mode.
      await fetch(`${BASE}/api/app-settings/apc_enabled`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: String(next !== "off") }),
      }).catch(() => { /* non-fatal — apc_mode is the source of truth */ });
    } catch {
      setApcModeError(true);
      setTimeout(() => setApcModeError(false), 3000);
    } finally {
      setApcModeSaving(false);
    }
  };

  const handleTestModeToggle = async () => {
    const newValue = !testMode;
    setTestModeToggling(true);
    setTestModeError(false);
    try {
      const r = await fetch(`${BASE}/api/app-settings/apc_test_mode`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: String(newValue) }),
      });
      if (!r.ok) throw new Error("Failed to save test mode");
      setTestMode(newValue);
    } catch {
      setTestModeError(true);
      setTimeout(() => setTestModeError(false), 3000);
    } finally {
      setTestModeToggling(false);
    }
  };

  const handleSave = async () => {
    // Client-side validation before saving
    const serviceCodes = [codes.smallWeekday, codes.largeWeekday, codes.smallFriday, codes.largeFriday];
    if (serviceCodes.some(c => !c.trim())) {
      setSavedMsg("Error: all 4 service codes are required");
      setTimeout(() => setSavedMsg(null), 3000);
      return;
    }
    const threshold = Number(codes.weightThreshold);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      setSavedMsg("Error: weight threshold must be a positive number");
      setTimeout(() => setSavedMsg(null), 3000);
      return;
    }

    setSaving(true);
    try {
      const pairs = [
        ["apc_service_code_small_weekday", codes.smallWeekday],
        ["apc_service_code_large_weekday", codes.largeWeekday],
        ["apc_service_code_small_friday", codes.smallFriday],
        ["apc_service_code_large_friday", codes.largeFriday],
        ["apc_weight_threshold_grams", codes.weightThreshold],
      ];
      await Promise.all(pairs.map(([key, value]) =>
        fetch(`${BASE}/api/app-settings/${key}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        }).then(r => { if (!r.ok) throw new Error(`Failed to save ${key}`); })
      ));
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2500);
    } catch {
      setSavedMsg("Error saving");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Truck className="w-4 h-4 text-primary" /> APC Service Codes
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure the 4 APC service codes used for fulfilment. Service code is chosen automatically based on box size and dispatch day.
          </p>
        </div>
        {savedMsg && <span className={`text-xs font-medium ${savedMsg.startsWith("Error") ? "text-destructive" : "text-green-600"}`}>{savedMsg}</span>}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        {fetching && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Loading saved values…</div>}

        {/* Courier mode — the switch that decides how the packing station gets
            a tracking number. Kept above the service codes because those only
            matter in "full" mode. */}
        <div className="p-4 rounded-xl border-2 border-border bg-secondary/20 space-y-3">
          <div>
            <p className="font-semibold text-sm">Courier Mode</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              How the packing station gets a tracking number onto the Shopify order.
            </p>
            {apcModeError && <p className="text-xs text-destructive mt-1 font-medium">Failed to save — please try again.</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {([
              { id: "off", label: "Off", detail: "No courier integration. Orders are fulfilled with no tracking number." },
              { id: "reconcile", label: "Label scan", detail: "Consignments booked by hand in Hypaship. Scan each printed label to verify it, then its tracking number goes to Shopify." },
              { id: "full", label: "Full API", detail: "The app books consignments and prints labels itself. Needs the 4 service codes below." },
            ] as const).map(opt => {
              const active = apcMode === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleApcModeChange(opt.id)}
                  disabled={apcModeSaving}
                  className={`text-left p-3 rounded-xl border-2 transition-colors disabled:opacity-50 ${
                    active ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-secondary/40"
                  }`}
                >
                  <span className="text-sm font-semibold flex items-center gap-1.5">
                    {active && <Check className="w-3.5 h-3.5 text-primary" />}
                    {opt.label}
                  </span>
                  <span className="block text-xs text-muted-foreground mt-1">{opt.detail}</span>
                </button>
              );
            })}
          </div>
          {apcMode === "reconcile" && (
            <p className="text-xs text-muted-foreground">
              Note: APC Test Mode below does not affect label scanning — consignment lookups always
              use the live account, because that's where hand-raised consignments exist.
            </p>
          )}
        </div>

        {/* APC Test Mode toggle */}
        <div className={`flex items-center justify-between p-4 rounded-xl border-2 transition-colors ${testMode ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : "border-border bg-secondary/20"}`}>
          <div>
            <p className="font-semibold text-sm flex items-center gap-2">
              {testMode && <span className="text-amber-600">⚠</span>}
              APC Test Mode
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {testMode
                ? "ON — all APC calls go to the Hypaship training environment. No real consignments are booked."
                : "OFF — live APC API is used. Real consignments and charges apply."}
            </p>
            {testModeError && (
              <p className="text-xs text-destructive mt-1 font-medium">Failed to save — please try again.</p>
            )}
          </div>
          <button
            onClick={handleTestModeToggle}
            disabled={testModeToggling}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${testMode ? "bg-amber-500" : "bg-secondary border border-border"}`}
            role="switch"
            aria-checked={testMode}
            title={testMode ? "Click to disable test mode" : "Click to enable test mode"}
          >
            {testModeToggling && <Loader2 className="absolute inset-0 m-auto w-3.5 h-3.5 animate-spin text-white" />}
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${testMode ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Small Box — Weekday</label>
              <input
                className={inputCls + " w-full"}
                placeholder="e.g. SWD01"
                value={codes.smallWeekday}
                onChange={e => setCodes(c => ({ ...c, smallWeekday: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">Standard small parcel, Mon–Thu delivery</p>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Large Box — Weekday</label>
              <input
                className={inputCls + " w-full"}
                placeholder="e.g. LWD01"
                value={codes.largeWeekday}
                onChange={e => setCodes(c => ({ ...c, largeWeekday: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">Large parcel, Mon–Thu delivery</p>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Small Box — Friday/Weekend</label>
              <input
                className={inputCls + " w-full"}
                placeholder="e.g. SFR01"
                value={codes.smallFriday}
                onChange={e => setCodes(c => ({ ...c, smallFriday: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">Small parcel, Friday/weekend delivery</p>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Large Box — Friday/Weekend</label>
              <input
                className={inputCls + " w-full"}
                placeholder="e.g. LFR01"
                value={codes.largeFriday}
                onChange={e => setCodes(c => ({ ...c, largeFriday: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">Large parcel, Friday/weekend delivery</p>
            </div>
          </div>

          <div className="border-t border-border pt-4 flex items-center gap-4">
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Large Box Threshold (grams)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="100"
                  step="100"
                  className={inputCls + " w-28 text-right"}
                  value={codes.weightThreshold}
                  onChange={e => setCodes(c => ({ ...c, weightThreshold: e.target.value }))}
                />
                <span className="text-sm text-muted-foreground">g</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Orders at or above this weight are treated as large-box</p>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-border">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Save Service Codes
            </button>
          </div>

          <div className="bg-secondary/30 rounded-xl p-4 text-xs space-y-2">
            <p className="font-semibold text-sm">Chrome Kiosk Printing Setup</p>
            <p className="text-muted-foreground">
              For silent label printing on the dispatch PC, create a Chrome shortcut with the{" "}
              <code className="bg-secondary px-1 py-0.5 rounded font-mono">--kiosk-printing</code> flag.
            </p>
            <p className="font-mono text-muted-foreground bg-background px-3 py-2 rounded-lg">
              "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing
            </p>
            <p className="text-muted-foreground">
              Without this flag, Chrome will show a print dialog for each label instead of printing silently.
            </p>
          </div>
        </div>
    </div>
  );
}

const ROLE_OPTIONS: { value: "viewer" | "manager" | "admin"; label: string; color: string }[] = [
  { value: "viewer", label: "Viewer", color: "text-blue-600" },
  { value: "manager", label: "Manager", color: "text-amber-600" },
  { value: "admin", label: "Admin", color: "text-red-600" },
];

function AccessControlSection() {
  const { permissions, isLoading } = usePagePermissions();
  const savePermissions = useSavePagePermissions();
  const [draft, setDraft] = useState<Record<string, "viewer" | "manager" | "admin">>({});
  const [saved, setSaved] = useState(false);

  const effective = (pageKey: string): "viewer" | "manager" | "admin" => {
    if (pageKey in draft) return draft[pageKey];
    return permissions.find(p => p.pageKey === pageKey)?.minRole ?? "viewer";
  };

  const handleChange = (pageKey: string, value: "viewer" | "manager" | "admin") => {
    setSaved(false);
    setDraft(d => ({ ...d, [pageKey]: value }));
  };

  const handleSave = () => {
    const updates = permissions.map(p => ({
      pageKey: p.pageKey,
      minRole: effective(p.pageKey),
    }));
    savePermissions.mutate(updates, {
      onSuccess: () => {
        setDraft({});
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      },
    });
  };

  const isDirty = Object.keys(draft).length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" /> Page Access Control
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Set the minimum role required to view each page. Admins always have full access.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || savePermissions.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-2 flex-shrink-0"
        >
          {savePermissions.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
          {savePermissions.isPending ? "Saving…" : saved ? "Saved" : "Save Changes"}
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-muted-foreground text-xs">
              <tr>
                <th className="px-5 py-3 font-medium text-left">Page</th>
                <th className="px-5 py-3 font-medium text-left">Minimum Role Required</th>
                <th className="px-5 py-3 font-medium text-left">Who can see it</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {permissions.map(p => {
                const current = effective(p.pageKey);
                const changed = p.pageKey in draft;
                const whoCanSee =
                  current === "viewer" ? "Viewer, Manager, Admin" :
                  current === "manager" ? "Manager, Admin" :
                  "Admin only";
                return (
                  <tr key={p.pageKey} className={`transition-colors ${changed ? "bg-primary/5" : "hover:bg-secondary/10"}`}>
                    <td className="px-5 py-3.5">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">{p.pageKey}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-2">
                        {ROLE_OPTIONS.map(r => (
                          <button
                            key={r.value}
                            type="button"
                            onClick={() => handleChange(p.pageKey, r.value)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all ${
                              current === r.value
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:border-border/60 hover:bg-secondary/30"
                            }`}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground text-xs">{whoCanSee}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type StorageLocationRow = {
  id: number;
  name: string;
  zone: string;
  isSystem: boolean;
  createdAt: string;
  racks: { id: number; locationId: number; label: string }[];
};

const ZONE_LABELS: Record<string, string> = { fridge: "Fridge", freezer: "Freezer", ambient: "Ambient / Dry" };
const ZONE_COLORS: Record<string, string> = { fridge: "bg-blue-50 text-blue-700", freezer: "bg-indigo-50 text-indigo-700", ambient: "bg-amber-50 text-amber-700" };

function StorageLocationsSection() {
  const queryClient = useQueryClient();
  const [addName, setAddName] = useState("");
  const [addZone, setAddZone] = useState("fridge");
  const [rackInputs, setRackInputs] = useState<Record<number, string>>({});

  const { data: locations, isLoading } = useQuery<StorageLocationRow[]>({
    queryKey: ["/api/storage-locations"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/storage-locations`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; zone: string }) => {
      const res = await fetch(`${BASE}/api/storage-locations`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Create failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/storage-locations"] }); setAddName(""); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/storage-locations/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Delete failed");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/storage-locations"] }); },
  });

  const addRackMutation = useMutation({
    mutationFn: async (data: { locationId: number; label: string }) => {
      const res = await fetch(`${BASE}/api/storage-locations/racks`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to add rack");
      return res.json();
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage-locations"] });
      setRackInputs(prev => ({ ...prev, [vars.locationId]: "" }));
    },
  });

  const deleteRackMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/storage-locations/racks/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete rack");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/storage-locations"] }); },
  });

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-5 border-b border-border bg-secondary/20 flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Warehouse className="w-5 h-5 text-primary" /> Storage Locations</h2>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-sm font-medium mb-1 block">Location Name</label>
            <input
              value={addName}
              onChange={e => setAddName(e.target.value)}
              placeholder="e.g. Walk-in Chiller"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Zone</label>
            <select
              value={addZone}
              onChange={e => setAddZone(e.target.value)}
              className="px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="fridge">Fridge</option>
              <option value="freezer">Freezer</option>
              <option value="ambient">Ambient / Dry</option>
            </select>
          </div>
          <button
            onClick={() => addName.trim() && createMutation.mutate({ name: addName.trim(), zone: addZone })}
            disabled={!addName.trim() || createMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Add
          </button>
        </div>

        {isLoading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !locations?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No storage locations configured yet.</p>
        ) : (
          <div className="space-y-3">
            {locations.map(loc => (
              <div key={loc.id} className="border border-border rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-sm">{loc.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ZONE_COLORS[loc.zone] ?? "bg-gray-50 text-gray-600"}`}>
                      {ZONE_LABELS[loc.zone] ?? loc.zone}
                    </span>
                    {loc.isSystem && <span className="text-xs text-muted-foreground italic">System</span>}
                  </div>
                  {!loc.isSystem && (
                    <button
                      onClick={() => { if (confirm(`Delete "${loc.name}"?`)) deleteMutation.mutate(loc.id); }}
                      className="p-1.5 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {loc.racks.map(rack => (
                    <span key={rack.id} className="inline-flex items-center gap-1 text-xs bg-secondary/50 px-2 py-1 rounded-lg">
                      {rack.label}
                      <button onClick={() => deleteRackMutation.mutate(rack.id)} className="text-muted-foreground hover:text-destructive ml-0.5">
                        <XCircle className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <div className="inline-flex items-center gap-1">
                    <input
                      value={rackInputs[loc.id] ?? ""}
                      onChange={e => setRackInputs(prev => ({ ...prev, [loc.id]: e.target.value }))}
                      placeholder="Add shelf/rack..."
                      className="w-28 px-2 py-1 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
                      onKeyDown={e => {
                        if (e.key === "Enter" && rackInputs[loc.id]?.trim()) {
                          addRackMutation.mutate({ locationId: loc.id, label: rackInputs[loc.id].trim() });
                        }
                      }}
                    />
                    <button
                      onClick={() => rackInputs[loc.id]?.trim() && addRackMutation.mutate({ locationId: loc.id, label: rackInputs[loc.id].trim() })}
                      disabled={!rackInputs[loc.id]?.trim()}
                      className="p-1 text-primary hover:bg-primary/10 rounded disabled:opacity-30"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type IngredientAssignment = {
  id: number;
  ingredientId: number;
  locationId: number;
  rackLabel: string | null;
  shelfLabel: string | null;
};

function IngredientStorageAssignmentsSection() {
  const queryClient = useQueryClient();
  const { data: ingredients } = useListIngredients();
  const { data: locations } = useQuery<StorageLocationRow[]>({
    queryKey: ["/api/storage-locations"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/storage-locations`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
  const { data: assignments, isLoading } = useQuery<IngredientAssignment[]>({
    queryKey: ["/api/storage-locations/ingredient-assignments"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/storage-locations/ingredient-assignments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const [selIngredient, setSelIngredient] = useState<number | "">("");
  const [selLocation, setSelLocation] = useState<number | "">("");
  const [selRack, setSelRack] = useState("");
  const [selShelf, setSelShelf] = useState("");

  const addMutation = useMutation({
    mutationFn: async (data: { ingredientId: number; locationId: number; rackLabel: string | null; shelfLabel: string | null }) => {
      const existing = assignments?.find(a => a.ingredientId === data.ingredientId && a.locationId === data.locationId);
      if (existing) throw new Error("This ingredient is already assigned to this location");
      const res = await fetch(`${BASE}/api/storage-locations/ingredient-assignments`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to assign");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storage-locations/ingredient-assignments"] });
      setSelIngredient("");
      setSelLocation("");
      setSelRack("");
      setSelShelf("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/storage-locations/ingredient-assignments/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/storage-locations/ingredient-assignments"] }); },
  });

  const ingredientName = (id: number) => (ingredients as { id: number; name: string }[] | undefined)?.find(i => i.id === id)?.name ?? `#${id}`;
  const locationName = (id: number) => locations?.find(l => l.id === id)?.name ?? `#${id}`;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-5 border-b border-border bg-secondary/20">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Package className="w-5 h-5 text-primary" /> Ingredient Default Locations</h2>
        <p className="text-xs text-muted-foreground mt-1">Assign where each ingredient is normally stored (location, rack/shelf label).</p>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <label className="text-sm font-medium mb-1 block">Ingredient</label>
            <select
              value={selIngredient}
              onChange={e => setSelIngredient(e.target.value ? Number(e.target.value) : "")}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Select ingredient…</option>
              {(ingredients as { id: number; name: string }[] | undefined)?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-sm font-medium mb-1 block">Location</label>
            <select
              value={selLocation}
              onChange={e => setSelLocation(e.target.value ? Number(e.target.value) : "")}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Select location…</option>
              {locations?.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="w-24">
            <label className="text-sm font-medium mb-1 block">Rack</label>
            <input
              value={selRack}
              onChange={e => setSelRack(e.target.value)}
              placeholder="e.g. A1"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <div className="w-24">
            <label className="text-sm font-medium mb-1 block">Shelf</label>
            <input
              value={selShelf}
              onChange={e => setSelShelf(e.target.value)}
              placeholder="e.g. Top"
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={() => selIngredient && selLocation && addMutation.mutate({
              ingredientId: Number(selIngredient),
              locationId: Number(selLocation),
              rackLabel: selRack.trim() || null,
              shelfLabel: selShelf.trim() || null,
            })}
            disabled={!selIngredient || !selLocation || addMutation.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {addMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Assign
          </button>
        </div>

        {isLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !assignments?.length ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No ingredient storage assignments yet.</p>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Ingredient</th>
                  <th className="text-left px-4 py-2 font-medium">Location</th>
                  <th className="text-left px-4 py-2 font-medium">Rack</th>
                  <th className="text-left px-4 py-2 font-medium">Shelf</th>
                  <th className="w-10 px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {assignments.map(a => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-4 py-2">{ingredientName(a.ingredientId)}</td>
                    <td className="px-4 py-2">{locationName(a.locationId)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{a.rackLabel || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{a.shelfLabel || "—"}</td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => deleteMutation.mutate(a.id)}
                        className="p-1 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
