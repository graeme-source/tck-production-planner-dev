import type React from "react";
import { cn } from "@/lib/utils";

/** A headline number card used across Analytics (moved out of
 *  pages/reports.tsx so tabs can live in their own files). */
export function SummaryCard({ icon, label, value, sub, highlight }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlight?: "red" | "green" | "amber";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-muted-foreground font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && (
        <p className={cn(
          "text-xs mt-1",
          highlight === "red" ? "text-red-600" : highlight === "green" ? "text-emerald-600" : highlight === "amber" ? "text-amber-600" : "text-muted-foreground"
        )}>
          {sub}
        </p>
      )}
    </div>
  );
}
