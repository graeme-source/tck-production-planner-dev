import { useState } from "react";
import { useListSuppliers } from "@workspace/api-client-react";
import { useAppMutations } from "@/hooks/use-mutations";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Edit2, Loader2, Building2, Mail, Phone, Globe, MapPin, Search } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  contactName: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  orderFrequency: z.enum(["daily", "weekly"]).optional(),
  orderDays: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type SupplierItem = {
  id: number;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  notes?: string | null;
  orderFrequency?: string;
  orderDays?: string | null;
  createdAt: string;
};

const defaultValues: FormValues = {
  name: "", contactName: "", email: "", phone: "", website: "", address: "", notes: "", orderFrequency: "daily", orderDays: "",
};

function SupplierForm({
  values,
  onSubmit,
  isPending,
  isEdit,
}: {
  values: FormValues;
  onSubmit: (data: FormValues) => void;
  isPending: boolean;
  isEdit: boolean;
}) {
  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: values,
  });

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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
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
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[64px] resize-none"
          placeholder="Street, City, Postcode"
        />
      </div>

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

      <div>
        <label className="text-sm font-medium mb-1 block">Notes</label>
        <textarea
          {...register("notes")}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[60px] resize-none"
          placeholder="Lead times, payment terms, order minimums..."
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        {isPending ? "Saving..." : isEdit ? "Save Changes" : "Add Supplier"}
      </button>
    </form>
  );
}

export default function Suppliers() {
  const { data: suppliers, isLoading } = useListSuppliers();
  const { createSupplier, updateSupplier, deleteSupplier } = useAppMutations();
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SupplierItem | null>(null);

  const filtered = suppliers?.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.contactName?.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase())
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

      {/* Add Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[540px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">New Supplier</DialogTitle>
          </DialogHeader>
          <SupplierForm
            values={defaultValues}
            isEdit={false}
            isPending={createSupplier.isPending}
            onSubmit={(data) =>
              createSupplier.mutate(
                { data: { ...data, email: data.email || undefined, contactName: data.contactName || undefined, phone: data.phone || undefined, website: data.website || undefined, address: data.address || undefined, notes: data.notes || undefined, orderFrequency: data.orderFrequency ?? "daily", orderDays: data.orderFrequency === "weekly" ? (data.orderDays || null) : null } },
                { onSuccess: () => setIsAddOpen(false) }
              )
            }
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      {editingItem && (
        <Dialog open={!!editingItem} onOpenChange={(v) => { if (!v) setEditingItem(null); }}>
          <DialogContent className="sm:max-w-[540px] bg-card border-border rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">Edit Supplier</DialogTitle>
            </DialogHeader>
            <SupplierForm
              key={editingItem.id}
              values={{
                name: editingItem.name,
                contactName: editingItem.contactName ?? "",
                email: editingItem.email ?? "",
                phone: editingItem.phone ?? "",
                website: editingItem.website ?? "",
                address: editingItem.address ?? "",
                notes: editingItem.notes ?? "",
                orderFrequency: (editingItem.orderFrequency as "daily" | "weekly") ?? "daily",
                orderDays: editingItem.orderDays ?? "",
              }}
              isEdit
              isPending={updateSupplier.isPending}
              onSubmit={(data) =>
                updateSupplier.mutate(
                  { id: editingItem.id, data: { ...data, email: data.email || undefined, contactName: data.contactName || undefined, phone: data.phone || undefined, website: data.website || undefined, address: data.address || undefined, notes: data.notes || undefined, orderFrequency: data.orderFrequency ?? "daily", orderDays: data.orderFrequency === "weekly" ? (data.orderDays || null) : null } },
                  { onSuccess: () => setEditingItem(null) }
                )
              }
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
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setEditingItem(supplier as SupplierItem)}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
                  title="Edit"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { if (confirm(`Delete "${supplier.name}"?`)) deleteSupplier.mutate({ id: supplier.id }); }}
                  className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                  title="Delete"
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

            {supplier.notes && (
              <p className="text-xs text-muted-foreground bg-secondary/40 rounded-lg px-3 py-2 line-clamp-2 mt-auto">
                {supplier.notes}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
