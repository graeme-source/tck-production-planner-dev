/**
 * The cards AI Jane puts in the chat when someone wants to add something
 * (Graeme, 27 Nov 2026: Jane as the go-between, "automate as much of it as
 * we can"). Rules and wording: lib/jane-add.ts.
 *
 *   JaneFormCard  — "I've opened Report accident / incident for you", with
 *                   what she filled in and a button to open it again.
 *   JaneDraftCard — exactly what will be added, and "Add it". Only that tap
 *                   creates it, through the same endpoint and with the same
 *                   checks as the to-do or Wish List form, as the signed-in
 *                   person.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { useOpenMyTodos } from "@/hooks/use-team-list-dock";
import { useAddWishItem } from "@/hooks/use-wish-list";
import { post, type TodoTask } from "@/components/todos/api";
import { WISH_LIST_NAME, WISH_LIST_PATH } from "@/lib/wish-list";
import {
  JANE_FORM_LABEL, addedLine, draftHeading, draftRows, todoBodyFor, wishBodyFor,
  type JaneDraft, type JaneFormRequest,
} from "@/lib/jane-add";

export function JaneFormCard({ request, onOpen }: { request: JaneFormRequest; onOpen: () => void }) {
  const filled = request.text ?? request.title ?? request.link ?? null;
  return (
    <div className="rounded-3xl border-2 border-primary/40 bg-card p-4 space-y-3">
      <p className="text-base font-bold">{JANE_FORM_LABEL[request.kind]}</p>
      {filled && (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
          <span className="font-semibold text-foreground">Filled in: </span>{filled}
        </p>
      )}
      <p className="text-sm text-muted-foreground">Nothing's sent until you finish it in the form.</p>
      <button
        type="button"
        onClick={onOpen}
        className="w-full min-h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
      >
        <ExternalLink className="w-5 h-5" /> Open {JANE_FORM_LABEL[request.kind]}
      </button>
    </div>
  );
}

type DraftState = { status: "pending" } | { status: "added"; line: string } | { status: "dismissed" };

export function JaneDraftCard({ draft }: { draft: JaneDraft }) {
  const [state, setState] = useState<DraftState>({ status: "pending" });
  const queryClient = useQueryClient();
  const { state: auth } = useAuth();
  const meId = auth.status === "authenticated" ? auth.user.id : null;
  const openMyTodos = useOpenMyTodos();
  const addWish = useAddWishItem();

  const addTodo = useMutation({
    mutationFn: (): Promise<TodoTask> => {
      if (draft.kind !== "todo" || meId == null) throw new Error("Not signed in");
      return post("/api/todos", todoBodyFor(draft, meId));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["todos"] });
      const line = addedLine(draft);
      setState({ status: "added", line });
      toast({ title: "Added to your list", description: draft.title });
    },
    onError: (e: Error) => toast({ title: "Couldn't add it — try again", description: e.message, variant: "destructive" }),
  });

  const add = () => {
    if (draft.kind === "todo") { addTodo.mutate(); return; }
    addWish.mutate(wishBodyFor(draft), {
      onSuccess: r => {
        setState({ status: "added", line: addedLine(draft, r) });
        toast({ title: r.duplicate ? "Already on the list" : `Added to the ${WISH_LIST_NAME}`, description: r.item.title });
      },
      onError: (e: Error) => toast({ title: "Couldn't add it — try again", description: e.message, variant: "destructive" }),
    });
  };
  const saving = addTodo.isPending || addWish.isPending;

  if (state.status === "dismissed") {
    return <p className="text-sm text-muted-foreground px-1">Not added.</p>;
  }

  if (state.status === "added") {
    return (
      <div className="rounded-3xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-3">
        <p className="flex items-start gap-2 text-base font-bold">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400 flex-shrink-0" /> {state.line}
        </p>
        {draft.kind === "todo" ? (
          <button type="button" onClick={() => openMyTodos()} className="text-base font-semibold text-primary underline underline-offset-4">
            Open my to-dos
          </button>
        ) : (
          <Link href={WISH_LIST_PATH} className="text-base font-semibold text-primary underline underline-offset-4">
            See the {WISH_LIST_NAME}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-3xl border-2 border-primary/40 bg-card p-4 space-y-3">
      <p className="text-lg font-bold">{draftHeading(draft)}</p>
      <dl className="space-y-2">
        {draftRows(draft).map(r => (
          <div key={r.label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</dt>
            <dd className="text-base whitespace-pre-wrap break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={add}
          disabled={saving || (draft.kind === "todo" && meId == null)}
          className={cn("flex-1 min-h-14 rounded-2xl bg-[#7cb342] text-white text-lg font-bold flex items-center justify-center gap-2 hover:bg-[#6a9c37] disabled:opacity-60")}
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
          {saving ? "Adding…" : "Add it"}
        </button>
        <button
          type="button"
          onClick={() => setState({ status: "dismissed" })}
          disabled={saving}
          className="min-h-14 px-4 rounded-2xl border-2 border-border text-base font-semibold flex items-center justify-center gap-1.5 hover:bg-secondary disabled:opacity-60"
        >
          <X className="w-5 h-5" /> Not now
        </button>
      </div>
    </div>
  );
}
