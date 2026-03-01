'use client';

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Triangle } from "lucide-react";

type ProjectOrder = {
  id?: number;
  order_id?: number;
  project_id: number;
  order_number: string | null;
  vendor_name: string | null;
  title: string | null;
  total_amount: number | null;
  status: string;
  order_date: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

const STATUS_OPTIONS = ["Draft", "Placed", "Delivered", "Cancelled"] as const;

function statusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("delivered")) return "bg-green-100 text-green-800";
  if (s.includes("cancel")) return "bg-red-100 text-red-800";
  if (s.includes("placed")) return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}

export default function OrdersTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [orders, setOrders] = useState<ProjectOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ProjectOrder | null>(null);
  const [editingKey, setEditingKey] = useState<{ column: string; value: number } | null>(null);

  const [form, setForm] = useState({
    order_number: "",
    vendor_name: "",
    title: "",
    total_amount: "",
    status: "Draft",
    order_date: "",
    notes: "",
  });

  const resetForm = () => {
    setEditing(null);
    setForm({
      order_number: "",
      vendor_name: "",
      title: "",
      total_amount: "",
      status: "Draft",
      order_date: "",
      notes: "",
    });
  };

  const fetchOrders = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_orders")
      .select("*")
      .eq("project_id", numericProjectId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Error fetching orders:", error);
      toast.error("Failed to load orders");
      setOrders([]);
    } else {
      setOrders((data || []) as ProjectOrder[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const openNew = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (o: ProjectOrder) => {
    setEditing(o);
    const key =
      typeof o.id === "number"
        ? { column: "id", value: o.id }
        : typeof o.order_id === "number"
          ? { column: "order_id", value: o.order_id }
          : null;
    setEditingKey(key);
    setForm({
      order_number: o.order_number || "",
      vendor_name: o.vendor_name || "",
      title: o.title || "",
      total_amount: o.total_amount != null ? String(o.total_amount) : "",
      status: o.status || "Draft",
      order_date: o.order_date || "",
      notes: o.notes || "",
    });
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!Number.isFinite(numericProjectId)) {
      toast.error("Invalid project");
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const payload = {
      project_id: numericProjectId,
      order_number: form.order_number.trim() ? form.order_number.trim() : null,
      vendor_name: form.vendor_name.trim() ? form.vendor_name.trim() : null,
      title: form.title.trim() ? form.title.trim() : null,
      total_amount: form.total_amount ? Number(form.total_amount) : 0,
      status: form.status,
      order_date: form.order_date || null,
      notes: form.notes.trim() ? form.notes.trim() : null,
    };

    if (editing) {
      if (!editingKey) {
        toast.error("Cannot update: missing order identifier");
        setIsSaving(false);
        return;
      }
      const { error } = await supabase.from("project_orders").update(payload).eq(editingKey.column, editingKey.value);
      if (error) {
        console.error("Error updating order:", error);
        toast.error(error.message || "Failed to update order");
      } else {
        toast.success("Order updated");
        setIsOpen(false);
        resetForm();
        fetchOrders();
      }
    } else {
      const { error } = await supabase.from("project_orders").insert([{ ...payload, created_by: userId }]);
      if (error) {
        console.error("Error creating order:", error);
        toast.error(error.message || "Failed to create order");
      } else {
        toast.success("Order created");
        setIsOpen(false);
        resetForm();
        fetchOrders();
      }
    }
    setIsSaving(false);
  };

  const handleDelete = async (o: ProjectOrder) => {
    if (!confirm(`Delete order ${o.order_number ? `"${o.order_number}"` : `#${o.id}`}?`)) return;
    const key =
      typeof o.id === "number"
        ? { column: "id", value: o.id }
        : typeof o.order_id === "number"
          ? { column: "order_id", value: o.order_id }
          : null;
    if (!key) {
      toast.error("Cannot delete: missing order identifier");
      return;
    }
    const { error } = await supabase.from("project_orders").delete().eq(key.column, key.value);
    if (error) {
      console.error("Error deleting order:", error);
      toast.error(error.message || "Failed to delete order");
    } else {
      toast.success("Order deleted");
      fetchOrders();
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Triangle className="h-5 w-5 text-slate-500" /> Orders
          </CardTitle>
          <Dialog
            open={isOpen}
            onOpenChange={(open) => {
              setIsOpen(open);
              if (!open) resetForm();
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                <Plus className="h-4 w-4 mr-2" /> New Order
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Order" : "New Order"}</DialogTitle>
                <DialogDescription>Header-level order details (line items can be added later).</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                      Order # <span className="text-xs text-slate-500">(auto-generated if empty)</span>
                    </label>
                    <Input 
                      value={form.order_number} 
                      onChange={(e) => setForm((p) => ({ ...p, order_number: e.target.value }))} 
                      className="bg-white"
                      placeholder="Leave empty for auto: ORD-001, ORD-002..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Status</label>
                    <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border border-slate-200 shadow-lg">
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s} className="bg-white hover:bg-slate-50">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Vendor</label>
                    <Input value={form.vendor_name} onChange={(e) => setForm((p) => ({ ...p, vendor_name: e.target.value }))} className="bg-white" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Order Date</label>
                    <Input type="date" value={form.order_date} onChange={(e) => setForm((p) => ({ ...p, order_date: e.target.value }))} className="bg-white" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Title</label>
                  <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className="bg-white" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Total Amount</label>
                    <Input type="number" value={form.total_amount} onChange={(e) => setForm((p) => ({ ...p, total_amount: e.target.value }))} className="bg-white" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Notes</label>
                  <Textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className="bg-white" />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                  {isSaving ? "Saving..." : editing ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading orders...</div>
          ) : orders.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Triangle className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No orders yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="w-[140px]">Status</TableHead>
                  <TableHead className="w-[140px]">Amount</TableHead>
                  <TableHead className="w-[160px]">Date</TableHead>
                  <TableHead className="text-right w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">
                      <div className="space-y-1">
                        <div className="text-slate-900">{o.order_number || `Order #${o.id}`}</div>
                        {o.title ? <div className="text-xs text-slate-500 line-clamp-1">{o.title}</div> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">{o.vendor_name || <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell>
                      <Badge className={statusBadge(o.status)}>{o.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm font-semibold text-slate-900">₹ {(o.total_amount || 0).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-sm text-slate-700">{o.order_date ? new Date(o.order_date).toLocaleDateString() : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(o)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDelete(o)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

