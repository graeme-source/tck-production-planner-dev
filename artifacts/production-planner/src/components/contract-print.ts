/**
 * Shared contract rendering for screen and paper.
 *
 * contractBodyHtml() turns the stored plain-text body into HTML: all-caps
 * section headings go bold, and the [[founder_signature]] marker becomes
 * Graeme's handwritten signature image (served through the authenticated
 * API, never as a public asset). Both the in-app viewers and the print path
 * use this one function, so the contract always looks the same.
 *
 * printContract() prints through a hidden same-origin iframe — pop-up
 * blockers killed the old window.open() approach on the factory machines
 * (Graeme, 2026-09-07).
 */
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** The TCK mark that heads every contract, on screen and on paper. */
export const CONTRACT_LOGO_URL = `${import.meta.env.BASE_URL}tck-logo-dark.png`;

/** Founder's signature — authenticated endpoint, same-origin. */
export const FOUNDER_SIGNATURE_URL = `${BASE}/api/contracts/founder-signature.png`;

// Mirrors artifacts/api-server/src/lib/contract-render.ts — keep in sync.
const FOUNDER_SIGNATURE_MARKER = "[[founder_signature]]";

function isContractHeading(line: string): boolean {
  const t = line.trim();
  return t.length >= 3 && /[A-Z]/.test(t) && !/[a-z0-9]/.test(t);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function contractBodyHtml(body: string): string {
  const renderPart = (part: string) =>
    part
      .split("\n")
      .map(line => {
        if (line.trim() === "") return "<div>&nbsp;</div>";
        const safe = esc(line);
        return isContractHeading(line) ? `<div style="font-weight:700">${safe}</div>` : `<div>${safe}</div>`;
      })
      .join("");
  return body
    .split(FOUNDER_SIGNATURE_MARKER)
    .map(renderPart)
    .join(`<img src="${FOUNDER_SIGNATURE_URL}" alt="Signed — Graeme Carter" style="height:56px;display:block;margin:4px 0">`);
}

export function printContract(title: string, body: string) {
  const logo = `${window.location.origin}${CONTRACT_LOGO_URL}`;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.srcdoc = `<!doctype html><html><head><title>${esc(title)}</title><style>
    body { font-family: Georgia, "Times New Roman", serif; margin: 48px auto; max-width: 46rem; line-height: 1.55; font-size: 12.5pt; color: #111; }
    img.logo { display: block; margin: 0 auto 32px; height: 64px; }
  </style></head><body><img class="logo" src="${logo}" alt="The Calzone Kitchen">${contractBodyHtml(body)}</body></html>`;
  iframe.onload = () => {
    // Give the logo and signature images a beat to load before the print
    // dialog snapshots the page.
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        toast({ title: "Couldn't open the print dialog", description: "Try again, or use the signed PDF download instead.", variant: "destructive" });
      }
      // The frame must outlive the print dialog; tidy it up well after.
      setTimeout(() => iframe.remove(), 60_000);
    }, 400);
  };
  document.body.appendChild(iframe);
}
