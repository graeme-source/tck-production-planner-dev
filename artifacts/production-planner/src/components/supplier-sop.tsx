/**
 * SOPs on one supplier's Orders card (Fix queue #390): a how-to for ordering
 * unusual items from that supplier. Attached SOPs show as a big bold banner
 * whose title is the link; "+ SOP" uses the same picker as everywhere else.
 * The banner shows only when the supplier has an SOP. Removing one happens
 * inside the SOP, as everywhere (see sop-detach.tsx). Objectives C and E.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronRight, Plus, X } from "lucide-react";
import { StandardsSopsDialog } from "@/components/standards-sops-dialog";
import { SopPicker, type SopLink } from "@/components/sop-link-chips";
import { type SopPlace } from "@/components/sop-detach";
import { supplierSopAttachTarget } from "@/lib/supplier-sop";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const QUERY_KEY = ["sop-links-suppliers"];

/** Every supplier's SOPs in one shared request, however many cards show. */
function useSupplierSops(supplierId: number) {
  const queryClient = useQueryClient();
  const { data } = useQuery<Record<number, SopLink[]>>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/standards/links/for-suppliers`, { credentials: "include" });
      return res.ok ? res.json() : {};
    },
  });
  return {
    links: data?.[supplierId] ?? [],
    invalidate: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  };
}

/** The viewer, or the editor for an SOP with no steps yet (the same rule as
 *  every other SOP button). Portalled so the card can't clip it. */
function SopDialogs({ viewSop, editSopId, onCloseView, onCloseEdit }: {
  viewSop: SopPlace | null;
  editSopId: number | null;
  onCloseView: () => void;
  onCloseEdit: () => void;
}) {
  return createPortal(
    <>
      {viewSop != null && <StandardsSopsDialog open onClose={onCloseView} initialSopId={viewSop.sopId} detachFrom={viewSop} />}
      {editSopId != null && <StandardsSopsDialog open onClose={onCloseEdit} initialEditSopId={editSopId} />}
    </>,
    document.body,
  );
}

export function SupplierSopBanner({ supplierId, supplierName }: { supplierId: number; supplierName: string }) {
  const { links, invalidate } = useSupplierSops(supplierId);
  const [viewSop, setViewSop] = useState<SopPlace | null>(null);
  const [editSopId, setEditSopId] = useState<number | null>(null);

  if (links.length === 0) return null;
  return (
    <div className="px-4 pb-4 space-y-2">
      {links.map(l => (
        <button
          key={l.linkId}
          type="button"
          onClick={() => {
            if (l.stepCount === 0) setEditSopId(l.sopId);
            else setViewSop({ linkId: l.linkId, sopId: l.sopId, sopTitle: l.title, placeLabel: supplierName, onChanged: invalidate });
          }}
          className="w-full min-h-[64px] px-4 py-3 flex items-center gap-3 rounded-xl bg-primary text-white text-left text-lg font-bold leading-snug hover:opacity-90 transition-opacity"
        >
          <BookOpen className="w-6 h-6 shrink-0" />
          <span className="flex-1 min-w-0 break-words">{l.title}</span>
          <ChevronRight className="w-6 h-6 shrink-0" />
        </button>
      ))}
      <SopDialogs
        viewSop={viewSop}
        editSopId={editSopId}
        onCloseView={() => setViewSop(null)}
        onCloseEdit={() => { setEditSopId(null); invalidate(); }}
      />
    </div>
  );
}

export function SupplierSopAddButton({ supplierId, supplierName }: { supplierId: number; supplierName: string }) {
  const { links, invalidate } = useSupplierSops(supplierId);
  const [open, setOpen] = useState(false);
  const [editSopId, setEditSopId] = useState<number | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 border border-border hover:bg-secondary text-foreground"
      >
        <Plus className="w-4 h-4" />
        SOP
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-2xl max-h-[92dvh] overflow-y-auto overscroll-contain p-5 space-y-4 mt-2 sm:mt-10" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold leading-tight">SOPs for this supplier</h2>
                <p className="text-sm text-muted-foreground break-words">{supplierName}</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary/50 flex-shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>
            <SopPicker
              targets={[supplierSopAttachTarget({ id: supplierId, name: supplierName })]}
              existingSopIds={new Set(links.map(l => l.sopId))}
              onDone={invalidate}
              onInvalidate={invalidate}
              onEditSop={id => { setOpen(false); setEditSopId(id); }}
            />
          </div>
        </div>,
        document.body,
      )}
      <SopDialogs viewSop={null} editSopId={editSopId} onCloseView={() => undefined} onCloseEdit={() => { setEditSopId(null); invalidate(); }} />
    </>
  );
}
