/**
 * "Storage location" on the ingredient / supply form (fix-queue #357, Jane;
 * Graeme approved). Objective F.
 *
 * Where the item normally lives — location, plus optional Rack and Shelf.
 * It's what the printed kanban card's Location line says ("Dry Store ·
 * Rack A1 · Top shelf"). Same data as Settings › Storage & Inventory ›
 * Ingredient Default Locations, saved through that section's existing
 * /api/storage-locations/ingredient-assignments endpoints (no new endpoint).
 *
 * Autosaves with a visible save state, so it never waits for the dialog's
 * Save. The endpoints only add and remove, so a change adds the new
 * assignment first and only then removes the old one — a failed save can
 * never leave the item with no location. Removals that failed are retried
 * before anything else on the next save.
 *
 * An item can have more than one assignment (set in Settings); this field
 * edits the first and lists the rest.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Same keys and shapes as the Settings section, so both stay in step.
const LOCATIONS_KEY = ["/api/storage-locations"] as const;
const ASSIGNMENTS_KEY = ["/api/storage-locations/ingredient-assignments"] as const;

interface StorageLocationOption { id: number; name: string }
interface IngredientAssignment {
  id: number;
  ingredientId: number;
  locationId: number;
  rackLabel: string | null;
  shelfLabel: string | null;
}
interface Choice { locationId: number | null; rack: string; shelf: string }

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Couldn't load (${res.status})`);
  return res.json() as Promise<T>;
}

async function addAssignment(body: { ingredientId: number; locationId: number; rackLabel: string | null; shelfLabel: string | null }): Promise<IngredientAssignment> {
  const res = await fetch(`${BASE}/api/storage-locations/ingredient-assignments`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `Couldn't save (${res.status})`);
  }
  return res.json() as Promise<IngredientAssignment>;
}

async function removeAssignment(id: number) {
  const res = await fetch(`${BASE}/api/storage-locations/ingredient-assignments/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error(`Saved, but couldn't remove the old location (${res.status})`);
}

const same = (a: IngredientAssignment | null, c: Choice) =>
  (a?.locationId ?? null) === c.locationId &&
  (a?.rackLabel ?? "") === c.rack.trim() &&
  (a?.shelfLabel ?? "") === c.shelf.trim();

export function StorageLocationField({ ingredientId }: { ingredientId: number }) {
  const qc = useQueryClient();
  const locationsQ = useQuery<StorageLocationOption[]>({ queryKey: LOCATIONS_KEY, queryFn: () => getJson("/api/storage-locations") });
  const assignmentsQ = useQuery<IngredientAssignment[]>({ queryKey: ASSIGNMENTS_KEY, queryFn: () => getJson("/api/storage-locations/ingredient-assignments") });

  const mine = (assignmentsQ.data ?? []).filter(a => a.ingredientId === ingredientId).sort((a, b) => a.id - b.id);

  const [choice, setChoice] = useState<Choice>({ locationId: null, rack: "", shelf: "" });
  const [loaded, setLoaded] = useState(false);
  // The assignment this field is editing, and old ones still to remove.
  const saved = useRef<IngredientAssignment | null>(null);
  const toRemove = useRef<number[]>([]);
  useEffect(() => {
    if (!loaded && assignmentsQ.data) {
      const first = mine[0] ?? null;
      saved.current = first;
      setChoice({ locationId: first?.locationId ?? null, rack: first?.rackLabel ?? "", shelf: first?.shelfLabel ?? "" });
      setLoaded(true);
    }
  }, [assignmentsQ.data, loaded, mine]);

  const auto = useAutosave(async (c: Choice) => {
    if (!same(saved.current, c)) {
      const old = saved.current;
      if (c.locationId == null) {
        saved.current = null;
      } else {
        saved.current = await addAssignment({
          ingredientId,
          locationId: c.locationId,
          rackLabel: c.rack.trim() || null,
          shelfLabel: c.shelf.trim() || null,
        });
      }
      if (old) toRemove.current.push(old.id);
    }
    try {
      while (toRemove.current.length) {
        await removeAssignment(toRemove.current[0]!);
        toRemove.current.shift();
      }
    } finally {
      await qc.invalidateQueries({ queryKey: ASSIGNMENTS_KEY });
    }
  });

  if (locationsQ.isLoading || assignmentsQ.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading storage location…</div>;
  }
  if (locationsQ.isError || assignmentsQ.isError) {
    return <p className="text-sm text-destructive">Couldn&rsquo;t load the storage location. Close and reopen to try again.</p>;
  }

  const locations = locationsQ.data ?? [];
  const locationName = (id: number) => locations.find(l => l.id === id)?.name ?? `#${id}`;
  const others = mine.filter(a => a.id !== saved.current?.id && !toRemove.current.includes(a.id));

  const update = (next: Choice, now: boolean) => {
    setChoice(next);
    auto.schedule(next);
    if (now) void auto.flush();
  };
  const inputClass = "w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label htmlFor={`storage-location-${ingredientId}`} className="text-sm font-medium">Storage location</label>
        <SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_8rem] gap-3">
        <select
          id={`storage-location-${ingredientId}`}
          value={choice.locationId ?? ""}
          onChange={e => {
            const locationId = e.target.value ? Number(e.target.value) : null;
            update(locationId == null ? { locationId: null, rack: "", shelf: "" } : { ...choice, locationId }, true);
          }}
          className={inputClass}
        >
          <option value="">— Not assigned —</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div>
          <label htmlFor={`storage-rack-${ingredientId}`} className="sr-only">Rack</label>
          <input
            id={`storage-rack-${ingredientId}`}
            value={choice.rack}
            disabled={choice.locationId == null}
            onChange={e => update({ ...choice, rack: e.target.value }, false)}
            onBlur={() => void auto.flush()}
            placeholder="Rack, e.g. A1"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`storage-shelf-${ingredientId}`} className="sr-only">Shelf</label>
          <input
            id={`storage-shelf-${ingredientId}`}
            value={choice.shelf}
            disabled={choice.locationId == null}
            onChange={e => update({ ...choice, shelf: e.target.value }, false)}
            onBlur={() => void auto.flush()}
            placeholder="Shelf, e.g. Top"
            className={inputClass}
          />
        </div>
      </div>
      {others.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Also stored in {others.map(a => [locationName(a.locationId), a.rackLabel, a.shelfLabel].filter(Boolean).join(" / ")).join(", ")} —{" "}
          <Link href="/settings?section=storage" className="underline text-primary">change in Settings › Storage &amp; Inventory</Link>.
        </p>
      )}
      <p className="text-xs text-muted-foreground">Printed on the kanban card, e.g. &ldquo;Dry Store · Rack A1 · Top shelf&rdquo;.</p>
    </div>
  );
}
