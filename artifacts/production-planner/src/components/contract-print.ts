import { toast } from "@/hooks/use-toast";

/** Print / save-as-PDF for an employment contract: a minimal window holding
 *  just the contract text, so the browser's print dialog gives a clean
 *  document. Used by the founder's Contracts page and the Employee Hub. */
export function printContract(title: string, body: string) {
  const w = window.open("", "_blank", "noopener,width=800,height=1000");
  if (!w) { toast({ title: "Pop-up blocked", description: "Allow pop-ups to print the contract.", variant: "destructive" }); return; }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    body { font-family: Georgia, "Times New Roman", serif; margin: 48px auto; max-width: 46rem; line-height: 1.55; font-size: 12.5pt; color: #111; }
    pre { white-space: pre-wrap; font-family: inherit; }
  </style></head><body><pre>${esc(body)}</pre></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}
