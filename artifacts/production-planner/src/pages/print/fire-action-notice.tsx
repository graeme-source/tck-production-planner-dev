// Fire Action Notice — print-optimised page designed for A4 portrait.
//
// Usage: open /print/fire-action-notice in a new browser tab, use the browser
// print dialog (Cmd/Ctrl + P) and either print directly or "Save as PDF" for
// filing. Intended to be laminated and mounted next to every Manual Call Point
// and at the muster point.
//
// Layout priorities:
//   • Must read at 1m distance (main instructions)
//   • Must fit a single A4 page
//   • Fire Warden name, muster point, and site address are data we may want
//     to update without re-printing every time — but as a first pass these
//     are hard-coded from the FRA v1 draft.

import { useEffect } from "react";

export default function FireActionNoticePrint() {
  useEffect(() => {
    document.title = "Fire Action Notice — TCK Factory";
  }, []);

  return (
    <>
      <style>{`
        @page {
          size: A4 portrait;
          margin: 10mm;
        }
        @media print {
          html, body { background: white !important; }
          .no-print { display: none !important; }
        }
        .fan-page {
          max-width: 190mm;
          margin: 0 auto;
          padding: 8mm 10mm;
          background: white;
          color: #111;
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          line-height: 1.3;
        }
        .fan-title {
          background: #c1151c;
          color: white;
          text-align: center;
          font-weight: 900;
          font-size: 48pt;
          letter-spacing: 2pt;
          padding: 8mm 0 6mm;
          border-radius: 4mm;
        }
        .fan-subtitle {
          text-align: center;
          font-size: 12pt;
          color: #374151;
          margin-top: 2mm;
          margin-bottom: 4mm;
        }
        .fan-section {
          margin-top: 3mm;
          padding: 3mm 4mm 4mm;
          border: 1.5pt solid #111;
          border-radius: 3mm;
          page-break-inside: avoid;
        }
        .fan-section.red {
          border-color: #c1151c;
        }
        .fan-section.red .fan-heading {
          background: #c1151c;
          color: white;
        }
        .fan-section.red .fan-heading::before {
          content: "🔥  ";
        }
        .fan-heading {
          background: #111;
          color: white;
          font-weight: 800;
          font-size: 14pt;
          padding: 2mm 4mm;
          margin: -3mm -4mm 3mm;
          border-top-left-radius: 2.5mm;
          border-top-right-radius: 2.5mm;
          letter-spacing: 0.5pt;
        }
        .fan-ol {
          margin: 0;
          padding-left: 6mm;
          font-size: 11pt;
          font-weight: 600;
        }
        .fan-ol li {
          margin-bottom: 1.5mm;
        }
        .fan-dont {
          list-style: none;
          margin: 0;
          padding: 0;
          font-size: 10.5pt;
          font-weight: 600;
        }
        .fan-dont li {
          padding: 1.5mm 0 1.5mm 8mm;
          position: relative;
          color: #7f1d1d;
        }
        .fan-dont li::before {
          content: "✕";
          position: absolute;
          left: 0;
          color: #c1151c;
          font-weight: 900;
        }
        .fan-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 3mm;
          margin-top: 3mm;
        }
        .fan-card {
          border: 1.5pt solid #111;
          border-radius: 3mm;
          padding: 3mm 4mm;
        }
        .fan-card .label {
          font-size: 9pt;
          text-transform: uppercase;
          letter-spacing: 1pt;
          color: #6b7280;
          font-weight: 700;
        }
        .fan-card .value {
          font-size: 13pt;
          font-weight: 800;
          margin-top: 1mm;
        }
        .fan-card.green { border-color: #166534; background: #f0fdf4; }
        .fan-card.green .value { color: #166534; }
        .fan-address {
          text-align: center;
          font-size: 11pt;
          margin-top: 3mm;
          line-height: 1.4;
        }
        .fan-address strong {
          font-size: 14pt;
          letter-spacing: 0.5pt;
        }
        .fan-footer {
          margin-top: 3mm;
          padding-top: 2mm;
          border-top: 0.5pt solid #9ca3af;
          font-size: 7.5pt;
          color: #6b7280;
          text-align: center;
          font-style: italic;
        }
        .fan-print-bar {
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
        .fan-print-bar button {
          background: #111;
          color: white;
          border: 0;
          padding: 6px 14px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
        }
      `}</style>

      <div className="fan-print-bar no-print">
        <span style={{ fontSize: "13px", alignSelf: "center" }}>
          📄 Use your browser's print dialog (<kbd>Cmd</kbd>+<kbd>P</kbd> / <kbd>Ctrl</kbd>+<kbd>P</kbd>) to print or save as PDF. Laminate A4 for mounting.
        </span>
        <button onClick={() => window.print()}>Print</button>
      </div>

      <div className="fan-page">
        <div className="fan-title">FIRE ACTION</div>
        <div className="fan-subtitle">The Calzone Kitchen Ltd — Unit 1b Lower Rectory Farm, MK17 9FX</div>

        <div className="fan-section red">
          <div className="fan-heading">If you discover a fire</div>
          <ol className="fan-ol">
            <li><strong>Raise the alarm</strong> — break the glass at the nearest Manual Call Point.</li>
            <li><strong>Leave the building</strong> by the nearest fire exit.</li>
            <li><strong>Call 999.</strong> Say: <em>"Fire at The Calzone Kitchen, Unit 1b Lower Rectory Farm, Mill Lane, Great Brickhill, MK17 9FX."</em></li>
            <li><strong>Go to the assembly point.</strong></li>
            <li>Only fight the fire if you are <strong>trained</strong> and it is <strong>safe to do so</strong>.</li>
          </ol>
        </div>

        <div className="fan-section red">
          <div className="fan-heading">If you hear the fire alarm</div>
          <ol className="fan-ol">
            <li><strong>Stop work immediately.</strong> Turn equipment off only if it does not delay you.</li>
            <li><strong>Leave the building</strong> by the nearest fire exit. Close doors behind you.</li>
            <li><strong>Do not collect</strong> personal belongings.</li>
            <li><strong>Go directly to the assembly point.</strong></li>
            <li>Report to the Fire Warden and stay at the assembly point.</li>
          </ol>
        </div>

        <div className="fan-section">
          <div className="fan-heading">DO NOT</div>
          <ul className="fan-dont">
            <li>Do not re-enter the building until told it is safe by the Fire &amp; Rescue Service</li>
            <li>Do not stop to collect personal belongings</li>
            <li>Do not move vehicles</li>
            <li>Do not block the site entrance or fire-engine access</li>
          </ul>
        </div>

        <div className="fan-grid">
          <div className="fan-card green">
            <div className="label">Assembly Point</div>
            <div className="value">[designate — front car park, clear of bins]</div>
          </div>
          <div className="fan-card">
            <div className="label">Fire Warden</div>
            <div className="value">Lorna Brown</div>
            <div style={{ fontSize: "9pt", color: "#6b7280", marginTop: "1mm" }}>
              Deputy: <em>to be nominated</em>
            </div>
          </div>
        </div>

        <div className="fan-address">
          <strong>The Calzone Kitchen Ltd</strong><br />
          Unit 1b Lower Rectory Farm, Mill Lane, Great Brickhill, <strong>MK17 9FX</strong>
          <br />
          <span style={{ fontSize: "9pt", color: "#6b7280" }}>Emergency: 999 · Gas emergency: 0800 111 999</span>
        </div>

        <div className="fan-footer">
          Fire Action Notice v1 — issued April 2026 — TCK Factory FRA. Review annually or on change. Do not remove or alter.
        </div>
      </div>
    </>
  );
}
