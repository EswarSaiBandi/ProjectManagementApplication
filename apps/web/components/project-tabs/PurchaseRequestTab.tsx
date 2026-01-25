'use client';

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ShoppingBag, Plus, Eye, Save } from "lucide-react";

type Material = {
  material_id: number;
  item_name: string;
  unit: string | null;
};

type PrItem = {
  item_id: number;
  material_id: number;
  requested_qty: string | number | null;
  approved_qty: string | number | null;
  // PostgREST may return embedded relations as an object OR an array depending on FK inference.
  material_master?:
    | {
        item_name: string;
        unit: string | null;
      }
    | Array<{
        item_name: string;
        unit: string | null;
      }>
    | null;
};

type PurchaseRequest = {
  pr_id: number;
  project_id: number;
  requester_id: string | null;
  status: string;
  created_at: string;
  pr_items?: PrItem[] | null;
};

const STATUS_OPTIONS = ["Pending", "Approved", "Rejected"] as const;

function statusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("approved")) return "bg-green-100 text-green-800";
  if (s.includes("rejected")) return "bg-red-100 text-red-800";
  return "bg-yellow-100 text-yellow-800";
}

function getMaterialInfo(it: PrItem): { name: string | null; unit: string | null } {
  const mm = it.material_master;
  const m = Array.isArray(mm) ? mm[0] : mm;
  return { name: m?.item_name ?? null, unit: m?.unit ?? null };
}

export default function PurchaseRequestTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [prs, setPrs] = useState<PurchaseRequest[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  // Create PR dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [materialSearch, setMaterialSearch] = useState("");
  const [selectedQtyByMaterial, setSelectedQtyByMaterial] = useState<Record<number, string>>({});
  const [newMaterialName, setNewMaterialName] = useState("");
  const [newMaterialUnit, setNewMaterialUnit] = useState<string>("units");

  // View/Edit dialog
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [activePr, setActivePr] = useState<PurchaseRequest | null>(null);
  const [activeStatus, setActiveStatus] = useState<string>("Pending");
  const [approvedQtyByItemId, setApprovedQtyByItemId] = useState<Record<number, string>>({});

  const resetCreate = () => {
    setMaterialSearch("");
    setSelectedQtyByMaterial({});
    setNewMaterialName("");
    setNewMaterialUnit("units");
  };

  const fetchMaterials = async () => {
    const { data, error } = await supabase.from("material_master").select("material_id, item_name, unit").order("item_name");
    if (error) {
      console.error("Error fetching materials:", error);
      toast.error("Failed to load materials");
      setMaterials([]);
    } else {
      setMaterials((data || []) as Material[]);
    }
  };

  const fetchPRs = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_requests")
      .select(
        `
        pr_id,
        project_id,
        requester_id,
        status,
        created_at,
        pr_items (
          item_id,
          material_id,
          requested_qty,
          approved_qty,
          material_master (
            item_name,
            unit
          )
        )
      `
      )
      .eq("project_id", numericProjectId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching PRs:", error);
      toast.error("Failed to load purchase requests");
      setPrs([]);
    } else {
      setPrs((data || []) as unknown as PurchaseRequest[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMaterials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchPRs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const filteredMaterials = materials.filter((m) =>
    m.item_name.toLowerCase().includes(materialSearch.trim().toLowerCase())
  );

  const toggleMaterial = (materialId: number) => {
    setSelectedQtyByMaterial((prev) => {
      const next = { ...prev };
      if (next[materialId] != null) {
        delete next[materialId];
      } else {
        next[materialId] = "1";
      }
      return next;
    });
  };

  const handleQuickAddMaterial = async () => {
    const name = newMaterialName.trim();
    if (!name) {
      toast.error("Item name is required");
      return;
    }
    setIsSaving(true);
    const { data, error } = await supabase
      .from("material_master")
      .insert([{ item_name: name, unit: newMaterialUnit }])
      .select("material_id, item_name, unit")
      .single();

    if (error || !data?.material_id) {
      console.error("Add material error:", error);
      toast.error(error?.message || "Failed to add item");
      setIsSaving(false);
      return;
    }

    toast.success("Item added");
    await fetchMaterials();
    setMaterialSearch(data.item_name);
    setSelectedQtyByMaterial((prev) => ({ ...prev, [data.material_id]: prev[data.material_id] ?? "1" }));
    setNewMaterialName("");
    setIsSaving(false);
  };

  const handleCreate = async () => {
    if (isSaving) return;
    if (!Number.isFinite(numericProjectId)) {
      toast.error("Invalid project");
      return;
    }

    const selectedMaterialIds = Object.keys(selectedQtyByMaterial).map((k) => Number(k));
    if (selectedMaterialIds.length === 0) {
      toast.error("Select at least one item");
      return;
    }

    for (const materialId of selectedMaterialIds) {
      const qty = Number(selectedQtyByMaterial[materialId]);
      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error("Quantities must be positive numbers");
        return;
      }
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const { data: prData, error: prError } = await supabase
      .from("purchase_requests")
      .insert([
        {
          project_id: numericProjectId,
          requester_id: userId,
          status: "Pending",
        },
      ])
      .select("pr_id")
      .single();

    if (prError || !prData?.pr_id) {
      console.error("Create PR error:", prError);
      toast.error(prError?.message || "Failed to create purchase request");
      setIsSaving(false);
      return;
    }

    const prId = prData.pr_id as number;
    const itemsPayload = selectedMaterialIds.map((materialId) => ({
      pr_id: prId,
      material_id: materialId,
      requested_qty: Number(selectedQtyByMaterial[materialId]),
    }));

    const { error: itemsError } = await supabase.from("pr_items").insert(itemsPayload);
    if (itemsError) {
      console.error("Insert PR items error:", itemsError);
      toast.error(itemsError?.message || "PR created, but failed to add items");
      setIsSaving(false);
      return;
    }

    toast.success(`Purchase Request #${prId} created`);
    setIsCreateOpen(false);
    resetCreate();
    fetchPRs();
    setIsSaving(false);
  };

  const openView = (pr: PurchaseRequest) => {
    setActivePr(pr);
    setActiveStatus(pr.status);
    const nextApproved: Record<number, string> = {};
    (pr.pr_items || []).forEach((it) => {
      nextApproved[it.item_id] = it.approved_qty != null ? String(it.approved_qty) : "";
    });
    setApprovedQtyByItemId(nextApproved);
    setIsViewOpen(true);
  };

  const handleSaveApproval = async () => {
    if (!activePr) return;
    setIsSaving(true);

    // Update header status
    const { error: headerError } = await supabase
      .from("purchase_requests")
      .update({ status: activeStatus })
      .eq("pr_id", activePr.pr_id);

    if (headerError) {
      console.error("Header update error:", headerError);
      toast.error("Failed to update PR status");
      setIsSaving(false);
      return;
    }

    // Update per-item approved qty (best-effort)
    const items = activePr.pr_items || [];
    for (const it of items) {
      const raw = approvedQtyByItemId[it.item_id];
      const val = raw === "" ? null : Number(raw);
      if (val !== null && (!Number.isFinite(val) || val < 0)) {
        toast.error("Approved quantities must be valid numbers (or blank)");
        setIsSaving(false);
        return;
      }
    }

    for (const it of items) {
      const raw = approvedQtyByItemId[it.item_id];
      const val = raw === "" ? null : Number(raw);
      const { error } = await supabase.from("pr_items").update({ approved_qty: val }).eq("item_id", it.item_id);
      if (error) {
        console.error("Item update error:", error);
        toast.error("Some item updates failed");
        break;
      }
    }

    toast.success("Saved");
    setIsViewOpen(false);
    setActivePr(null);
    fetchPRs();
    setIsSaving(false);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-slate-500" /> Purchase Requests
          </CardTitle>

          <Dialog
            open={isCreateOpen}
            onOpenChange={(open) => {
              setIsCreateOpen(open);
              if (!open) resetCreate();
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={() => setIsCreateOpen(true)} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                <Plus className="h-4 w-4 mr-2" /> New PR
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white max-w-3xl">
              <DialogHeader>
                <DialogTitle>Create Purchase Request</DialogTitle>
                <DialogDescription>Select items from inventory and add requested quantities.</DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="border rounded-md p-3 bg-slate-50">
                  <div className="text-sm font-medium text-slate-700 mb-2">Quick add item (optional)</div>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                    <div className="md:col-span-3">
                      <label className="text-xs text-slate-600">Item name</label>
                      <Input
                        value={newMaterialName}
                        onChange={(e) => setNewMaterialName(e.target.value)}
                        placeholder="e.g., Cement (OPC 53)"
                        className="bg-white"
                      />
                    </div>
                    <div className="md:col-span-1">
                      <label className="text-xs text-slate-600">Unit</label>
                      <Select value={newMaterialUnit} onValueChange={setNewMaterialUnit}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border border-slate-200 shadow-lg">
                          <SelectItem value="units" className="bg-white hover:bg-slate-50">
                            Units
                          </SelectItem>
                          <SelectItem value="kg" className="bg-white hover:bg-slate-50">
                            Kilograms (kg)
                          </SelectItem>
                          <SelectItem value="tons" className="bg-white hover:bg-slate-50">
                            Tons
                          </SelectItem>
                          <SelectItem value="bags" className="bg-white hover:bg-slate-50">
                            Bags
                          </SelectItem>
                          <SelectItem value="sqft" className="bg-white hover:bg-slate-50">
                            Square Feet
                          </SelectItem>
                          <SelectItem value="sqm" className="bg-white hover:bg-slate-50">
                            Square Meters
                          </SelectItem>
                          <SelectItem value="cft" className="bg-white hover:bg-slate-50">
                            Cubic Feet
                          </SelectItem>
                          <SelectItem value="cum" className="bg-white hover:bg-slate-50">
                            Cubic Meters
                          </SelectItem>
                          <SelectItem value="liters" className="bg-white hover:bg-slate-50">
                            Liters
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-1">
                      <Button
                        type="button"
                        onClick={handleQuickAddMaterial}
                        disabled={isSaving}
                        className="w-full bg-slate-900 text-white hover:bg-slate-800"
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                </div>

                <Input
                  value={materialSearch}
                  onChange={(e) => setMaterialSearch(e.target.value)}
                  placeholder="Search materials..."
                  className="bg-white"
                />

                <div className="border rounded-md overflow-hidden">
                  <div className="max-h-[360px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-slate-50 z-10">
                        <TableRow>
                          <TableHead className="w-[60px]">Pick</TableHead>
                          <TableHead>Item</TableHead>
                          <TableHead className="w-[120px]">Unit</TableHead>
                          <TableHead className="w-[160px]">Qty</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredMaterials.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                              No materials found.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredMaterials.map((m) => {
                            const selected = selectedQtyByMaterial[m.material_id] != null;
                            return (
                              <TableRow key={m.material_id} className="hover:bg-slate-50">
                                <TableCell>
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => toggleMaterial(m.material_id)}
                                    className="accent-blue-600 h-4 w-4"
                                  />
                                </TableCell>
                                <TableCell className="font-medium">{m.item_name}</TableCell>
                                <TableCell className="text-sm text-slate-600">{m.unit || "—"}</TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={selectedQtyByMaterial[m.material_id] ?? ""}
                                    onChange={(e) =>
                                      setSelectedQtyByMaterial((prev) => ({
                                        ...prev,
                                        [m.material_id]: e.target.value,
                                      }))
                                    }
                                    disabled={!selected}
                                    className="bg-white"
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                  {isSaving ? "Creating..." : "Create PR"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading purchase requests...</div>
          ) : prs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <ShoppingBag className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No purchase requests yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">PR</TableHead>
                  <TableHead className="w-[140px]">Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="w-[220px]">Created</TableHead>
                  <TableHead className="text-right w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prs.map((pr) => (
                  <TableRow key={pr.pr_id} className="hover:bg-slate-50">
                    <TableCell className="font-semibold">#{pr.pr_id}</TableCell>
                    <TableCell>
                      <Badge className={statusBadge(pr.status)}>{pr.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {(pr.pr_items || []).length ? (
                        <div className="line-clamp-1">
                          {(pr.pr_items || [])
                            .slice(0, 4)
                            .map((it) => getMaterialInfo(it).name || `Item ${it.material_id}`)
                            .join(", ")}
                          {(pr.pr_items || []).length > 4 ? "..." : ""}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">{new Date(pr.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openView(pr)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* View / Approve Dialog */}
      <Dialog
        open={isViewOpen}
        onOpenChange={(open) => {
          setIsViewOpen(open);
          if (!open) setActivePr(null);
        }}
      >
        <DialogContent className="bg-white max-w-3xl">
          <DialogHeader>
            <DialogTitle>Purchase Request {activePr ? `#${activePr.pr_id}` : ""}</DialogTitle>
            <DialogDescription>Review items, set approved quantities, and update status.</DialogDescription>
          </DialogHeader>

          {activePr ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Status</label>
                  <Select value={activeStatus} onValueChange={setActiveStatus}>
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
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Created</label>
                  <Input value={new Date(activePr.created_at).toLocaleString()} disabled className="bg-white" />
                </div>
              </div>

              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-[120px]">Unit</TableHead>
                      <TableHead className="w-[140px]">Requested</TableHead>
                      <TableHead className="w-[160px]">Approved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(activePr.pr_items || []).map((it) => (
                      (() => {
                        const info = getMaterialInfo(it);
                        return (
                      <TableRow key={it.item_id}>
                        <TableCell className="font-medium">
                          {info.name || `Material ${it.material_id}`}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">{info.unit || "—"}</TableCell>
                        <TableCell className="text-sm text-slate-700">{it.requested_qty ?? "—"}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            value={approvedQtyByItemId[it.item_id] ?? ""}
                            onChange={(e) => setApprovedQtyByItemId((prev) => ({ ...prev, [it.item_id]: e.target.value }))}
                            className="bg-white"
                          />
                        </TableCell>
                      </TableRow>
                        );
                      })()
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewOpen(false)}>
              Close
            </Button>
            <Button onClick={handleSaveApproval} disabled={isSaving || !activePr} className="bg-blue-600 text-white hover:bg-blue-700">
              {isSaving ? "Saving..." : (
                <>
                  <Save className="h-4 w-4 mr-2" /> Save
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

