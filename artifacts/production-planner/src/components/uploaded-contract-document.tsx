/**
 * An uploaded old contract, shown in-app with "Open full screen" and
 * "Download" (the shared viewer: components/inline-document.tsx). The server
 * decides who may load the file: the founder/HR accounts and the employee
 * themself (routes/uploaded-contracts.ts).
 */
import { InlineDocument } from "@/components/inline-document";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function uploadedContractFileUrl(id: number, download = false): string {
  return `${BASE}/api/contracts/uploaded/${id}/file${download ? "?download=1" : ""}`;
}

export function UploadedContractDocument({ id, mime, fileName }: { id: number; mime: string; fileName: string | null }) {
  return (
    <InlineDocument
      src={uploadedContractFileUrl(id)}
      downloadSrc={uploadedContractFileUrl(id, true)}
      mime={mime}
      title={fileName ?? "Previous contract"}
    />
  );
}
