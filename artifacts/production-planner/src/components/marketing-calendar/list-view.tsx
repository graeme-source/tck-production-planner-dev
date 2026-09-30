/**
 * List view (Graeme, 2026-09-30): the peak-trading spreadsheet as big cards.
 * Top to bottom in date order, grouped into campaign sections (a campaign's
 * name, dates and offer as the header; tap it to open the campaign). Each
 * planned email shows its day, subject line, offer, core message, cadence,
 * audience and the website / Meta changes at a glance. Klaviyo's real sends
 * sit in the right section as read-only cards, and a planned email linked to
 * its Klaviyo send is ONE card with a "Scheduled/Sent in Klaviyo ✓" badge.
 *
 * Grouping is the pure buildEmailSections() in @workspace/marketing-calendar.
 */
import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { CheckCircle2, Globe, Mail, Megaphone, MessageSquare, Plus, Repeat, Target, Users } from "lucide-react";
import { audienceLabel, buildEmailSections, defaultEmailDate, formatDay, formatRange } from "@workspace/marketing-calendar";
import { cn } from "@/lib/utils";
import type { CalEvent, KlaviyoEmail, PlannedEmail } from "./api";
import { emailStatus, typeStyle } from "./constants";

export function ListView({ today, events, planned, klaviyo, showPast, onOpenCampaign, onOpenEmail, onOpenKlaviyo, onAddEmail }: {
  today: string;
  events: CalEvent[];
  planned: PlannedEmail[];
  klaviyo: KlaviyoEmail[];
  showPast: boolean;
  onOpenCampaign: (id: number) => void;
  onOpenEmail: (id: number) => void;
  onOpenKlaviyo: (k: KlaviyoEmail) => void;
  onAddEmail: (date: string) => void;
}) {
  const sections = useMemo(
    () => buildEmailSections({ campaigns: events, planned, klaviyo, today, showPast }),
    [events, planned, klaviyo, today, showPast],
  );

  if (sections.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-border p-6 text-center space-y-3">
        <p className="text-base text-muted-foreground">No campaigns or emails coming up yet.</p>
        <button type="button" onClick={() => onAddEmail(today)}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add email
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {sections.map(section => {
        const c = section.campaign;
        const style = c ? typeStyle(c.type) : null;
        return (
          <section key={section.key} className={cn("rounded-2xl border-2 overflow-hidden", c ? "border-border" : "border-dashed border-border")}>
            {/* Section header */}
            <div className="flex items-stretch gap-0 bg-secondary/30 border-b border-border">
              {style && <span className={cn("w-2 flex-shrink-0", style.dot)} />}
              {c ? (
                <button type="button" onClick={() => onOpenCampaign(c.id)} className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-secondary/50" title="Open the campaign to rename it or change its dates">
                  <span className="flex items-center gap-2 flex-wrap">
                    <Megaphone className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-lg font-bold">{c.title}</span>
                    <span className="text-sm font-semibold text-muted-foreground">{formatRange(c.startDate, c.endDate)}</span>
                    {c.startDate <= today && c.endDate >= today && (
                      <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-primary text-primary-foreground">On now</span>
                    )}
                  </span>
                  {(c.offer || c.summary) && (
                    <span className="block text-sm text-muted-foreground mt-0.5 line-clamp-2">{c.offer || c.summary}</span>
                  )}
                </button>
              ) : (
                <div className="flex-1 px-4 py-3">
                  <span className="text-lg font-bold text-muted-foreground">Not in a campaign</span>
                </div>
              )}
              <button type="button" onClick={() => onAddEmail(c ? defaultEmailDate(c, today) : section.items[0]?.date ?? today)}
                className="self-center px-3 sm:px-4 py-2.5 m-2 rounded-xl border-2 border-indigo-500/40 text-indigo-700 dark:text-indigo-300 text-sm font-semibold flex items-center gap-1.5 hover:bg-indigo-500/10 flex-shrink-0">
                <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Add email</span><span className="sm:hidden">Email</span>
              </button>
            </div>

            <div className="p-3 space-y-3">
              {section.items.length === 0 && (
                <p className="text-sm text-muted-foreground px-1">No emails planned in this campaign yet.</p>
              )}
              {section.items.map(item => item.kind === "planned"
                ? <PlannedCard key={`p-${item.planned.id}`} email={item.planned} klaviyo={item.klaviyo} today={today} onOpen={() => onOpenEmail(item.planned.id)} />
                : <KlaviyoCard key={`k-${item.klaviyo.id}`} email={item.klaviyo} onOpen={() => onOpenKlaviyo(item.klaviyo)} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DateBlock({ date, time, past }: { date: string; time: string | null; past: boolean }) {
  const [dow, d, mon] = formatDay(date).split(" ");
  return (
    <span className={cn("w-16 flex-shrink-0 self-start rounded-xl border-2 text-center py-1.5", past ? "border-border text-muted-foreground" : "border-indigo-500/40")}>
      <span className="block text-xs font-semibold uppercase">{dow}</span>
      <span className="block text-2xl font-bold leading-none">{d}</span>
      <span className="block text-xs font-semibold uppercase">{mon}</span>
      {time && <span className="block text-xs font-semibold text-muted-foreground mt-0.5">{time}</span>}
    </span>
  );
}

function Line({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-start gap-1.5 text-sm min-w-0">
      <span className="text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden>{icon}</span>
      <span className="min-w-0"><span className="text-muted-foreground">{label}: </span>{children}</span>
    </span>
  );
}

function PlannedCard({ email: e, klaviyo, today, onOpen }: { email: PlannedEmail; klaviyo: KlaviyoEmail | null; today: string; onOpen: () => void }) {
  const st = emailStatus(e.status);
  const audience = [...e.audiences.map(audienceLabel), ...(e.audienceOther ? [e.audienceOther] : [])].join(", ");
  return (
    <button type="button" onClick={onOpen} className="w-full text-left rounded-2xl border-2 border-indigo-500/40 bg-background hover:bg-secondary/30 p-3.5 flex gap-3">
      <DateBlock date={e.sendDate} time={e.sendTime} past={e.sendDate < today} />
      <span className="flex-1 min-w-0 space-y-1.5">
        <span className="flex items-center gap-2 flex-wrap">
          <Mail className="w-4 h-4 text-indigo-600 flex-shrink-0" />
          <span className="text-base font-bold">{e.subject}</span>
        </span>
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", st.chip)}>{st.label}</span>
          {klaviyo && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> {klaviyo.status === "Sent" ? "Sent" : "Scheduled"} in Klaviyo
            </span>
          )}
          {!klaviyo && e.klaviyoCampaignId && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary text-muted-foreground">Linked to Klaviyo</span>
          )}
        </span>
        <span className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
          {e.offer && <Line icon={<Target className="w-3.5 h-3.5" />} label="Offer">{e.offer}</Line>}
          {e.coreMessage && <Line icon={<MessageSquare className="w-3.5 h-3.5" />} label="Message">{e.coreMessage}</Line>}
          {e.cadence && <Line icon={<Repeat className="w-3.5 h-3.5" />} label="Cadence">{e.cadence}</Line>}
          {audience && <Line icon={<Users className="w-3.5 h-3.5" />} label="Audience">{audience}</Line>}
          {e.websiteChange && <Line icon={<Globe className="w-3.5 h-3.5" />} label="Website">{e.websiteChange}</Line>}
          {e.metaChange && <Line icon={<Megaphone className="w-3.5 h-3.5" />} label="Meta">{e.metaChange}</Line>}
        </span>
      </span>
    </button>
  );
}

function KlaviyoCard({ email: k, onOpen }: { email: KlaviyoEmail; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full text-left rounded-2xl border-2 border-dashed border-sky-500/50 bg-sky-500/5 hover:bg-sky-500/10 p-3.5 flex gap-3">
      <DateBlock date={k.date} time={format(parseISO(k.sendAt), "HH:mm")} past={k.status === "Sent"} />
      <span className="flex-1 min-w-0 space-y-1">
        <span className="block text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
          Klaviyo · {k.status} · not planned here
        </span>
        <span className="block text-base font-bold truncate">{k.subject ?? k.name}</span>
        <span className="block text-sm text-muted-foreground truncate">{k.name}{k.audiences.length ? ` · ${k.audiences.join(", ")}` : ""}</span>
      </span>
    </button>
  );
}
