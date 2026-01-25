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
import { Plus, Pencil, Trash2, StickyNote } from "lucide-react";

type ProjectNote = {
  id?: number;
  note_id?: number;
  project_id: number;
  title: string;
  body: string | null;
  // Some existing DB schemas use `content` instead of `body`.
  content?: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export default function NotesTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [loading, setLoading] = useState(true);

  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ProjectNote | null>(null);
  const [editingKey, setEditingKey] = useState<{ column: string; value: number } | null>(null);

  const [form, setForm] = useState({
    title: "",
    body: "",
  });

  const resetForm = () => {
    setEditing(null);
    setForm({ title: "", body: "" });
  };

  const fetchNotes = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_notes")
      .select("*")
      .eq("project_id", numericProjectId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching notes:", error);
      toast.error("Failed to load notes");
      setNotes([]);
    } else {
      setNotes((data || []) as ProjectNote[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const openNew = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (note: ProjectNote) => {
    setEditing(note);
    const key =
      typeof note.id === "number"
        ? { column: "id", value: note.id }
        : typeof note.note_id === "number"
          ? { column: "note_id", value: note.note_id }
          : null;
    setEditingKey(key);
    setForm({
      title: note.title || "",
      body: note.body || note.content || "",
    });
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!Number.isFinite(numericProjectId)) {
      toast.error("Invalid project");
      return;
    }

    setIsSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    if (editing) {
      if (!editingKey) {
        toast.error("Cannot update: missing note identifier");
        setIsSaving(false);
        return;
      }
      const { error } = await supabase
        .from("project_notes")
        .update({
          title: form.title.trim(),
          body: form.body.trim() ? form.body.trim() : null,
          // Compatibility for schemas that require NOT NULL `content`
          content: form.body.trim() ? form.body.trim() : null,
          updated_at: new Date().toISOString(),
        })
        .eq(editingKey.column, editingKey.value);

      if (error) {
        console.error("Error updating note:", error);
        toast.error(error.message || "Failed to update note");
      } else {
        toast.success("Note updated");
        setIsOpen(false);
        resetForm();
        fetchNotes();
      }
    } else {
      const { error } = await supabase.from("project_notes").insert([
        {
          project_id: numericProjectId,
          title: form.title.trim(),
          body: form.body.trim() ? form.body.trim() : null,
          // Compatibility for schemas that require NOT NULL `content`
          content: form.body.trim() ? form.body.trim() : null,
          created_by: userId,
          updated_at: new Date().toISOString(),
        },
      ]);

      if (error) {
        console.error("Error creating note:", error);
        toast.error(error.message || "Failed to create note");
      } else {
        toast.success("Note created");
        setIsOpen(false);
        resetForm();
        fetchNotes();
      }
    }

    setIsSaving(false);
  };

  const handleDelete = async (note: ProjectNote) => {
    if (!confirm(`Delete note "${note.title}"?`)) return;
    const key =
      typeof note.id === "number"
        ? { column: "id", value: note.id }
        : typeof note.note_id === "number"
          ? { column: "note_id", value: note.note_id }
          : null;
    if (!key) {
      toast.error("Cannot delete: missing note identifier");
      return;
    }
    const { error } = await supabase.from("project_notes").delete().eq(key.column, key.value);
    if (error) {
      console.error("Error deleting note:", error);
      toast.error("Failed to delete note");
    } else {
      toast.success("Note deleted");
      fetchNotes();
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <StickyNote className="h-5 w-5 text-slate-500" /> Notes
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
                <Plus className="h-4 w-4 mr-2" /> New Note
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Note" : "New Note"}</DialogTitle>
                <DialogDescription>
                  Keep project-specific notes here (decisions, meeting notes, links, etc.).
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Title *</label>
                  <Input
                    value={form.title}
                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="e.g. Client meeting summary"
                    className="bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Body</label>
                  <Textarea
                    value={form.body}
                    onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
                    placeholder="Write your note..."
                    className="bg-white text-slate-900"
                  />
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
            <div className="text-center py-8 text-muted-foreground">Loading notes...</div>
          ) : notes.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <StickyNote className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No notes yet. Create one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-[180px]">Last Updated</TableHead>
                  <TableHead className="text-right w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notes.map((n, idx) => (
                  <TableRow key={String(n.id ?? n.note_id ?? idx)} className="hover:bg-slate-50">
                    <TableCell className="font-medium">
                      <div className="space-y-1">
                        <div className="text-slate-900">{n.title}</div>
                        {(n.body || n.content) ? (
                          <div className="text-xs text-slate-500 line-clamp-2">{n.body || n.content}</div>
                        ) : (
                          <div className="text-xs text-slate-400 italic">No content</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">
                      {new Date(n.updated_at || n.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(n)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDelete(n)}>
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

