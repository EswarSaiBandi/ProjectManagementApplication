'use client';

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Percent, Plus, Pencil, Trash2 } from "lucide-react";

type ProjectQuote = {
  id?: number;
  quote_id?: number;
  project_id: number;
  quote_number: string | null;
  vendor_name: string | null;
  title: string | null;
  total_amount: number | null;
  status: string;
  issued_date: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

const STATUS_OPTIONS = ["Draft", "Sent", "Approved", "Rejected"] as const;

function statusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("approved")) return "bg-green-100 text-green-800";
  if (s.includes("rejected")) return "bg-red-100 text-red-800";
  if (s.includes("sent")) return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}

export default function QuotesTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [quotes, setQuotes] = useState<ProjectQuote[]>([]);
  const [loading, setLoading] = useState(true);

  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ProjectQuote | null>(null);
  const [editingKey, setEditingKey] = useState<{ column: string; value: number } | null>(null);

  const [form, setForm] = useState({
    quote_number: "",
    vendor_name: "",
    title: "",
    total_amount: "",
    status: "Draft",
    issued_date: "",
    notes: "",
  });

  const resetForm = () => {
    setEditing(null);
    setForm({
      quote_number: "",
      vendor_name: "",
      title: "",
      total_amount: "",
      status: "Draft",
      issued_date: "",
      notes: "",
    });
  };

  const fetchQuotes = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_quotes")
      .select("*")
      .eq("project_id", numericProjectId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Error fetching quotes:", error);
      toast.error("Failed to load quotes");
      setQuotes([]);
    } else {
      setQuotes((data || []) as ProjectQuote[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const openNew = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (q: ProjectQuote) => {
    setEditing(q);
    const key =
      typeof q.id === "number"
        ? { column: "id", value: q.id }
        : typeof q.quote_id === "number"
          ? { column: "quote_id", value: q.quote_id }
          : null;
    setEditingKey(key);
    setForm({
      quote_number: q.quote_number || "",
      vendor_name: q.vendor_name || "",
      title: q.title || "",
      total_amount: q.total_amount != null ? String(q.total_amount) : "",
      status: q.status || "Draft",
      issued_date: q.issued_date || "",
      notes: q.notes || "",
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
      quote_number: form.quote_number.trim() ? form.quote_number.trim() : null,
      vendor_name: form.vendor_name.trim() ? form.vendor_name.trim() : null,
      title: form.title.trim() ? form.title.trim() : null,
      total_amount: form.total_amount ? Number(form.total_amount) : 0,
      status: form.status,
      issued_date: form.issued_date || null,
      notes: form.notes.trim() ? form.notes.trim() : null,
    };

    if (editing) {
      if (!editingKey) {
        toast.error("Cannot update: missing quote identifier");
        setIsSaving(false);
        return;
      }
      const { error } = await supabase.from("project_quotes").update(payload).eq(editingKey.column, editingKey.value);
      if (error) {
        console.error("Error updating quote:", error);
        toast.error(error.message || "Failed to update quote");
      } else {
        toast.success("Quote updated");
        setIsOpen(false);
        resetForm();
        fetchQuotes();
      }
    } else {
      const { error } = await supabase.from("project_quotes").insert([{ ...payload, created_by: userId }]);
      if (error) {
        console.error("Error creating quote:", error);
        toast.error(error.message || "Failed to create quote");
      } else {
        toast.success("Quote created");
        setIsOpen(false);
        resetForm();
        fetchQuotes();
      }
    }
    setIsSaving(false);
  };

  const handleDelete = async (q: ProjectQuote) => {
    if (!confirm(`Delete quote ${q.quote_number ? `"${q.quote_number}"` : `#${q.id}`}?`)) return;
    const key =
      typeof q.id === "number"
        ? { column: "id", value: q.id }
        : typeof q.quote_id === "number"
          ? { column: "quote_id", value: q.quote_id }
          : null;
    if (!key) {
      toast.error("Cannot delete: missing quote identifier");
      return;
    }
    const { error } = await supabase.from("project_quotes").delete().eq(key.column, key.value);
    if (error) {
      console.error("Error deleting quote:", error);
      toast.error(error.message || "Failed to delete quote");
    } else {
      toast.success("Quote deleted");
      fetchQuotes();
    }
  };

  const totalQuotes = quotes.reduce((sum, q) => sum + (q.total_amount || 0), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Percent className="h-5 w-5 text-slate-500" /> Quotes
            </CardTitle>
            <div className="text-sm text-muted-foreground mt-1">
              Total: <span className={cn("font-semibold", totalQuotes > 0 ? "text-slate-900" : "")}>₹ {totalQuotes.toLocaleString("en-IN")}</span>
            </div>
          </div>
          <Dialog
            open={isOpen}
            onOpenChange={(open) => {
              setIsOpen(open);
              if (!open) resetForm();
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                <Plus className="h-4 w-4 mr-2" /> New Quote
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Quote" : "New Quote"}</DialogTitle>
                <DialogDescription>Header-level quote details (line items can be added later).</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Quote #</label>
                    <Input value={form.quote_number} onChange={(e) => setForm((p) => ({ ...p, quote_number: e.target.value }))} className="bg-white" />
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
                    <label className="text-sm font-medium text-slate-700">Issued Date</label>
                    <Input type="date" value={form.issued_date} onChange={(e) => setForm((p) => ({ ...p, issued_date: e.target.value }))} className="bg-white" />
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
            <div className="text-center py-8 text-muted-foreground">Loading quotes...</div>
          ) : quotes.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Percent className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No quotes yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quote</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="w-[140px]">Status</TableHead>
                  <TableHead className="w-[140px]">Amount</TableHead>
                  <TableHead className="w-[160px]">Issued</TableHead>
                  <TableHead className="text-right w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((q) => (
                  <TableRow key={q.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">
                      <div className="space-y-1">
                        <div className="text-slate-900">{q.quote_number || `Quote #${q.id}`}</div>
                        {q.title ? <div className="text-xs text-slate-500 line-clamp-1">{q.title}</div> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">{q.vendor_name || <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell>
                      <Badge className={statusBadge(q.status)}>{q.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm font-semibold text-slate-900">₹ {(q.total_amount || 0).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-sm text-slate-700">{q.issued_date ? new Date(q.issued_date).toLocaleDateString() : <span className="text-slate-400">—</span>}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(q)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDelete(q)}>
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

