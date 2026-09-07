// The archival "hard copy" of an employment contract (Graeme, 2026-09-07):
// generated the moment the employee signs and stored as bytes on the row, so
// what they signed is preserved as a finished document — logo, founder's
// signature on the employer line, initials on theirs — independent of any
// later change to how the app renders contracts. Deterministic from the
// signed body, so a missing PDF can always be regenerated from it.

import React from "react";
import { Document, Page, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FOUNDER_SIGNATURE_MARKER, isContractHeading } from "../lib/contract-render";

const DATA_DIR = path.resolve(import.meta.dirname, "../data");

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 56, fontFamily: "Times-Roman", fontSize: 11, lineHeight: 1.45, color: "#111" },
  logo: { width: 96, alignSelf: "center", marginBottom: 24 },
  line: {},
  heading: { fontFamily: "Times-Bold" },
  signature: { width: 140, marginTop: 4, marginBottom: 4, alignSelf: "flex-start" },
});

function dataUri(file: string): string {
  return `data:image/png;base64,${readFileSync(path.join(DATA_DIR, file)).toString("base64")}`;
}

export async function renderContractPdf(body: string): Promise<Buffer> {
  const logo = dataUri("contract-logo.png");
  const founderSignature = dataUri("founder-signature.png");

  const blocks: React.ReactElement[] = [];
  let key = 0;
  body.split(FOUNDER_SIGNATURE_MARKER).forEach((part, i) => {
    if (i > 0) blocks.push(<Image key={key++} style={styles.signature} src={founderSignature} />);
    for (const line of part.split("\n")) {
      blocks.push(
        <Text key={key++} style={isContractHeading(line) ? styles.heading : styles.line}>
          {line.trim() === "" ? " " : line}
        </Text>,
      );
    }
  });

  return renderToBuffer(
    <Document title="Employment contract — The Calzone Kitchen">
      <Page size="A4" style={styles.page}>
        <Image style={styles.logo} src={logo} />
        {blocks}
      </Page>
    </Document>,
  );
}
