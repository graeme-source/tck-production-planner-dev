import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";

// Issue #339: when APC's tracking has been slow several times in a row, the
// pack list shows ONE banner instead of a warning on every order. Polling
// this endpoint also keeps today's consignments' APC tracking read in the
// background, so opening an order uses a cached answer instead of waiting
// on APC.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ApcTrackingHealth {
  slow: boolean;
  message: string | null;
}

async function fetchApcTrackingHealth(): Promise<ApcTrackingHealth> {
  const res = await fetch(`${BASE}/api/fulfilment/apc-tracking-health`, { credentials: "include" });
  if (!res.ok) throw new Error("Could not read APC tracking health");
  return res.json();
}

export function ApcTrackingSlowBanner() {
  const { data } = useQuery({
    queryKey: ["fulfilment-apc-tracking-health"],
    queryFn: fetchApcTrackingHealth,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  if (!data?.slow || !data.message) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-secondary/50 text-base text-muted-foreground"
    >
      <Clock className="w-5 h-5 flex-shrink-0" />
      <span>{data.message}</span>
    </div>
  );
}
