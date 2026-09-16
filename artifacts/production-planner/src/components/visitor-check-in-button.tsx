import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Opens the visitor-book kiosk (/visitor-check-in) — press it, hand the iPad
 *  over. Carries a live count of visitors still signed in so the page
 *  doubles as the fire roll-call prompt. Lives on the Front Door —
 *  Deliveries page: deliveries, collections and visitor check-in are all
 *  the same doorstep (Graeme, 2026-09-16); it started life on the
 *  dashboard header. */
export function VisitorCheckInButton() {
  const { data: onSite } = useQuery<Array<{ id: number }>>({
    queryKey: ["visitors-on-site"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/visitors/on-site`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 120_000,
    retry: false,
  });
  const count = onSite?.length ?? 0;

  return (
    <Link href="/visitor-check-in">
      <button className="flex items-center gap-1.5 text-xs font-medium text-primary border border-primary/30 bg-primary/10 rounded-lg px-3 py-2 hover:bg-primary/20 transition-colors">
        <UserPlus className="w-3.5 h-3.5" />
        Visitor Check-In
        {count > 0 && (
          <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold tabular-nums">
            {count} on site
          </span>
        )}
      </button>
    </Link>
  );
}
