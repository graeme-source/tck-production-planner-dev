import { useState, useEffect, type ReactNode } from "react";
import { SupplierPaymentEditor } from "@/components/suppliers/supplier-payment-editor";
import { NewSupplierDialog, SupplierForm, supplierBodyFromForm } from "@/components/suppliers/supplier-form";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useListSuppliers, type CreateSupplier } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Edit2, Loader2, Building2, Mail, Phone, Globe, MapPin, Search, ClipboardCheck, GripVertical, Truck, Clock, UserRound, Contact, Landmark } from "lucide-react";
import { SUPPLIER_TABS, supplierTabsFor, supplierErrorCounts, firstSupplierErrorTab, type SupplierTabId } from "@/lib/supplier-editor-tabs";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SUPPLIER_CARD_ACTIONS_ROW, SUPPLIER_CARD_EDIT_BUTTON, SUPPLIER_CARD_DELETE_BUTTON } from "@/lib/supplier-card-actions";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type SupplierItem = {
  id: number;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  orderingPhone?: string | null;
  website?: string | null;
  address?: string | null;
  notes?: string | null;
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
  createdAt: string;
};


interface CheckConfig {
  id: number;
  supplierId: number;
  label: string;
  isRequired: boolean;
  sortOrder: number;
}

function DeliveryChecksEditor({ supplierId }: { supplierId: number }) {
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState("");

  const { data: checks, isLoading } = useQuery({
    queryKey: ["/api/deliveries/supplier", supplierId, "check-configs"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/deliveries/supplier/${supplierId}/check-configs`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch checks");
      return res.json() as Promise<CheckConfig[]>;
    },
  });

  const seedDefaults = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/deliveries/supplier/${supplierId}/seed-defaults`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to seed defaults");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/deliveries/supplier", supplierId, "check-configs"] }),
  });

  const addCheck = useMutation({
    mutationFn: async (label: string) => {
      const sortOrder = (checks?.length ?? 0);
      const res = await fetch(`${BASE}/api/deliveries/supplier/${supplierId}/check-configs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ label, isRequired: true, sortOrder }),
      });
      if (!res.ok) throw new Error("Failed to add check");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deliveries/supplier", supplierId, "check-configs"] });
      setNewLabel("");
    },
  });

  const deleteCheck = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/deliveries/check-configs/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete check");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/deliveries/supplier", supplierId, "check-configs"] }),
  });

  const toggleRequired = useMutation({
    mutationFn: async ({ id, isRequired }: { id: number; isRequired: boolean }) => {
      const res = await fetch(`${BASE}/api/deliveries/check-configs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isRequired }),
      });
      if (!res.ok) throw new Error("Failed to update check");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/deliveries/supplier", supplierId, "check-configs"] }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading checks...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-primary" /> Delivery Checks
        </h4>
        {(!checks || checks.length === 0) && (
          <button
            type="button"
            onClick={() => seedDefaults.mutate()}
            disabled={seedDefaults.isPending}
            className="text-xs text-primary hover:underline"
          >
            {seedDefaults.isPending ? "Adding..." : "Add default checks"}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Checks that must be completed when receiving deliveries from this supplier.
      </p>

      {checks && checks.length > 0 && (
        <div className="space-y-2">
          {checks.map((check) => (
            <div
              key={check.id}
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 bg-background"
            >
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
              <span className="text-sm flex-1">{check.label}</span>
              <button
                type="button"
                onClick={() => toggleRequired.mutate({ id: check.id, isRequired: !check.isRequired })}
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full border transition-colors",
                  check.isRequired
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-secondary text-muted-foreground border-border"
                )}
              >
                {check.isRequired ? "Required" : "Optional"}
              </button>
              <button
                type="button"
                onClick={() => deleteCheck.mutate(check.id)}
                className="p-1 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Add custom check..."
          className="flex-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newLabel.trim()) {
              e.preventDefault();
              addCheck.mutate(newLabel.trim());
            }
          }}
        />
        <button
          type="button"
          disabled={!newLabel.trim() || addCheck.isPending}
          onClick={() => newLabel.trim() && addCheck.mutate(newLabel.trim())}
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function Suppliers() {
  const { data: suppliers, isLoading } = useListSuppliers();
  const { createSupplier, updateSupplier, deleteSupplier } = useAppMutations();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SupplierItem | null>(null);

  // /suppliers?edit=12 opens that supplier's record — the Contacts page
  // links supplier cards here, since their numbers are edited on the record
  // (2026-10-02). Once only: the param is dropped so closing doesn't reopen.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("edit"));
    if (!id || !suppliers) return;
    const s = suppliers.find(x => x.id === id);
    if (s) setEditingItem(s as SupplierItem);
    window.history.replaceState(null, "", window.location.pathname);
  }, [suppliers]);

  const filtered = suppliers?.filter(s =>
    s.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    s.contactName?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    s.email?.toLowerCase().includes(debouncedSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Database"
        description="Manage your suppliers, contact details, and ordering information."
        action={
          <button
            onClick={() => setIsAddOpen(true)}
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium shadow-md shadow-primary/20 flex items-center gap-2 hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-5 h-5" /> Add Supplier
          </button>
        }
      />

      {/* Add Dialog — the shared "New supplier" pop-up (also opened from the
          ingredient editor's supplier dropdown). */}
      <NewSupplierDialog open={isAddOpen} onClose={() => setIsAddOpen(false)} />

      {editingItem && (
        <Dialog open={!!editingItem} onOpenChange={(v) => { if (!v) setEditingItem(null); }}>
          <DialogContent className="p-0 gap-0 flex flex-col w-[calc(100vw-1rem)] sm:max-w-[min(96vw,1400px)] h-[92dvh] max-h-[92dvh] overflow-hidden bg-card border-border rounded-2xl [&>button:last-child]:p-2 [&>button:last-child]:right-3 [&>button:last-child]:top-3 [&>button:last-child>svg]:h-5 [&>button:last-child>svg]:w-5">
            <SupplierForm
              key={editingItem.id}
              title={editingItem.name || "Edit Supplier"}
              paymentPanel={<SupplierPaymentEditor supplierId={editingItem.id} />}
              checksPanel={<DeliveryChecksEditor supplierId={editingItem.id} />}
              values={{
                name: editingItem.name,
                contactName: editingItem.contactName ?? "",
                email: editingItem.email ?? "",
                phone: editingItem.phone ?? "",
                orderingPhone: editingItem.orderingPhone ?? "",
                website: editingItem.website ?? "",
                address: editingItem.address ?? "",
                notes: editingItem.notes ?? "",
                orderFrequency: (editingItem.orderFrequency as "daily" | "weekly") ?? "daily",
                orderDays: editingItem.orderDays ?? "",
                leadTimeDays: editingItem.leadTimeDays ?? 1,
                cutoffTime: editingItem.cutoffTime ?? "17:00",
                invoiceNotRequired: editingItem.invoiceNotRequired ?? false,
                orderByEmail: editingItem.orderByEmail ?? false,
                collectsLocalDeliveries: editingItem.collectsLocalDeliveries ?? false,
                minimumOrderValue: editingItem.minimumOrderValue != null ? String(editingItem.minimumOrderValue) : "",
                accountManagerName: editingItem.accountManagerName ?? "",
                accountManagerEmail: editingItem.accountManagerEmail ?? "",
              }}
              isEdit
              editing={{ id: editingItem.id, accountNumber: editingItem.accountNumber ?? null }}
              isPending={updateSupplier.isPending}
              onSubmit={(data) => {
                  const body = supplierBodyFromForm(data, { isNew: false });
                updateSupplier.mutate(
                  { id: editingItem.id, data: body },
                  { onSuccess: () => setEditingItem(null) }
                );
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search suppliers..."
          className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && filtered?.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No suppliers yet</p>
          <p className="text-sm mt-1">Add your first supplier to get started.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered?.map((supplier) => (
          <div
            key={supplier.id}
            className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3 group hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div className={SUPPLIER_CARD_ACTIONS_ROW}>
                <button
                  onClick={() => setEditingItem(supplier as SupplierItem)}
                  className={SUPPLIER_CARD_EDIT_BUTTON}
                  title="Edit"
                  aria-label={`Edit ${supplier.name}`}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { if (confirm(`Delete "${supplier.name}"?`)) deleteSupplier.mutate({ id: supplier.id }); }}
                  className={SUPPLIER_CARD_DELETE_BUTTON}
                  title="Delete"
                  aria-label={`Delete ${supplier.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-base leading-tight">{supplier.name}</h3>
              {supplier.contactName && (
                <p className="text-sm text-muted-foreground mt-0.5">{supplier.contactName}</p>
              )}
            </div>

            <div className="space-y-1.5 text-sm">
              {(supplier as SupplierItem).accountManagerEmail && (
                <a
                  href={`mailto:${(supplier as SupplierItem).accountManagerEmail}`}
                  className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors truncate"
                  title="Account manager — short-shelf-life reports go here"
                >
                  <UserRound className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">
                    Account manager: {(supplier as SupplierItem).accountManagerName ? `${(supplier as SupplierItem).accountManagerName} · ` : ""}{(supplier as SupplierItem).accountManagerEmail}
                  </span>
                </a>
              )}
              {supplier.email && (
                <a
                  href={`mailto:${supplier.email}`}
                  className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors truncate"
                >
                  <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{supplier.email}</span>
                </a>
              )}
              {supplier.phone && (
                <a
                  href={`tel:${supplier.phone}`}
                  className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                  {supplier.phone}
                </a>
              )}
              {supplier.website && (
                <a
                  href={supplier.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-primary hover:underline truncate"
                >
                  <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{supplier.website.replace(/^https?:\/\//, "")}</span>
                </a>
              )}
              {supplier.address && (
                <p className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span className="line-clamp-2">{supplier.address}</span>
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 mt-auto">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                <Truck className="w-3 h-3" />
                {(supplier as SupplierItem).leadTimeDays ?? 1} day{((supplier as SupplierItem).leadTimeDays ?? 1) !== 1 ? "s" : ""} lead
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-secondary text-muted-foreground font-medium">
                <Clock className="w-3 h-3" />
                Cut-off {(supplier as SupplierItem).cutoffTime ?? "17:00"}
              </span>
              {(supplier as SupplierItem).minimumOrderValue != null && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
                  Min order &pound;{Number((supplier as SupplierItem).minimumOrderValue).toFixed(2)}
                </span>
              )}
            </div>

            {supplier.notes && (
              <p className="text-xs text-muted-foreground bg-secondary/40 rounded-lg px-3 py-2 line-clamp-2">
                {supplier.notes}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
