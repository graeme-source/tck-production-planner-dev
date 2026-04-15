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
  Lock, Timer, BarChart2, Coffee, Truck, Mail, Warehouse,
  Camera, User, CircleDot, ToggleRight, Boxes, UtensilsCrossed,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
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

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["admin", "manager", "viewer"]),
  isActive: z.boolean(),
});

const editSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email required"),
  password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal("")),
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
            placeholder={mode === "edit" ? "Enter new password to change..." : "Min. 6 characters"}
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

type SettingsSection = "profile" | "team" | "production" | "storage" | "features";

const NAV_ITEMS: { id: SettingsSection; label: string; icon: typeof User }[] = [
  { id: "profile", label: "My Profile", icon: User },
  { id: "team", label: "Team & Access", icon: Users },
  { id: "production", label: "Production", icon: BarChart2 },
  { id: "storage", label: "Storage & Inventory", icon: Warehouse },
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
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "manager" | "viewer">("viewer");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ url: string; email: string } | null>(null);

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
      else { setInviteResult({ url: data.inviteUrl, email: data.email }); }
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
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm font-medium">Invite created for {inviteResult.email}</p>
                </div>
                {!import.meta.env.VITE_EMAIL_ENABLED && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Email not yet connected — share this link manually:</p>
                    <div className="bg-secondary/50 rounded-lg p-3 break-all text-xs font-mono select-all border border-border">
                      {inviteResult.url}
                    </div>
                    <button
                      onClick={() => { navigator.clipboard.writeText(inviteResult.url); toast({ title: "Link copied!" }); }}
                      className="text-xs text-primary hover:underline mt-1"
                    >
                      Copy link
                    </button>
                  </div>
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
  const validSections: SettingsSection[] = ["profile", "team", "production", "storage", "features"];
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
              <div ref={dptRef}>
                {user?.role === "admin" && <DptSettingsSection />}
                {user?.role === "admin" && <MacCheeseSettingsSection />}
              </div>
              {user?.role === "admin" && <FactoryNumberSection />}
              {(user?.role === "admin" || user?.role === "manager") && <BuildingTimerSection />}
              {user?.role === "admin" && <TimingStandardsSection />}
              {user?.role === "admin" && <MixerCapacitySection />}
              {user?.role === "admin" && <ProductionExtrasSection />}
              {user?.role === "admin" && <ExtraTomatoBaseSection />}
              {user?.role === "admin" && <BreakDefaultsSection />}
              {user?.role === "admin" && <ApcServiceCodesSection />}
            </div>
          )}

          {activeSection === "features" && user?.role === "admin" && (
            <div className="space-y-8">
              <FeaturesSection />
              <QuickIdeaTabsSection />
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
            <input
              type="number"
              min={0}
              value={totalDailyBatches}
              onChange={e => setTotalDailyBatches(Math.max(0, Number(e.target.value) || 0))}
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
                        <input
                          type="number"
                          min={0}
                          value={sold}
                          onChange={e => setLocalPacksSold(prev => ({ ...prev, [recipe.id]: Math.max(0, Number(e.target.value) || 0) }))}
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
                  <input
                    type="number"
                    min={0}
                    value={extras[recipe.id] ?? 5}
                    onChange={e => setExtras(prev => ({ ...prev, [recipe.id]: Math.max(0, Number(e.target.value) || 0) }))}
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

function BreakDefaultsSection() {
  const [breakMins, setBreakMins] = useState<string>("15");
  const [lunchMins, setLunchMins] = useState<string>("45");
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

function QuickIdeaTabsSection() {
  const [tabs, setTabs] = useState({ kanban: true, idea: true, struggle: true, issue: true });
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

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/app-settings/apc_service_code_small_weekday`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_service_code_large_weekday`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_service_code_small_friday`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_service_code_large_friday`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_weight_threshold_grams`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/app-settings/apc_test_mode`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
    ]).then(([sw, lw, sf, lf, wt, tm]) => {
      setCodes({
        smallWeekday: sw?.value ?? "",
        largeWeekday: lw?.value ?? "",
        smallFriday: sf?.value ?? "",
        largeFriday: lf?.value ?? "",
        weightThreshold: wt?.value ?? "1000",
      });
      setTestMode(tm?.value === "true");
    }).catch(() => {
      // Leave defaults if fetch fails
    }).finally(() => setFetching(false));
  }, []);

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
