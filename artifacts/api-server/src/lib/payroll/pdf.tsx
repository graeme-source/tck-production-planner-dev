// Monthly payroll report as an A4 PDF (objective B). Same library as every
// other PDF in the app (@react-pdf/renderer — see src/pdf/*.tsx).

import React from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
type Style = Parameters<typeof StyleSheet.create>[0][string];

export interface PayrollPdfInput {
  periodLabel: string;
  generatedAt: string;
  people: Array<{ name: string; hours: number; shifts: number; hourlyRate: number | null; grossPay: number }>;
  totals: { hours: number; grossPay: number };
  sick: Array<{ name: string; date: string; hours: number | null; contractDaysPerWeek: number | null; contractHoursPerWeek: number | null }>;
  joiners: Array<{ name: string; date: string; documents: string[] }>;
  leavers: Array<{ name: string; date: string; note?: string | null }>;
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

const COLS = [
  { key: "name", label: "Name", flex: 3, num: false },
  { key: "shifts", label: "Shifts", flex: 1, num: true },
  { key: "hours", label: "Hours", flex: 1.2, num: true },
  { key: "rate", label: "Rate", flex: 1.2, num: true },
  { key: "gross", label: "Gross", flex: 1.6, num: true },
] as const;

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

function Cells({ values, style }: { values: string[]; style?: Style }) {
  return (
    <>
      {COLS.map((c, i) => (
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

function PayrollDocument({ data }: { data: PayrollPdfInput }) {
  return (
    <Document title={`TCK payroll report — ${data.periodLabel}`} author="The Calzone Kitchen">
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>The Calzone Kitchen</Text>
        <Text style={s.title}>Payroll report — {data.periodLabel}</Text>
        <Text style={s.meta}>Generated {data.generatedAt}</Text>

        <Text style={s.h2}>Summary</Text>
        <View style={s.headRow}>
          <Cells values={COLS.map(c => c.label)} style={s.th} />
        </View>
        {data.people.length === 0 ? (
          <View style={s.row}><Empty text="No hours recorded this period." /></View>
        ) : data.people.map((p, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Cells values={[
              p.name,
              String(p.shifts),
              hrs(p.hours),
              p.hourlyRate == null ? "—" : gbp(p.hourlyRate),
              gbp(p.grossPay),
            ]} />
          </View>
        ))}
        <View style={s.totalRow} wrap={false}>
          <Cells values={["Total", "", hrs(data.totals.hours), "", gbp(data.totals.grossPay)]} />
        </View>

        <Text style={s.h2}>Sick days</Text>
        {data.sick.length === 0 ? <Empty text="None recorded." /> : data.sick.map((d, i) => {
          const contract = contractLine(d.contractDaysPerWeek, d.contractHoursPerWeek);
          return (
            <View key={i} style={s.item} wrap={false}>
              <Text>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{d.name}</Text> — {d.date}
                {d.hours != null ? ` (${hrs(d.hours)} hours)` : ""}
              </Text>
              {contract ? <Text style={s.sub}>{contract}</Text> : null}
            </View>
          );
        })}

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
    </Document>
  );
}

export async function renderPayrollPdf(data: PayrollPdfInput): Promise<Buffer> {
  return renderToBuffer(<PayrollDocument data={data} />);
}
