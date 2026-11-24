/**
 * The supplier form — moved out of the Suppliers page (24 Nov 2026) so the
 * same form can open from anywhere a supplier is picked: Graeme, "I can't
 * add a new supplier from the supplier dropdown … I have to close the modal
 * down, save my changes, go out and add a supplier, then come back".
 * <NewSupplierDialog> is the "New supplier" pop-up both places use.
 */
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Phone, Truck, Contact, Landmark, ClipboardCheck } from "lucide-react";
import type { CreateSupplier } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SupplierAccountNumberField } from "@/components/supplier-account-number-field";
import { SUPPLIER_TABS, supplierTabsFor, supplierErrorCounts, firstSupplierErrorTab, type SupplierTabId } from "@/lib/supplier-editor-tabs";
import { useAppMutations } from "@/hooks/use-mutations";
import { cn } from "@/lib/utils";

const SUPPLIER_TAB_ICONS: Record<SupplierTabId, typeof Truck> = {
  contact: Contact,
  ordering: Truck,
  account: Landmark,
  checks: ClipboardCheck,
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  contactName: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  orderingPhone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  orderFrequency: z.enum(["daily", "weekly"]).optional(),
  orderDays: z.string().optional(),
  leadTimeDays: z.coerce.number().int().min(0).optional(),
  cutoffTime: z.string().optional(),
  invoiceNotRequired: z.boolean().optional(),
  orderByEmail: z.boolean().optional(),
  collectsLocalDeliveries: z.boolean().optional(),
  // Account manager (2026-10-16) — short-shelf-life reports from goods-in
  // are emailed here automatically.
  accountManagerName: z.string().optional(),
  accountManagerEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  // Our account number with the supplier (new suppliers only — an existing
  // one autosaves it separately).
  accountNumber: z.string().max(100).optional(),
  // Minimum order spend in £ — blank = no minimum.
  minimumOrderValue: z
    .string()
    .optional()
    .refine(v => {
      if (v == null || v.trim() === "") return true;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100000;
    }, "Enter an amount in £ between 0 and 100,000, or leave blank"),
});

export type FormValues = z.infer<typeof schema>;

/** Ordering-schedule fields the suppliers routes read and persist (the API's
 * validate middleware passes unknown fields through) but the generated
 * CreateSupplier body doesn't declare. */
export type SupplierBody = CreateSupplier & {
  orderingPhone?: string | null;
  orderFrequency?: string;
  orderDays?: string | null;
  leadTimeDays?: number;
  cutoffTime?: string;
  invoiceNotRequired?: boolean;
  orderByEmail?: boolean;
  collectsLocalDeliveries?: boolean;
  minimumOrderValue?: number | null;
  accountManagerName?: string | null;
  accountManagerEmail?: string | null;
  accountNumber?: string | null;
};



export const supplierFormDefaults: FormValues = {
  name: "", contactName: "", email: "", phone: "", orderingPhone: "", website: "", address: "", notes: "", orderFrequency: "daily", orderDays: "", leadTimeDays: 1, cutoffTime: "17:00", invoiceNotRequired: false, orderByEmail: false, collectsLocalDeliveries: false, minimumOrderValue: "", accountManagerName: "", accountManagerEmail: "", accountNumber: "",
};

/** Form text → £ amount for the API: blank or 0 = no minimum (null). */
export function minimumFromForm(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function SupplierForm({
  values,
  onSubmit,
  isPending,
  isEdit,
  editing,
  title,
  paymentPanel,
  checksPanel,
}: {
  title: string;
  /** Payment terms — saves on its own, shown on the Account tab. */
  paymentPanel?: ReactNode;
  /** Goods-in checks — saves on its own, its own tab. */
  checksPanel?: ReactNode;
  values: FormValues;
  onSubmit: (data: FormValues) => void;
  isPending: boolean;
  isEdit: boolean;
  /** An existing supplier: the account number autosaves on its own
   *  (SupplierAccountNumberField). A new one sends it with the form. */
  editing?: { id: number; accountNumber: string | null };
}) {
  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: values,
  });

  const [activeTab, setActiveTab] = useState<SupplierTabId>("contact");
  const shownTabs = supplierTabsFor(editing != null);
  const tabErrorCounts = supplierErrorCounts(errors);
  const formId = editing ? `supplier-form-${editing.id}` : "supplier-form-new";

  const watchedFrequency = watch("orderFrequency");
  const watchedOrderDays = watch("orderDays") ?? "";
  const selectedDays = watchedOrderDays ? watchedOrderDays.split(",").filter(Boolean) : [];

  const toggleDay = (day: string) => {
    const next = selectedDays.includes(day)
      ? selectedDays.filter(d => d !== day)
      : [...selectedDays, day];
    setValue("orderDays", next.join(","));
  };

  return (
    <>
      <DialogHeader className="px-5 sm:px-6 pt-5 pb-0 pr-14 shrink-0 space-y-3 text-left">
        <DialogTitle className="font-display text-xl">{title}</DialogTitle>
        <div role="tablist" aria-label="Supplier settings" className="-mx-5 sm:-mx-6 px-5 sm:px-6 pb-3 border-b border-border flex gap-1.5 xl:gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SUPPLIER_TABS.filter(t => shownTabs.includes(t.id)).map(t => {
            const Icon = SUPPLIER_TAB_ICONS[t.id];
            const isActive = t.id === activeTab;
            const nErr = tabErrorCounts[t.id] ?? 0;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`supplier-tab-${t.id}`}
                aria-selected={isActive}
                aria-controls={`supplier-panel-${t.id}`}
                onClick={() => setActiveTab(t.id)}
                title={t.hint}
                className={cn(
                  "relative shrink-0 lg:flex-1 min-h-12 px-3 xl:px-4 py-2 rounded-xl text-sm xl:text-base font-semibold flex items-center justify-center gap-1.5 xl:gap-2 transition-colors whitespace-nowrap",
                  isActive ? "bg-primary text-primary-foreground shadow-sm" : "bg-secondary/40 text-foreground hover:bg-secondary/70",
                )}
              >
                <Icon className="w-4 h-4 xl:w-5 xl:h-5 shrink-0" />
                <span className="flex flex-col items-start leading-tight">
                  <span>{t.label}</span>
                  <span className={cn("hidden xl:block text-[11px] font-normal", isActive ? "text-primary-foreground/85" : "text-muted-foreground")}>{t.hint}</span>
                </span>
                {nErr > 0 && (
                  <span className="min-w-6 h-6 px-1.5 rounded-full bg-destructive text-white text-xs font-bold flex items-center justify-center" aria-label={`${nErr} problem${nErr !== 1 ? "s" : ""} to fix`}>
                    {nErr}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </DialogHeader>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5" data-testid="supplier-editor-body">
        <form id={formId} onSubmit={handleSubmit(onSubmit, (errs) => { const tab = firstSupplierErrorTab(errs); if (tab) setActiveTab(tab); })}>
          <section
            role="tabpanel"
            id="supplier-panel-contact"
            aria-labelledby="supplier-tab-contact"
            hidden={activeTab !== "contact"}
            className="grid gap-x-8 gap-y-4 lg:grid-cols-2"
          >
            <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Company / Supplier Name *</label>
              <input
                {...register("name")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. Harvest Foods Ltd"
              />
              {errors.name && <span className="text-destructive text-xs">{errors.name.message}</span>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Contact Name</label>
                <input
                  {...register("contactName")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="Account manager name"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Phone</label>
                <input
                  {...register("phone")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="+44 1234 567890"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Email</label>
              <input
                {...register("email")}
                type="email"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="orders@supplier.co.uk"
              />
              {errors.email && <span className="text-destructive text-xs">{errors.email.message}</span>}
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Ordering Phone (WhatsApp)</label>
              <input
                {...register("orderingPhone")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="+44 7123 456789"
              />
              <span className="text-xs text-muted-foreground">International format (with country code) so the WhatsApp order button works.</span>
            </div>
            </div>
            <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Website</label>
              <input
                {...register("website")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="https://www.supplier.co.uk"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Address</label>
              <textarea
                {...register("address")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[96px] resize-y"
                placeholder="Street, City, Postcode"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Notes</label>
              <textarea
                {...register("notes")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px] resize-none"
                placeholder="Payment terms, order minimums..."
              />
            </div>
            </div>
          </section>
          <section
            role="tabpanel"
            id="supplier-panel-ordering"
            aria-labelledby="supplier-tab-ordering"
            hidden={activeTab !== "ordering"}
            className="grid gap-x-8 gap-y-4 lg:grid-cols-2"
          >
            <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Order Frequency</label>
              <select
                {...register("orderFrequency")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="daily">Daily — can order any day</option>
                <option value="weekly">Weekly — specific order days only</option>
              </select>
            </div>

            {watchedFrequency === "weekly" && (
              <div>
                <label className="text-sm font-medium mb-1 block">Order Days</label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                        selectedDays.includes(day)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-muted-foreground hover:border-primary/50"
                      )}
                    >
                      {day.slice(0, 3)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Select which days orders can be placed with this supplier.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Delivery Lead Time (days)</label>
                <input
                  type="number"
                  min={0}
                  {...register("leadTimeDays")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="1"
                />
                <p className="text-xs text-muted-foreground mt-1">Days after ordering until delivery arrives.</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Order Cut-off Time</label>
                <input
                  type="time"
                  {...register("cutoffTime")}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-xs text-muted-foreground mt-1">Orders placed after this time add an extra day.</p>
              </div>
            </div>
            </div>
            <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Minimum order value (&pound;)</label>
              <div className="relative max-w-[240px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">&pound;</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  inputMode="decimal"
                  {...register("minimumOrderValue")}
                  className="w-full pl-7 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="No minimum"
                />
              </div>
              {errors.minimumOrderValue && <span className="text-destructive text-xs">{errors.minimumOrderValue.message}</span>}
              <p className="text-xs text-muted-foreground mt-1">
                Leave blank if there&rsquo;s no minimum. The Orders page warns when an order is under it and suggests items to move across from other suppliers.
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...register("orderByEmail")} className="w-4 h-4 rounded border-border" />
                <span className="text-sm font-medium">We order from this supplier by email</span>
              </label>
              <p className="text-xs text-muted-foreground mt-1 ml-6">
                The main button on their order becomes Email order instead of Supplier website.
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...register("collectsLocalDeliveries")} className="w-4 h-4 rounded border-border" />
                <span className="text-sm font-medium">Their driver collects our local-delivery orders</span>
              </label>
              <p className="text-xs text-muted-foreground mt-1 ml-6">
                Processing a local-delivery wholesale order books a collection on their delivery for the chosen day, at the top of goods-in.
              </p>
            </div>
            </div>
          </section>
          <section
            role="tabpanel"
            id="supplier-panel-account"
            aria-labelledby="supplier-tab-account"
            hidden={activeTab !== "account"}
            className="grid gap-x-8 gap-y-4 lg:grid-cols-2"
          >
            <div className="space-y-4">
            <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-3">
              <div>
                <p className="text-sm font-semibold">Account manager</p>
                <p className="text-xs text-muted-foreground">
                  If something arrives with less shelf life than the minimum set on the ingredient, goods-in emails them
                  automatically (Graeme gets a copy).
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Name</label>
                  <input
                    {...register("accountManagerName")}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="e.g. Sam Smith"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Email</label>
                  <input
                    {...register("accountManagerEmail")}
                    type="email"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="name@supplier.co.uk"
                  />
                  {errors.accountManagerEmail && <span className="text-destructive text-xs">{errors.accountManagerEmail.message}</span>}
                </div>
              </div>
              {editing ? (
                <SupplierAccountNumberField supplierId={editing.id} initial={editing.accountNumber} />
              ) : (
                <div>
                  <label className="text-sm font-medium mb-1 block">Our account number</label>
                  <input
                    {...register("accountNumber")}
                    maxLength={100}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="e.g. 1867332"
                  />
                  <span className="text-xs text-muted-foreground">Quoted at the top of goods-in issue emails.</span>
                </div>
              )}
            </div>
            </div>
            <div className="space-y-4">
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...register("invoiceNotRequired")} className="w-4 h-4 rounded border-border" />
                <span className="text-sm font-medium">No invoices from this supplier</span>
              </label>
              <p className="text-xs text-muted-foreground mt-1 ml-6">
                For suppliers like Amazon that never provide an invoice or delivery note —
                goods-in skips the &ldquo;Invoice filed&rdquo; check on their deliveries.
              </p>
            </div>
            </div>
          </section>
        </form>
        {/* These save as you go, so they sit outside the form: Enter in them
            never saves the supplier. */}
        {paymentPanel && (
          <div hidden={activeTab !== "account"} className="max-w-3xl">{paymentPanel}</div>
        )}
        {checksPanel && (
          <section role="tabpanel" id="supplier-panel-checks" aria-labelledby="supplier-tab-checks" hidden={activeTab !== "checks"} className="max-w-3xl">
            {checksPanel}
          </section>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-5 sm:px-6 py-3 flex items-center justify-end gap-3 bg-card">
        <button
          type="submit"
          form={formId}
          disabled={isPending}
          className="min-h-11 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 w-full sm:w-auto"
        >
          {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {isPending ? "Saving..." : isEdit ? "Save Changes" : "Add Supplier"}
        </button>
      </div>
    </>
  );
}

/** The form's values → the body the suppliers API takes. A new supplier
 *  sends its account number with the form; an existing one autosaves it. */
export function supplierBodyFromForm(data: FormValues, opts: { isNew: boolean }): SupplierBody {
  return {
    ...data,
    email: data.email || undefined, contactName: data.contactName || undefined, phone: data.phone || undefined,
    website: data.website || undefined, address: data.address || undefined, notes: data.notes || undefined,
    orderFrequency: data.orderFrequency ?? "daily", orderDays: data.orderFrequency === "weekly" ? (data.orderDays || null) : null,
    leadTimeDays: data.leadTimeDays ?? 1, cutoffTime: data.cutoffTime || "17:00",
    invoiceNotRequired: data.invoiceNotRequired ?? false, orderByEmail: data.orderByEmail ?? false,
    collectsLocalDeliveries: data.collectsLocalDeliveries ?? false, minimumOrderValue: minimumFromForm(data.minimumOrderValue),
    accountManagerName: data.accountManagerName?.trim() || null, accountManagerEmail: data.accountManagerEmail?.trim() || null,
    ...(opts.isNew ? { accountNumber: data.accountNumber?.trim() || null } : {}),
  };
}

/** "New supplier" in its own full-size pop-up. `onCreated` gets the new
 *  supplier, so a dropdown that opened it can select it straight away. The
 *  name can be filled in from what was typed. */
export function NewSupplierDialog({ open, onClose, onCreated, initialName, zIndexClass }: {
  open: boolean;
  onClose: () => void;
  onCreated?: (supplier: { id: number; name: string }) => void;
  initialName?: string;
  /** Raise it above another pop-up it was opened from. */
  zIndexClass?: string;
}) {
  const { createSupplier } = useAppMutations();
  const [formKey] = useState(() => Math.random().toString(36).slice(2));
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className={cn("p-0 gap-0 flex flex-col w-[calc(100vw-1rem)] sm:max-w-[min(96vw,1400px)] h-[92dvh] max-h-[92dvh] overflow-hidden bg-card border-border rounded-2xl [&>button:last-child]:p-2 [&>button:last-child]:right-3 [&>button:last-child]:top-3 [&>button:last-child>svg]:h-5 [&>button:last-child>svg]:w-5", zIndexClass)}>
        {open && (
          <SupplierForm
            key={formKey}
            title="New Supplier"
            values={{ ...supplierFormDefaults, name: initialName ?? "" }}
            isEdit={false}
            isPending={createSupplier.isPending}
            onSubmit={data => {
              createSupplier.mutate(
                { data: supplierBodyFromForm(data, { isNew: true }) },
                {
                  onSuccess: (created: unknown) => {
                    const s = created as { id?: number; name?: string } | undefined;
                    if (s?.id != null) onCreated?.({ id: s.id, name: s.name ?? data.name });
                    onClose();
                  },
                },
              );
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
