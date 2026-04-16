// Fire Safety Equipment Audit — print-optimised.
//
// Intended use: hand to a team member (e.g. Fire Warden Lorna) who walks the
// building and ticks off each item as "present + serviced", records notes,
// and signs the bottom. Final state goes in the Fire Log Book.
//
// Content:
//   • Schedule table with check-boxes (Present / Serviced / Notes)
//   • Ground floor map: HACCP floor plan image with numbered markers overlaid
//   • First floor map: hand-drawn schematic with numbered markers
//   • Key / legend (type × colour coding)
//   • Inspector sign-off block
//
// Marker positions on the ground-floor plan are approximate — the auditor uses
// them as a starting point to find the mounted equipment; the table's location
// descriptions are authoritative.

import { useEffect } from "react";

type ExtType = "wet-chemical" | "foam" | "co2" | "blanket" | "mcp" | "exit" | "muster" | "gas-shutoff" | "consumer-unit";

interface AuditItem {
  ref: string;               // E1, MCP1, FE1, etc.
  type: ExtType;
  location: string;          // Description (authoritative)
  spec: string;              // e.g. "Wet Chemical 6L (75F)"
  purpose: string;
  // Ground-floor marker position as % of image (0–100), null = first floor or n/a
  groundX?: number;
  groundY?: number;
  // First-floor marker position as % (0–100), null = ground floor or n/a
  firstX?: number;
  firstY?: number;
}

const ITEMS: AuditItem[] = [
  // Extinguishers
  { ref: "E1", type: "wet-chemical", location: "Building Room, on escape route toward FE1 (top-left)", spec: "Wet Chemical 6L, 75F rating", purpose: "Cooking oil / hot fat fire at pizza oven", groundX: 26, groundY: 18 },
  { ref: "E2", type: "blanket", location: "Building Room, on wall near pizza oven", spec: "Fire blanket 1.2m × 1.2m", purpose: "Pan / clothing fires", groundX: 32, groundY: 15 },
  { ref: "E3", type: "wet-chemical", location: "Prep area, near combi steamer & induction hobs", spec: "Wet Chemical 6L, 75F rating", purpose: "Cooking oil fires; also Class A", groundX: 54, groundY: 45 },
  { ref: "E4", type: "foam", location: "Mixing / Meat Chop area", spec: "Foam (AFFF) 6L, 21A / 144B", purpose: "General combustibles", groundX: 38, groundY: 30 },
  { ref: "E5", type: "co2", location: "Next to consumer unit on the left (west) perimeter, ground floor", spec: "CO₂ 2kg, 34B", purpose: "Electrical fires", groundX: 9, groundY: 46 },
  { ref: "E6", type: "foam", location: "Wrapping / Labelling area", spec: "Foam (AFFF) 6L, 21A", purpose: "Cardboard / packaging", groundX: 23, groundY: 46 },
  { ref: "E7", type: "foam", location: "Packing area, near Goods Out (FE2)", spec: "Foam (AFFF) 6L, 21A", purpose: "Cardboard / general", groundX: 44, groundY: 78 },
  { ref: "E8", type: "foam", location: "First floor, near head of staircase (outside staff kitchen)", spec: "Foam (AFFF) 6L + CO₂ 2kg", purpose: "General + electrical (domestic appliances)", firstX: 48, firstY: 60 },
  { ref: "E9", type: "co2", location: "First floor, Office", spec: "CO₂ 2kg", purpose: "Electrical (IT equipment)", firstX: 75, firstY: 48 },

  // Manual call points
  { ref: "MCP1", type: "mcp", location: "Next to fire alarm panel at main entrance", spec: "Red break-glass MCP", purpose: "Manually trigger the alarm", groundX: 11, groundY: 7 },
  { ref: "MCP2", type: "mcp", location: "Beside FE2 (Goods Out) bottom-right", spec: "Red break-glass MCP", purpose: "Manually trigger the alarm", groundX: 66, groundY: 82 },
  { ref: "MCP3", type: "mcp", location: "Beside FE3 (rear exit near freezer) bottom-left", spec: "Red break-glass MCP", purpose: "Manually trigger the alarm", groundX: 11, groundY: 86 },
  { ref: "MCP4", type: "mcp", location: "First floor, head of staircase", spec: "Red break-glass MCP", purpose: "Manually trigger the alarm", firstX: 48, firstY: 64 },

  // Fire exits
  { ref: "FE1", type: "exit", location: "Top-left external door (north wall, near Ovens)", spec: "Final fire exit — EN 179 single-action hardware", purpose: "Primary escape", groundX: 11, groundY: 4 },
  { ref: "FE2", type: "exit", location: "Bottom-right external door (Goods Out)", spec: "Final fire exit — EN 1125 push-bar", purpose: "Primary escape", groundX: 62, groundY: 82 },
  { ref: "FE3", type: "exit", location: "Bottom-left external door (next to freezer extrusion)", spec: "Final fire exit — EN 179 single-action hardware", purpose: "Secondary escape", groundX: 6, groundY: 86 },

  // Other fixed kit
  { ref: "CU", type: "consumer-unit", location: "Consumer unit / distribution board — left perimeter wall", spec: "RCD-protected (landlord-managed)", purpose: "Electrical isolation", groundX: 5, groundY: 42 },
  { ref: "GS", type: "gas-shutoff", location: "Manual gas shut-off valve for Zanolli pizza oven (document precise location on-site)", spec: "Lever / quarter-turn valve", purpose: "Gas isolation in emergency", groundX: 26, groundY: 8 },
  { ref: "MP", type: "muster", location: "Muster Point — back of the car park, opposite factory front door", spec: "Photoluminescent Fire Assembly Point sign / post", purpose: "Head-count on evacuation" },
];

const TYPE_COLOUR: Record<ExtType, { fill: string; border: string; label: string }> = {
  "wet-chemical": { fill: "#fde68a", border: "#b45309", label: "Wet Chemical (Class F)" },
  "foam":         { fill: "#fca5a5", border: "#b91c1c", label: "Foam (Class A/B)" },
  "co2":          { fill: "#bae6fd", border: "#0369a1", label: "CO₂ (Electrical)" },
  "blanket":      { fill: "#fcd34d", border: "#92400e", label: "Fire Blanket" },
  "mcp":          { fill: "#ef4444", border: "#7f1d1d", label: "Manual Call Point" },
  "exit":         { fill: "#bbf7d0", border: "#166534", label: "Fire Exit" },
  "muster":       { fill: "#86efac", border: "#14532d", label: "Muster Point" },
  "gas-shutoff":  { fill: "#fbbf24", border: "#78350f", label: "Gas Shut-off" },
  "consumer-unit":{ fill: "#e9d5ff", border: "#6b21a8", label: "Consumer Unit" },
};

const UNIQUE_TYPES: ExtType[] = ["wet-chemical", "foam", "co2", "blanket", "mcp", "exit", "muster", "gas-shutoff", "consumer-unit"];

function Marker({ ref, x, y, type }: { ref: string; x: number; y: number; type: ExtType }) {
  const c = TYPE_COLOUR[type];
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        background: c.fill,
        border: `1.5pt solid ${c.border}`,
        color: c.border,
        borderRadius: "50%",
        width: "9mm",
        height: "9mm",
        fontSize: "7pt",
        fontWeight: 800,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 0 0 1.5pt white",
        lineHeight: 1,
      }}
    >
      {ref}
    </div>
  );
}

export default function FireSafetyEquipmentAuditPrint() {
  useEffect(() => {
    document.title = "Fire Safety Equipment Audit — TCK Factory";
  }, []);

  const groundItems = ITEMS.filter(i => i.groundX != null && i.groundY != null);
  const firstItems = ITEMS.filter(i => i.firstX != null && i.firstY != null);

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        @media print {
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          .no-print { display: none !important; }
          .page-break { page-break-after: always; }
        }
        html, body, .audit-page, .audit-page * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        html, body { margin: 0; padding: 0; }
        .audit-page {
          max-width: 190mm;
          margin: 0 auto;
          padding: 6mm 8mm;
          background: white;
          color: #111;
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
          line-height: 1.3;
        }
        .audit-title {
          font-size: 22pt;
          font-weight: 900;
          letter-spacing: 0.5pt;
          margin: 0 0 2mm;
          padding-bottom: 3mm;
          border-bottom: 2pt solid #111;
        }
        .audit-subtitle { font-size: 10pt; color: #374151; margin-bottom: 6mm; }
        .audit-sect-hdr {
          background: #111;
          color: white;
          padding: 2mm 4mm;
          font-weight: 700;
          font-size: 11pt;
          letter-spacing: 0.5pt;
          border-radius: 2mm;
          margin-top: 6mm;
          margin-bottom: 3mm;
        }
        .inspector-fields {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 3mm;
          padding: 3mm 0;
          border-bottom: 0.5pt solid #9ca3af;
          font-size: 9pt;
        }
        .inspector-fields .field {
          display: flex;
          flex-direction: column;
        }
        .inspector-fields label {
          font-size: 8pt;
          text-transform: uppercase;
          letter-spacing: 1pt;
          color: #6b7280;
          font-weight: 700;
          margin-bottom: 1mm;
        }
        .inspector-fields .line {
          border-bottom: 0.75pt solid #111;
          height: 7mm;
        }
        table.audit {
          width: 100%;
          border-collapse: collapse;
          font-size: 8.5pt;
          margin-top: 1mm;
        }
        table.audit th, table.audit td {
          border: 0.5pt solid #9ca3af;
          padding: 1.5mm 2mm;
          text-align: left;
          vertical-align: top;
        }
        table.audit th {
          background: #f3f4f6;
          font-weight: 700;
          text-transform: uppercase;
          font-size: 7.5pt;
          letter-spacing: 0.5pt;
        }
        table.audit .ref-pill {
          display: inline-block;
          min-width: 11mm;
          text-align: center;
          font-weight: 800;
          padding: 0.5mm 1.5mm;
          border-radius: 1.5mm;
          font-size: 8.5pt;
        }
        .check-box {
          display: inline-block;
          width: 5mm;
          height: 5mm;
          border: 1pt solid #111;
          vertical-align: middle;
        }
        .check-cell { text-align: center; width: 11mm; }
        .notes-cell { width: 30mm; }
        .legend {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2mm 4mm;
          font-size: 9pt;
          padding: 3mm;
          border: 0.75pt solid #d1d5db;
          border-radius: 2mm;
          background: #f9fafb;
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 2mm;
        }
        .legend-dot {
          width: 5mm;
          height: 5mm;
          border-radius: 50%;
          border: 1pt solid #111;
          flex-shrink: 0;
        }
        .map-wrap {
          position: relative;
          border: 0.75pt solid #9ca3af;
          border-radius: 2mm;
          overflow: hidden;
          background: white;
          page-break-inside: avoid;
        }
        .map-wrap img { width: 100%; display: block; }
        .first-floor-svg {
          width: 100%;
          background: #fafafa;
          border-radius: 2mm;
        }
        .signoff {
          margin-top: 8mm;
          padding-top: 4mm;
          border-top: 1pt solid #111;
          display: grid;
          grid-template-columns: 2fr 1fr 1fr;
          gap: 4mm;
          font-size: 9pt;
        }
        .signoff .line { border-bottom: 0.75pt solid #111; height: 9mm; }
        .audit-print-bar {
          position: sticky;
          top: 0;
          display: flex;
          gap: 8px;
          justify-content: center;
          padding: 8px;
          background: #fef3c7;
          border-bottom: 1px solid #f59e0b;
          z-index: 10;
        }
        .audit-print-bar button {
          background: #111;
          color: white;
          border: 0;
          padding: 6px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
        }
      `}</style>

      <div className="audit-print-bar no-print">
        <span style={{ fontSize: "13px", alignSelf: "center", maxWidth: "720px" }}>
          📄 <kbd>Cmd</kbd>+<kbd>P</kbd> / <kbd>Ctrl</kbd>+<kbd>P</kbd> to print. In the print dialog tick <strong>"Background graphics"</strong> so markers and colours print properly. Prints over ~3 A4 pages.
        </span>
        <button onClick={() => window.print()}>Print</button>
      </div>

      <div className="audit-page">
        <h1 className="audit-title">Fire Safety Equipment Audit</h1>
        <p className="audit-subtitle">The Calzone Kitchen Ltd — Unit 1b Lower Rectory Farm, MK17 9FX · Walk the building, tick what's present and serviced, and note anything missing or overdue.</p>

        <div className="inspector-fields">
          <div className="field"><label>Inspector name</label><div className="line" /></div>
          <div className="field"><label>Date</label><div className="line" /></div>
          <div className="field"><label>Signature</label><div className="line" /></div>
        </div>

        {/* ─── Schedule table ─── */}
        <div className="audit-sect-hdr">1. Equipment Schedule</div>
        <table className="audit">
          <thead>
            <tr>
              <th style={{ width: "14mm" }}>Ref</th>
              <th>Type / Spec</th>
              <th>Location (walk to this)</th>
              <th className="check-cell">Present</th>
              <th className="check-cell">Serviced &amp; in date</th>
              <th className="notes-cell">Notes</th>
            </tr>
          </thead>
          <tbody>
            {ITEMS.map(item => {
              const c = TYPE_COLOUR[item.type];
              return (
                <tr key={item.ref}>
                  <td>
                    <span className="ref-pill" style={{ background: c.fill, border: `1pt solid ${c.border}`, color: c.border }}>{item.ref}</span>
                  </td>
                  <td>
                    <strong>{item.spec}</strong>
                    <div style={{ fontSize: "7.5pt", color: "#6b7280", marginTop: "0.5mm" }}>{item.purpose}</div>
                  </td>
                  <td style={{ fontSize: "8pt" }}>{item.location}</td>
                  <td className="check-cell"><span className="check-box" /></td>
                  <td className="check-cell"><span className="check-box" /></td>
                  <td className="notes-cell" />
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ─── Legend ─── */}
        <div className="audit-sect-hdr">2. Key (colour = type)</div>
        <div className="legend">
          {UNIQUE_TYPES.map(t => {
            const c = TYPE_COLOUR[t];
            return (
              <div className="legend-item" key={t}>
                <span className="legend-dot" style={{ background: c.fill, borderColor: c.border }} />
                <span>{c.label}</span>
              </div>
            );
          })}
        </div>

        {/* ─── Ground floor map ─── */}
        <div className="audit-sect-hdr">3. Ground Floor — Marker Map</div>
        <p style={{ fontSize: "8.5pt", color: "#6b7280", marginTop: "-1mm", marginBottom: "2mm" }}>
          Numbered markers match the Ref column of the schedule. Positions are approximate — use the Location text in the schedule as the authoritative guide.
        </p>
        <div className="map-wrap">
          <img src="/fire-safety/ground-floor.png" alt="Ground floor plan" />
          {groundItems.map(i => (
            <Marker key={i.ref} ref={i.ref} x={i.groundX!} y={i.groundY!} type={i.type} />
          ))}
        </div>

        <div className="page-break" />

        {/* ─── First floor map ─── */}
        <div className="audit-sect-hdr">4. First Floor — Marker Map</div>
        <p style={{ fontSize: "8.5pt", color: "#6b7280", marginTop: "-1mm", marginBottom: "2mm" }}>
          Simplified schematic. The single staircase is in the centre of the floor plate; escape is down this staircase only (the upstairs windows are NOT compliant emergency escape under AD B1).
        </p>
        <div style={{ position: "relative" }}>
          <svg className="first-floor-svg" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">
            {/* Perimeter */}
            <rect x="10" y="10" width="780" height="580" fill="white" stroke="#111" strokeWidth="3" />

            {/* Toilets — top centre-left */}
            <rect x="220" y="30" width="140" height="110" fill="#fce7f3" stroke="#111" strokeWidth="1.5" />
            <line x1="290" y1="30" x2="290" y2="140" stroke="#111" strokeWidth="1.5" />
            <text x="255" y="80" fontSize="16" fontWeight="700" textAnchor="middle">Toilet</text>
            <text x="325" y="80" fontSize="16" fontWeight="700" textAnchor="middle">Toilet</text>

            {/* Sinks */}
            <rect x="260" y="150" width="100" height="40" fill="#fce7f3" stroke="#111" strokeWidth="1.5" />
            <text x="310" y="175" fontSize="14" fontWeight="700" textAnchor="middle">Sinks</text>

            {/* Kitchen — top right */}
            <rect x="420" y="30" width="350" height="200" fill="#d1fae5" stroke="#111" strokeWidth="1.5" />
            <text x="745" y="60" fontSize="18" fontWeight="800" textAnchor="end">KITCHEN</text>
            <text x="745" y="80" fontSize="10" textAnchor="end" fill="#374151">(staff welfare)</text>
            <text x="595" y="180" fontSize="10" textAnchor="middle" fill="#6b7280">Microwave · toaster · coffee · fridge/freezer · dishwasher</text>
            {/* Escape windows — mark as non-compliant */}
            <rect x="450" y="26" width="80" height="10" fill="#fca5a5" stroke="#b91c1c" strokeWidth="1.5" />
            <rect x="620" y="26" width="80" height="10" fill="#fca5a5" stroke="#b91c1c" strokeWidth="1.5" />
            <text x="490" y="22" fontSize="8" textAnchor="middle" fill="#991b1b" fontWeight="700">window — NOT escape</text>
            <text x="660" y="22" fontSize="8" textAnchor="middle" fill="#991b1b" fontWeight="700">window — NOT escape</text>

            {/* Meeting area — centre below kitchen */}
            <rect x="220" y="200" width="280" height="160" fill="#d1fae5" stroke="#111" strokeWidth="1.5" />
            <text x="360" y="230" fontSize="14" fontWeight="700" textAnchor="middle">MEETING AREA</text>
            <text x="360" y="250" fontSize="9" textAnchor="middle" fill="#6b7280">(up to 10 at breaks)</text>

            {/* Office — right */}
            <rect x="530" y="250" width="240" height="160" fill="#fef3c7" stroke="#111" strokeWidth="1.5" />
            <text x="640" y="330" fontSize="18" fontWeight="800" textAnchor="middle">OFFICE</text>

            {/* Storage — left */}
            <rect x="30" y="30" width="170" height="380" fill="#fed7aa" stroke="#111" strokeWidth="1.5" />
            <text x="115" y="220" fontSize="16" fontWeight="700" textAnchor="middle">STORAGE</text>

            {/* Stairs — centre */}
            <rect x="350" y="370" width="100" height="140" fill="#e5e7eb" stroke="#111" strokeWidth="2" strokeDasharray="4 2" />
            <text x="400" y="420" fontSize="14" fontWeight="800" textAnchor="middle">↓ STAIRS</text>
            <text x="400" y="445" fontSize="10" textAnchor="middle" fill="#6b7280">(to ground floor)</text>
            <text x="400" y="470" fontSize="10" textAnchor="middle" fill="#374151">Sole escape</text>

            {/* Labels for compass */}
            <text x="400" y="585" fontSize="9" textAnchor="middle" fill="#9ca3af">(North is up — windows on the top/north elevation)</text>
          </svg>
          {firstItems.map(i => (
            <Marker key={i.ref} ref={i.ref} x={i.firstX!} y={i.firstY!} type={i.type} />
          ))}
        </div>

        {/* ─── Additional checks ─── */}
        <div className="audit-sect-hdr">5. Additional checks (not mapped)</div>
        <table className="audit">
          <thead>
            <tr>
              <th>Item</th>
              <th className="check-cell">OK</th>
              <th className="notes-cell">Notes</th>
            </tr>
          </thead>
          <tbody>
            {[
              "All fire exits (FE1, FE2, FE3) unobstructed from inside",
              "All fire exits open without a key / two-handed action",
              "Fire alarm panel (Fike TwinflexPro²) shows green power, no fault/disabled indicators",
              "Fire alarm panel has a current service sticker (within 6 months)",
              "Emergency lighting working at every escape door (test button)",
              "No combustibles within 1m of the pizza oven, ovens, or consumer unit",
              "Cardboard / packaging not piled against any wall or blocking routes",
              "Under-stair cleaning chemical store closed; no flammables inside",
              "Fire Action Notices mounted at every MCP and at the muster point",
              "Laminated zone plan mounted next to alarm panel",
              "Fire Log Book present, recent entries up to date",
              "Staff visitor sign-in book in use and visible at front door",
              "External 600L waste bins across the road are not overflowing",
            ].map((q, i) => (
              <tr key={i}>
                <td style={{ fontSize: "8.5pt" }}>{q}</td>
                <td className="check-cell"><span className="check-box" /></td>
                <td className="notes-cell" />
              </tr>
            ))}
          </tbody>
        </table>

        {/* ─── Sign-off ─── */}
        <div className="signoff">
          <div className="field">
            <label style={{ fontSize: "8pt", color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1pt" }}>Summary of findings / actions</label>
            <div className="line" style={{ height: "14mm" }} />
          </div>
          <div className="field">
            <label style={{ fontSize: "8pt", color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1pt" }}>Date completed</label>
            <div className="line" />
          </div>
          <div className="field">
            <label style={{ fontSize: "8pt", color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1pt" }}>Inspector signature</label>
            <div className="line" />
          </div>
        </div>

        <p style={{ marginTop: "5mm", fontSize: "7.5pt", color: "#9ca3af", textAlign: "center", fontStyle: "italic" }}>
          Fire Safety Equipment Audit v1 — TCK Factory FRA. File a completed copy in the Fire Log Book. Record any missing / overdue items in the in-app Risk Assessments compliance list.
        </p>
      </div>
    </>
  );
}
