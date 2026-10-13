/**
 * The "Sort: Time, then Priority" control that sits at the top of a task
 * list, and the hook that remembers each person's choice per list
 * (Graeme, 2026-10-13). Objective F. The sorting itself is lib/task-sort.
 *
 * The choice is a per-viewer convenience, so it lives in localStorage
 * (keyed by user and list) and every read/write is wrapped — a private
 * window or blocked storage just means the default each time. Every
 * control showing the same list stays in step within the tab.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDownUp, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { parseSortSpec, SORT_KEYS, SORT_LABELS, type SortKey, type SortSpec } from "@/lib/task-sort";

const EVENT = "tck-task-sort";

function storageKey(userId: number | null, listKey: string) {
  return `tck.taskSort.${userId ?? "anon"}.${listKey}`;
}

function read(key: string, fallback: SortSpec): SortSpec {
  try {
    return parseSortSpec(window.localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

/** [choice, setChoice] for one list, remembered for the signed-in person. */
export function useTaskSort(listKey: string, fallback: SortSpec): [SortSpec, (s: SortSpec) => void] {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : null;
  const key = storageKey(userId, listKey);
  const [spec, setLocal] = useState<SortSpec>(() => read(key, fallback));

  // A different person or list: read their choice.
  useEffect(() => { setLocal(read(key, fallback)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another control for the same list changed it (same tab or another tab).
  useEffect(() => {
    const onChange = (e: Event) => {
      const changed = e instanceof StorageEvent ? e.key : (e as CustomEvent<string>).detail;
      if (changed === key) setLocal(read(key, fallback));
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSpec = useCallback((next: SortSpec) => {
    setLocal(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage blocked — the choice still applies until the page reloads.
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
  }, [key]);

  return [spec, setSpec];
}

/**
 * "Sort: Time ▸ then Priority". Tap to open two rows of big chips:
 * First (Time / Priority / List order) and Then (the others, or None).
 */
export function TaskSortControl({ spec, onChange, className, manualLabel }: {
  spec: SortSpec;
  onChange: (s: SortSpec) => void;
  className?: string;
  /** What "List order" means on this list, e.g. "Order added". */
  manualLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const label = (k: SortKey) => (k === "manual" && manualLabel ? manualLabel : SORT_LABELS[k]);
  const thenOptions: Array<SortKey | "none"> = [...SORT_KEYS.filter(k => k !== spec.primary), "none"];

  const pickFirst = (k: SortKey) => {
    // Keep the second rule if it still makes sense; otherwise the obvious partner.
    const secondary = spec.secondary === k ? (k === "time" ? "priority" : k === "priority" ? "time" : "none") : spec.secondary;
    onChange({ primary: k, secondary });
  };

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="min-h-[48px] px-4 rounded-xl border-2 border-border bg-card font-semibold inline-flex items-center gap-2 hover:bg-secondary/60"
      >
        <ArrowDownUp className="w-5 h-5 text-muted-foreground" />
        <span className="text-muted-foreground">Sort:</span>
        <span>{label(spec.primary)}</span>
        {spec.secondary !== "none" && (
          <>
            <span className="text-muted-foreground font-normal">▸ then</span>
            <span>{label(spec.secondary)}</span>
          </>
        )}
        {open ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </button>

      {open && (
        <div className="rounded-2xl border-2 border-border bg-card p-3 space-y-3">
          <ChipRow title="First">
            {SORT_KEYS.map(k => (
              <Chip key={k} active={spec.primary === k} onClick={() => pickFirst(k)}>{label(k)}</Chip>
            ))}
          </ChipRow>
          <ChipRow title="Then">
            {thenOptions.map(k => (
              <Chip key={k} active={spec.secondary === k} onClick={() => onChange({ ...spec, secondary: k })}>
                {k === "none" ? "Nothing" : label(k)}
              </Chip>
            ))}
          </ChipRow>
        </div>
      )}
    </div>
  );
}

function ChipRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 text-sm font-bold uppercase tracking-wide text-muted-foreground">{title}</span>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-[48px] px-4 rounded-full border-2 font-semibold transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary/60",
      )}
    >
      {children}
    </button>
  );
}
