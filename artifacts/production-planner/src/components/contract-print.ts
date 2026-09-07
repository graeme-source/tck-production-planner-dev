import { toast } from "@/hooks/use-toast";

/** Print / save-as-PDF for an employment contract: a minimal window holding
 *  just the contract text, so the browser's print dialog gives a clean
 *  document. Used by the founder's Contracts page and the Employee Hub. */
/** The TCK mark that heads every contract, on screen and on paper. */
export const CONTRACT_LOGO_URL = `${import.meta.env.BASE_URL}tck-logo-dark.png`;

export function printContract(title: string, body: string) {
  const w = window.open("", "_blank", "noopener,width=800,height=1000");
  if (!w) { toast({ title: "Pop-up blocked", description: "Allow pop-ups to print the contract.", variant: "destructive" }); return; }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // The print window is about:blank, so the logo needs an absolute URL.
  const logo = `${window.location.origin}${CONTRACT_LOGO_URL}`;
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    body { font-family: Georgia, "Times New Roman", serif; margin: 48px auto; max-width: 46rem; line-height: 1.55; font-size: 12.5pt; color: #111; }
    img.logo { display: block; margin: 0 auto 32px; height: 64px; }
    pre { white-space: pre-wrap; font-family: inherit; }
  </style></head><body><img class="logo" src="${logo}" alt="The Calzone Kitchen"><pre>${esc(body)}</pre></body></html>`);
  w.document.close();
  w.focus();
  // Give the logo a beat to load before the print dialog snapshots the page.
  setTimeout(() => w.print(), 300);
}
