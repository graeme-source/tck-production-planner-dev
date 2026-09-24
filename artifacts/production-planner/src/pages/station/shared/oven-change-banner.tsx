import { Flame } from "lucide-react";
import { formatOvenTime, type OvenChangeReminder } from "./oven-reminder";

/** Big amber "oven change" strip for a recipe whose oven setting differs
 *  from its profile's standard (shared/oven-reminder.ts). Readable at arm's
 *  length on the 10.2" iPad; a banner, never a gate. `atOvens` words it for
 *  whoever sets the ovens rather than the builders. */
export function OvenChangeBanner({ reminder, atOvens = false }: { reminder: OvenChangeReminder; atOvens?: boolean }) {
  const { setting, standard } = reminder;
  return (
    <div role="alert" className="flex items-center gap-3 px-4 py-3 bg-amber-500 text-white border-b-4 border-amber-600">
      <Flame className="w-9 h-9 flex-shrink-0" strokeWidth={2.5} />
      <div className="min-w-0">
        <p className="text-2xl font-extrabold leading-tight tabular-nums">
          {atOvens ? "Set oven" : "Oven change"}: {setting.tempC}°C for {formatOvenTime(setting.timeSeconds)}
        </p>
        <p className="text-base font-semibold opacity-95 leading-snug">
          {standard
            ? <>Standard is {standard.tempC}°C for {formatOvenTime(standard.timeSeconds)} — {atOvens ? "change it back after this recipe." : "tell the ovens, and change it back after."}</>
            : atOvens ? <>For this recipe only.</> : <>Tell the ovens before these go in.</>}
        </p>
      </div>
    </div>
  );
}
