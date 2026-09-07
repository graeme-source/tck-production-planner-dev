/**
 * The contract as a piece of paper: white ground in every theme (it's a
 * document, not a UI surface), TCK mark up top, bold section headings, and
 * the founder's signature rendered where the body carries the
 * [[founder_signature]] marker. Used by the employee's My Contract sheet and
 * both founder dialogs, so all four views are the same document.
 */
import { contractBodyHtml, CONTRACT_LOGO_URL } from "@/components/contract-print";

export function ContractPaper({ body }: { body: string }) {
  return (
    <div className="bg-white text-black rounded-xl border border-border p-6 sm:p-8 shadow-sm">
      <img src={CONTRACT_LOGO_URL} alt="The Calzone Kitchen" className="h-14 mx-auto mb-6" />
      <div
        className="font-serif text-[15px] leading-relaxed"
        // Built by contractBodyHtml from our own escaped text — never raw input.
        dangerouslySetInnerHTML={{ __html: contractBodyHtml(body) }}
      />
    </div>
  );
}
