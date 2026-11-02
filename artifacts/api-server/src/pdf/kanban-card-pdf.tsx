// Kanban cards as a real PDF at the exact physical size (objective C).
//
// One page per card. Each page is the A5 fold sheet from
// lib/kanban-card-layout.ts: front on the top half, back on the bottom half
// rotated 180°, a faint dashed fold line between them. Fold along the line
// (blank sides together) and it is the A6 landscape kanban card. Everything
// is vector — text, shapes and the QR code — so it is crisp on any printer
// and there is no image that can fail to load before printing.

import { Document, Page, View, Text, Svg, Path, Line, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import {
  FACE_CONTENT_PADDING_MM, KANBAN_FRONT_BORDER_PT, KANBAN_FRONT_MM, KANBAN_FRONT_TYPE, kanbanFrontLayout, kanbanSheetLayout, kanbanWordPieces, mm, qrModulesPath,
  type KanbanFrontFieldLayout, type KanbanSheet, type Rect,
} from "../lib/kanban-card-layout";
import type { KanbanCardText } from "../lib/kanban-card-text";

export interface KanbanCardPdfCard extends KanbanCardText {
  /** What the QR code encodes (lib/qr-code.ts qrPayload). */
  qrText: string;
}

const GREEN = "#16a34a";
const DARK_GREEN = "#14532d";
const CREAM = "#fffdf0";
const RULE = "#d6c38c";
const AMBER = "#ffbe23";

const T = KANBAN_FRONT_TYPE;
const FM = KANBAN_FRONT_MM;

const s = StyleSheet.create({
  abs: { position: "absolute" },
  header: { backgroundColor: GREEN, color: "#ffffff" },
  // Front-face sizes come from lib/kanban-card-layout.ts (#353): the same
  // numbers the fit maths uses, so what is drawn is what was measured.
  // maxLines + ellipsis is the backstop: the fit maths already sizes text to
  // fit, so only absurd text (hundreds of characters) is ever cut.
  name: { fontFamily: "Helvetica-Bold", lineHeight: T.nameLineHeight, maxLines: T.nameMaxLines, textOverflow: "ellipsis" },
  subtitle: { fontSize: T.subtitlePt, lineHeight: T.lineHeight, letterSpacing: 1, marginTop: mm(FM.subtitleGap), opacity: 0.9 },
  fieldLabel: { fontSize: T.labelPt, lineHeight: T.lineHeight, fontFamily: "Helvetica-Bold", color: GREEN, letterSpacing: 0.8, marginBottom: mm(FM.labelGap) },
  fieldValue: { fontFamily: "Helvetica-Bold", color: DARK_GREEN, lineHeight: T.valueLineHeight, maxLines: T.valueMaxLines, textOverflow: "ellipsis" },
  fieldPart: { fontSize: T.partPt, lineHeight: T.lineHeight, fontFamily: "Helvetica", color: "#3f6212", maxLines: 1, textOverflow: "ellipsis" },
  field: { borderBottomWidth: 0.75, borderBottomColor: RULE, paddingBottom: mm(FM.fieldRulePad) },
  footer: { backgroundColor: DARK_GREEN, color: CREAM, fontSize: T.footerPt, letterSpacing: 1, textAlign: "center", fontFamily: "Helvetica-Bold" },
  qrLabel: { fontSize: T.qrLabelPt, color: GREEN, letterSpacing: 0.5, marginTop: 3, textAlign: "center", fontFamily: "Helvetica-Bold" },
  backTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", color: DARK_GREEN, letterSpacing: 1.5, textAlign: "center" },
  backSub: { fontSize: 10, color: DARK_GREEN, marginTop: 6, textAlign: "center" },
  backName: { fontSize: 13, fontFamily: "Helvetica-Bold", color: DARK_GREEN, marginTop: 10, paddingVertical: 5, paddingHorizontal: 14, backgroundColor: "#ffd97a", borderRadius: 6, textAlign: "center" },
  foldText: { fontSize: 5.5, color: "#9ca3af" },
});

const box = (r: Rect) => ({ left: r.x, top: r.y, width: r.width, height: r.height });

function QrVector({ text, size }: { text: string; size: number }) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2;
  const d = qrModulesPath(n, (r, c) => Boolean(qr.modules.get(r, c)), quiet);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n + quiet * 2} ${n + quiet * 2}`}>
      <Path d={`M0 0h${n + quiet * 2}v${n + quiet * 2}h-${n + quiet * 2}z`} fill="#ffffff" />
      <Path d={d} fill="#000000" />
    </Svg>
  );
}

function Field({ field }: { field: KanbanFrontFieldLayout }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{field.label.toUpperCase()}</Text>
      <Text style={[s.fieldValue, { fontSize: field.valuePt }]} hyphenationCallback={kanbanWordPieces}>{field.value}</Text>
      {field.part ? <Text style={s.fieldPart} hyphenationCallback={kanbanWordPieces}>{`Part # ${field.part}`}</Text> : null}
    </View>
  );
}

function Front({ card, fill, sheet }: { card: KanbanCardPdfCard; fill: Rect; sheet: KanbanSheet }) {
  const pad = mm(FACE_CONTENT_PADDING_MM);
  const qrSize = mm(FM.qrSize);
  const layout = kanbanFrontLayout(card.name, [
    { label: "Pull when using last", value: card.pullWhen, part: null },
    { label: "Order amount", value: card.orderAmount, part: null },
    { label: "Location", value: card.location, part: null },
    { label: "Supplier", value: card.supplier, part: card.partNumber },
  ], sheet);
  return (
    <View style={[s.abs, box(fill), { backgroundColor: CREAM, borderWidth: KANBAN_FRONT_BORDER_PT, borderColor: GREEN, flexDirection: "column" }]}>
      <View style={[s.header, { paddingHorizontal: pad, paddingTop: mm(FM.headerPadTop), paddingBottom: mm(FM.headerPadBottom) }]}>
        <Text style={[s.name, { fontSize: layout.namePt }]} hyphenationCallback={kanbanWordPieces}>{card.name}</Text>
        <Text style={s.subtitle}>KANBAN CARD — THE CALZONE KITCHEN</Text>
      </View>
      <View style={{ flex: 1, flexDirection: "row", paddingHorizontal: pad, paddingTop: mm(FM.bodyPadTop), paddingBottom: mm(FM.bodyPadBottom) }}>
        {/* The four fields spread down the whole face, not bunched at the top. */}
        <View style={{ flex: 1, paddingRight: mm(FM.qrGap), justifyContent: "space-between" }}>
          {layout.fields.map((f) => <Field key={f.label} field={f} />)}
        </View>
        <View style={{ width: qrSize, alignItems: "center", justifyContent: "center" }}>
          <QrVector text={card.qrText} size={qrSize} />
          <Text style={s.qrLabel}>SCAN TO PULL</Text>
        </View>
      </View>
      <View style={[s.footer, { height: mm(FM.footerHeight), justifyContent: "center" }]}>
        <Text>PULL — SCAN QR OR NOTIFY MANAGER</Text>
      </View>
    </View>
  );
}

function WarningTriangle({ size }: { size: number }) {
  return (
    <Svg width={size} height={size * 0.88} viewBox="0 0 100 88">
      <Path d="M50 4 L96 84 L4 84 Z" fill={DARK_GREEN} />
      <Path d="M50 20 L82 76 L18 76 Z" fill={AMBER} />
      <Path d="M46 36h8v22h-8z" fill={DARK_GREEN} />
      <Path d="M46 63h8v8h-8z" fill={DARK_GREEN} />
    </Svg>
  );
}

function Back({ card, fill }: { card: KanbanCardPdfCard; fill: Rect }) {
  // Rotated 180° about its own centre: upside down on the flat sheet, the
  // right way up once the sheet is folded.
  return (
    <View
      style={[
        s.abs, box(fill),
        { backgroundColor: AMBER, alignItems: "center", justifyContent: "center", transform: "rotate(180deg)", transformOrigin: "50% 50%" },
      ]}
    >
      <WarningTriangle size={mm(16)} />
      <Text style={[s.backTitle, { marginTop: mm(4) }]}>KANBAN PULLED</Text>
      <Text style={s.backSub}>Item on order</Text>
      <Text style={[s.backName, { maxWidth: fill.width - mm(16) }]}>{card.name}</Text>
    </View>
  );
}

// Each guide is its own tiny SVG box around the line: one page-sized SVG
// overlay makes react-pdf spill onto an extra blank page.
function GuideLine({ line, color, dashed }: { line: { x1: number; y1: number; x2: number; y2: number }; color: string; dashed?: boolean }) {
  const pad = 1;
  const left = Math.min(line.x1, line.x2) - pad;
  const top = Math.min(line.y1, line.y2) - pad;
  const width = Math.abs(line.x2 - line.x1) + pad * 2;
  const height = Math.abs(line.y2 - line.y1) + pad * 2;
  return (
    <Svg style={[s.abs, { left, top }]} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Line
        x1={line.x1 - left} y1={line.y1 - top} x2={line.x2 - left} y2={line.y2 - top}
        stroke={color} strokeWidth={0.5} strokeDasharray={dashed ? "3 3" : undefined}
      />
    </Svg>
  );
}

function SheetGuides({ sheet }: { sheet: KanbanSheet }) {
  const L = kanbanSheetLayout(sheet);
  return (
    <>
      <GuideLine line={L.fold} color="#9ca3af" dashed />
      {L.cropMarks.map((m, i) => <GuideLine key={i} line={m} color="#000000" />)}
    </>
  );
}

function CardPage({ card, sheet }: { card: KanbanCardPdfCard; sheet: KanbanSheet }) {
  const L = kanbanSheetLayout(sheet);
  return (
    <Page size={[L.page.width, L.page.height]} style={{ position: "relative", backgroundColor: "#ffffff" }}>
      <Front card={card} fill={L.frontFill} sheet={sheet} />
      <Back card={card} fill={L.backFill} />
      <SheetGuides sheet={sheet} />
      <Text style={[s.abs, s.foldText, { left: L.card.x + mm(0.8), top: L.fold.y1 - mm(2.4) }]}>fold</Text>
      {sheet === "a4" ? (
        <Text style={[s.abs, s.foldText, { left: L.card.x, top: L.card.y + L.card.height + mm(4), width: L.card.width, textAlign: "center" }]}>
          Print at Actual size (100%). Trim on the corner marks, then fold on the dashed line.
        </Text>
      ) : null}
    </Page>
  );
}

export async function renderKanbanCardsPdf(cards: KanbanCardPdfCard[], sheet: KanbanSheet): Promise<Buffer> {
  const title = cards.length === 1 ? `Kanban — ${cards[0].name}` : `Kanban cards (${cards.length})`;
  return renderToBuffer(
    <Document title={title} author="The Calzone Kitchen" creator="TCK Production Planner">
      {cards.map((c) => <CardPage key={c.id} card={c} sheet={sheet} />)}
    </Document>,
  );
}
