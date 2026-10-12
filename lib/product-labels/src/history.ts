/**
 * Label history (pure, tested) — Objective D (traceable, lawful labels).
 *
 * Every "Update live version" publish is kept in product_label_versions with
 * its full frozen snapshot. This turns those rows (oldest → newest) plus the
 * back-label print runs into the History tab's cards: newest first, what
 * changed against the version before, which one is live, and how many
 * production labels were printed from each. Also the archive PDF's file name
 * and its "not for printing" stamp.
 */
import { diffSnapshots, type LabelSnapshot, type SnapshotChange } from "./snapshot";

export interface HistoryVersionInput {
  id: number;
  versionNo: number;
  snapshot: LabelSnapshot;
  publishedAt: Date | string;
  publishedByName: string | null;
}

export interface HistoryPrintInput {
  labelVersionId: number | null;
  versionNo: number | null;
  count: number;
  kind: string;
  createdAt: Date | string;
}

export interface PrintStats {
  /** Production print runs (wrapping station) from this version. */
  runs: number;
  /** Labels in those runs. */
  labels: number;
  firstPrintedAt: string | null;
  lastPrintedAt: string | null;
  /** Test prints of this version (label review page) — never on product. */
  testRuns: number;
}

export interface HistoryEntry {
  id: number;
  versionNo: number;
  publishedAt: string;
  publishedByName: string | null;
  live: boolean;
  /** True for the very first publish (nothing to compare with). */
  first: boolean;
  /** What changed against the version before it. */
  changes: SnapshotChange[];
  prints: PrintStats;
}

const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

const emptyStats = (): PrintStats => ({ runs: 0, labels: 0, firstPrintedAt: null, lastPrintedAt: null, testRuns: 0 });

/** Print runs grouped by the label version they printed. Matched by version
 *  id, falling back to the version number when the id was cleared. Test
 *  prints of an unpublished proof (no version) are left out. */
export function groupPrintsByVersion(prints: HistoryPrintInput[], versions: Pick<HistoryVersionInput, "id" | "versionNo">[]): Map<number, PrintStats> {
  const byNo = new Map(versions.map(v => [v.versionNo, v.id]));
  const ids = new Set(versions.map(v => v.id));
  const out = new Map<number, PrintStats>();
  for (const p of prints) {
    const id = p.labelVersionId != null && ids.has(p.labelVersionId)
      ? p.labelVersionId
      : p.versionNo != null ? byNo.get(p.versionNo) : undefined;
    if (id == null) continue;
    const s = out.get(id) ?? emptyStats();
    if (p.kind === "test") {
      s.testRuns += 1;
    } else {
      s.runs += 1;
      s.labels += p.count;
      const at = iso(p.createdAt);
      if (!s.firstPrintedAt || at < s.firstPrintedAt) s.firstPrintedAt = at;
      if (!s.lastPrintedAt || at > s.lastPrintedAt) s.lastPrintedAt = at;
    }
    out.set(id, s);
  }
  return out;
}

/** The History tab's cards, newest first. The highest version is live. */
export function buildLabelHistory(versions: HistoryVersionInput[], prints: HistoryPrintInput[] = []): HistoryEntry[] {
  const asc = [...versions].sort((a, b) => a.versionNo - b.versionNo);
  const stats = groupPrintsByVersion(prints, asc);
  const liveNo = asc.length ? asc[asc.length - 1].versionNo : null;
  const out: HistoryEntry[] = asc.map((v, i) => ({
    id: v.id,
    versionNo: v.versionNo,
    publishedAt: iso(v.publishedAt),
    publishedByName: v.publishedByName,
    live: v.versionNo === liveNo,
    first: i === 0,
    changes: i === 0 ? [] : diffSnapshots(asc[i - 1].snapshot, v.snapshot),
    prints: stats.get(v.id) ?? emptyStats(),
  }));
  return out.reverse();
}

/** Lower-case words joined by hyphens, ASCII only — safe in a file name. */
export function slugify(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "label";
}

/** e.g. "garlic-cheese-label-v3-2026-10-12.pdf". `publishedDay` is the
 *  London calendar day (YYYY-MM-DD). */
export function archivePdfFilename(recipeName: string, versionNo: number, publishedDay: string): string {
  return `${slugify(recipeName)}-label-v${versionNo}-${publishedDay}.pdf`;
}

/** Stamped across an archived label so it can't pass for a printable one.
 *  Kept short so the diagonal stamp is big and bold; the publish date is in
 *  the file name and the PDF title. */
export function archiveStampText(versionNo: number): string {
  return `ARCHIVE v${versionNo} — NOT FOR PRINTING`;
}
