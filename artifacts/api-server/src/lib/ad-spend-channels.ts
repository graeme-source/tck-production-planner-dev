/**
 * One day's TOTAL ad spend, from every channel (Graeme, 2026-10-11).
 * Objective I.
 *
 * Every ROAS on the Numbers page — the Order Analysis tile, the trend
 * graphs and the At a Glance ROAS cards — divides by the figures this
 * produces, so Google Ads spend counts everywhere at once:
 *
 *     day total = Meta channel + Google channel
 *
 *   Meta channel   founder_ad_spend: synced from Meta, or typed by hand on
 *                  the Numbers panel (a typed figure always beats the sync).
 *   Google channel ad_spend_channel_days (channel 'google'): sent by the
 *                  Google Ads Script, or typed by hand (typed always wins).
 *
 * WHEN IS A DAY "KNOWN"? ROAS refuses to divide while any day's spend is
 * missing ("—" means "nobody has told us", never "£0"). With two channels:
 *
 *   - The Meta figure is required, exactly as before Google existed.
 *   - Google is required only from the first day Google has ever sent.
 *     Before that day Google wasn't being reported (or wasn't running), so
 *     those days keep their Meta-only totals and history doesn't vanish.
 *     From that day on, a day with no Google figure is MISSING — the script
 *     sends every day (zeros included), so a gap means it stopped, and
 *     quietly treating it as £0 would overstate ROAS.
 *
 * Pure, no I/O; the reads are lib/ad-spend-days.ts.
 */

export interface MetaChannelRow {
  date: string;
  amount: number;
  /** 'manual' (typed) or 'meta' (synced). */
  source: string;
  syncedAt: string | null;
}

export interface ChannelRow {
  date: string;
  amount: number;
  /** 'manual' (typed) or 'google_ads_script'. */
  source: string;
  receivedAt: string | null;
}

export interface CombinedSpendDay {
  date: string;
  /** Total of the channels that have sent a figure; null only when Meta
   *  (the main channel) has nothing. A day still waiting for Google counts
   *  Meta alone and says so via `missing: "google"` (Graeme, 2026-10-15:
   *  blanking the whole day hid £412 of Meta spend while the Google script
   *  wasn't running). */
  amount: number | null;
  /** The Meta channel's source ('manual' | 'meta'), as the panel has always shown. */
  source: string | null;
  syncedAt: string | null;
  /** Each channel's own figure; null = nothing recorded for that channel. */
  meta: number | null;
  google: number | null;
  googleSource: string | null;
  googleReceivedAt: string | null;
  /** Which required channel has no figure, when amount is null. */
  missing: "meta" | "google" | null;
}

const pence = (n: number) => Math.round(n * 100);

/**
 * Combine the channels into per-day totals for every day that has ANY
 * figure, oldest first. Days with nothing anywhere are absent, exactly as
 * the single-channel read always returned them.
 *
 * `googleFirstDate` is the earliest day Google has ever sent (over ALL
 * time, not just this range) — null when Google has never sent anything.
 */
export function combineChannelSpend(input: {
  meta: MetaChannelRow[];
  google: ChannelRow[];
  googleFirstDate: string | null;
}): CombinedSpendDay[] {
  const metaBy = new Map<string, MetaChannelRow>();
  for (const r of input.meta) if (Number.isFinite(r.amount) && !metaBy.has(r.date)) metaBy.set(r.date, r);
  const googleBy = new Map<string, ChannelRow>();
  for (const r of input.google) if (Number.isFinite(r.amount) && !googleBy.has(r.date)) googleBy.set(r.date, r);

  const dates = [...new Set([...metaBy.keys(), ...googleBy.keys()])].sort();
  return dates.map((date) => {
    const m = metaBy.get(date) ?? null;
    const g = googleBy.get(date) ?? null;
    const googleRequired = input.googleFirstDate != null && date >= input.googleFirstDate;
    const missing: CombinedSpendDay["missing"] = !m ? "meta" : googleRequired && !g ? "google" : null;
    return {
      date,
      amount: m ? (pence(m.amount) + (g ? pence(g.amount) : 0)) / 100 : null,
      source: m?.source ?? null,
      syncedAt: m?.syncedAt ?? null,
      meta: m ? m.amount : null,
      google: g ? g.amount : null,
      googleSource: g?.source ?? null,
      googleReceivedAt: g?.receivedAt ?? null,
      missing,
    };
  });
}
