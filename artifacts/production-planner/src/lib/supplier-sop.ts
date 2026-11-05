import type { SopAttachTarget } from "@/components/sop-link-chips";

/** Where "+ SOP" on a supplier's Orders card attaches (Fix queue #390):
 *  keyed by the supplier's id, so renaming a supplier keeps its SOPs. */
export function supplierSopAttachTarget(supplier: { id: number; name: string }): SopAttachTarget {
  return { targetType: "supplier", a: supplier.id, label: supplier.name };
}
