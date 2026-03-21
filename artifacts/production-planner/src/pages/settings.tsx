import { useState, useEffect, useMemo } from "react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useListUsers, useListCategoryDefaults, useListDptSettings, useListTimingStandards, useListRecipes } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { usePagePermissions, useSavePagePermissions } from "@/hooks/use-page-permissions";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import {
  Plus, Trash2, Edit2, Loader2, Users, ShieldCheck, Eye, Wrench,
  CheckCircle2, XCircle, KeyRound, Package, ChevronDown, ChevronUp,
  Lock, Timer, BarChart2, Coffee,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { upsertDptSettingByRecipe, updateTimingStandard, getListDptSettingsQueryKey, getListTimingStandardsQueryKey } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

export default function Settings() {
  const { data: users, isLoading } = useListUsers();
  const { createUser, updateUser, deleteUser } = useAppMutations();
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);

  const createDefaults: CreateValues = {
    name: "", email: "", password: "", role: "viewer", isActive: true,
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage user accounts and access levels for your team."
      />

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
          <button
            onClick={() => setIsAddOpen(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium shadow-sm shadow-primary/20 flex items-center gap-2 hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add User
          </button>
        </div>

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
                {users?.map((user) => (
                  <tr key={user.id} className="hover:bg-secondary/10 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium">{user.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">{user.email}</td>
                    <td className="px-5 py-3.5">
                      <RoleBadge role={user.role as Role} />
                    </td>
                    <td className="px-5 py-3.5">
                      {user.isActive ? (
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
                      {new Date(user.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditingUser(user as AppUser)}
                          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
                          title="Edit user"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete user "${user.name}"? This cannot be undone.`)) {
                              deleteUser.mutate({ id: user.id });
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

      {/* Category Defaults Section */}
      <CategoryDefaultsSection />

      {/* DPT Settings & Timing Standards — admin only */}
      {user?.role === "admin" && <DptSettingsSection />}
      {user?.role === "admin" && <TimingStandardsSection />}
      {user?.role === "admin" && <MixerCapacitySection />}
      {user?.role === "admin" && <BreakDefaultsSection />}

      {/* Access Control — admin only */}
      {user?.role === "admin" && <AccessControlSection />}
    </div>
  );
}

function CategoryDefaultsSection() {
  const { data: defaults, isLoading } = useListCategoryDefaults();
  const { createCategoryDefault, updateCategoryDefault, deleteCategoryDefault } = useAppMutations();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ category: "", defaultPackagingCost: "", defaultLabourCost: "" });

  const resetForm = () => setForm({ category: "", defaultPackagingCost: "", defaultLabourCost: "" });

  const handleAdd = () => {
    createCategoryDefault.mutate({
      data: {
        category: form.category,
        defaultPackagingCost: Number(form.defaultPackagingCost) || 0,
        defaultLabourCost: Number(form.defaultLabourCost) || 0,
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
      }
    }, { onSuccess: () => { setEditingId(null); resetForm(); } });
  };

  const startEdit = (d: { id: number; category: string; defaultPackagingCost: number; defaultLabourCost: number }) => {
    setEditingId(d.id);
    setForm({ category: d.category, defaultPackagingCost: String(d.defaultPackagingCost), defaultLabourCost: String(d.defaultLabourCost) });
    setAdding(false);
  };

  const inputCls = "px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Package className="w-5 h-5 text-primary" /> Category Cost Defaults</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            When a recipe's category matches, packaging and labour costs are auto-filled in the recipe form.
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">Category Name</label>
              <input className={inputCls} placeholder="e.g. Bread" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
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
          <p className="text-xs mt-1">Add one to auto-populate packaging and labour costs in recipes.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-muted-foreground text-xs">
              <tr>
                <th className="px-5 py-3 font-medium text-left">Category</th>
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
                      <td className="px-5 py-3.5 font-medium">{recipe.name}</td>
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
            <Coffee className="w-4 h-4 text-primary" /> Break & Lunch Defaults
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Set the default allowed duration for morning breaks and lunch breaks. Actual time is tracked and compared against these values in reports.
          </p>
        </div>
        {savedMsg && <span className="text-xs text-green-600 font-medium">{savedMsg}</span>}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium w-36">Morning Break</label>
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
