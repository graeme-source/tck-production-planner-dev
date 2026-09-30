/**
 * Getting someone onto the Team list: the Invite flow (email link, the usual
 * way in) and Add person (an admin sets the first password). Both moved
 * out of pages/settings.tsx unchanged in behaviour for the 2026-09-30
 * Team & Access redesign; both are admin-only on the server.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Check, CheckCircle2, Copy, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useAppMutations } from "@/hooks/use-mutations";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Role = "admin" | "manager" | "viewer";

// Read-only link + copy button — for the invite link fallback.
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

export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("viewer");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ url: string | null; email: string; emailSent: boolean } | null>(null);

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) { setInviteResult(null); setInviteEmail(""); setInviteRole("viewer"); }
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
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-[440px] max-h-[92dvh] overflow-y-auto bg-card border-border rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Invite someone</DialogTitle>
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
            <button onClick={() => close(false)}
              className="w-full h-11 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90">
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Email address</label>
              <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="w-full h-11 px-3 bg-background border border-border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Role</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value as Role)}
                className="w-full h-11 px-3 bg-background border border-border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="viewer">Viewer — station work only</option>
                <option value="manager">Manager — plans &amp; reports</option>
                <option value="admin">Admin — full access</option>
              </select>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => close(false)}
                className="flex-1 h-11 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50">
                Cancel
              </button>
              <button onClick={sendInvite} disabled={!inviteEmail || inviteSending}
                className="flex-1 h-11 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
                {inviteSending && <Loader2 className="w-4 h-4 animate-spin" />}
                {inviteSending ? "Sending…" : "Send invite"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email required"),
  password: z.string()
    .min(9, "Password must be more than 8 characters")
    .regex(/[A-Z]/, "Password must include a capital letter")
    .regex(/[0-9]/, "Password must include a number"),
  role: z.enum(["admin", "manager", "viewer"]),
  isActive: z.boolean(),
});
type CreateValues = z.infer<typeof createSchema>;

/** A one-off form, not a data-entry screen: nothing exists until "Create". */
export function AddPersonDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { createUser } = useAppMutations();
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", email: "", password: "", role: "viewer", isActive: true },
  });
  const role = watch("role");
  const field = "w-full h-11 px-3 bg-background border border-border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-[520px] max-h-[92dvh] overflow-y-auto bg-card border-border rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Add a person</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(data => createUser.mutate({ data }, { onSuccess: () => { onOpenChange(false); reset(); } }))}
          className="space-y-4"
        >
          <div>
            <label className="text-sm font-medium mb-1 block">Full name</label>
            <input {...register("name")} className={field} placeholder="e.g. Jane Smith" />
            {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Email address</label>
            <input {...register("email")} type="email" className={field} placeholder="jane@example.com" />
            {errors.email && <span className="text-destructive text-xs">{errors.email.message}</span>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">First password</label>
            <input {...register("password")} type="password" autoComplete="new-password" className={field} placeholder="9+ chars, a capital & a number" />
            {errors.password && <span className="text-destructive text-xs">{errors.password.message}</span>}
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Role</label>
            <div className="grid grid-cols-3 gap-2">
              {(["viewer", "manager", "admin"] as const).map(r => (
                <button key={r} type="button" onClick={() => setValue("role", r)}
                  className={cn("h-11 rounded-xl border-2 text-sm font-semibold capitalize", role === r ? "border-primary bg-primary/5 text-primary" : "border-border")}>
                  {r}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Extras on top of the role are set afterwards — tap them on the Team list.</p>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} className="flex-1 h-11 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50">
              Cancel
            </button>
            <button type="submit" disabled={createUser.isPending}
              className="flex-1 h-11 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">
              {createUser.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {createUser.isPending ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
