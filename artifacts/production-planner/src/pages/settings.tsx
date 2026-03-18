import { useState } from "react";
import { useListUsers } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import {
  Plus, Trash2, Edit2, Loader2, Users, ShieldCheck, Eye, Wrench,
  CheckCircle2, XCircle, KeyRound,
} from "lucide-react";
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
  onSubmit: (data: any) => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  const schema = mode === "create" ? createSchema : editSchema;
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<any>({
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
                  const payload: any = {
                    name: data.name,
                    email: data.email,
                    role: data.role,
                    isActive: data.isActive,
                  };
                  if (data.password) payload.password = data.password;
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
    </div>
  );
}
