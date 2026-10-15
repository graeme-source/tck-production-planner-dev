/**
 * Edit a team-list task. Autosaves every change (text ~0.8s after typing
 * stops, buttons at once) with the save state always visible in the header.
 * Modal rules: X, backdrop and Escape close it (anything unsaved still goes
 * out — useAutosave flushes on unmount), card capped at 92dvh with internal
 * scroll, full width on a phone.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { X, Trash2, Clock } from "lucide-react";
import {
  describeRule, WEEKDAY_SHORT, WEEKDAYS_MONDAY_FIRST, type RecurrenceRule, type Weekday,
} from "@workspace/recurrence";
import { ruleStartingOn } from "@workspace/recurrence";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { useModalScrollKeeper } from "@/hooks/use-modal-scroll";
import { SaveChip } from "@/components/save-chip";
import { MONTH_INTERVALS, PRESETS, defaultCarryOver, nextOn, presetOf, ruleForPreset, startMonthChoices, type Preset } from "@/lib/team-list-view";
import { PRIORITY_STYLES, TEAM_LISTS_KEY, patchItem, type ItemInput, type TeamListItem } from "./team-lists-api";

const inputCls = "w-full h-12 rounded-xl border-2 border-border bg-background px-3 text-base focus:outline-none focus:border-primary";
const chip = (on: boolean) => cn(
  "min-h-[48px] px-4 rounded-xl border-2 text-base font-semibold transition-colors",
  on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-secondary/60",
);

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </section>
  );
}

function toInput(i: TeamListItem): ItemInput {
  return { title: i.title, notes: i.notes, url: i.url, priority: i.priority, recurrence: i.recurrence, timeOfDay: i.timeOfDay, carryOver: i.carryOver };
}

export function ItemEditModal({ item, today, onClose }: { item: TeamListItem; today: string; onClose: () => void }) {
  useModalScrollKeeper();
  const qc = useQueryClient();
  const [form, setForm] = useState<ItemInput>(() => toInput(item));
  // Saves go out one after another, never side by side: two quick taps must
  // land in the order they were made, or the older one would win.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const auto = useAutosave<ItemInput>(v => {
    const next = queue.current.catch(() => undefined).then(() => patchItem(item.id, v));
    queue.current = next;
    return next;
  });
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Refresh the lists once this closes (and the last save has gone out).
  useEffect(() => () => { void queue.current.catch(() => undefined).then(() => qc.invalidateQueries({ queryKey: TEAM_LISTS_KEY })); }, [qc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Change fields; `now` saves straight away (buttons), else after typing stops. */
  function change(patch: Partial<ItemInput>, now = false) {
    const next = { ...form, ...patch };
    setForm(next);
    auto.schedule(next);
    if (now) void auto.flush();
  }

  // The button that's lit. Kept apart from the rule so "Pick days" stays lit
  // while only one day is picked (that rule alone looks like "Weekly").
  const [choice, setChoice] = useState<Preset>(() => presetOf(item.recurrence));

  function setRule(next: RecurrenceRule, nextChoice: Preset = choice) {
    // A start date survives switching rhythm (the preset buttons build a
    // fresh rule); "once" items have their own date.
    const prevFrom = form.recurrence.from ?? null;
    const rule: RecurrenceRule = next.kind !== "once" && next.from === undefined && prevFrom
      ? ruleStartingOn(next, prevFrom) : next;
    const rhythmChanged = defaultCarryOver(rule) !== defaultCarryOver(form.recurrence);
    setChoice(nextChoice);
    change({ recurrence: rule, ...(rhythmChanged ? { carryOver: defaultCarryOver(rule) } : {}) }, true);
  }

  async function close() {
    // A blank title can't save — put the old one back rather than trap anyone.
    if (form.title.trim() === "") auto.schedule({ ...form, title: item.title });
    const ok = await auto.flush();
    if (!ok && !window.confirm("The last change didn't save. Close anyway? (It will be tried once more.)")) return;
    onClose();
  }

  async function remove() {
    if (!window.confirm(`Remove "${form.title}" from this list? Its history is kept.`)) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      auto.discard();
      await patchItem(item.id, { active: false });
      onClose();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Couldn't remove it");
      setRemoving(false);
    }
  }

  const rule = form.recurrence;
  const preset = choice;
  const days: Weekday[] = rule.kind === "weekly" ? rule.days : [];

  function toggleDay(d: Weekday) {
    if (rule.kind !== "weekly") return;
    if (preset === "days") {
      const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
      if (next.length === 0) return; // at least one day
      setRule({ ...rule, days: next });
    } else if (preset === "every_n") {
      setRule({ ...rule, days: [d], anchor: nextOn(d, today) });
    } else {
      setRule({ kind: "weekly", days: [d] });
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={() => void close()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit task"
        className="bg-background border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <h2 className="font-display text-xl font-bold flex-1">Edit task</h2>
          <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
          <button type="button" onClick={() => void close()} className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-6">
          <Section title="Task">
            <input
              value={form.title}
              onChange={e => change({ title: e.target.value })}
              onBlur={() => { if (form.title.trim()) void auto.flush(); }}
              className={inputCls}
              aria-label="Task title"
              maxLength={300}
            />
            {form.title.trim() === "" && <p className="text-sm text-red-600">A task needs a title.</p>}
          </Section>

          <Section title="Repeats" hint={describeRule(rule)}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PRESETS.map(p => (
                <button key={p.key} type="button" className={chip(preset === p.key)} onClick={() => setRule(ruleForPreset(p.key, rule, today), p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            {rule.kind === "weekly" && (
              <div className="space-y-2 pt-1">
                <p className="text-sm font-semibold">{preset === "days" ? "Which days? (tap several)" : "Which day?"}</p>
                <div className="grid grid-cols-7 gap-1.5">
                  {WEEKDAYS_MONDAY_FIRST.map(d => (
                    <button key={d} type="button" className={cn(chip(days.includes(d)), "px-0")} onClick={() => toggleDay(d)} aria-pressed={days.includes(d)}>
                      {WEEKDAY_SHORT[d]}
                    </button>
                  ))}
                </div>
                {preset === "every_n" && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold">Every</span>
                    {[2, 3, 4, 6, 8].map(n => (
                      <button key={n} type="button" className={chip((rule.interval ?? 1) === n)} onClick={() => setRule({ ...rule, interval: n })}>
                        {n} weeks
                      </button>
                    ))}
                    {rule.anchor && <span className="text-sm text-muted-foreground">Starting the week of {new Date(`${rule.anchor}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>}
                  </div>
                )}
              </div>
            )}
            {rule.kind === "monthly" && (rule.interval ?? 1) > 1 && (
              <div className="space-y-2 pt-1">
                <p className="text-sm font-semibold">How often?</p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {MONTH_INTERVALS.map(o => (
                    <button key={o.n} type="button" className={chip(rule.interval === o.n)} onClick={() => setRule({ ...rule, interval: o.n })}>
                      {o.n === 12 ? o.label : `Every ${o.label}`}
                    </button>
                  ))}
                </div>
                <p className="text-sm font-semibold">Starting in</p>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                  {startMonthChoices(today).map(c => (
                    <button key={c.anchor} type="button" className={cn(chip(rule.anchor?.slice(0, 7) === c.anchor.slice(0, 7)), "px-1")} onClick={() => setRule({ ...rule, anchor: c.anchor })}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {rule.kind === "monthly" && (
              <div className="space-y-2 pt-1">
                <p className="text-sm font-semibold">Which day of the month?</p>
                <div className="grid grid-cols-7 gap-1.5">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(n => (
                    <button key={n} type="button" className={cn(chip(rule.dayOfMonth === n), "px-0")} onClick={() => setRule({ ...rule, dayOfMonth: n })}>
                      {n}
                    </button>
                  ))}
                </div>
                {rule.dayOfMonth > 28 && <p className="text-sm text-muted-foreground">Shorter months use their last day.</p>}
              </div>
            )}
            {/* Start date (Graeme, 2026-10-15: "every 3 months starting from
                next Monday"): the first one falls on this day, then it repeats. */}
            {rule.kind !== "once" && (
              <div className="flex items-center gap-3 flex-wrap pt-2">
                <span className="text-sm font-semibold">Starts on</span>
                <input type="date" value={rule.from ?? ""} min={today}
                  onChange={e => {
                    const v = e.target.value;
                    if (!v) { const { from: _drop, ...rest } = rule; void _drop; setRule({ ...rest, from: null } as RecurrenceRule); return; }
                    setRule(ruleStartingOn({ ...rule, from: undefined } as RecurrenceRule, v));
                  }}
                  className="h-11 px-3 rounded-xl border-2 border-border bg-background" aria-label="Starts on" />
                {rule.from
                  ? <button type="button" className={chip(false)} onClick={() => { const { from: _drop, ...rest } = rule; void _drop; setRule({ ...rest, from: null } as RecurrenceRule); }}>Start now</button>
                  : <span className="text-sm text-muted-foreground">Leave empty to start straight away.</span>}
              </div>
            )}
          </Section>

          <Section title="Priority">
            <div className="grid grid-cols-4 gap-2">
              {([1, 2, 3, 4] as const).map(p => (
                <button key={p} type="button" className={cn(chip(form.priority === p), "flex items-center justify-center gap-2")} onClick={() => change({ priority: p }, true)}>
                  <span className={cn("w-3 h-3 rounded-full", PRIORITY_STYLES[p].dot)} /> {PRIORITY_STYLES[p].label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Time" hint="Optional — timed tasks sort before untimed ones of the same priority.">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              <input
                type="time"
                value={form.timeOfDay ?? ""}
                onChange={e => change({ timeOfDay: e.target.value || null }, true)}
                className={cn(inputCls, "w-40")}
                aria-label="Time of day"
              />
              {form.timeOfDay && (
                <button type="button" className={chip(false)} onClick={() => change({ timeOfDay: null }, true)}>Any time</button>
              )}
            </div>
          </Section>

          <Section
            title="If it's missed"
            hint={form.carryOver
              ? "Stays on the list as Overdue until someone does it or skips it — or until its next day comes round."
              : "Drops off at midnight; it comes back on its next day."}
          >
            <button type="button" role="switch" aria-checked={form.carryOver} onClick={() => change({ carryOver: !form.carryOver }, true)}
              className="flex items-center gap-3 min-h-[48px]">
              <span className={cn("w-14 h-8 rounded-full p-1 transition-colors", form.carryOver ? "bg-primary" : "bg-muted")}>
                <span className={cn("block w-6 h-6 rounded-full bg-white shadow transition-transform", form.carryOver && "translate-x-6")} />
              </span>
              <span className="text-base font-semibold">Carry over if missed</span>
            </button>
          </Section>

          <Section title="Notes">
            <textarea
              value={form.notes ?? ""}
              onChange={e => change({ notes: e.target.value || null })}
              onBlur={() => void auto.flush()}
              rows={3}
              className="w-full rounded-xl border-2 border-border bg-background p-3 text-base focus:outline-none focus:border-primary"
              aria-label="Notes"
              placeholder="How to do it, who to call…"
            />
          </Section>

          <Section title="Link" hint="A page in the app (e.g. /orders or /documents/12) or a website. The task's title becomes the link.">
            <input
              value={form.url ?? ""}
              onChange={e => change({ url: e.target.value || null })}
              onBlur={() => void auto.flush()}
              className={inputCls}
              placeholder="/orders"
              aria-label="Link"
              inputMode="url"
            />
          </Section>

          <div className="pt-2 border-t border-border">
            {removeError && <p className="text-sm text-red-600 mb-2">{removeError}</p>}
            <button type="button" onClick={() => void remove()} disabled={removing}
              className="min-h-[48px] px-4 rounded-xl border-2 border-red-300 text-red-700 dark:text-red-300 font-semibold inline-flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50">
              <Trash2 className="w-5 h-5" /> Remove from list
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
