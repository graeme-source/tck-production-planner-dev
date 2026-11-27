/**
 * Which Windows printer the wrapping PC's print bridge prints back labels on
 * (Graeme, 27 Nov 2026). Empty = off: the back-labels dialog only makes the
 * PDF. Set = the dialog's main button sends the labels to that printer one
 * label at a time (bridge-print.tsx). Autosaves ~1 s after typing stops,
 * with the save state shown. Changing it needs admin (app-settings).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Wifi, WifiOff } from "lucide-react";
import { BACK_LABEL_PRINTER_SETTING_KEY, parseBackLabelPrinterSetting } from "@workspace/product-labels";
import { cn } from "@/lib/utils";
import { bridgeKeys, useBackLabelBridgeSetup } from "./bridge-print";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const URL_ = `${BASE}/api/app-settings/${BACK_LABEL_PRINTER_SETTING_KEY}`;

export function BackLabelPrinterSetting() {
  const qc = useQueryClient();
  const saved = useQuery({
    queryKey: ["app-settings", BACK_LABEL_PRINTER_SETTING_KEY],
    queryFn: async () => {
      const res = await fetch(URL_, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Couldn't load the setting (${res.status})`);
      return parseBackLabelPrinterSetting(((await res.json()) as { value: string }).value);
    },
  });
  const setup = useBackLabelBridgeSetup();
  const [printerName, setPrinterName] = useState("");
  const [station, setStation] = useState("wrapping");
  const [state, setState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loaded.current || saved.isLoading) return;
    loaded.current = true;
    setPrinterName(saved.data?.printerName ?? "");
    setStation(saved.data?.station ?? "wrapping");
  }, [saved.isLoading, saved.data]);

  const save = useMutation({
    mutationFn: async (v: { printerName: string; station: string }) => {
      const res = await fetch(URL_, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify({ printerName: v.printerName.trim(), station: v.station.trim() || "wrapping" }) }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? "Changing this needs admin access." : `Not saved (${res.status})`);
    },
    onMutate: () => setState("saving"),
    onSuccess: () => {
      setState("saved");
      qc.invalidateQueries({ queryKey: bridgeKeys.setup });
    },
    onError: () => setState("error"),
  });

  const change = (next: { printerName: string; station: string }) => {
    setPrinterName(next.printerName);
    setStation(next.station);
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save.mutate(next), 1000);
  };

  const s = setup.data;
  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-lg flex items-center gap-2"><Printer className="w-5 h-5 text-primary" /> Wrapping back-label printer</h2>
        <span className={cn("text-sm font-medium", state === "saved" && "text-emerald-600", state === "error" && "text-destructive", (state === "saving" || state === "dirty") && "text-muted-foreground")}>
          {state === "dirty" && "…"}
          {state === "saving" && "Saving…"}
          {state === "saved" && "Saved ✓"}
          {state === "error" && (save.error as Error | null)?.message}
        </span>
      </div>
      <p className="text-sm text-muted-foreground max-w-prose">
        The wrapping PC prints back labels one at a time through this Windows printer, so a roll running out only
        reprints the one label. Type the printer's name exactly as Windows shows it (Settings → Printers &amp; scanners).
        Leave it empty to print back labels from the PDF only. Setup steps: tools/print-bridge/README.md, “Wrapping back labels”.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
        <label className="block">
          <span className="text-sm font-medium block mb-1">Windows printer name</span>
          <input
            value={printerName}
            onChange={e => change({ printerName: e.target.value, station })}
            placeholder="e.g. ZDesigner ZD421-203dpi ZPL"
            className="w-full h-12 px-3 border-2 border-border rounded-xl text-base bg-background"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium block mb-1">Bridge (STATION in its .env)</span>
          <input
            value={station}
            onChange={e => change({ printerName, station: e.target.value })}
            className="w-full h-12 px-3 border-2 border-border rounded-xl text-base bg-background"
          />
        </label>
      </div>
      {s?.configured && (
        <div className={cn("flex items-center gap-3 rounded-xl px-4 py-3 border-2", s.bridgeOnline ? "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-800" : "border-amber-400 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-700")}>
          {s.bridgeOnline ? <Wifi className="w-6 h-6 text-emerald-600 shrink-0" /> : <WifiOff className="w-6 h-6 text-amber-600 shrink-0" />}
          <p className="font-semibold">
            {s.bridgeOnline
              ? "The wrapping printer computer is connected."
              : s.lastSeenAt
                ? `The wrapping printer computer isn't connected (last seen ${new Date(s.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}).`
                : "The wrapping printer computer hasn't connected since the app started."}
          </p>
        </div>
      )}
    </div>
  );
}
