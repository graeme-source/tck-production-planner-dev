/**
 * Current rate of pay and the last pay rise (Graeme, 26 Nov 2026: "I want to
 * be able to see it there so I can discuss it with them during the
 * performance review"). From Planday, refreshed daily on the server
 * (routes/people-pay.ts), shown on a person's People record and their
 * performance review page — People access only, never your own record, and
 * never part of the report copy shared with them. Objective H.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PoundSterling, RefreshCw } from "lucide-react";
import { fmtDayIso, londonTodayIso } from "@workspace/people-reviews";
import { peopleFetch, peopleRetry } from "@/hooks/use-people-gate";
import { api } from "@/components/employee-reviews";
import { toast } from "@/hooks/use-toast";

interface PayRow {
  userId: number;
  known: boolean;
  currentRate?: number | null;
  wageType?: string | null;
  rates?: Array<{ rate: number; wageType: string; salaryCode: string }>;
  lastChangeOn?: string | null;
  previousRate?: number | null;
  historyFrom?: string | null;
  syncedAt?: string;
}

const gbp = (n: number) => `£${n.toFixed(2)}`;
const per = (t: string | null | undefined) => (!t || /hour/i.test(t) ? "an hour" : /month/i.test(t) ? "a month" : /year|annual/i.test(t) ? "a year" : "");

export function PayRateCard({ userId, ready, canWrite }: { userId: number; ready: boolean; canWrite: boolean }) {
  const qc = useQueryClient();
  const key = ["people-record-entries", "pay", userId];
  const q = useQuery<PayRow>({
    queryKey: key,
    queryFn: () => peopleFetch<PayRow>(`/people-reviews/person/${userId}/pay`),
    enabled: ready && canWrite,
    retry: peopleRetry,
    refetchOnWindowFocus: false,
  });
  const refresh = useMutation({
    mutationFn: () => api<PayRow>(`/people-reviews/person/${userId}/pay/refresh`, { method: "POST", body: "{}" }),
    onSuccess: (row) => qc.setQueryData(key, row),
    onError: (e: Error) => toast({ title: "Couldn't read Planday", description: e.message, variant: "destructive" }),
  });
  if (!canWrite || q.isError) return null;
  const row = q.data;
  const otherRates = (row?.rates ?? []).filter(r => row?.currentRate == null || Math.abs(r.rate - row.currentRate) > 0.004);

  return (
    <div className="rounded-2xl border-2 border-border p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PoundSterling className="w-6 h-6 text-primary shrink-0" />
        <div className="flex-1 min-w-[12rem]">
          <p className="text-sm font-semibold text-muted-foreground">Current rate of pay</p>
          {!row ? (
            <p className="text-base text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking…</p>
          ) : !row.known || row.currentRate == null ? (
            <p className="text-base text-muted-foreground">Not read from Planday yet{row.known ? " — no rate set there" : ""}.</p>
          ) : (
            <>
              <p className="text-lg font-bold leading-snug">{gbp(row.currentRate)} <span className="text-base font-medium text-muted-foreground">{per(row.wageType)}</span></p>
              <p className="text-sm text-muted-foreground">
                {row.lastChangeOn
                  ? <>Last pay rise <span className="font-semibold text-foreground">{fmtDayIso(row.lastChangeOn)}</span>{row.previousRate != null ? <>, from {gbp(row.previousRate)}</> : null}</>
                  : row.historyFrom ? <>No pay change since {fmtDayIso(row.historyFrom)}</> : "Pay history not read yet"}
              </p>
              {otherRates.length > 0 && (
                <p className="text-xs text-muted-foreground">Also set in Planday: {otherRates.map(r => `${gbp(r.rate)}${r.salaryCode ? ` (${r.salaryCode})` : ""}`).join(", ")}</p>
              )}
            </>
          )}
        </div>
        <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending}
          className="h-11 px-3 rounded-xl border-2 border-border text-sm font-semibold flex items-center gap-2 hover:bg-secondary disabled:opacity-60">
          {refresh.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
        </button>
      </div>
      {row?.syncedAt && (
        <p className="text-xs text-muted-foreground">
          From Planday{londonTodayIso(new Date(row.syncedAt)) === londonTodayIso() ? " today" : `, ${fmtDayIso(londonTodayIso(new Date(row.syncedAt)))}`}. Private — People access only, never shown to them.
        </p>
      )}
    </div>
  );
}
