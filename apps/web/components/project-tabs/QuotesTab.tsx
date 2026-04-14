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
import { Copy, Download, ExternalLink, Mail, Percent, Plus, Pencil, Trash2 } from "lucide-react";

type ProjectQuote = {
  id?: number;
  quote_id?: number;
  project_id: number;
  quote_number: string | null;
  vendor_name: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  subject?: string | null;
  title: string | null;
  total_amount: number | null;
  gst_percent?: number | null;
  sub_total?: number | null;
  gst_amount?: number | null;
  grand_total?: number | null;
  terms?: string | null;
  share_token?: string | null;
  share_enabled?: boolean | null;
  status: string;
  issued_date: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
};

type QuoteItem = {
  id: number;
  quote_id: number;
  line_no: number;
  scope: string;
  metric: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
  created_at: string;
  updated_at: string;
};

type FinalQuotationFile = {
  id?: number;
  file_id?: number;
  project_id: number;
  bucket: string;
  object_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
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

function formatBytes(bytes?: number | null) {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export default function QuotesTab({ projectId, role }: { projectId: string; role?: string | null }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);
  const canManageQuotes = role === "Admin" || role === "ProjectManager";
  const canViewFinalQuotation = role === "Admin" || role === "Client";
  const canUploadFinalQuotation = role === "Admin";

  const [quotes, setQuotes] = useState<ProjectQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [finalQuotationFiles, setFinalQuotationFiles] = useState<FinalQuotationFile[]>([]);
  const [finalFilesLoading, setFinalFilesLoading] = useState(false);
  const [finalUploadDialogOpen, setFinalUploadDialogOpen] = useState(false);
  const [finalUploadFile, setFinalUploadFile] = useState<File | null>(null);
  const [finalUploading, setFinalUploading] = useState(false);

  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ProjectQuote | null>(null);
  const [editingKey, setEditingKey] = useState<{ column: string; value: number } | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeQuote, setActiveQuote] = useState<ProjectQuote | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemForm, setItemForm] = useState({
    scope: "",
    metric: "Sq. Ft",
    quantity: "",
    unit_price: "",
    amount: "",
  });

  const [form, setForm] = useState({
    quote_number: "",
    vendor_name: "",
    customer_name: "",
    customer_address: "",
    subject: "",
    title: "",
    total_amount: "",
    gst_percent: "18",
    terms: "",
    status: "Draft",
    issued_date: "",
    notes: "",
  });

  const resetForm = () => {
    setEditing(null);
    setForm({
      quote_number: "",
      vendor_name: "",
      customer_name: "",
      customer_address: "",
      subject: "",
      title: "",
      total_amount: "",
      gst_percent: "18",
      terms: "",
      status: "Draft",
      issued_date: "",
      notes: "",
    });
  };

  const resetItemForm = () => {
    setItemForm({ scope: "", metric: "Sq. Ft", quantity: "", unit_price: "", amount: "" });
  };

  const generateToken = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  const shareUrl = (q: ProjectQuote) => {
    if (!q.share_token) return "";
    return `${window.location.origin}/quote/share/${q.share_token}`;
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

  const fetchFinalQuotationFiles = async () => {
    if (!Number.isFinite(numericProjectId) || !canViewFinalQuotation) return;
    setFinalFilesLoading(true);
    const { data, error } = await supabase
      .from("project_files")
      .select("*")
      .eq("project_id", numericProjectId)
      .like("object_path", `projects/${numericProjectId}/quotes/final/%`)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Final quotation files fetch error:", error);
      toast.error(error.message || "Failed to load final quotation files");
      setFinalQuotationFiles([]);
    } else {
      setFinalQuotationFiles((data || []) as FinalQuotationFile[]);
    }
    setFinalFilesLoading(false);
  };

  useEffect(() => {
    fetchQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  useEffect(() => {
    void fetchFinalQuotationFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId, canViewFinalQuotation]);

  const openNew = () => {
    resetForm();
    setIsOpen(true);
  };

  const handleFinalQuotationUpload = async () => {
    if (!canUploadFinalQuotation) {
      toast.error("Only Admin can upload final quotation");
      return;
    }
    if (!finalUploadFile) {
      toast.error("Choose a file first");
      return;
    }
    if (!Number.isFinite(numericProjectId)) {
      toast.error("Invalid project");
      return;
    }
    setFinalUploading(true);
    const bucket = "documents";
    const path = `projects/${numericProjectId}/quotes/final/${Date.now()}-${safeFileName(finalUploadFile.name)}`;
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, finalUploadFile, {
      contentType: finalUploadFile.type || undefined,
      upsert: false,
    });
    if (uploadError) {
      toast.error(uploadError.message || "Failed to upload");
      setFinalUploading(false);
      return;
    }
    const { error: dbError } = await supabase.from("project_files").insert([
      {
        project_id: numericProjectId,
        bucket,
        object_path: path,
        file_url: `${bucket}/${path}`,
        file_name: finalUploadFile.name,
        mime_type: finalUploadFile.type || null,
        size_bytes: finalUploadFile.size || null,
        created_by: userId,
      },
    ]);
    if (dbError) {
      toast.error(dbError.message || "Uploaded, but failed to save metadata");
    } else {
      toast.success("Final quotation uploaded");
      setFinalUploadDialogOpen(false);
      setFinalUploadFile(null);
      await fetchFinalQuotationFiles();
    }
    setFinalUploading(false);
  };

  const handleFinalQuotationDownload = async (f: FinalQuotationFile) => {
    const { data, error } = await supabase.storage.from(f.bucket).createSignedUrl(f.object_path, 60);
    if (error) {
      toast.error(error.message || "Failed to generate download link");
      return;
    }
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleFinalQuotationDelete = async (f: FinalQuotationFile) => {
    if (!canUploadFinalQuotation) return;
    if (!confirm(`Delete "${f.file_name}"?`)) return;
    const { error: storageError } = await supabase.storage.from(f.bucket).remove([f.object_path]);
    if (storageError) {
      toast.error(storageError.message || "Failed to delete from storage");
      return;
    }
    const key =
      typeof f.id === "number"
        ? { column: "id", value: f.id }
        : typeof f.file_id === "number"
          ? { column: "file_id", value: f.file_id }
          : null;
    if (!key) {
      await fetchFinalQuotationFiles();
      return;
    }
    const { error: dbError } = await supabase.from("project_files").delete().eq(key.column, key.value);
    if (dbError) {
      toast.error(dbError.message || "Deleted from storage, but failed to delete metadata");
    } else {
      toast.success("Final quotation deleted");
      await fetchFinalQuotationFiles();
    }
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
      customer_name: q.customer_name || "",
      customer_address: q.customer_address || "",
      subject: (q.subject as any) || "",
      title: q.title || "",
      total_amount: q.total_amount != null ? String(q.total_amount) : "",
      gst_percent: q.gst_percent != null ? String(q.gst_percent) : "18",
      terms: (q.terms as any) || "",
      status: q.status || "Draft",
      issued_date: q.issued_date || "",
      notes: q.notes || "",
    });
    setIsOpen(true);
  };

  const fetchItems = async (quoteId: number) => {
    setItemsLoading(true);
    const { data, error } = await supabase
      .from("project_quote_items")
      .select("*")
      .eq("quote_id", quoteId)
      .order("line_no", { ascending: true });
    if (error) {
      console.error("Items fetch error:", error);
      toast.error(error.message || "Failed to load quote items");
      setItems([]);
    } else {
      setItems((data || []) as QuoteItem[]);
    }
    setItemsLoading(false);
  };

  const openDetails = async (q: ProjectQuote) => {
    if (!q.id) {
      toast.error("Missing quote id");
      return;
    }
    setActiveQuote(q);
    setDetailsOpen(true);
    resetItemForm();
    await fetchItems(q.id);
  };

  const computeSubTotal = (lineItems: QuoteItem[]) => {
    return lineItems.reduce((sum, it) => {
      const qty = it.quantity != null ? Number(it.quantity) : null;
      const price = it.unit_price != null ? Number(it.unit_price) : null;
      const amount = it.amount != null ? Number(it.amount) : qty != null && price != null ? qty * price : 0;
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);
  };

  const updateTotals = async (quote: ProjectQuote, lineItems: QuoteItem[]) => {
    if (!quote.id) return;
    const subTotal = computeSubTotal(lineItems);
    const gstPercent = Number(quote.gst_percent ?? 18) || 0;
    const gstAmount = Math.round((subTotal * gstPercent) / 100 * 100) / 100;
    const grandTotal = Math.round((subTotal + gstAmount) * 100) / 100;
    const { error } = await supabase
      .from("project_quotes")
      .update({
        sub_total: subTotal,
        gst_percent: gstPercent,
        gst_amount: gstAmount,
        grand_total: grandTotal,
        total_amount: grandTotal,
      })
      .eq("id", quote.id);
    if (error) {
      console.error("Totals update error:", error);
      return;
    }
    setActiveQuote((prev) =>
      prev && prev.id === quote.id
        ? { ...prev, sub_total: subTotal, gst_percent: gstPercent, gst_amount: gstAmount, grand_total: grandTotal, total_amount: grandTotal }
        : prev
    );
  };

  const addItem = async () => {
    if (!activeQuote?.id) return;
    if (!itemForm.scope.trim()) {
      toast.error("Scope/description is required");
      return;
    }
    const qty = itemForm.quantity.trim() ? Number(itemForm.quantity) : null;
    const price = itemForm.unit_price.trim() ? Number(itemForm.unit_price) : null;
    const amount = itemForm.amount.trim() ? Number(itemForm.amount) : null;
    const lineNo = (items[items.length - 1]?.line_no || 0) + 1;

    const { data, error } = await supabase
      .from("project_quote_items")
      .insert([
        {
          quote_id: activeQuote.id,
          line_no: lineNo,
          scope: itemForm.scope.trim(),
          metric: itemForm.metric.trim() ? itemForm.metric.trim() : null,
          quantity: qty,
          unit_price: price,
          amount: amount,
        },
      ])
      .select("*")
      .limit(1);
    if (error) {
      console.error("Item insert error:", error);
      toast.error(error.message || "Failed to add item");
      return;
    }
    const next = [...items, ...(data as any[])];
    setItems(next);
    resetItemForm();
    await updateTotals(activeQuote, next);
    await fetchQuotes();
  };

  const deleteItem = async (id: number) => {
    if (!activeQuote?.id) return;
    if (!confirm("Delete this line item?")) return;
    const { error } = await supabase.from("project_quote_items").delete().eq("id", id);
    if (error) {
      toast.error(error.message || "Failed to delete item");
      return;
    }
    const next = items.filter((x) => x.id !== id);
    setItems(next);
    await updateTotals(activeQuote, next);
    await fetchQuotes();
  };

  const enableShare = async () => {
    if (!activeQuote?.id) return;
    const token = activeQuote.share_token || generateToken();
    const { error } = await supabase
      .from("project_quotes")
      .update({ share_token: token, share_enabled: true })
      .eq("id", activeQuote.id);
    if (error) {
      toast.error(error.message || "Failed to enable sharing");
      return;
    }
    const updated = { ...activeQuote, share_token: token, share_enabled: true };
    setActiveQuote(updated);
    toast.success("Share link enabled");
    await fetchQuotes();
  };

  const copyShareLink = async () => {
    if (!activeQuote?.share_token) {
      toast.error("Enable sharing first");
      return;
    }
    await navigator.clipboard.writeText(shareUrl(activeQuote));
    toast.success("Link copied");
  };

  const shareEmail = () => {
    if (!activeQuote?.share_token) return toast.error("Enable sharing first");
    const url = shareUrl(activeQuote);
    const subject = encodeURIComponent(activeQuote.subject || activeQuote.title || "Quotation");
    const body = encodeURIComponent(`Please find the quotation here:\n${url}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const shareWhatsApp = () => {
    if (!activeQuote?.share_token) return toast.error("Enable sharing first");
    const url = shareUrl(activeQuote);
    const text = encodeURIComponent(`Quotation link: ${url}`);
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  };

  const exportItemsCsv = () => {
    const csvEscape = (v: any) => {
      const s = String(v ?? "");
      const needs = /[",\n\r]/.test(s);
      const escaped = s.replace(/"/g, '""');
      return needs ? `"${escaped}"` : escaped;
    };
    const header = ["scope", "metric", "quantity", "unit_price", "amount"].join(",");
    const rows = items.map((it) => [csvEscape(it.scope), csvEscape(it.metric), it.quantity ?? "", it.unit_price ?? "", it.amount ?? ""].join(","));
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `quote-items-${activeQuote?.id || "export"}.csv`;
    a.click();
  };

  const importItemsCsv = async (file: File) => {
    if (!activeQuote?.id) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return toast.error("CSV has no rows");
    const parseCsvLine = (line: string) => {
      const out: string[] = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (ch === '"') {
            inQ = false;
          } else {
            cur += ch;
          }
        } else {
          if (ch === ",") {
            out.push(cur);
            cur = "";
          } else if (ch === '"') {
            inQ = true;
          } else {
            cur += ch;
          }
        }
      }
      out.push(cur);
      return out;
    };

    const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);
    const iScope = idx("scope");
    if (iScope === -1) return toast.error("CSV must include 'scope' column");

    const payload = lines.slice(1).map((line, n) => {
      const parts = parseCsvLine(line);
      const scope = parts[iScope] || "";
      const metric = idx("metric") !== -1 ? (parts[idx("metric")] || "") : "";
      const q = idx("quantity") !== -1 ? Number(parts[idx("quantity")] || "") : null;
      const p = idx("unit_price") !== -1 ? Number(parts[idx("unit_price")] || "") : null;
      const a = idx("amount") !== -1 ? Number(parts[idx("amount")] || "") : null;
      return {
        quote_id: activeQuote.id,
        line_no: (items.length + n + 1),
        scope: String(scope || "").trim(),
        metric: String(metric || "").trim() || null,
        quantity: Number.isFinite(q) ? q : null,
        unit_price: Number.isFinite(p) ? p : null,
        amount: Number.isFinite(a) ? a : null,
      };
    }).filter((r) => r.scope);

    const { error } = await supabase.from("project_quote_items").insert(payload);
    if (error) {
      toast.error(error.message || "Failed to import items");
      return;
    }
    toast.success(`Imported ${payload.length} items`);
    await fetchItems(activeQuote.id);
    await updateTotals(activeQuote, [...items, ...(payload as any)]);
    await fetchQuotes();
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
      customer_name: form.customer_name.trim() ? form.customer_name.trim() : null,
      customer_address: form.customer_address.trim() ? form.customer_address.trim() : null,
      subject: form.subject.trim() ? form.subject.trim() : null,
      title: form.title.trim() ? form.title.trim() : null,
      total_amount: form.total_amount ? Number(form.total_amount) : 0,
      gst_percent: form.gst_percent ? Number(form.gst_percent) : 18,
      terms: form.terms.trim() ? form.terms.trim() : null,
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
      {canViewFinalQuotation && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Final Quotation Uploads</CardTitle>
              <div className="text-sm text-muted-foreground mt-1">Visibility: Client and Admin</div>
            </div>
            {canUploadFinalQuotation && (
              <Dialog
                open={finalUploadDialogOpen}
                onOpenChange={(open) => {
                  setFinalUploadDialogOpen(open);
                  if (!open) setFinalUploadFile(null);
                }}
              >
                <DialogTrigger asChild>
                  <Button className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                    <Plus className="h-4 w-4 mr-2" /> Upload Final Quotation
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-white">
                  <DialogHeader>
                    <DialogTitle>Upload Final Quotation</DialogTitle>
                    <DialogDescription>This file is intended for Client and Admin visibility in Quotes.</DialogDescription>
                  </DialogHeader>
                  <div className="py-2 space-y-3">
                    <Input type="file" onChange={(e) => setFinalUploadFile(e.target.files?.[0] ?? null)} className="bg-white" />
                    {finalUploadFile ? (
                      <div className="text-sm text-slate-600">
                        {finalUploadFile.name} • {formatBytes(finalUploadFile.size)}
                      </div>
                    ) : null}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setFinalUploadDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleFinalQuotationUpload} disabled={finalUploading} className="bg-blue-600 text-white hover:bg-blue-700">
                      {finalUploading ? "Uploading..." : "Upload"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent>
            {finalFilesLoading ? (
              <div className="text-sm text-muted-foreground">Loading final quotations...</div>
            ) : finalQuotationFiles.length === 0 ? (
              <div className="text-sm text-muted-foreground">No final quotation uploaded yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead className="w-[120px]">Size</TableHead>
                    <TableHead className="w-[220px]">Uploaded</TableHead>
                    <TableHead className="w-[140px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {finalQuotationFiles.map((f, idx) => (
                    <TableRow key={String(f.id ?? f.file_id ?? idx)} className="hover:bg-slate-50">
                      <TableCell className="font-medium">{f.file_name}</TableCell>
                      <TableCell className="text-sm text-slate-700">{formatBytes(f.size_bytes)}</TableCell>
                      <TableCell className="text-sm text-slate-700">{new Date(f.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => handleFinalQuotationDownload(f)}>
                            <Download className="h-4 w-4" />
                          </Button>
                          {canUploadFinalQuotation && (
                            <Button variant="outline" size="sm" onClick={() => handleFinalQuotationDelete(f)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {canManageQuotes && (
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
            <DialogContent className="bg-white max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Quote" : "New Quote"}</DialogTitle>
                <DialogDescription>Header details. Add line items in Quote Details.</DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                      Quote # <span className="text-xs text-slate-500">(auto-generated if empty)</span>
                    </label>
                    <Input 
                      value={form.quote_number} 
                      onChange={(e) => setForm((p) => ({ ...p, quote_number: e.target.value }))} 
                      className="bg-white" 
                      placeholder="Leave empty for auto: 027, 028..."
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
                    <label className="text-sm font-medium text-slate-700">Issued Date</label>
                    <Input type="date" value={form.issued_date} onChange={(e) => setForm((p) => ({ ...p, issued_date: e.target.value }))} className="bg-white" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Customer Name</label>
                    <Input value={form.customer_name} onChange={(e) => setForm((p) => ({ ...p, customer_name: e.target.value }))} className="bg-white" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">GST %</label>
                    <Input type="number" value={form.gst_percent} onChange={(e) => setForm((p) => ({ ...p, gst_percent: e.target.value }))} className="bg-white" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Customer Address</label>
                  <Textarea value={form.customer_address} onChange={(e) => setForm((p) => ({ ...p, customer_address: e.target.value }))} className="bg-white" />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Subject</label>
                  <Input value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))} className="bg-white" />
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
                  <label className="text-sm font-medium text-slate-700">Terms & Conditions</label>
                  <Textarea value={form.terms} onChange={(e) => setForm((p) => ({ ...p, terms: e.target.value }))} className="bg-white" />
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
                        <Button variant="outline" size="sm" onClick={() => openDetails(q)} title="Open details">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
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
      )}

      {canManageQuotes && (
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="bg-white max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Quote Details</DialogTitle>
            <DialogDescription>Line items (scope / metric / price) + share/send.</DialogDescription>
          </DialogHeader>

          {activeQuote ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-medium text-slate-900">{activeQuote.quote_number || `Quote #${activeQuote.id}`}</div>
                  <div className="text-xs text-slate-500">{activeQuote.subject || activeQuote.title || "—"}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={exportItemsCsv}>Export CSV</Button>
                  <label className="inline-flex items-center rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                    Import CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importItemsCsv(f);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  {!activeQuote.share_enabled ? (
                    <Button onClick={enableShare}>Enable Share Link</Button>
                  ) : (
                    <>
                      <Button variant="outline" onClick={copyShareLink}><Copy className="h-4 w-4 mr-2" /> Copy Link</Button>
                      <Button variant="outline" onClick={shareEmail}><Mail className="h-4 w-4 mr-2" /> Email</Button>
                      <Button variant="outline" onClick={shareWhatsApp}>WhatsApp</Button>
                      <Button
                        className="bg-blue-600 text-white hover:bg-blue-700"
                        onClick={() => {
                          // Open the share page in new tab for printing/downloading
                          window.open(`/quote/share/${activeQuote.share_token}`, '_blank');
                        }}
                      >
                        View & Download
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {activeQuote.share_enabled && activeQuote.share_token ? (
                <div className="text-xs text-slate-600">
                  Share link:{" "}
                  <a className="text-blue-600 hover:underline" href={shareUrl(activeQuote)} target="_blank" rel="noreferrer">
                    {shareUrl(activeQuote)}
                  </a>
                </div>
              ) : null}

              <div className="border rounded-md overflow-hidden">
                {itemsLoading ? (
                  <div className="p-6 text-sm text-slate-500">Loading items…</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">S No</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead className="w-28">Metric</TableHead>
                        <TableHead className="w-24 text-right">Qty</TableHead>
                        <TableHead className="w-32 text-right">Unit Price</TableHead>
                        <TableHead className="w-32 text-right">Amount</TableHead>
                        <TableHead className="w-24 text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-slate-500">No line items yet.</TableCell>
                        </TableRow>
                      ) : (
                        items.map((it, idx) => {
                          const qty = it.quantity != null ? Number(it.quantity) : null;
                          const price = it.unit_price != null ? Number(it.unit_price) : null;
                          const amount = it.amount != null ? Number(it.amount) : qty != null && price != null ? qty * price : 0;
                          return (
                            <TableRow key={it.id}>
                              <TableCell>{idx + 1}</TableCell>
                              <TableCell className="whitespace-pre-line">{it.scope}</TableCell>
                              <TableCell>{it.metric || "—"}</TableCell>
                              <TableCell className="text-right">{qty != null ? qty : "—"}</TableCell>
                              <TableCell className="text-right">{price != null ? price : "—"}</TableCell>
                              <TableCell className="text-right font-medium">{amount.toLocaleString("en-IN")}</TableCell>
                              <TableCell className="text-right">
                                <Button variant="outline" size="sm" onClick={() => deleteItem(it.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div className="rounded-md border p-4 bg-slate-50">
                <div className="text-sm font-medium text-slate-800 mb-3">Add line item</div>
                <div className="grid gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-600">Scope / Description *</label>
                    <Textarea
                      value={itemForm.scope}
                      onChange={(e) => setItemForm((p) => ({ ...p, scope: e.target.value }))}
                      placeholder="e.g., Ground Floor Area using Dr. Leakage Products"
                      className="bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-600">Metric</label>
                      <Input
                        value={itemForm.metric}
                        onChange={(e) => setItemForm((p) => ({ ...p, metric: e.target.value }))}
                        placeholder="Sq. Ft / Lumpsum"
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-600">Qty</label>
                      <Input
                        type="number"
                        value={itemForm.quantity}
                        onChange={(e) => setItemForm((p) => ({ ...p, quantity: e.target.value }))}
                        placeholder="e.g., 300"
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-600">Unit price</label>
                      <Input
                        type="number"
                        value={itemForm.unit_price}
                        onChange={(e) => setItemForm((p) => ({ ...p, unit_price: e.target.value }))}
                        placeholder="e.g., 25"
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-600">Amount (optional)</label>
                      <Input
                        type="number"
                        value={itemForm.amount}
                        onChange={(e) => setItemForm((p) => ({ ...p, amount: e.target.value }))}
                        placeholder="Use for lumpsum"
                        className="bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={resetItemForm}>Clear</Button>
                    <Button onClick={addItem} className="bg-blue-600 text-white hover:bg-blue-700">
                      <Plus className="h-4 w-4 mr-2" /> Add item
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <div className="w-full max-w-sm text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Subtotal</span>
                    <span className="font-medium">₹ {(activeQuote.sub_total || 0).toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">GST ({activeQuote.gst_percent ?? 18}%)</span>
                    <span className="font-medium">₹ {(activeQuote.gst_amount || 0).toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-semibold">Grand total</span>
                    <span className="font-bold">₹ {(activeQuote.grand_total || activeQuote.total_amount || 0).toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">No quote selected.</div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}
    </div>
  );
}

