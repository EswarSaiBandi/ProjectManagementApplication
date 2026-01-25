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
import { CheckCircle2, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";

type ProjectTask = {
  id?: number;
  task_id?: number;
  project_id: number;
  title: string;
  description: string | null;
  // Compatibility: some schemas use `content` or `name` instead of `title`
  content?: string | null;
  name?: string | null;
  task_name?: string | null;
  status: "Todo" | "In Progress" | "Done" | string;
  priority: "Low" | "Medium" | "High" | string;
  due_date: string | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

const STATUS_OPTIONS = ["Todo", "In Progress", "Done"] as const;
const PRIORITY_OPTIONS = ["Low", "Medium", "High"] as const;

function statusBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("done")) return "bg-green-100 text-green-800";
  if (s.includes("progress")) return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}

function priorityBadge(priority: string) {
  const p = (priority || "").toLowerCase();
  if (p.includes("high")) return "bg-red-100 text-red-800";
  if (p.includes("low")) return "bg-slate-100 text-slate-700";
  return "bg-yellow-100 text-yellow-800";
}

export default function TasksTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [teamNames, setTeamNames] = useState<string[]>([]);

  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ProjectTask | null>(null);
  const [editingKey, setEditingKey] = useState<{ column: string; value: number } | null>(null);

  const [form, setForm] = useState({
    title: "",
    description: "",
    status: "Todo",
    priority: "Medium",
    due_date: "",
    assignee_name: "",
  });

  const resetForm = () => {
    setEditing(null);
    setForm({
      title: "",
      description: "",
      status: "Todo",
      priority: "Medium",
      due_date: "",
      assignee_name: "",
    });
  };

  const fetchTasks = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_tasks")
      .select("*")
      .eq("project_id", numericProjectId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching tasks:", error);
      toast.error("Failed to load tasks");
      setTasks([]);
    } else {
      setTasks((data || []) as ProjectTask[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  useEffect(() => {
    const fetchTeamNames = async () => {
      const { data, error } = await supabase.from("profiles").select("full_name").order("full_name");
      if (error) {
        console.error("Profiles fetch error:", error);
        setTeamNames([]);
        return;
      }
      const names = (data || [])
        .map((r: any) => String(r.full_name || "").trim())
        .filter(Boolean);
      setTeamNames(Array.from(new Set(names)));
    };
    fetchTeamNames();
  }, []);

  const openNew = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (task: ProjectTask) => {
    setEditing(task);
    const key =
      typeof task.id === "number"
        ? { column: "id", value: task.id }
        : typeof task.task_id === "number"
          ? { column: "task_id", value: task.task_id }
          : null;
    setEditingKey(key);
    setForm({
      title: task.title || task.name || task.task_name || task.content || "",
      description: task.description || "",
      status: (task.status as any) || "Todo",
      priority: (task.priority as any) || "Medium",
      due_date: task.due_date || "",
      assignee_name: task.assignee_name || "",
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

    const payload = {
      project_id: numericProjectId,
      title: form.title.trim(),
      // Compatibility
      name: form.title.trim(),
      task_name: form.title.trim(),
      content: form.description.trim()
        ? `${form.title.trim()}\n\n${form.description.trim()}`
        : form.title.trim(),
      description: form.description.trim() ? form.description.trim() : null,
      status: form.status,
      priority: form.priority,
      due_date: form.due_date || null,
      assignee_name: form.assignee_name.trim() ? form.assignee_name.trim() : null,
      updated_at: new Date().toISOString(),
    };

    if (editing) {
      if (!editingKey) {
        toast.error("Cannot update: missing task identifier");
        setIsSaving(false);
        return;
      }
      const { error } = await supabase.from("project_tasks").update(payload).eq(editingKey.column, editingKey.value);
      if (error) {
        console.error("Error updating task:", error);
        toast.error(error.message || "Failed to update task");
      } else {
        toast.success("Task updated");
        setIsOpen(false);
        resetForm();
        fetchTasks();
      }
    } else {
      const { error } = await supabase.from("project_tasks").insert([
        {
          ...payload,
          created_by: userId,
        },
      ]);
      if (error) {
        console.error("Error creating task:", error);
        toast.error(error.message || "Failed to create task");
      } else {
        toast.success("Task created");
        setIsOpen(false);
        resetForm();
        fetchTasks();
      }
    }

    setIsSaving(false);
  };

  const handleDelete = async (task: ProjectTask) => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    const key =
      typeof task.id === "number"
        ? { column: "id", value: task.id }
        : typeof task.task_id === "number"
          ? { column: "task_id", value: task.task_id }
          : null;
    if (!key) {
      toast.error("Cannot delete: missing task identifier");
      return;
    }
    const { error } = await supabase.from("project_tasks").delete().eq(key.column, key.value);
    if (error) {
      console.error("Error deleting task:", error);
      toast.error(error.message || "Failed to delete task");
    } else {
      toast.success("Task deleted");
      fetchTasks();
    }
  };

  const quickMarkDone = async (task: ProjectTask) => {
    const key =
      typeof task.id === "number"
        ? { column: "id", value: task.id }
        : typeof task.task_id === "number"
          ? { column: "task_id", value: task.task_id }
          : null;
    if (!key) {
      toast.error("Cannot update: missing task identifier");
      return;
    }
    const { error } = await supabase
      .from("project_tasks")
      .update({ status: "Done", updated_at: new Date().toISOString() })
      .eq(key.column, key.value);
    if (error) {
      console.error("Error updating status:", error);
      toast.error(error.message || "Failed to update task");
    } else {
      fetchTasks();
    }
  };

  const filteredTasks = tasks.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (t.title || "").toLowerCase().includes(q) ||
      (t.description || "").toLowerCase().includes(q) ||
      (t.assignee_name || "").toLowerCase().includes(q) ||
      (t.status || "").toLowerCase().includes(q) ||
      (t.priority || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ListTodo className="h-5 w-5 text-slate-500" /> Tasks
            </CardTitle>
            <div className="text-sm text-muted-foreground mt-1">Track deliverables, owners, and due dates.</div>
          </div>
          <div className="flex gap-2 items-center">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="w-[240px] bg-white"
            />
            <Dialog
              open={isOpen}
              onOpenChange={(open) => {
                setIsOpen(open);
                if (!open) resetForm();
              }}
            >
              <DialogTrigger asChild>
                <Button onClick={openNew} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                  <Plus className="h-4 w-4 mr-2" /> New Task
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white">
                <DialogHeader>
                  <DialogTitle>{editing ? "Edit Task" : "New Task"}</DialogTitle>
                  <DialogDescription>Add tasks scoped to this project.</DialogDescription>
                </DialogHeader>
                <datalist id="team-member-names">
                  {teamNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>

                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Title *</label>
                    <Input
                      value={form.title}
                      onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                      placeholder="e.g. Finalize electrical BOQ"
                      className="bg-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Description</label>
                    <Textarea
                      value={form.description}
                      onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="Details..."
                      className="bg-white"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
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

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">Priority</label>
                      <Select value={form.priority} onValueChange={(v) => setForm((p) => ({ ...p, priority: v }))}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border border-slate-200 shadow-lg">
                          {PRIORITY_OPTIONS.map((p) => (
                            <SelectItem key={p} value={p} className="bg-white hover:bg-slate-50">
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">Due Date</label>
                      <Input
                        type="date"
                        value={form.due_date}
                        onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))}
                        className="bg-white"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">Assignee</label>
                      <Input
                        list="team-member-names"
                        value={form.assignee_name}
                        onChange={(e) => setForm((p) => ({ ...p, assignee_name: e.target.value }))}
                        placeholder="Name"
                        className="bg-white"
                      />
                    </div>
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
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading tasks...</div>
          ) : filteredTasks.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <ListTodo className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No tasks found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead className="w-[130px]">Status</TableHead>
                  <TableHead className="w-[120px]">Priority</TableHead>
                  <TableHead className="w-[140px]">Due</TableHead>
                  <TableHead className="w-[160px]">Assignee</TableHead>
                  <TableHead className="text-right w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTasks.map((t) => {
                  const isDone = (t.status || "").toLowerCase() === "done";
                  return (
                    <TableRow key={t.id} className="hover:bg-slate-50">
                      <TableCell className="font-medium">
                        <div className="space-y-1">
                          <div className={cn(isDone ? "line-through text-slate-500" : "text-slate-900")}>{t.title}</div>
                          {t.description ? (
                            <div className="text-xs text-slate-500 line-clamp-2">{t.description}</div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusBadge(t.status)}>{t.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={priorityBadge(t.priority)}>{t.priority}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {t.due_date ? new Date(t.due_date).toLocaleDateString() : <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {t.assignee_name || <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {!isDone ? (
                            <Button variant="outline" size="sm" onClick={() => quickMarkDone(t)} title="Mark done">
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                          <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleDelete(t)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

