/**
 * An uploaded old contract, shown in-app: a PDF in a frame (same approach
 * as Finance documents — the frame points straight at the same-origin file,
 * which CSP frame-src 'self' allows), a photo as an image, plus "Open full
 * screen" (iPad Safari only renders the first page of a framed PDF) and
 * "Download". The server decides who may load the file: the founder/HR
 * accounts and the employee themself (routes/uploaded-contracts.ts).
 */
import { Download, ExternalLink } from "lucide-react";
import { isPdf } from "@/lib/contract-history";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function uploadedContractFileUrl(id: number, download = false): string {
  return `${BASE}/api/contracts/uploaded/${id}/file${download ? "?download=1" : ""}`;
}

export function UploadedContractDocument({ id, mime, fileName }: { id: number; mime: string; fileName: string | null }) {
  const src = uploadedContractFileUrl(id);
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border-2 border-border bg-secondary/30 overflow-hidden">
        {isPdf(mime) ? (
          <iframe src={src} title={fileName ?? "Previous contract"} className="w-full h-[55dvh] border-0 bg-white" />
        ) : (
          <img src={src} alt={fileName ?? "Previous contract"} className="w-full max-h-[55dvh] object-contain bg-white" />
        )}
      </div>
      <div className="grid gap-2 grid-cols-2">
        <a href={src} target="_blank" rel="noopener noreferrer"
          className="h-12 rounded-xl border-2 border-border font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
          <ExternalLink className="w-4 h-4" /> Open full screen
        </a>
        <a href={uploadedContractFileUrl(id, true)}
          className="h-12 rounded-xl border-2 border-border font-bold flex items-center justify-center gap-2 hover:bg-secondary/50">
          <Download className="w-4 h-4" /> Download
        </a>
      </div>
    </div>
  );
}
