'use client';

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Image as ImageIcon, Plus, Trash2, Upload } from "lucide-react";

type MoodboardItem = {
  id: number;
  project_id: number;
  title: string | null;
  bucket: string;
  image_path: string;
  created_at: string;
  created_by: string | null;
};

type MoodboardItemWithUrl = MoodboardItem & {
  signed_url?: string | null;
};

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export default function MoodboardTab({ projectId }: { projectId: string }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [items, setItems] = useState<MoodboardItemWithUrl[]>([]);
  const [loading, setLoading] = useState(true);

  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");

  const fetchItems = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("project_moodboard_items")
      .select("*")
      .eq("project_id", numericProjectId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching moodboard:", error);
      toast.error("Failed to load moodboard");
      setItems([]);
      setLoading(false);
      return;
    }

    const baseItems = (data || []) as MoodboardItem[];
    const withUrls = await Promise.all(
      baseItems.map(async (it) => {
        const { data: urlData, error: urlError } = await supabase.storage
          .from(it.bucket)
          .createSignedUrl(it.image_path, 3600);
        if (urlError) {
          console.warn("Signed URL error:", urlError);
          return { ...it, signed_url: null };
        }
        return { ...it, signed_url: urlData?.signedUrl ?? null };
      })
    );

    setItems(withUrls);
    setLoading(false);
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const handleUpload = async () => {
    if (isSaving) return;
    if (!imageFile) {
      toast.error("Choose an image first");
      return;
    }
    if (!Number.isFinite(numericProjectId)) {
      toast.error("Invalid project");
      return;
    }

    setIsSaving(true);
    const bucket = "documents";
    let path = `projects/${numericProjectId}/moodboard/${Date.now()}-${safeFileName(imageFile.name)}`;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    let uploadError: any = null;
    {
      const res = await supabase.storage.from(bucket).upload(path, imageFile, {
        contentType: imageFile.type || undefined,
        upsert: false,
      });
      uploadError = res.error;
    }
    if (uploadError) {
      console.error("Upload error:", uploadError);
      toast.error(uploadError.message || "Failed to upload image");
      setIsSaving(false);
      return;
    }

    const { error: dbError } = await supabase.from("project_moodboard_items").insert([
      {
        project_id: numericProjectId,
        title: title.trim() ? title.trim() : null,
        bucket,
        image_path: path,
        created_by: userId,
      },
    ]);

    if (dbError) {
      console.error("DB insert error:", dbError);
      toast.error(dbError.message || "Uploaded, but failed to save item");
    } else {
      toast.success("Moodboard item added");
      setIsOpen(false);
      setImageFile(null);
      setTitle("");
      fetchItems();
    }
    setIsSaving(false);
  };

  const handleDelete = async (it: MoodboardItemWithUrl) => {
    if (!confirm("Delete this moodboard item?")) return;

    const { error: storageError } = await supabase.storage.from(it.bucket).remove([it.image_path]);
    if (storageError) {
      console.error("Storage delete error:", storageError);
      toast.error("Failed to delete image from storage");
      return;
    }

    const { error: dbError } = await supabase.from("project_moodboard_items").delete().eq("id", it.id);
    if (dbError) {
      console.error("DB delete error:", dbError);
      toast.error("Deleted from storage, but failed to delete record");
    } else {
      toast.success("Deleted");
      fetchItems();
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-slate-500" /> Moodboard
          </CardTitle>

          <Dialog
            open={isOpen}
            onOpenChange={(open) => {
              setIsOpen(open);
              if (!open) {
                setImageFile(null);
                setTitle("");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={() => setIsOpen(true)} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                <Plus className="h-4 w-4 mr-2" /> Add Image
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white">
              <DialogHeader>
                <DialogTitle>Add Moodboard Image</DialogTitle>
                <DialogDescription>Upload reference images (designs, materials, inspiration, etc.).</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Title (optional)</label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Living room palette" className="bg-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Image</label>
                  <Input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} className="bg-white" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleUpload} disabled={isSaving} className="bg-blue-600 text-white hover:bg-blue-700">
                  {isSaving ? "Uploading..." : (
                    <>
                      <Upload className="h-4 w-4 mr-2" /> Upload
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading moodboard...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No moodboard items yet.
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((it) => (
                <div key={it.id} className="rounded-lg border overflow-hidden bg-white">
                  <div className="aspect-video bg-slate-50 flex items-center justify-center overflow-hidden">
                    {it.signed_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.signed_url} alt={it.title || "Moodboard"} className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-sm text-slate-500">Preview unavailable</div>
                    )}
                  </div>
                  <div className="p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{it.title || "Untitled"}</div>
                      <div className="text-xs text-slate-500">{new Date(it.created_at).toLocaleString()}</div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleDelete(it)} title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

