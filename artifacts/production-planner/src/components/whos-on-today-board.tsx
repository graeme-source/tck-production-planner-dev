import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { chooseRotaGridLayout, ROTA_GRID_GAP, type RotaDensity } from "@/lib/rota-grid-fit";

/**
 * The morning meeting's opening slide body, laid out to fit ONE screen
 * (Graeme, 2026-10-22: "we don't have to scroll to see everything").
 * Header row (greeting + day numbers), a slim strip of stretches, then the
 * team as a grid of cards whose column count and density are picked by
 * chooseRotaGridLayout() from the space actually left over. The card CSS
 * below is what ROTA_DENSITIES in lib/rota-grid-fit.ts budgets for — change
 * them together.
 */

export interface WhosOnPerson {
  name: string; start: string | null; end: string | null; position: string;
  punch?: "in" | "finished" | "not-in";
  late?: boolean;
}
export interface WhosOnStation { title: string; people: WhosOnPerson[] }
export interface WhosOnStretch { name: string; emoji: string; description: string }
export interface WhosOnDayNumbers { calzoneBatches: number; macCheeseBatches: number; ordersToPack: number }

interface Card { key: string; label: string; people: WhosOnPerson[]; extra: boolean }

function StatTile({ value, label, sub, tone }: { value: number; label: string; sub?: string; tone?: "green" | "red" }) {
  return (
    <div className={cn(
      "rounded-2xl px-[clamp(0.75rem,1.2vw,1.5rem)] py-[clamp(0.25rem,0.8vh,0.75rem)] text-center flex flex-col justify-center",
      tone === "green" ? "bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300"
        : tone === "red" ? "bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300"
        : "glass-panel",
    )}>
      <p className="font-display font-bold tabular-nums leading-none text-[clamp(1.75rem,0.9rem+2.2vw,3.75rem)]">{value}</p>
      <p className={cn("font-semibold leading-tight mt-1 text-[clamp(0.75rem,0.55rem+0.45vw,1.125rem)]", !tone && "text-muted-foreground")}>{label}</p>
      {sub && <p className="text-[clamp(0.7rem,0.5rem+0.35vw,0.95rem)] font-medium text-muted-foreground leading-tight">{sub}</p>}
    </div>
  );
}

const NAME_SIZE: Record<RotaDensity, string> = {
  roomy: "text-[clamp(1.375rem,0.9rem+1.1vw,2.25rem)] leading-[1.15]",
  compact: "text-[clamp(1.125rem,0.8rem+0.8vw,1.75rem)] leading-[1.15]",
  tight: "text-[clamp(1rem,0.8rem+0.5vw,1.375rem)] leading-[1.2]",
};

/** Clocked in / finished / not in yet / late — colour AND shape both carry
 *  it, as before: read from across the kitchen. */
function personState(p: WhosOnPerson) {
  const late = !!p.late;
  const inNow = p.punch === "in";
  const done = p.punch === "finished";
  return { late, inNow, done };
}

function PersonStatus({ p, size }: { p: WhosOnPerson; size: "base" | "sm" | "xs" }) {
  const { late, inNow, done } = personState(p);
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 whitespace-nowrap",
      size === "base" ? "text-base leading-5" : size === "sm" ? "text-sm leading-5" : "text-xs leading-[14px]",
    )}>
      {(inNow || done) && (
        <CheckCircle2 className={cn("w-[1.1em] h-[1.1em] flex-shrink-0", done ? "text-muted-foreground" : "text-green-600 dark:text-green-400")} />
      )}
      {late && (
        <span className="inline-flex items-center gap-1 rounded-md bg-red-100 dark:bg-red-950/50 px-1.5 text-[11px] leading-[14px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">
          <AlertCircle className="w-3 h-3" /> not in
        </span>
      )}
      {p.start && <span className="text-muted-foreground tabular-nums">{p.start}–{p.end ?? ""}</span>}
    </span>
  );
}

function PersonNameText({ p, density }: { p: WhosOnPerson; density: RotaDensity }) {
  const { late, inNow, done } = personState(p);
  return (
    <span
      className={cn(
        "font-display font-bold break-words",
        NAME_SIZE[density],
        late && "text-red-600 dark:text-red-400",
        !late && !inNow && !done && "text-muted-foreground",
      )}
      title={late ? "Rostered but not clocked in" : inNow ? "Clocked in" : done ? "Shift finished" : "Not clocked in yet"}
    >
      {p.name}
    </span>
  );
}

function PersonLine({ p, density }: { p: WhosOnPerson; density: RotaDensity }) {
  if (density === "tight") {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
        <PersonNameText p={p} density={density} />
        <PersonStatus p={p} size="xs" />
      </div>
    );
  }
  return (
    <div className={cn("min-w-0 flex flex-col", density === "roomy" ? "mt-1" : "mt-0.5")}>
      <PersonNameText p={p} density={density} />
      <span className="mt-0.5 flex leading-5"><PersonStatus p={p} size={density === "roomy" ? "base" : "sm"} /></span>
    </div>
  );
}

function TeamCard({ card, density }: { card: Card; density: RotaDensity }) {
  const empty = card.people.length === 0;
  // Tight + one person: the shift time rides on the label line so the name
  // gets a line of its own and the card stays one name tall.
  const statusInLabel = density === "tight" && card.people.length === 1;
  return (
    <div className={cn(
      "rounded-xl border min-w-0",
      density === "roomy" ? "px-4 py-2" : density === "compact" ? "px-3 py-1.5" : "px-2.5 py-1",
      empty ? "border-dashed border-border bg-secondary/20" : card.extra ? "border-border bg-secondary/30" : "border-border bg-card",
    )}>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <p className={cn(
          "font-semibold uppercase tracking-wide text-muted-foreground break-words min-w-0",
          density === "roomy" ? "text-[13px] leading-4" : density === "compact" ? "text-xs leading-4" : "text-[11px] leading-[14px]",
        )}>
          {card.extra && <span className="normal-case tracking-normal font-medium">Also in · </span>}{card.label}
        </p>
        {statusInLabel && <PersonStatus p={card.people[0]} size="xs" />}
      </div>
      {empty ? (
        <p className={cn("font-display font-bold text-muted-foreground/40", NAME_SIZE[density])}>—</p>
      ) : statusInLabel ? (
        <p className="min-w-0"><PersonNameText p={card.people[0]} density={density} /></p>
      ) : (
        <div className={cn("flex flex-col", density === "tight" ? "gap-0" : "gap-1")}>
          {card.people.map((p, i) => <PersonLine key={i} p={p} density={density} />)}
        </div>
      )}
    </div>
  );
}

export function WhosOnTodayBoard({ stations, extras, dayNumbers, trialWelcome, stretches, inCount, lateCount, logoSrc }: {
  stations: WhosOnStation[];
  extras: WhosOnPerson[];
  dayNumbers: WhosOnDayNumbers | null;
  trialWelcome: string | null;
  stretches: WhosOnStretch[];
  inCount: number;
  lateCount: number;
  logoSrc: string;
}) {
  const cards: Card[] = useMemo(() => [
    ...stations.map(s => ({ key: `s:${s.title}`, label: s.title, people: s.people, extra: false })),
    ...extras.map((p, i) => ({ key: `x:${i}`, label: p.position || "Today", people: [p], extra: true })),
  ], [stations, extras]);
  const peoplePerCard = useMemo(() => cards.map(c => Math.max(1, c.people.length)), [cards]);

  // Measure the space left for the grid; re-measure on any resize.
  const areaRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const read = () => setArea(prev => {
      const w = Math.floor(el.clientWidth), h = Math.floor(el.clientHeight);
      return prev.w === w && prev.h === h ? prev : { w, h };
    });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // If a long name wraps and the real grid still overflows, step one
  // option down. Starts again from the roomiest whenever the space or the
  // rota changes.
  const signature = `${area.w}x${area.h}:${peoplePerCard.join(",")}`;
  const [squeezeState, setSqueezeState] = useState({ signature, n: 0 });
  const squeeze = squeezeState.signature === signature ? squeezeState.n : 0;
  const layout = chooseRotaGridLayout({ peoplePerCard, availableWidth: area.w, availableHeight: area.h, squeeze });
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || area.h === 0 || !layout.fits) return;
    if (grid.scrollHeight > area.h + 1 && squeeze < 20) setSqueezeState({ signature, n: squeeze + 1 });
  });

  return (
    <div className="h-full min-h-0 flex flex-col gap-[clamp(0.5rem,1.2vh,1rem)]">
      {/* Header: greeting left, the day's numbers right. Calzone and mac
          cheese stay split, per the house rule. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex items-center gap-3 min-w-0">
          <img src={logoSrc} alt="TCK" className="h-[clamp(2.25rem,5.5vh,4.5rem)] w-auto object-contain dark:invert dark:brightness-200" />
          <p className="font-display font-semibold tracking-tight leading-tight text-[clamp(1.5rem,0.9rem+1.7vw,3.25rem)]">Good morning, team</p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2">
          {dayNumbers && (
            <>
              <StatTile
                value={dayNumbers.calzoneBatches}
                label="calzone batches"
                sub={dayNumbers.macCheeseBatches > 0 ? `+ ${dayNumbers.macCheeseBatches} mac cheese` : undefined}
              />
              <StatTile value={dayNumbers.ordersToPack} label="orders to pack" />
            </>
          )}
          <StatTile value={inCount} label="clocked in" tone="green" />
          {lateCount > 0 && <StatTile value={lateCount} label="not in yet" tone="red" />}
        </div>
      </div>

      {trialWelcome && (
        <p className="self-center inline-flex items-center gap-2 rounded-xl bg-primary/10 border border-primary/30 px-4 py-1.5 font-display font-semibold text-primary text-[clamp(1rem,0.7rem+0.8vw,1.5rem)]">
          <span aria-hidden>👋</span> A big welcome to <span className="font-bold">{trialWelcome}</span> — with us on a trial shift today!
        </p>
      )}

      {/* Stretches as a slim strip — the team stretches WHILE reading the
          board (Graeme, 2026-09-11), so they stay on this slide. */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1 mb-1">Stretches — while we read the board</p>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 11rem), 1fr))` }}>
          {stretches.map((st, i) => (
            <div key={i} className="rounded-xl border border-border bg-card px-3 py-1.5 flex items-center gap-2 min-w-0">
              <span className="text-[clamp(1.5rem,1rem+1vw,2.25rem)] leading-none" aria-hidden>{st.emoji}</span>
              <div className="min-w-0">
                <p className="text-sm lg:text-base font-semibold leading-tight">{st.name}</p>
                {/* A very full rota needs the room more than the hints do. */}
                {cards.length <= 16 && <p className="text-xs text-muted-foreground leading-snug">{st.description}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* The team, in production-flow order, filling whatever space is left. */}
      <div ref={areaRef} className="flex-1 min-h-0 flex flex-col">
        <div
          ref={gridRef}
          className={cn("grid min-h-0", layout.fits ? "my-auto overflow-hidden" : "overflow-y-auto")}
          style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gap: ROTA_GRID_GAP }}
          data-columns={layout.columns}
          data-density={layout.density}
        >
          {cards.map(c => <TeamCard key={c.key} card={c} density={layout.density} />)}
        </div>
      </div>
    </div>
  );
}
