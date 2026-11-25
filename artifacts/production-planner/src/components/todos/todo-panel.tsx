/**
 * My to-dos in the docked panel (Graeme, 25 Nov 2026: "open by default in the
 * sidebar… so I can go through and tick those things off while I've got
 * visibility of and functionality across the rest of the app"). Objective G.
 *
 * Pages, not pop-ups: the list; a to-do (notes, link, sub-tasks to tick,
 * photos, comments); editing it; a new one. Back always returns to the list
 * (from editing, to its to-do). Nothing here dims or covers the app, and
 * questions ("Tick the 4 left as well?", "Really delete?") are asked in the
 * panel itself.
 *
 * Nothing typed is lost by going Back, to another list or to a station: an
 * edit saves as you type; a comment, the add box and a new to-do are kept as
 * drafts (lib/todo-drafts.ts).
 *
 * The list underneath stays where it was — it isn't unmounted while a to-do
 * is open over it, so Back lands on the same row. Rules: lib/todo-dock.ts.
 * Drawn by components/team-lists/team-list-dock.tsx (the panel's frame).
 */
import { useEffect, type ReactNode } from "react";
import { ArrowLeft, ClipboardList, Loader2, Plus } from "lucide-react";
import { DockCloseButton, DockHeader } from "@/components/team-lists/dock-header";
import { ParentTickInline } from "@/components/subtasks/subtask-ui";
import { PinnedBody, PinnedFooter } from "@/components/ui/pinned-save-bar";
import { MorningReviewBanner } from "@/components/todo-morning-review";
import { useAuth } from "@/contexts/auth-context";
import { useBackToClose } from "@/hooks/use-back-to-close";
import { useTodoCreateDraft, useTodoTextDraft } from "@/hooks/use-todo-draft";
import { useTeamListDock } from "@/hooks/use-team-list-dock";
import type { DockChoice } from "@/lib/team-list-dock";
import { createDraftStarted, startCreateDraft } from "@/lib/todo-drafts";
import { keepRestoredTask, todoListTitle, TODO_LIST_PAGE, type TodoPage } from "@/lib/todo-dock";
import { cn } from "@/lib/utils";
import { useTodoPeople, type TodoTask } from "./api";
import { TodoLinks, type TodoLinkMode } from "./todo-anchor";
import { TodoCreatePage } from "./todo-create";
import { TodoList, useJustAdded } from "./todo-list";
import { MorningReviewToggle, useReportTodoSheet } from "./todo-sheet";
import { TodoDoneButton, TodoEditForm, TodoTaskBody, useTodoTask } from "./todo-task";

export function TodoDockPanel({ choices, onSwitch, onClose, fullView, links, sheet = false }: {
  choices: DockChoice[];
  onSwitch: (choice: DockChoice["value"]) => void;
  onClose: () => void;
  fullView?: ReactNode;
  /** Where a to-do's link to a page of this app opens. */
  links: TodoLinkMode;
  /** A phone: the panel covers the app. */
  sheet?: boolean;
}) {
  const { state } = useAuth();
  const me = state.status === "authenticated" ? state.user : null;
  // On a phone it covers the screen, like the full-screen list — so the 8am
  // review waits for it. Docked beside the page it doesn't (it can be open
  // all day): lib/morning-review-view.ts.
  useReportTodoSheet(sheet);
  if (!me) return null;
  return (
    <TodoLinks mode={links}>
      {/* Keyed by person: nothing on screen carries over a PIN switch. */}
      <Panel key={me.id} meId={me.id} canManage={me.role === "admin" || me.role === "manager"}
        choices={choices} onSwitch={onSwitch} onClose={onClose} fullView={fullView} sheet={sheet} />
    </TodoLinks>
  );
}

function Panel({ meId, canManage, choices, onSwitch, onClose, fullView, sheet }: {
  meId: number;
  canManage: boolean;
  choices: DockChoice[];
  onSwitch: (choice: DockChoice["value"]) => void;
  onClose: () => void;
  fullView?: ReactNode;
  sheet: boolean;
}) {
  const { page, viewUserId, setTodoPage, todoBack, setTodoPerson } = useTeamListDock();
  const people = useTodoPeople(canManage);
  const listUserId = viewUserId ?? meId;
  const title = todoListTitle(viewUserId, people.find(p => p.id === viewUserId)?.name);
  const onList = page.kind === "list";
  const toList = () => setTodoPage(TODO_LIST_PAGE);

  const { justAddedId, onAdded, quickAddRef } = useJustAdded(meId, listUserId);
  const [quickTitle, setQuickTitle] = useTodoTextDraft({ kind: "add", listUserId });
  const { draft, setDraft, clearDraft } = useTodoCreateDraft();
  const unfinished = createDraftStarted(draft);

  // The phone's Back (swipe) does what the Back button does, instead of
  // leaving the page behind the sheet.
  useBackToClose(sheet && !onList, todoBack);

  return (
    <div className="flex flex-col h-full min-h-0 bg-card" data-testid="todo-dock" data-page={page.kind}>
      {onList ? (
        <DockHeader
          icon={<ClipboardList className="w-7 h-7 mt-0.5 text-primary shrink-0" aria-hidden />}
          title={title} choices={choices} onSwitch={onSwitch} onClose={onClose} closeLabel="Close to-dos" fullView={fullView}
          className={viewUserId !== null ? "bg-amber-100 dark:bg-amber-950/40" : undefined}
        />
      ) : (
        <PageTop page={page} listTitle={title} others={viewUserId !== null} onBack={todoBack} onClose={onClose} />
      )}
      {viewUserId !== null && onList && (
        <div className="flex-shrink-0 px-3 py-2 border-b-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 flex flex-wrap items-center gap-2">
          <p className="flex-1 min-w-[5rem] text-sm font-semibold text-amber-900 dark:text-amber-100">Not your list.</p>
          <button type="button" onClick={() => setTodoPerson(meId)}
            className="min-h-11 px-4 rounded-xl border-2 border-amber-400 bg-card text-base font-bold inline-flex items-center gap-2">
            <ArrowLeft className="w-5 h-5" /> Back to mine
          </button>
        </div>
      )}
      {viewUserId === null && onList && <MorningReviewBanner compact />}

      <div className="flex-1 min-h-0 relative">
        {/* Hidden, not removed, under a to-do — so it keeps its place. */}
        <div className={cn("absolute inset-0 overflow-y-auto overscroll-contain px-3 pb-4 pt-2", !onList && "invisible")}
          aria-hidden={!onList} data-no-swipe="">
          <TodoList
            key={listUserId}
            compact
            meId={meId}
            canManage={canManage}
            viewUserId={listUserId}
            justAddedId={justAddedId}
            quickAddRef={quickAddRef}
            quickTitle={quickTitle}
            setQuickTitle={setQuickTitle}
            onSwitchUser={setTodoPerson}
            onOpenTask={id => setTodoPage({ kind: "task", id })}
            onCreateWithDetails={boxTitle => {
              const next = startCreateDraft(draft, boxTitle, listUserId);
              setDraft(next);
              // Moved into the new to-do, so it can't be added twice.
              if (boxTitle && next.form.title === boxTitle) setQuickTitle("");
              setTodoPage({ kind: "create" });
            }}
            onAdded={onAdded}
            unfinished={unfinished ? <Unfinished title={draft.form.title} onContinue={() => setTodoPage({ kind: "create" })} onDiscard={clearDraft} /> : undefined}
          />
          {viewUserId === null && <div className="pt-4"><MorningReviewToggle compact /></div>}
        </div>

        {(page.kind === "task" || page.kind === "edit") && (
          <div className="absolute inset-0 flex flex-col bg-card" data-no-swipe="">
            <TaskPage key={page.id} page={page} meId={meId} canManage={canManage} onList={toList}
              onEdit={() => setTodoPage({ kind: "edit", id: page.id })} onDoneEditing={() => setTodoPage({ kind: "task", id: page.id })} />
          </div>
        )}
        {page.kind === "create" && (
          <div className="absolute inset-0 flex flex-col bg-card" data-no-swipe="">
            <PinnedBody bodyClassName="p-3" footerClassName="p-3">
              <TodoCreatePage meId={meId} canManage={canManage} onDiscard={toList} onAdded={(task: TodoTask) => { toList(); onAdded(task); }} />
            </PinnedBody>
          </div>
        )}
      </div>
    </div>
  );
}

/** The top of every page but the list: a big Back, where it goes, and close. */
function PageTop({ page, listTitle, others, onBack, onClose }: {
  page: TodoPage; listTitle: string; others: boolean; onBack: () => void; onClose: () => void;
}) {
  return (
    <div className={cn("flex-shrink-0 px-2 py-2 border-b border-border flex items-start gap-1", others && "bg-amber-100 dark:bg-amber-950/40")}>
      <button type="button" onClick={onBack}
        className="flex-1 min-w-0 min-h-12 px-2 rounded-xl inline-flex items-center gap-2 text-left text-base font-bold text-primary hover:bg-primary/10">
        <ArrowLeft className="w-6 h-6 shrink-0" />
        <span className="min-w-0 break-words leading-tight">{page.kind === "edit" ? "Back to the to-do" : `Back to ${listTitle === "My to-dos" ? "my to-dos" : listTitle}`}</span>
      </button>
      <span className="pt-1.5 pr-2"><DockCloseButton onClose={onClose} label="Close to-dos" /></span>
    </div>
  );
}

function TaskPage({ page, meId, canManage, onList, onEdit, onDoneEditing }: {
  page: Extract<TodoPage, { kind: "task" | "edit" }>;
  meId: number;
  canManage: boolean;
  onList: () => void;
  onEdit: () => void;
  onDoneEditing: () => void;
}) {
  const t = useTodoTask({ taskId: page.id, meId, canManage, onClose: onList });
  // Reopened after a reload: only while it's still there and still mine.
  const restored = page.kind === "task" && !!page.restored;
  const drop = restored && !t.isLoading && !keepRestoredTask(t.task, meId);
  useEffect(() => { if (drop) onList(); }, [drop, onList]);
  if (drop) return null;

  const editing = page.kind === "edit" && !!t.task && t.canEdit;
  return (
    <PinnedBody key={editing ? "edit" : "view"} bodyClassName="p-3" footerClassName="p-3">
      {editing && t.task ? (
        <TodoEditForm task={t.task} t={t} onDone={onDoneEditing} />
      ) : page.kind === "edit" && t.isLoading ? (
        <p className="py-10 flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</p>
      ) : (
        <>
          <TodoTaskBody t={t} compact onEdit={onEdit} />
          {t.task && t.canEdit && (
            <PinnedFooter>
              <div className="flex flex-col gap-2">
                <ParentTickInline asking={t.guard.asking} answer={t.guard.answer} />
                {!t.guard.asking && <TodoDoneButton t={t} primary onMarkDone={() => void t.markDone()} />}
              </div>
            </PinnedFooter>
          )}
        </>
      )}
    </PinnedBody>
  );
}

/** A new to-do someone started and went Back from. */
function Unfinished({ title, onContinue, onDiscard }: { title: string; onContinue: () => void; onDiscard: () => void }) {
  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 break-words">
        Not added yet: <strong>{title.trim() || "a new to-do"}</strong>
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onContinue}
          className="flex-1 min-h-11 px-3 rounded-xl bg-primary text-primary-foreground text-base font-bold inline-flex items-center justify-center gap-2">
          <Plus className="w-5 h-5" /> Carry on
        </button>
        <button type="button" onClick={onDiscard} className="min-h-11 px-3 rounded-xl border-2 border-border bg-card text-base font-semibold">
          Discard
        </button>
      </div>
    </div>
  );
}
