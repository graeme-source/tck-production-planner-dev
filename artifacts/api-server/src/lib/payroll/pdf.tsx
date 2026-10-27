// Monthly payroll report as an A4 PDF (objective B). Same library as every
// other PDF in the app (@react-pdf/renderer — see src/pdf/*.tsx).

import React from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
type Style = Parameters<typeof StyleSheet.create>[0][string];

export interface PayrollPdfInput {
  periodLabel: string;
  generatedAt: string;
  people: Array<{
    name: string; shifts: number; hourlyRate: number | null;
    productionHours: number; productionPay: number;
    holidayHours: number; holidayPay: number | null;
    office: Array<{ work: string; hours: number; pay: number }>;
  }>;
  totals: {
    hours: number; grossPay: number;
    productionHours: number; productionPay: number;
    officeHours: number; officePay: number;
    holidayHours: number; holidayPay: number;
    sspEstimate?: number;
  };
  sick: Array<{ name: string; date: string; hours: number | null; ssp?: number | null; contractDaysPerWeek: number | null; contractHoursPerWeek: number | null }>;
  /** Statutory Sick Pay estimate per person — for the accountant to check. */
  ssp?: Array<{ name: string; sickDays: number; total: number; byHandDays?: number; awe: number | null; weeklySsp: number | null; qualifyingDaysPerWeek: number | null; notes: string[] }>;
  joiners: Array<{ name: string; date: string; documents: string[] }>;
  leavers: Array<{ name: string; date: string; note?: string | null }>;
  /** Month-end adjustments for the month end inside this pay period. */
  monthEnd?: MonthEndPdf | null;
  /** Optional appendix: every month end since 31 Mar 2025. */
  history?: MonthEndHistoryPdf | null;
}

/** One pay period's month-end adjustments (lib/payroll/month-end.ts). */
export interface MonthEndPdf {
  /** "Month-end adjustments for September 2026" */
  title: string;
  deferred: {
    heading: string;
    incVat: number;
    /** Shown only when VAT makes a difference. */
    exVat: number | null;
    orders: number;
    definition: string;
    opening: { label: string; incVat: number } | null;
    movement: number | null;
    trust: string;
    notes: string[];
  } | null;
  deferredError: string | null;
  labour: {
    heading: string;
    pay: number;
    hours: number;
    holidayPay: number;
    holidayHours: number;
    opening: { label: string; pay: number } | null;
    movement: number | null;
    employer: { total: number; ni: number; pension: number; note: string } | null;
    notes: string[];
  } | null;
  labourError: string | null;
}

type Mv = { opening: number | null; closing: number | null; movement: number | null };
export interface MonthEndHistoryPdf {
  opening: { label: string; deferred: number | null; labour: number | null } | null;
  years: Array<{
    year: string; span: string; complete: boolean; deferred: Mv; labour: Mv;
    rows: Array<{ label: string; deferred: Mv; labour: Mv; trustworthy: boolean | null; error: string | null }>;
  }>;
}

const GREEN = "#7cb342";
const DARK = "#1f2937";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 9.5, color: DARK },
  brand: { fontSize: 18, fontFamily: "Helvetica-Bold", color: GREEN },
  title: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 4 },
  meta: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  h2: { fontSize: 11.5, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 6, color: DARK },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 3.5 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: DARK, paddingBottom: 3 },
  totalRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: DARK, paddingTop: 4, fontFamily: "Helvetica-Bold" },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  num: { textAlign: "right" },
  empty: { color: MUTED, fontStyle: "italic" },
  item: { marginBottom: 4 },
  sub: { color: MUTED, fontSize: 8.5 },
  pageNo: { position: "absolute", bottom: 20, right: 36, fontSize: 7.5, color: MUTED },
});

type Col = { key: string; label: string; flex: number; num: boolean };
// Above the line: production shifts + holiday. Office work is below it.
const COLS: Col[] = [
  { key: "name", label: "Name", flex: 3, num: false },
  { key: "hours", label: "Hours", flex: 1.1, num: true },
  { key: "holiday", label: "Holiday hrs", flex: 1.3, num: true },
  { key: "rate", label: "Rate", flex: 1.1, num: true },
  { key: "gross", label: "Gross", flex: 1.5, num: true },
];
const OFFICE_COLS: Col[] = [
  { key: "name", label: "Name", flex: 3, num: false },
  { key: "work", label: "Work", flex: 2.4, num: false },
  { key: "hours", label: "Hours", flex: 1.1, num: true },
  { key: "pay", label: "Pay", flex: 1.5, num: true },
];

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

function Cells({ values, style, cols = COLS }: { values: string[]; style?: Style; cols?: Col[] }) {
  return (
    <>
      {cols.map((c, i) => (
        <Text key={c.key} style={[{ flex: c.flex }, ...(c.num ? [s.num] : []), ...(style ? [style] : [])]}>{values[i]}</Text>
      ))}
    </>
  );
}

function contractLine(days: number | null, hours: number | null): string | null {
  const parts: string[] = [];
  if (days != null) parts.push(`${hrs(days)} day${days === 1 ? "" : "s"}`);
  if (hours != null) parts.push(`${hrs(hours)} hours`);
  return parts.length ? `normally ${parts.join(" / ")} a week` : null;
}

function Empty({ text }: { text: string }) {
  return <Text style={s.empty}>{text}</Text>;
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${gbp(Math.abs(n))}`;

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={[s.row, ...(bold ? [{ fontFamily: "Helvetica-Bold" }] : [])]} wrap={false}>
      <Text style={{ flex: 1 }}>{label}</Text>
      <Text style={s.num}>{value}</Text>
    </View>
  );
}

function MonthEndSection({ m }: { m: MonthEndPdf }) {
  const d = m.deferred;
  const l = m.labour;
  return (
    <>
      <Text style={s.h2}>{m.title}</Text>
      {d ? (
        <View style={s.item}>
          <Line bold label={`${d.heading} — ${d.orders} order${d.orders === 1 ? "" : "s"}${d.exVat != null ? " (inc VAT)" : ""}`} value={gbp(d.incVat)} />
          {d.exVat != null ? <Line label="  ex VAT" value={gbp(d.exVat)} /> : null}
          {d.opening ? <Line label={`  Opening: ${d.opening.label}`} value={gbp(d.opening.incVat)} /> : null}
          {d.movement != null ? <Line label="  Movement (closing minus opening) — take off this month's sales" value={signed(d.movement)} /> : null}
          <Text style={[s.sub, { marginTop: 3 }]}>{d.definition}</Text>
          <Text style={s.sub}>{d.trust}</Text>
          {d.notes.map((n, i) => <Text key={i} style={s.sub}>{n}</Text>)}
        </View>
      ) : <Text style={s.empty}>Deferred income couldn't be worked out: {m.deferredError ?? "unknown error"}</Text>}
      {l ? (
        <View style={[s.item, { marginTop: 8 }]}>
          <Line bold label={`${l.heading} — ${hrs(l.hours)} hours`} value={gbp(l.pay)} />
          {l.holidayHours > 0 ? <Line label={`  includes holiday (${hrs(l.holidayHours)} hours)`} value={gbp(l.holidayPay)} /> : null}
          {l.opening ? <Line label={`  Opening: ${l.opening.label}`} value={gbp(l.opening.pay)} /> : null}
          {l.movement != null ? <Line label="  Movement (closing minus opening) — add to this month's wages" value={signed(l.movement)} /> : null}
          {l.employer ? <Line label={`  Employer NI ${gbp(l.employer.ni)} + pension ${gbp(l.employer.pension)} — ESTIMATE`} value={gbp(l.employer.total)} /> : null}
          <Text style={[s.sub, { marginTop: 3 }]}>
            Shifts worked from the 25th to the month end are paid in this pay period but belong to the month before. Same pay rules as above:
            approved shifts, unpaid breaks off, holiday hours at the person's rate.
          </Text>
          {l.employer ? <Text style={s.sub}>{l.employer.note}</Text> : null}
          {l.notes.map((n, i) => <Text key={i} style={s.sub}>{n}</Text>)}
        </View>
      ) : <Text style={s.empty}>Labour couldn't be worked out: {m.labourError ?? "unknown error"}</Text>}
    </>
  );
}

const H_COLS: Col[] = [
  { key: "label", label: "Month end", flex: 3.2, num: false },
  { key: "do", label: "Opening", flex: 1.3, num: true },
  { key: "dc", label: "Closing", flex: 1.3, num: true },
  { key: "dm", label: "Movement", flex: 1.2, num: true },
  { key: "lo", label: "Opening", flex: 1.3, num: true },
  { key: "lc", label: "Closing", flex: 1.3, num: true },
  { key: "lm", label: "Movement", flex: 1.2, num: true },
];

function HistoryHead() {
  return (
    <>
      <View style={{ flexDirection: "row", marginBottom: 1 }}>
        <Text style={{ flex: 3.2 }} />
        <Text style={[s.th, { flex: 3.8, textAlign: "center", borderBottomWidth: 0.5, borderBottomColor: MUTED }]}>Deferred income (inc VAT)</Text>
        <Text style={[s.th, { flex: 3.8, textAlign: "center", borderBottomWidth: 0.5, borderBottomColor: MUTED, marginLeft: 6 }]}>Labour, 25th to month end</Text>
      </View>
      <View style={s.headRow}><Cells cols={H_COLS} values={H_COLS.map(c => c.label)} style={s.th} /></View>
    </>
  );
}
const money = (n: number | null) => (n == null ? "—" : gbp(n));
const mvm = (n: number | null) => (n == null ? "—" : signed(n));

function HistoryAppendix({ h }: { h: MonthEndHistoryPdf }) {
  return (
    <Page size="A4" style={[s.page, { fontSize: 8 }]}>
      <Text style={s.title}>Appendix — month-end adjustments history</Text>
      <Text style={[s.sub, { marginTop: 2, marginBottom: 4 }]}>
        Deferred income (inc VAT) = orders paid by 23:59 on the month end but not yet dispatched. Labour = gross pay for shifts from the 25th
        to the month end, paid in the next pay period. Each month's opening is the month end before; the movement (closing minus opening) comes off
        that month's sales (deferred income) or goes on its wages (labour). Grouped by financial year, April to March.
      </Text>
      {h.opening ? (
        <View style={s.totalRow} wrap={false}>
          <Text style={{ flex: 3.2 }}>{h.opening.label}</Text>
          <Text style={[s.num, { flex: 3.8 }]}>{money(h.opening.deferred)}</Text>
          <Text style={[s.num, { flex: 3.8 }]}>{money(h.opening.labour)}</Text>
        </View>
      ) : null}
      {h.years.map(y => (
        <View key={y.year} style={{ marginTop: 10 }}>
          <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 3 }}>Financial year {y.year} ({y.span}){y.complete ? "" : " — so far"}</Text>
          <HistoryHead />
          {y.rows.map((r, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Cells cols={H_COLS} values={[
                `${r.label}${r.trustworthy === false ? " (dispatch dates thin — check)" : ""}${r.error ? " (incomplete)" : ""}`,
                money(r.deferred.opening), money(r.deferred.closing), mvm(r.deferred.movement),
                money(r.labour.opening), money(r.labour.closing), mvm(r.labour.movement),
              ]} />
            </View>
          ))}
          <View style={s.totalRow} wrap={false}>
            <Cells cols={H_COLS} values={[`Year ${y.year}`, money(y.deferred.opening), money(y.deferred.closing), mvm(y.deferred.movement), money(y.labour.opening), money(y.labour.closing), mvm(y.labour.movement)]} />
          </View>
        </View>
      ))}
      <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </Page>
  );
}

function PayrollDocument({ data }: { data: PayrollPdfInput }) {
  return (
    <Document title={`TCK payroll report — ${data.periodLabel}`} author="The Calzone Kitchen">
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>The Calzone Kitchen</Text>
        <Text style={s.title}>Payroll report — {data.periodLabel}</Text>
        <Text style={s.meta}>Generated {data.generatedAt}</Text>

        <Text style={s.h2}>Production and holiday</Text>
        <View style={s.headRow}>
          <Cells values={COLS.map(c => c.label)} style={s.th} />
        </View>
        {data.people.length === 0 ? (
          <View style={s.row}><Empty text="No hours recorded this period." /></View>
        ) : data.people.filter(p => p.productionHours > 0 || p.holidayHours > 0).map((p, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Cells values={[
              p.name,
              hrs(p.productionHours),
              p.holidayHours > 0 ? hrs(p.holidayHours) : "—",
              p.hourlyRate == null ? "—" : gbp(p.hourlyRate),
              p.holidayPay == null && p.holidayHours > 0 ? `${gbp(p.productionPay)} + holiday by hand` : gbp(p.productionPay + (p.holidayPay ?? 0)),
            ]} />
          </View>
        ))}
        <View style={s.totalRow} wrap={false}>
          <Cells values={["Total", hrs(data.totals.productionHours), hrs(data.totals.holidayHours), "", gbp(data.totals.productionPay + data.totals.holidayPay)]} />
        </View>

        <Text style={s.h2}>Below the line — office work</Text>
        {data.totals.officeHours === 0 ? <Empty text="No office work this period." /> : (
          <>
            <View style={s.headRow}>
              <Cells cols={OFFICE_COLS} values={OFFICE_COLS.map(c => c.label)} style={s.th} />
            </View>
            {data.people.flatMap(p => p.office.map(o => ({ name: p.name, ...o }))).map((o, i) => (
              <View key={i} style={s.row} wrap={false}>
                <Cells cols={OFFICE_COLS} values={[o.name, o.work, hrs(o.hours), gbp(o.pay)]} />
              </View>
            ))}
            <View style={s.totalRow} wrap={false}>
              <Cells cols={OFFICE_COLS} values={["Total", "", hrs(data.totals.officeHours), gbp(data.totals.officePay)]} />
            </View>
          </>
        )}

        <View style={[s.totalRow, { marginTop: 14 }]} wrap={false}>
          <Text style={{ flex: 1 }}>Total gross pay — {hrs(data.totals.hours)} hours</Text>
          <Text style={s.num}>{gbp(data.totals.grossPay)}</Text>
        </View>

        {data.monthEnd ? <MonthEndSection m={data.monthEnd} /> : null}

        <Text style={s.h2}>Sick days</Text>
        {data.sick.length === 0 ? <Empty text="None recorded." /> : data.sick.map((d, i) => {
          const contract = contractLine(d.contractDaysPerWeek, d.contractHoursPerWeek);
          return (
            <View key={i} style={s.item} wrap={false}>
              <Text>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.name}</Text> — {d.date}
                {d.hours != null ? ` (${hrs(d.hours)} hours)` : ""}
                {d.ssp != null ? ` · SSP est. ${gbp(d.ssp)}` : data.ssp?.length ? " · SSP: work out by hand" : ""}
              </Text>
              {contract ? <Text style={s.sub}>{contract}</Text> : null}
            </View>
          );
        })}

        {data.ssp && data.ssp.length > 0 ? (
          <>
            <Text style={s.h2}>Statutory Sick Pay — ESTIMATE, please check</Text>
            <Text style={[s.sub, { marginBottom: 6 }]}>
              Worked out by the app on the rules from 6 April 2026: paid from the first day, lower of £123.25 a week or 80% of average
              weekly earnings (pay earned in the 8 weeks before the sickness began), ÷ the person's qualifying days a week. Linked spells
              and the 28-week limit are taken into account. Not included in the gross pay above.
            </Text>
            {data.ssp.map((x, i) => (
              <View key={i} style={s.item} wrap={false}>
                <Text>
                  <Text style={{ fontFamily: "Helvetica-Bold" }}>{x.name}</Text> — {x.sickDays} sick day{x.sickDays === 1 ? "" : "s"} · {(x.byHandDays ?? 0) >= x.sickDays ? "SSP: work out by hand" : `SSP est. ${gbp(x.total)}${x.byHandDays ? ` + ${x.byHandDays} day${x.byHandDays === 1 ? "" : "s"} by hand` : ""}`}
                </Text>
                <Text style={s.sub}>
                  {[x.awe != null ? `average weekly earnings ${gbp(x.awe)}` : null, x.weeklySsp != null ? `weekly SSP ${gbp(x.weeklySsp)}` : null, x.qualifyingDaysPerWeek != null ? `${x.qualifyingDaysPerWeek} qualifying day${x.qualifyingDaysPerWeek === 1 ? "" : "s"} a week` : null].filter(Boolean).join(" · ")}
                </Text>
                {x.notes.map((n, j) => <Text key={j} style={s.sub}>{n}</Text>)}
              </View>
            ))}
            <Text style={{ fontFamily: "Helvetica-Bold", marginTop: 2 }}>Total SSP estimate {gbp(data.totals.sspEstimate ?? 0)}</Text>
          </>
        ) : null}

        <Text style={s.h2}>Joiners</Text>
        {data.joiners.length === 0 ? <Empty text="No new starters." /> : data.joiners.map((j, i) => (
          <View key={i} style={s.item} wrap={false}>
            <Text><Text style={{ fontFamily: "Helvetica-Bold" }}>{j.name}</Text> — started {j.date}</Text>
            <Text style={s.sub}>
              {j.documents.length ? `Attached: ${j.documents.join(", ")}` : "No starter documents attached."}
            </Text>
          </View>
        ))}

        <Text style={s.h2}>Leavers</Text>
        {data.leavers.length === 0 ? <Empty text="No leavers." /> : data.leavers.map((l, i) => (
          <Text key={i} style={s.item}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>{l.name}</Text> — last day {l.date}{l.note ? ` · ${l.note}` : ""}
          </Text>
        ))}

        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </Page>
      {data.history ? <HistoryAppendix h={data.history} /> : null}
    </Document>
  );
}

export async function renderPayrollPdf(data: PayrollPdfInput): Promise<Buffer> {
  return renderToBuffer(<PayrollDocument data={data} />);
}
