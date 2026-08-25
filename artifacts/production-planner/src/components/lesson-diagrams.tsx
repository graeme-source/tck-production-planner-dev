/**
 * Lesson diagram bank — code-drawn visuals for the lean curriculum,
 * keyed by lean_examples.diagram. Self-contained SVG/markup: crisp on
 * the iPad, no external assets, works offline. Moved out of meeting.tsx
 * and extended for the 9-week "Seeing Waste" programme (Aug 2026).
 *
 * To add a diagram: add the component, a case in LessonDiagram, and an
 * entry in DIAGRAM_OPTIONS — the options list powers the picker in the
 * meeting page's curriculum editor, so a new key is usable the moment
 * it ships.
 */

// Shared palette — matches the meeting deck's existing accents.
const GREEN = "#10b981";
const RED = "#ef4444";
const PURPLE = "#a855f7";
const PURPLE_DEEP = "#7c3aed";
const SLATE = "#94a3b8";

/** Every diagram key, with the label shown in the curriculum editor. */
export const DIAGRAM_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "value-lens", label: "Value vs waste — the customer's question" },
  { key: "hidden-waste", label: "Waste fades from view, not from the kitchen" },
  { key: "energy-drain", label: "Friction drains the battery" },
  { key: "eight-wastes", label: "The Eight Wastes — overview grid" },
  { key: "waste-overproduction", label: "Overproduction — made vs ordered" },
  { key: "waste-transportation", label: "Transportation — the pointless journey" },
  { key: "waste-inventory", label: "Inventory — cash on a shelf" },
  { key: "water-level", label: "Lower the water level, see the rocks" },
  { key: "waste-defects", label: "Defects — all the cost, less the price" },
  { key: "defect-timeline", label: "Defects grow downstream" },
  { key: "waste-motion", label: "Motion — the half-mile item" },
  { key: "spaghetti-motion", label: "Spaghetti diagram — an hour of footsteps" },
  { key: "waste-overprocessing", label: "Overprocessing — past the target" },
  { key: "standard-line", label: "The standard defines done" },
  { key: "waste-waiting", label: "Waiting — the crumbs add up" },
  { key: "bottleneck-flow", label: "Bottleneck — piles before, idle after" },
  { key: "waste-skills", label: "Waste of Skills — the unasked experts" },
  { key: "idea-barriers", label: "Why ideas stay unsaid" },
  { key: "compound-growth", label: "1% better every day (compound curve)" },
  { key: "3s-cycle", label: "3S cycle — Sweep, Sort, Standardise" },
];

export function LessonDiagram({ id }: { id: string }) {
  switch (id) {
    case "value-lens":            return <ValueLensDiagram />;
    case "hidden-waste":          return <HiddenWasteDiagram />;
    case "energy-drain":          return <EnergyDrainDiagram />;
    case "eight-wastes":          return <EightWastesDiagram />;
    case "waste-overproduction":  return <WasteOverproductionDiagram />;
    case "waste-transportation":  return <WasteTransportationDiagram />;
    case "waste-inventory":       return <WasteInventoryDiagram />;
    case "water-level":           return <WaterLevelDiagram />;
    case "waste-defects":         return <WasteDefectsDiagram />;
    case "defect-timeline":       return <DefectTimelineDiagram />;
    case "waste-motion":          return <WasteMotionDiagram />;
    case "spaghetti-motion":      return <SpaghettiMotionDiagram />;
    case "waste-overprocessing":  return <WasteOverprocessingDiagram />;
    case "standard-line":         return <StandardLineDiagram />;
    case "waste-waiting":         return <WasteWaitingDiagram />;
    case "bottleneck-flow":       return <BottleneckFlowDiagram />;
    case "waste-skills":          return <WasteSkillsDiagram />;
    case "idea-barriers":         return <IdeaBarriersDiagram />;
    case "compound-growth":       return <CompoundGrowthDiagram />;
    case "3s-cycle":              return <ThreeSCycleDiagram />;
    default:                      return null;
  }
}

function Panel({ caption, children }: { caption?: string; children: React.ReactNode }) {
  return (
    <figure className="glass-panel rounded-2xl p-5">
      {children}
      {caption && (
        <figcaption className="text-center text-sm text-muted-foreground mt-2">{caption}</figcaption>
      )}
    </figure>
  );
}

// ── Week 1 — Seeing waste ───────────────────────────────────────────

// Everything we do passes through one question and lands in one of two
// buckets. The founding picture of the whole curriculum.
function ValueLensDiagram() {
  return (
    <Panel caption="One question sorts everything we do.">
      <svg viewBox="0 0 500 240" className="w-full" role="img"
        aria-label="Everything we do passes through the question 'would the customer pay for it?' and splits into value, which we protect, and waste, which we shrink.">
        <rect x="10" y="85" width="130" height="70" rx="12" fill={PURPLE} fillOpacity="0.12" stroke={PURPLE} strokeWidth="2" />
        <text x="75" y="113" textAnchor="middle" fontSize="13" fontWeight="700" fill={PURPLE_DEEP}>Everything</text>
        <text x="75" y="131" textAnchor="middle" fontSize="13" fontWeight="700" fill={PURPLE_DEEP}>we do</text>
        <line x1="140" y1="120" x2="185" y2="120" stroke={SLATE} strokeWidth="2.5" />
        <circle cx="250" cy="120" r="62" fill={PURPLE} fillOpacity="0.1" stroke={PURPLE} strokeWidth="2.5" />
        <text x="250" y="103" textAnchor="middle" fontSize="12.5" fontWeight="700" fill={PURPLE_DEEP}>"Would the</text>
        <text x="250" y="120" textAnchor="middle" fontSize="12.5" fontWeight="700" fill={PURPLE_DEEP}>customer pay</text>
        <text x="250" y="137" textAnchor="middle" fontSize="12.5" fontWeight="700" fill={PURPLE_DEEP}>for this?"</text>
        <line x1="300" y1="90" x2="352" y2="58" stroke={GREEN} strokeWidth="2.5" />
        <line x1="300" y1="150" x2="352" y2="182" stroke={RED} strokeWidth="2.5" />
        <rect x="355" y="22" width="135" height="64" rx="12" fill={GREEN} fillOpacity="0.14" stroke={GREEN} strokeWidth="2" />
        <text x="422" y="48" textAnchor="middle" fontSize="15" fontWeight="800" fill={GREEN}>VALUE</text>
        <text x="422" y="68" textAnchor="middle" fontSize="11" fill={GREEN}>protect it · do it brilliantly</text>
        <rect x="355" y="152" width="135" height="64" rx="12" fill={RED} fillOpacity="0.12" stroke={RED} strokeWidth="2" />
        <text x="422" y="178" textAnchor="middle" fontSize="15" fontWeight="800" fill={RED}>WASTE</text>
        <text x="422" y="198" textAnchor="middle" fontSize="11" fill={RED}>see it · shrink it</text>
      </svg>
    </Panel>
  );
}

// The same annoyance, fading from attention week by week while staying
// exactly as real. Familiarity is the camouflage.
function HiddenWasteDiagram() {
  const stages = [
    { x: 85, opacity: 1, label: "Day 1", note: '"this bugs me"' },
    { x: 250, opacity: 0.45, label: "Week 3", note: '"I\'ll sort it sometime"' },
    { x: 415, opacity: 0.14, label: "Month 3", note: '"what thing?"' },
  ];
  return (
    <Panel caption="It fades from view — not from the kitchen.">
      <svg viewBox="0 0 500 210" className="w-full" role="img"
        aria-label="The same piece of waste fades from attention between day one and month three while remaining just as real.">
        <line x1="40" y1="168" x2="460" y2="168" stroke={SLATE} strokeWidth="1.5" />
        {stages.map(s => (
          <g key={s.label}>
            {/* the annoyance: a zigzag detour that never went away */}
            <g opacity={s.opacity}>
              <path d={`M${s.x - 38},120 L${s.x - 12},78 L${s.x + 12},120 L${s.x + 38},78`}
                fill="none" stroke={RED} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={s.x - 38} cy={120} r="5" fill={RED} />
              <circle cx={s.x + 38} cy={78} r="5" fill={RED} />
            </g>
            <text x={s.x} y="152" textAnchor="middle" fontSize="10.5" fontStyle="italic" fill={SLATE}>{s.note}</text>
            <text x={s.x} y="190" textAnchor="middle" fontSize="13" fontWeight="700" fill={SLATE}>{s.label}</text>
          </g>
        ))}
        <text x="250" y="34" textAnchor="middle" fontSize="13" fontWeight="700" fill={PURPLE_DEEP}>
          The waste stays the same size — only our attention shrinks
        </text>
      </svg>
    </Panel>
  );
}

// Two end-of-shift batteries: the work costs the same either way; the
// friction is the difference between tired and wrecked.
function EnergyDrainDiagram() {
  return (
    <Panel caption="Same work, same effort — the friction is the difference.">
      <svg viewBox="0 0 500 220" className="w-full" role="img"
        aria-label="Two end-of-shift energy batteries: with friction, the work plus hunting and trekking leaves the battery nearly empty; with friction removed, the same work leaves energy to spare.">
        {[
          { y: 40, label: "A shift today", segs: [
            { w: 190, color: GREEN, text: "the actual work" },
            { w: 150, color: RED, text: "hunting · re-doing · trekking" },
          ], left: 40, leftText: "left: running on fumes" },
          { y: 130, label: "Friction removed", segs: [
            { w: 190, color: GREEN, text: "the actual work" },
          ], left: 190, leftText: "left: energy at 4 o'clock" },
        ].map(row => {
          const x0 = 20, h = 44, total = 380;
          const used = row.segs.reduce((a, s) => a + s.w, 0);
          let x = x0;
          return (
            <g key={row.label}>
              <text x={x0} y={row.y - 8} fontSize="12.5" fontWeight="700" fill={SLATE}>{row.label}</text>
              <rect x={x0} y={row.y} width={total} height={h} rx="9" fill="none" stroke={SLATE} strokeWidth="1.5" />
              <rect x={x0 + total} y={row.y + 12} width="8" height={h - 24} rx="2" fill={SLATE} />
              {row.segs.map(s => {
                const r = <rect key={s.text} x={x} y={row.y} width={s.w} height={h} rx="9" fill={s.color} fillOpacity="0.8" />;
                const t = <text key={`${s.text}-t`} x={x + s.w / 2} y={row.y + h / 2 + 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="white">{s.text}</text>;
                x += s.w;
                return [r, t];
              })}
              <text x={x0 + used + (total - used) / 2} y={row.y + h / 2 + 4} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={total - used > 100 ? GREEN : SLATE}>
                {row.leftText}
              </text>
            </g>
          );
        })}
      </svg>
    </Panel>
  );
}

// The Eight Wastes overview — canonical Lean Made Simple names, in the
// canonical order, numbered. (Deliberately NOT the DOWNTIME acronym —
// the corpus bans other literatures' names.)
function EightWastesDiagram() {
  const items: Array<[string, string]> = [
    ["Overproduction", "more than ordered"],
    ["Transportation", "product on pointless journeys"],
    ["Inventory", "cash sitting on a shelf"],
    ["Defects", "made wrong, paid for anyway"],
    ["Motion", "steps the work doesn't need"],
    ["Overprocessing", "more work than the customer needs"],
    ["Waiting", "people ready, work not"],
    ["Waste of Skills", "ideas never asked for"],
  ];
  return (
    <div className="glass-panel rounded-2xl p-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {items.map(([w, d], i) => (
          <div key={w} className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-300 font-display font-bold text-xl shrink-0">{i + 1}</span>
            <div className="min-w-0">
              <div className="font-semibold leading-tight truncate">{w}</div>
              <div className="text-xs text-muted-foreground truncate">{d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Week 2 — Overproduction ─────────────────────────────────────────

// Made vs ordered: everything above the order line is waste with a
// fridge-shaped future.
function WasteOverproductionDiagram() {
  return (
    <Panel caption="Everything above the order line was made without a customer.">
      <svg viewBox="0 0 500 250" className="w-full" role="img"
        aria-label="Bar chart: 100 ordered versus 130 made — the 30 extra sit above the order line and head for storage and the bin.">
        {/* order line */}
        <line x1="40" y1="80" x2="330" y2="80" stroke={SLATE} strokeWidth="1.5" strokeDasharray="5 5" />
        <text x="40" y="70" fontSize="11.5" fontWeight="600" fill={SLATE}>the order line</text>
        {/* ordered bar */}
        <rect x="70" y="80" width="100" height="140" rx="8" fill={GREEN} fillOpacity="0.75" />
        <text x="120" y="155" textAnchor="middle" fontSize="14" fontWeight="800" fill="white">100</text>
        <text x="120" y="240" textAnchor="middle" fontSize="12.5" fontWeight="700" fill={SLATE}>ordered</text>
        {/* made bar with red overhang */}
        <rect x="210" y="80" width="100" height="140" rx="8" fill={GREEN} fillOpacity="0.75" />
        <rect x="210" y="38" width="100" height="42" rx="8" fill={RED} fillOpacity="0.85" />
        <text x="260" y="65" textAnchor="middle" fontSize="13" fontWeight="800" fill="white">+30</text>
        <text x="260" y="155" textAnchor="middle" fontSize="14" fontWeight="800" fill="white">100</text>
        <text x="260" y="240" textAnchor="middle" fontSize="12.5" fontWeight="700" fill={SLATE}>made</text>
        {/* the extra's future */}
        <path d="M315,55 C 370,55 380,80 385,105" fill="none" stroke={RED} strokeWidth="2" strokeDasharray="4 4" />
        <text x="392" y="100" fontSize="11.5" fontWeight="700" fill={RED}>the extra:</text>
        <text x="392" y="118" fontSize="11.5" fill={RED}>needs space,</text>
        <text x="392" y="134" fontSize="11.5" fill={RED}>needs shuffling,</text>
        <text x="392" y="150" fontSize="11.5" fill={RED}>counts down…</text>
        <text x="392" y="172" fontSize="12.5" fontWeight="800" fill={RED}>…often: the bin</text>
      </svg>
    </Panel>
  );
}

// ── Week 3 — Transportation ─────────────────────────────────────────

// Before/after floor sketch: the far home makes six trips; the near home
// makes the journey boring.
function WasteTransportationDiagram() {
  return (
    <Panel caption="The product's journey should look boring.">
      <svg viewBox="0 0 500 230" className="w-full" role="img"
        aria-label="Two floor sketches: stock stored far from the station means repeated zigzag trips; stored beside the station, the journey almost disappears.">
        {/* left: the trek */}
        <rect x="18" y="30" width="212" height="170" rx="10" fill="none" stroke={SLATE} strokeWidth="1.5" />
        <rect x="34" y="150" width="66" height="38" rx="7" fill={PURPLE} fillOpacity="0.15" stroke={PURPLE} strokeWidth="1.5" />
        <text x="67" y="173" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={PURPLE_DEEP}>station</text>
        <rect x="160" y="44" width="56" height="34" rx="7" fill={SLATE} fillOpacity="0.15" stroke={SLATE} strokeWidth="1.5" />
        <text x="188" y="65" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={SLATE}>stock</text>
        <path d="M84,148 L120,112 L96,96 L152,78" fill="none" stroke={RED} strokeWidth="2.5" strokeDasharray="6 4" strokeLinecap="round" />
        <path d="M100,152 L136,120 L112,102 L158,86" fill="none" stroke={RED} strokeWidth="2.5" strokeDasharray="6 4" strokeLinecap="round" opacity="0.55" />
        <text x="124" y="135" fontSize="11" fontWeight="800" fill={RED}>×6 a day</text>
        <text x="124" y="215" textAnchor="middle" fontSize="12" fontWeight="700" fill={RED}>now</text>
        {/* right: the boring journey */}
        <rect x="270" y="30" width="212" height="170" rx="10" fill="none" stroke={SLATE} strokeWidth="1.5" />
        <rect x="286" y="150" width="66" height="38" rx="7" fill={PURPLE} fillOpacity="0.15" stroke={PURPLE} strokeWidth="1.5" />
        <text x="319" y="173" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={PURPLE_DEEP}>station</text>
        <rect x="366" y="152" width="56" height="34" rx="7" fill={GREEN} fillOpacity="0.15" stroke={GREEN} strokeWidth="1.5" />
        <text x="394" y="173" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={GREEN}>stock</text>
        <line x1="354" y1="169" x2="364" y2="169" stroke={GREEN} strokeWidth="3" strokeLinecap="round" />
        <text x="376" y="140" textAnchor="middle" fontSize="11" fontWeight="800" fill={GREEN}>kept where it's used</text>
        <text x="376" y="215" textAnchor="middle" fontSize="12" fontWeight="700" fill={GREEN}>fixed</text>
      </svg>
    </Panel>
  );
}

// ── Week 4 — Inventory ──────────────────────────────────────────────

// A shelf read honestly: the front row is this week's need; everything
// behind it is parked cash on a countdown.
function WasteInventoryDiagram() {
  return (
    <Panel caption="Stock is money with a use-by date.">
      <svg viewBox="0 0 500 230" className="w-full" role="img"
        aria-label="A shelf holding two green tubs that this week needs, and five red-tinted tubs behind them marked with pound signs and a countdown clock.">
        <line x1="30" y1="180" x2="470" y2="180" stroke={SLATE} strokeWidth="3" strokeLinecap="round" />
        {/* this week's need */}
        {[0, 1].map(i => (
          <g key={i}>
            <rect x={50 + i * 62} y={122} width="52" height="56" rx="7" fill={GREEN} fillOpacity="0.7" />
            <text x={76 + i * 62} y={155} textAnchor="middle" fontSize="14" fontWeight="800" fill="white">✓</text>
          </g>
        ))}
        <text x="107" y="205" textAnchor="middle" fontSize="12" fontWeight="700" fill={GREEN}>this week's need</text>
        {/* the excess */}
        {[0, 1, 2].map(i => (
          <rect key={i} x={218 + i * 62} y={122} width="52" height="56" rx="7" fill={RED} fillOpacity="0.55" />
        ))}
        {[0, 1].map(i => (
          <rect key={i} x={249 + i * 62} y={60} width="52" height="56" rx="7" fill={RED} fillOpacity="0.35" />
        ))}
        {[0, 1, 2].map(i => (
          <text key={i} x={244 + i * 62} y={156} textAnchor="middle" fontSize="15" fontWeight="800" fill="white">£</text>
        ))}
        <text x="336" y="205" textAnchor="middle" fontSize="12" fontWeight="700" fill={RED}>parked cash, counting down</text>
        {/* countdown clock */}
        <circle cx="430" cy="88" r="24" fill="none" stroke={RED} strokeWidth="2.5" />
        <line x1="430" y1="88" x2="430" y2="72" stroke={RED} strokeWidth="2.5" strokeLinecap="round" />
        <line x1="430" y1="88" x2="441" y2="95" stroke={RED} strokeWidth="2.5" strokeLinecap="round" />
        <text x="430" y="135" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={RED}>use-by</text>
      </svg>
    </Panel>
  );
}

// The classic: high stock is water hiding the rocks; lower it slowly and
// the real problems surface where we can finally fix them.
function WaterLevelDiagram() {
  const rocks = [
    { x: 120, label: "late supplier" },
    { x: 250, label: "recipe uses more than the sheet says" },
    { x: 395, label: "guessed orders" },
  ];
  return (
    <Panel caption="Lower the water slowly — a surfaced problem is a win.">
      <svg viewBox="0 0 500 240" className="w-full" role="img"
        aria-label="High stock level shown as water hiding rocks; lowering the level exposes the rocks — the real problems — so they can be fixed.">
        {/* high water line */}
        <path d="M30,70 Q 70,62 110,70 T 190,70 T 270,70 T 350,70 T 430,70 L470,70" fill="none" stroke={SLATE} strokeWidth="2" strokeDasharray="6 4" />
        <text x="470" y="58" textAnchor="end" fontSize="11.5" fontWeight="600" fill={SLATE}>stock level today — problems hidden</text>
        {/* lowered water */}
        <path d="M30,128 Q 70,120 110,128 T 190,128 T 270,128 T 350,128 T 430,128 L470,128" fill="none" stroke={PURPLE} strokeWidth="2.5" />
        <text x="470" y="118" textAnchor="end" fontSize="11.5" fontWeight="700" fill={PURPLE_DEEP}>level lowered — problems visible</text>
        {/* rocks */}
        {rocks.map(r => (
          <g key={r.x}>
            <path d={`M${r.x - 34},214 L${r.x - 12},96 L${r.x + 10},150 L${r.x + 34},214 Z`} fill={RED} fillOpacity="0.5" stroke={RED} strokeWidth="1.5" />
          </g>
        ))}
        <line x1="30" y1="214" x2="470" y2="214" stroke={SLATE} strokeWidth="2" />
        <text x="120" y="232" textAnchor="middle" fontSize="10.5" fontWeight="600" fill={RED}>{rocks[0].label}</text>
        <text x="255" y="232" textAnchor="middle" fontSize="10.5" fontWeight="600" fill={RED}>{rocks[1].label}</text>
        <text x="395" y="232" textAnchor="middle" fontSize="10.5" fontWeight="600" fill={RED}>{rocks[2].label}</text>
      </svg>
    </Panel>
  );
}

// ── Week 5 — Defects ────────────────────────────────────────────────

// Two identical cost stacks, two different endings: the wonky spent
// everything the perfect one did.
function WasteDefectsDiagram() {
  const layers = ["skilled hands", "oven time", "filling", "dough"];
  const colors = ["#c084fc", "#a855f7", "#9333ea", "#7c3aed"];
  return (
    <Panel caption="All the cost is spent either way.">
      <svg viewBox="0 0 500 250" className="w-full" role="img"
        aria-label="Two identical stacks of costs — dough, filling, oven time, skilled hands — one becoming a full-price calzone, the other a wonky that cannot earn full price.">
        {[{ x: 90, ok: true }, { x: 300, ok: false }].map(col => (
          <g key={col.x}>
            {layers.map((l, i) => (
              <g key={l}>
                <rect x={col.x} y={178 - i * 38} width="120" height="34" rx="6" fill={colors[i]} fillOpacity="0.8" />
                <text x={col.x + 60} y={199 - i * 38} textAnchor="middle" fontSize="11" fontWeight="700" fill="white">{l}</text>
              </g>
            ))}
            <text x={col.x + 60} y="238" textAnchor="middle" fontSize="12.5" fontWeight="700" fill={col.ok ? GREEN : RED}>
              {col.ok ? "perfect calzone" : "wonky"}
            </text>
          </g>
        ))}
        {/* outcomes */}
        <text x="150" y="26" textAnchor="middle" fontSize="16" fontWeight="800" fill={GREEN}>earns full price</text>
        <g>
          <text x="360" y="26" textAnchor="middle" fontSize="16" fontWeight="800" fill={RED}>can't</text>
          <line x1="315" y1="20" x2="405" y2="20" stroke={RED} strokeWidth="0" />
        </g>
      </svg>
    </Panel>
  );
}

// Born upstream, noticed downstream, priced at every stage: the same
// flaw grows as it travels.
function DefectTimelineDiagram() {
  const stages = [
    { x: 65, label: "prep", cost: "£", h: 26 },
    { x: 160, label: "build", cost: "££", h: 52 },
    { x: 255, label: "oven", cost: "£££", h: 84 },
    { x: 350, label: "pack", cost: "££££", h: 120 },
    { x: 445, label: "customer", cost: "trust", h: 160 },
  ];
  return (
    <Panel caption="The same flaw, five price tags — catch it early.">
      <svg viewBox="0 0 500 250" className="w-full" role="img"
        aria-label="The cost of the same defect rising as it travels from prep through build, oven and pack to the customer, where it costs trust.">
        <line x1="20" y1="200" x2="480" y2="200" stroke={SLATE} strokeWidth="2" />
        {stages.map((s, i) => (
          <g key={s.label}>
            <rect x={s.x - 26} y={200 - s.h} width="52" height={s.h} rx="6"
              fill={RED} fillOpacity={0.35 + i * 0.14} />
            <text x={s.x} y={190 - s.h} textAnchor="middle" fontSize="12.5" fontWeight="800" fill={RED}>{s.cost}</text>
            <text x={s.x} y="220" textAnchor="middle" fontSize="11.5" fontWeight="700" fill={SLATE}>{s.label}</text>
          </g>
        ))}
        <text x="65" y="243" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={GREEN}>born here — cheapest here</text>
        <text x="255" y="243" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={RED}>often noticed here</text>
      </svg>
    </Panel>
  );
}

// ── Week 6 — Motion ─────────────────────────────────────────────────

// One item stored twenty steps away turns into half a mile of walking a
// day; moved next to the work, the walk disappears.
function WasteMotionDiagram() {
  return (
    <Panel caption="Move the item, keep the energy.">
      <svg viewBox="0 0 500 230" className="w-full" role="img"
        aria-label="Twenty steps to a far shelf, forty times a shift, equals about half a mile a day for one item; stored at the bench it becomes two steps.">
        {/* the walk */}
        <circle cx="60" cy="80" r="17" fill={PURPLE} fillOpacity="0.16" stroke={PURPLE} strokeWidth="2" />
        <text x="60" y="85" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={PURPLE_DEEP}>you</text>
        <rect x="392" y="60" width="66" height="40" rx="7" fill={SLATE} fillOpacity="0.15" stroke={SLATE} strokeWidth="1.5" />
        <text x="425" y="84" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={SLATE}>far shelf</text>
        <path d="M82,80 C 150,52 190,108 250,80 S 340,52 388,78" fill="none" stroke={RED} strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" />
        <text x="238" y="42" textAnchor="middle" fontSize="12.5" fontWeight="800" fill={RED}>20 steps × 40 trips a shift</text>
        <text x="238" y="126" textAnchor="middle" fontSize="16" fontWeight="800" fill={RED}>≈ ½ a mile a day — for one item</text>
        {/* the fix */}
        <line x1="30" y1="158" x2="470" y2="158" stroke={SLATE} strokeWidth="1" strokeDasharray="3 5" />
        <circle cx="60" cy="196" r="17" fill={PURPLE} fillOpacity="0.16" stroke={PURPLE} strokeWidth="2" />
        <text x="60" y="201" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={PURPLE_DEEP}>you</text>
        <rect x="100" y="176" width="66" height="40" rx="7" fill={GREEN} fillOpacity="0.16" stroke={GREEN} strokeWidth="2" />
        <text x="133" y="200" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={GREEN}>at the bench</text>
        <text x="330" y="200" textAnchor="middle" fontSize="14" fontWeight="800" fill={GREEN}>2 steps — energy stays yours</text>
      </svg>
    </Panel>
  );
}

// An hour of footsteps drawn as string: the tangle accuses the layout,
// never the person.
function SpaghettiMotionDiagram() {
  return (
    <Panel caption="The shape blames the layout, never the person.">
      <svg viewBox="0 0 500 230" className="w-full" role="img"
        aria-label="Two floor plans: one hour of footsteps as a tangled scribble before fixes, and as a few short lines after.">
        {/* before: the tangle */}
        <rect x="18" y="34" width="212" height="160" rx="10" fill="none" stroke={SLATE} strokeWidth="1.5" />
        <path d="M40,170 C 90,60 60,150 130,70 S 90,160 180,90 S 120,180 200,130 S 150,60 70,120 S 190,170 210,60"
          fill="none" stroke={RED} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        <text x="124" y="215" textAnchor="middle" fontSize="12" fontWeight="700" fill={RED}>one hour of footsteps</text>
        {/* after: boring spaghetti */}
        <rect x="270" y="34" width="212" height="160" rx="10" fill="none" stroke={SLATE} strokeWidth="1.5" />
        <path d="M300,168 L 300,80 M300,124 L 372,124 M372,124 L 372,80 M300,168 L 440,168"
          fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" />
        <text x="376" y="215" textAnchor="middle" fontSize="12" fontWeight="700" fill={GREEN}>after the fixes — boring, short, rare</text>
      </svg>
    </Panel>
  );
}

// ── Week 7 — Overprocessing ─────────────────────────────────────────

// Effort past the line the customer can taste: the overshoot is care
// spent on nothing.
function WasteOverprocessingDiagram() {
  return (
    <Panel caption="Care past the line buys nothing the customer can taste.">
      <svg viewBox="0 0 500 210" className="w-full" role="img"
        aria-label="Two effort bars against the line of what the customer values: one overshoots the line in wasted polish; the aimed one stops exactly at the line.">
        <line x1="330" y1="20" x2="330" y2="170" stroke={PURPLE} strokeWidth="2.5" strokeDasharray="7 5" />
        <text x="330" y="196" textAnchor="middle" fontSize="12" fontWeight="700" fill={PURPLE_DEEP}>what the customer values</text>
        {/* overshooting bar */}
        <rect x="40" y="46" width="290" height="40" rx="8" fill={GREEN} fillOpacity="0.75" />
        <rect x="330" y="46" width="130" height="40" rx="8" fill={RED} fillOpacity="0.75" />
        <text x="185" y="71" textAnchor="middle" fontSize="12" fontWeight="700" fill="white">the work that matters</text>
        <text x="395" y="71" textAnchor="middle" fontSize="11" fontWeight="700" fill="white">polish they never taste</text>
        {/* aimed bar */}
        <rect x="40" y="116" width="290" height="40" rx="8" fill={GREEN} fillOpacity="0.75" />
        <text x="185" y="141" textAnchor="middle" fontSize="12" fontWeight="700" fill="white">same care — aimed</text>
        <text x="345" y="141" fontSize="13" fontWeight="800" fill={GREEN}>✓ done, with confidence</text>
      </svg>
    </Panel>
  );
}

// Done is a written line: under it is a defect, past it is wasted care,
// on it is finished — for everyone, the same.
function StandardLineDiagram() {
  return (
    <Panel caption="A written standard protects both ways.">
      <svg viewBox="0 0 500 220" className="w-full" role="img"
        aria-label="Three bars against the written 'done' line: one stops short as under-done, one lands exactly as done, one overshoots as over-done.">
        <line x1="310" y1="16" x2="310" y2="180" stroke={PURPLE} strokeWidth="2.5" />
        <text x="310" y="204" textAnchor="middle" fontSize="12.5" fontWeight="800" fill={PURPLE_DEEP}>DONE — defined and written down</text>
        {[
          { y: 30, w: 210, color: RED, label: "under — a defect", tx: 340 },
          { y: 84, w: 270, color: GREEN, label: "on the line — finished", tx: 340 },
          { y: 138, w: 410, color: RED, label: "", tx: 0 },
        ].map((b, i) => (
          <g key={i}>
            {i === 2 ? (
              <>
                <rect x="40" y={b.y} width="270" height="34" rx="7" fill={GREEN} fillOpacity="0.75" />
                <rect x="310" y={b.y} width="140" height="34" rx="7" fill={RED} fillOpacity="0.75" />
                <text x="380" y={b.y + 22} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="white">"to be safe" — wasted care</text>
              </>
            ) : (
              <>
                <rect x="40" y={b.y} width={b.w} height="34" rx="7" fill={b.color} fillOpacity="0.75" />
                <text x={b.tx} y={b.y + 22} fontSize="11.5" fontWeight="700" fill={b.color}>{b.label}</text>
              </>
            )}
          </g>
        ))}
      </svg>
    </Panel>
  );
}

// ── Week 8 — Waiting ────────────────────────────────────────────────

// One morning as a timeline: the red crumbs between the work blocks are
// invisible one by one and enormous added up.
function WasteWaitingDiagram() {
  const blocks = [
    { x: 30, w: 92, wait: 14, waitLabel: "90s" },
    { x: 136, w: 74, wait: 26, waitLabel: "3m" },
    { x: 236, w: 90, wait: 20, waitLabel: "2m" },
    { x: 346, w: 60, wait: 34, waitLabel: "4m" },
  ];
  return (
    <Panel caption="Invisible one by one — enormous added up.">
      <svg viewBox="0 0 500 190" className="w-full" role="img"
        aria-label="A morning drawn as a timeline: green work blocks separated by small red waiting gaps of ninety seconds to four minutes, which add up to roughly twenty-five minutes a day.">
        <text x="30" y="40" fontSize="12.5" fontWeight="700" fill={SLATE}>one morning:</text>
        {blocks.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y="60" width={b.w} height="44" rx="7" fill={GREEN} fillOpacity="0.7" />
            <text x={b.x + b.w / 2} y="87" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="white">work</text>
            <rect x={b.x + b.w} y="60" width={b.wait} height="44" fill={RED} fillOpacity="0.8" />
            <text x={b.x + b.w + b.wait / 2} y="122" textAnchor="middle" fontSize="10" fontWeight="700" fill={RED}>{b.waitLabel}</text>
          </g>
        ))}
        <rect x="440" y="60" width="30" height="44" rx="7" fill={GREEN} fillOpacity="0.7" />
        <text x="250" y="165" textAnchor="middle" fontSize="15" fontWeight="800" fill={RED}>the crumbs ≈ 25 minutes — every day</text>
      </svg>
    </Panel>
  );
}

// The chain travels at the pace of its narrowest point: piles queue
// before it, idle hands sit after it.
function BottleneckFlowDiagram() {
  const stations = [
    { x: 60, label: "dough", r: 24 },
    { x: 160, label: "build", r: 24 },
    { x: 258, label: "oven", r: 13 },
    { x: 356, label: "wrap", r: 24 },
    { x: 448, label: "pack", r: 24 },
  ];
  return (
    <Panel caption="Minutes gained at the bottleneck flow through the whole day.">
      <svg viewBox="0 0 500 200" className="w-full" role="img"
        aria-label="Five stations in a chain with the oven drawn narrow as the bottleneck: work piles up before it and hands sit idle after it.">
        {stations.slice(0, -1).map((s, i) => (
          <line key={i} x1={s.x + s.r} y1="90" x2={stations[i + 1].x - stations[i + 1].r} y2="90" stroke={SLATE} strokeWidth="2" />
        ))}
        {stations.map(s => (
          <g key={s.label}>
            <circle cx={s.x} cy="90" r={s.r} fill={s.r < 20 ? RED : PURPLE} fillOpacity={s.r < 20 ? 0.28 : 0.14} stroke={s.r < 20 ? RED : PURPLE} strokeWidth="2.5" />
            <text x={s.x} y="140" textAnchor="middle" fontSize="11.5" fontWeight="700" fill={s.r < 20 ? RED : PURPLE_DEEP}>{s.label}</text>
          </g>
        ))}
        {/* pile before the bottleneck */}
        {[0, 1, 2, 3].map(i => (
          <circle key={i} cx={206 + (i % 2) * 13} cy={62 - Math.floor(i / 2) * 14} r="5.5" fill={RED} fillOpacity="0.7" />
        ))}
        <text x="210" y="28" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={RED}>piles form before it</text>
        <text x="310" y="52" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={SLATE}>idle hands after it</text>
        <text x="258" y="172" textAnchor="middle" fontSize="12" fontWeight="800" fill={RED}>the bottleneck sets everyone's pace</text>
      </svg>
    </Panel>
  );
}

// ── Week 9 — Waste of Skills ────────────────────────────────────────

// Sixteen experts in the building; the grey heads are the ones whose
// ideas nobody has asked for yet. The gap is the waste.
function WasteSkillsDiagram() {
  const lit = [0, 5, 11];
  return (
    <Panel caption="Every grey head is an expert we haven't asked yet.">
      <svg viewBox="0 0 500 210" className="w-full" role="img"
        aria-label="Sixteen heads representing the team, only three with lit idea bulbs — the unlit majority are the wasted skills.">
        {Array.from({ length: 16 }, (_, i) => {
          const x = 52 + (i % 8) * 57;
          const y = i < 8 ? 70 : 150;
          const on = lit.includes(i);
          return (
            <g key={i}>
              {/* idea bulb */}
              <circle cx={x} cy={y - 34} r="8" fill={on ? "#facc15" : SLATE} fillOpacity={on ? 0.95 : 0.25} stroke={on ? "#eab308" : SLATE} strokeWidth="1.5" />
              {on && <path d={`M${x - 3},${y - 25} h6`} stroke="#eab308" strokeWidth="1.5" />}
              {/* head + shoulders */}
              <circle cx={x} cy={y - 6} r="9" fill={on ? GREEN : SLATE} fillOpacity={on ? 0.8 : 0.35} />
              <path d={`M${x - 15},${y + 18} a15 15 0 0 1 30 0 z`} fill={on ? GREEN : SLATE} fillOpacity={on ? 0.8 : 0.35} />
            </g>
          );
        })}
        <text x="250" y="200" textAnchor="middle" fontSize="13" fontWeight="800" fill={PURPLE_DEEP}>16 brains in the building — how many are we asking?</text>
      </svg>
    </Panel>
  );
}

// The four walls between a good idea and a logged fix — every one of
// them ours to knock down.
function IdeaBarriersDiagram() {
  const walls = [
    '"nothing will happen"',
    '"it\'ll sound like moaning"',
    '"it\'s too small"',
    '"not my place"',
  ];
  return (
    <Panel caption="Every barrier is ours to remove — none of them is true here.">
      <svg viewBox="0 0 500 220" className="w-full" role="img"
        aria-label="A lit idea bulb on the left, a logged fix on the right, and the four crossed-out barriers between them: nothing will happen, it'll sound like moaning, it's too small, not my place.">
        {/* the idea */}
        <circle cx="55" cy="100" r="22" fill="#facc15" fillOpacity="0.9" stroke="#eab308" strokeWidth="2" />
        <path d="M47,128 h16 M49,136 h12" stroke="#eab308" strokeWidth="2.5" strokeLinecap="round" />
        <text x="55" y="170" textAnchor="middle" fontSize="11.5" fontWeight="700" fill={SLATE}>your idea</text>
        {/* the walls */}
        {walls.map((w, i) => {
          const x = 130 + i * 72;
          return (
            <g key={w}>
              <rect x={x} y="46" width="30" height="110" rx="5" fill={RED} fillOpacity="0.28" stroke={RED} strokeWidth="1.5" />
              <line x1={x - 2} y1="160" x2={x + 32} y2="42" stroke={GREEN} strokeWidth="3.5" strokeLinecap="round" />
              <text x={x + 15} y="184" textAnchor="middle" fontSize="8.6" fontWeight="600" fill={RED}
                transform={`rotate(-14 ${x + 15} 184)`}>{w}</text>
            </g>
          );
        })}
        {/* the landing */}
        <rect x="418" y="72" width="72" height="56" rx="10" fill={GREEN} fillOpacity="0.16" stroke={GREEN} strokeWidth="2" />
        <text x="454" y="96" textAnchor="middle" fontSize="12" fontWeight="800" fill={GREEN}>logged</text>
        <text x="454" y="114" textAnchor="middle" fontSize="12" fontWeight="800" fill={GREEN}>fix ✓</text>
      </svg>
    </Panel>
  );
}

// ── Originals (moved from meeting.tsx) ──────────────────────────────

// The hero: 1% better every day compounds to ~37.8× in a year; 1% worse
// decays to ~0.03×. Plotted on a linear axis so the late "explosion" of
// compounding reads instantly.
function CompoundGrowthDiagram() {
  const x0 = 56, x1 = 466, y0 = 30, y1 = 232, maxV = 38, days = 365;
  const sx = (d: number) => x0 + (d / days) * (x1 - x0);
  const sy = (v: number) => y1 - (Math.min(v, maxV) / maxV) * (y1 - y0);
  const ds: number[] = [];
  for (let d = 0; d <= days; d += 5) ds.push(d);
  if (ds[ds.length - 1] !== days) ds.push(days);
  const up = ds.map(d => `${sx(d).toFixed(1)},${sy(Math.pow(1.01, d)).toFixed(1)}`).join(" ");
  const down = ds.map(d => `${sx(d).toFixed(1)},${sy(Math.pow(0.99, d)).toFixed(1)}`).join(" ");
  const flatY = sy(1);
  const upEndY = sy(Math.pow(1.01, days));
  const downEndY = sy(Math.pow(0.99, days));
  return (
    <Panel caption="1.01³⁶⁵ ≈ 37.8 · 0.99³⁶⁵ ≈ 0.03">
      <svg viewBox="0 0 500 268" className="w-full" role="img"
        aria-label="Compound growth: improving 1% a day reaches about 37 times in a year, while declining 1% a day falls to almost nothing.">
        <line x1={x0} y1={y1} x2={x1} y2={y1} stroke={SLATE} strokeWidth="1" />
        <line x1={x0} y1={y0} x2={x0} y2={y1} stroke={SLATE} strokeWidth="1" />
        <line x1={x0} y1={flatY} x2={x1} y2={flatY} stroke={SLATE} strokeWidth="1" strokeDasharray="4 4" />
        <text x={x1} y={flatY - 6} textAnchor="end" fontSize="12" fill={SLATE}>no change · 1×</text>
        <polyline points={down} fill="none" stroke={RED} strokeWidth="2.5" />
        <polyline points={up} fill="none" stroke={GREEN} strokeWidth="3" />
        <circle cx={sx(days)} cy={upEndY} r="4.5" fill={GREEN} />
        <text x={sx(days) - 8} y={upEndY + 5} textAnchor="end" fontSize="16" fontWeight="700" fill={GREEN}>37.8×</text>
        <circle cx={sx(days)} cy={downEndY} r="4.5" fill={RED} />
        <text x={sx(days)} y={downEndY + 19} textAnchor="end" fontSize="13" fontWeight="700" fill={RED}>0.03×</text>
        <text x={x0} y={y1 + 18} fontSize="12" fill={SLATE}>Day 0</text>
        <text x={x1} y={y1 + 18} textAnchor="end" fontSize="12" fill={SLATE}>1 year</text>
        <text x={x0 + 10} y={y0 + 12} fontSize="13" fontWeight="600" fill={GREEN}>▲ 1% better / day</text>
        <text x={x0 + 10} y={y0 + 30} fontSize="13" fontWeight="600" fill={RED}>▼ 1% worse / day</text>
      </svg>
    </Panel>
  );
}

// Sweep → Sort → Standardise as a repeating cycle.
function ThreeSCycleDiagram() {
  const nodes = [
    { x: 150, y: 56, t: "Sweep", s: "daily reset" },
    { x: 248, y: 196, t: "Standardise", s: "the best way" },
    { x: 52, y: 196, t: "Sort", s: "a home for all" },
  ];
  return (
    <div className="glass-panel rounded-2xl p-5">
      <svg viewBox="0 0 300 256" className="w-full max-w-md mx-auto" role="img"
        aria-label="The 3S cycle: Sweep, then Sort, then Standardise, repeating.">
        <defs>
          <marker id="lean3sArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={PURPLE} />
          </marker>
        </defs>
        {/* cycle arrows (Sweep → Sort → Standardise → Sweep) */}
        <path d="M120,78 A 110 110 0 0 0 72,168" fill="none" stroke={PURPLE} strokeWidth="2.5" markerEnd="url(#lean3sArrow)" />
        <path d="M92,210 A 110 110 0 0 0 208,210" fill="none" stroke={PURPLE} strokeWidth="2.5" markerEnd="url(#lean3sArrow)" />
        <path d="M228,168 A 110 110 0 0 0 180,78" fill="none" stroke={PURPLE} strokeWidth="2.5" markerEnd="url(#lean3sArrow)" />
        {nodes.map(n => (
          <g key={n.t}>
            <circle cx={n.x} cy={n.y} r="40" fill={PURPLE} fillOpacity="0.12" stroke={PURPLE} strokeWidth="2" />
            <text x={n.x} y={n.y - 2} textAnchor="middle" fontSize="15" fontWeight="700" fill={PURPLE_DEEP}>{n.t}</text>
            <text x={n.x} y={n.y + 15} textAnchor="middle" fontSize="10" fill={SLATE}>{n.s}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
