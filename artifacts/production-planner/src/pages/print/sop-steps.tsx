// SOP step grid — print-optimised page for the factory wall.
//
// Usage: opened in a new tab as /print/sop/:id (from the SOP viewer's
// "Print PDF" button). Use the browser print dialog (Cmd/Ctrl + P) and
// "Save as PDF" or print directly. A4 landscape, steps laid out as a grid
// of picture + caption, broken across pages every N steps.
//
// Steps-per-page resolution (highest priority first):
//   1. ?perPage= query override (one-off prints)
//   2. the SOP's saved steps_per_page setting (manual override, 1-6)
//   3. auto — a balanced fill, max 6 per page
//
// Images load via the same-origin /api/standards/steps/:id/image endpoint,
// so no base64 embedding is needed — the browser fetches them for print.

import { useEffect, useState } from "react";
import { useParams } from "wouter";

interface SopStep {
  id: number;
  position: number;
  description: string;
  hasImage: boolean;
}

interface SopDetail {
  id: number;
  title: string;
  stepsPerPage: number | null;
  steps: SopStep[];
}

// Auto: fill pages as evenly as possible, never more than 6 per page.
// 8 steps -> 4+4, 9 -> 5+4, 12 -> 6+6, <=6 -> single page.
function autoPerPage(total: number): number {
  if (total <= 6) return Math.max(total, 1);
  const pages = Math.ceil(total / 6);
  return Math.ceil(total / pages);
}

// Balanced grid columns for landscape: 2 across, quarters (2x2), 2x3.
function columnsFor(perPage: number): number {
  if (perPage <= 3) return perPage;
  if (perPage <= 4) return 2;
  return 3;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function SopStepsPrint() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [sop, setSop] = useState<SopDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/standards/${id}`, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: SopDetail) => { if (!cancelled) { setSop(data); document.title = `SOP — ${data.title}`; } })
      .catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [id]);

  if (error) {
    return <div style={{ padding: 32, fontFamily: "system-ui" }}>Couldn’t load SOP: {error}</div>;
  }
  if (!sop) {
    return <div style={{ padding: 32, fontFamily: "system-ui" }}>Loading…</div>;
  }

  const total = sop.steps.length;
  const override = new URLSearchParams(window.location.search).get("perPage");
  const overrideNum = override ? Number(override) : NaN;
  const perPage = Number.isInteger(overrideNum) && overrideNum >= 1 && overrideNum <= 6
    ? overrideNum
    : (sop.stepsPerPage && sop.stepsPerPage >= 1 && sop.stepsPerPage <= 6
        ? sop.stepsPerPage
        : autoPerPage(total));
  const cols = columnsFor(perPage);
  const pages = chunk(sop.steps, perPage);

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          .no-print { display: none !important; }
          .sop-page { box-shadow: none !important; margin: 0 !important; }
        }
        html, body, .sop-page, .sop-page * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        body { background: #e5e7eb; margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #111; }

        .sop-print-bar {
          position: sticky; top: 0; z-index: 10;
          display: flex; gap: 12px; align-items: center; justify-content: center;
          padding: 10px; background: #fef3c7; border-bottom: 1px solid #f59e0b;
        }
        .sop-print-bar button {
          background: #111; color: white; border: 0; padding: 6px 16px;
          border-radius: 6px; cursor: pointer; font-weight: 600;
        }
        .sop-print-bar .meta { font-size: 13px; color: #92400e; }

        .sop-page {
          width: 281mm; height: 194mm;            /* A4 landscape minus 8mm margins */
          background: white; margin: 12px auto; padding: 0;
          display: flex; flex-direction: column;
          box-shadow: 0 1px 6px rgba(0,0,0,0.15);
          page-break-after: always; overflow: hidden;
        }
        .sop-page:last-child { page-break-after: auto; }

        .sop-head {
          display: flex; justify-content: space-between; align-items: baseline;
          border-bottom: 2px solid #16a34a; padding-bottom: 5px; margin-bottom: 8px;
        }
        .sop-head h1 { font-size: 18pt; font-weight: 800; margin: 0; }
        .sop-head .pageno { font-size: 9pt; color: #555; }

        .sop-grid { flex: 1; display: grid; gap: 6mm; min-height: 0; }
        .sop-cell {
          display: flex; flex-direction: column; min-height: 0;
          border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden;
        }
        .sop-img-wrap {
          flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center;
          background: #f8fafc; padding: 4px;
        }
        .sop-img-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .sop-img-wrap.empty { color: #9ca3af; font-size: 9pt; }
        .sop-cap {
          padding: 5px 8px; border-top: 1px solid #e5e7eb; background: #fff;
          font-size: 11pt; line-height: 1.25; flex-shrink: 0;
        }
        .sop-cap .num {
          display: inline-block; min-width: 20px; height: 20px; line-height: 20px;
          text-align: center; background: #16a34a; color: white; border-radius: 50%;
          font-weight: 700; font-size: 9pt; margin-right: 6px;
        }
      `}</style>

      <div className="sop-print-bar no-print">
        <span className="meta">
          {sop.title} — {total} step{total === 1 ? "" : "s"}, {perPage} per page
          {override ? "" : (sop.stepsPerPage ? " (manual)" : " (auto)")}
        </span>
        <button onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      {pages.map((pageSteps, pi) => (
        <div className="sop-page" key={pi}>
          <div className="sop-head">
            <h1>{sop.title}</h1>
            <span className="pageno">Page {pi + 1} of {pages.length}</span>
          </div>
          <div
            className="sop-grid"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: "1fr" }}
          >
            {pageSteps.map((step, si) => {
              const stepNumber = pi * perPage + si + 1;
              return (
                <div className="sop-cell" key={step.id}>
                  <div className={`sop-img-wrap${step.hasImage ? "" : " empty"}`}>
                    {step.hasImage
                      ? <img src={`/api/standards/steps/${step.id}/image`} alt="" />
                      : <span>No photo</span>}
                  </div>
                  <div className="sop-cap">
                    <span className="num">{stepNumber}</span>
                    {step.description || <em style={{ color: "#9ca3af" }}>No description</em>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
