'use client';

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Download, File as FileIcon, Plus, Trash2, Upload } from "lucide-react";

type ProjectFile = {
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

export default function FilesTab({ projectId, readOnly = false }: { projectId: string; readOnly?: boolean }) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);

  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const fetchFiles = async () => {
    if (!Number.isFinite(numericProjectId)) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("project_files")
      .select("*")
      .eq("project_id", numericProjectId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching files:", error);
      toast.error("Failed to load files");
      setFiles([]);
    } else {
      setFiles((data || []) as ProjectFile[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericProjectId]);

  const handleUpload = async () => {
    if (isSaving) return;
    if (!uploadFile) {
      toast.error("Choose a file first");
      return;
    }
    if (!Number.isFinite(numericProjectId)) {
      toast.error("Invalid project");
      return;
    }

    setIsSaving(true);
    const bucket = "documents";
    let path = `projects/${numericProjectId}/files/${Date.now()}-${safeFileName(uploadFile.name)}`;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    let uploadError: any = null;
    {
      const res = await supabase.storage.from(bucket).upload(path, uploadFile, {
        contentType: uploadFile.type || undefined,
        upsert: false,
      });
      uploadError = res.error;
    }

    if (uploadError) {
      console.error("Upload error:", uploadError);
      toast.error(uploadError.message || "Failed to upload file");
      setIsSaving(false);
      return;
    }

    const { error: dbError } = await supabase.from("project_files").insert([
      {
        project_id: numericProjectId,
        bucket,
        object_path: path,
        // Compatibility for existing schemas that require file_url NOT NULL.
        // Store a stable locator (bucket/path). The UI uses bucket+object_path for downloads.
        file_url: `${bucket}/${path}`,
        file_name: uploadFile.name,
        mime_type: uploadFile.type || null,
        size_bytes: uploadFile.size || null,
        created_by: userId,
      },
    ]);

    if (dbError) {
      console.error("DB insert error:", dbError);
      toast.error(dbError.message || "Uploaded, but failed to save metadata");
    } else {
      toast.success("File uploaded");
      setIsOpen(false);
      setUploadFile(null);
      fetchFiles();
    }

    setIsSaving(false);
  };

  const handleDownload = async (f: ProjectFile) => {
    const { data, error } = await supabase.storage.from(f.bucket).createSignedUrl(f.object_path, 60);
    if (error) {
      console.error("Signed URL error:", error);
      toast.error("Failed to generate download link");
      return;
    }
    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleDelete = async (f: ProjectFile) => {
    if (!confirm(`Delete "${f.file_name}"?`)) return;
    const { error: storageError } = await supabase.storage.from(f.bucket).remove([f.object_path]);
    if (storageError) {
      console.error("Storage delete error:", storageError);
      toast.error("Failed to delete file from storage");
      return;
    }
    const key =
      typeof f.id === "number"
        ? { column: "id", value: f.id }
        : typeof f.file_id === "number"
          ? { column: "file_id", value: f.file_id }
          : null;
    if (!key) {
      toast.error("Deleted from storage, but missing file identifier for DB row");
      fetchFiles();
      return;
    }
    const { error: dbError } = await supabase.from("project_files").delete().eq(key.column, key.value);
    if (dbError) {
      console.error("DB delete error:", dbError);
      toast.error("Deleted from storage, but failed to delete metadata");
    } else {
      toast.success("File deleted");
      fetchFiles();
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileIcon className="h-5 w-5 text-slate-500" /> Files
          </CardTitle>
          <Dialog
            open={isOpen}
            onOpenChange={(open) => {
              setIsOpen(open);
              if (!open) setUploadFile(null);
            }}
          >
            {!readOnly && (
              <DialogTrigger asChild>
                <Button onClick={() => setIsOpen(true)} className="bg-blue-600 text-white hover:bg-blue-700 h-9">
                  <Plus className="h-4 w-4 mr-2" /> Upload
                </Button>
              </DialogTrigger>
            )}
            <DialogContent className="bg-white">
              <DialogHeader>
                <DialogTitle>Upload File</DialogTitle>
                <DialogDescription>Upload any project document (drawings, BOQ, approvals, etc.).</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <Input
                  type="file"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  className="bg-white"
                />
                {uploadFile ? (
                  <div className="text-sm text-slate-600">
                    <div>
                      <span className="font-medium">Selected:</span> {uploadFile.name}
                    </div>
                    <div className="text-xs text-slate-500">{formatBytes(uploadFile.size)} • {uploadFile.type || "unknown type"}</div>
                  </div>
                ) : null}
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
            <div className="text-center py-8 text-muted-foreground">Loading files...</div>
          ) : files.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <FileIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
              No files uploaded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead className="w-[120px]">Size</TableHead>
                  <TableHead className="w-[220px]">Uploaded</TableHead>
                  <TableHead className="text-right w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f, idx) => (
                  <TableRow key={String(f.id ?? f.file_id ?? idx)} className="hover:bg-slate-50">
                    <TableCell className="font-medium">
                      <div className="space-y-1">
                        <div className="text-slate-900">{f.file_name}</div>
                        <div className="text-xs text-slate-500">{f.mime_type || "—"}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">{formatBytes(f.size_bytes)}</TableCell>
                    <TableCell className="text-sm text-slate-700">{new Date(f.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleDownload(f)}>
                          <Download className="h-4 w-4" />
                        </Button>
                        {!readOnly && (
                          <Button variant="outline" size="sm" onClick={() => handleDelete(f)}>
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
    </div>
  );
}

