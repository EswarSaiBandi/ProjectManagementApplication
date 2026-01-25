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
import { FileText, Plus, Pencil, Trash2 } from "lucide-react";

type ProjectInvoice = {
  id?: number;
  invoice_id?: number;
  project_id: number;
  invoice_number: string | null;
  counterparty_name: string | null;
  title: string | null;
  total_amount: number | null;
  status: string;
  issued_date: string | null;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

const STATUS_OPTIONS = ["Draft", "Sent", "Paid", "Overdue", "Cancelled"] as const;

function statusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("paid")) return "bg-green-100 text-green-800";
  if (s.includes("overdue")) return "bg-red-100 text-red-800";
  if (s.includes("cancel")) return "bg-slate-200 text-slate-700";
  if (s.includes("sent")) return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}

export default function InvoicesTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [invoices, setInvoices] = useState<ProjectInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ProjectInvoice | null>(null);
  const [editingKey, setEditingKey] = useState<{ column: string; value: number } | null>(null);

  const [form, setForm] = useState({
    invoice_number: "",
    counterparty_name: "",
    title: "",
    total_amount: "",
    status: "Draft",
    issued_date: "",
    due_date: "",
    notes: "",
  });

  const resetForm = () => {
    setEditing(null);
    setForm({
      invoice_number: "",
      counterparty_name: "",
      title: "",
      total_amount: "",
      status: "Draft",
      issued_date: "",
      due_date: "",
      notes: "",
    });
  };

  const fetchInvoices = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_invoices")
      .select("*")
      .eq("project_id", numericProjectId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Error fetching invoices:", error);
      toast.error("Failed to load invoices");
      setInvoices([]);
    } else {
      setInvoices((data || []) as ProjectInvoice[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const openNew = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (inv: ProjectInvoice) => {
    setEditing(inv);
    const key =
      typeof inv.id === "number"
        ? { column: "id", value: inv.id }
        : typeof inv.invoice_id === "number"
          ? { column: "invoice_id", value: inv.invoice_id }
          : null;
    setEditingKey(key);
    setForm({
      invoice_number: inv.invoice_number || "",
      counterparty_name: inv.counterparty_name || "",
      title: inv.title || "",
      total_amount: inv.total_amount != null ? String(inv.total_amount) : "",
      status: inv.status || "Draft",
      issued_date: inv.issued_date || "",
      due_date: inv.due_date || "",
      notes: inv.notes || "",
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
      invoice_number: form.invoice_number.trim() ? form.invoice_number.trim() : null,
      counterparty_name: form.counterparty_name.trim() ? form.counterparty_name.trim() : null,
      title: form.title.trim() ? form.title.trim() : null,
      total_amount: form.total_amount ? Number(form.total_amount) : 0,
      status: form.status,
      issued_date: form.issued_date || null,
      due_date: form.due_date || null,
      notes: form.notes.trim() ? form.notes.trim() : null,
    };

    if (editing) {
      if (!editingKey) {
        toast.error("Cannot update: missing invoice identifier");
        setIsSaving(false);
        return;
      }
      const { error } = await supabase.from("project_invoices").update(payload).eq(editingKey.column, editingKey.value);
      if (error) {
        console.error("Error updating invoice:", error);
        toast.error(error.message || "Failed to update invoice");
      } else {
        toast.success("Invoice updated");
        setIsOpen(false);
        resetForm();
        fetchInvoices();
      }
    } else {
      const { error } = await supabase.from("project_invoices").insert([{ ...payload, created_by: userId }]);
      if (error) {
        console.error("Error creating invoice:", error);
        toast.error(error.message || "Failed to create invoice");
      } else {
        toast.success("Invoice created");
        setIsOpen(false);
        resetForm();
        fetchInvoices();
      }
    }
    setIsSaving(false);
  };

  const handleDelete = async (inv: ProjectInvoice) => {
    if (!confirm(`Delete invoice ${inv.invoice_number ? `"${inv.invoice_number}"` : `#${inv.id}`}?`)) return;
    const key =
      typeof inv.id === "number"
        ? { column: "id", value: inv.id }
        : typeof inv.invoice_id === "number"
          ? { column: "invoice_id", value: inv.invoice_id }
          : null;
    if (!key) {
      toast.error("Cannot delete: missing invoice identifier");
      return;
    }
    const { error } = await supabase.from("project_invoices").delete().eq(key.column, key.value);
    if (error) {
      console.error("Error deleting invoice:", error);
      toast.error(error.message || "Failed to delete invoice");
    } else {
      toast.success("Invoice deleted");
      fetchInvoices();
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5 text-slate-500" /> Invoices
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
                <Plus className="h-4 w-4 mr-2" /> New Invoice
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Invoice" : "New Invoice"}</DialogTitle>
                <DialogDescription>Header-level invoice details (line items can be added later).</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Invoice #</label>
                    <Input value={form.invoice_number} onChange={(e) => setForm((p) => ({ ...p, invoice_number: e.target.value }))} className="bg-white" />
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
                    <label className="text-sm font-medium text-slate-700">Client/Vendor</label>
                    <Input value={form.counterparty_name} onChange={(e) => setForm((p) => ({ ...p, counterparty_name: e.target.value }))} className="bg-white" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Total Amount</label>
                    <Input type="number" value={form.total_amount} onChange={(e) => setForm((p) => ({ ...p, total_amount: e.target.value }))} className="bg-white" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Issued Date</label>
                    <Input type="date" value={form.issued_date} onChange={(e) => setForm((p) => ({ ...p, issued_date: e.target.value }))} className="bg-white" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Due Date</label>
                    <Input type="date" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} className="bg-white" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Title</label>
                  <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className="bg-white" />
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
            <div className="text-center py-8 text-muted-foreground">Loading invoices...</div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No invoices yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Client/Vendor</TableHead>
                  <TableHead className="w-[140px]">Status</TableHead>
                  <TableHead className="w-[140px]">Amount</TableHead>
                  <TableHead className="w-[160px]">Issued</TableHead>
                  <TableHead className="w-[160px]">Due</TableHead>
                  <TableHead className="text-right w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">
                      <div className="space-y-1">
                        <div className="text-slate-900">{inv.invoice_number || `Invoice #${inv.id}`}</div>
                        {inv.title ? <div className="text-xs text-slate-500 line-clamp-1">{inv.title}</div> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">{inv.counterparty_name || <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell>
                      <Badge className={statusBadge(inv.status)}>{inv.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm font-semibold text-slate-900">₹ {(inv.total_amount || 0).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-sm text-slate-700">{inv.issued_date ? new Date(inv.issued_date).toLocaleDateString() : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-sm text-slate-700">{inv.due_date ? new Date(inv.due_date).toLocaleDateString() : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(inv)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDelete(inv)}>
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

