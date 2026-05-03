'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { FileText, Plus, Download, Trash2, Upload } from 'lucide-react';

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

function formatBytes(bytes?: number | null) {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export default function QuotesTab({
  projectId,
  role,
}: {
  projectId: string;
  role?: string | null;
}) {
  const numericProjectId = useMemo(() => Number(projectId), [projectId]);
  const canView    = role === 'Admin' || role === 'ProjectManager' || role === 'Client';
  const canUpload  = role === 'Admin';

  const [files, setFiles] = useState<FinalQuotationFile[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchFiles = useCallback(async () => {
    if (!Number.isFinite(numericProjectId) || !canView) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('project_files')
      .select('*')
      .eq('project_id', numericProjectId)
      .like('object_path', `projects/${numericProjectId}/quotes/final/%`)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Final quotation files fetch error:', error);
      toast.error(error.message || 'Failed to load quotations');
      setFiles([]);
    } else {
      setFiles((data || []) as FinalQuotationFile[]);
    }
    setLoading(false);
  }, [numericProjectId, canView]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  const handleUpload = async () => {
    if (!canUpload) { toast.error('Only Admin can upload'); return; }
    if (!file) { toast.error('Choose a file first'); return; }

    setUploading(true);
    const bucket = 'documents';
    const path = `projects/${numericProjectId}/quotes/final/${Date.now()}-${safeFileName(file.name)}`;

    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (upErr) { toast.error(upErr.message || 'Upload failed'); setUploading(false); return; }

    const { data: userRes } = await supabase.auth.getUser();
    const { error: dbErr } = await supabase.from('project_files').insert([{
      project_id: numericProjectId,
      bucket,
      object_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size || null,
      file_url: `${bucket}/${path}`,
      created_by: userRes?.user?.id ?? null,
    }]);
    if (dbErr) {
      toast.error(dbErr.message || 'Uploaded, but failed to save metadata');
    } else {
      toast.success('Quotation uploaded');
      setDialogOpen(false);
      setFile(null);
      void fetchFiles();
    }
    setUploading(false);
  };

  const handleDownload = async (f: FinalQuotationFile) => {
    const { data, error } = await supabase.storage.from(f.bucket).createSignedUrl(f.object_path, 60);
    if (error) { toast.error(error.message || 'Failed to generate link'); return; }
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = async (f: FinalQuotationFile) => {
    if (!canUpload) return;
    if (!confirm(`Delete "${f.file_name}"?`)) return;
    const { error: stErr } = await supabase.storage.from(f.bucket).remove([f.object_path]);
    if (stErr) { toast.error(stErr.message || 'Storage delete failed'); return; }
    const key =
      typeof f.id === 'number'      ? { column: 'id', value: f.id }
      : typeof f.file_id === 'number' ? { column: 'file_id', value: f.file_id }
      : null;
    if (!key) { void fetchFiles(); return; }
    const { error: dbErr } = await supabase.from('project_files').delete().eq(key.column, key.value);
    if (dbErr) {
      toast.error(dbErr.message || 'Deleted storage file but failed to delete metadata');
    } else {
      toast.success('Deleted');
      void fetchFiles();
    }
  };

  if (!canView) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-slate-500">
          You don&apos;t have access to quotations for this project.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5 text-slate-500" />
                Final Quotations
              </CardTitle>
              <p className="text-xs text-slate-500 mt-1">
                Upload the final quotation document(s) for this project. Previously-uploaded files are listed below.
              </p>
            </div>
            {canUpload && (
              <Dialog
                open={dialogOpen}
                onOpenChange={(o) => { setDialogOpen(o); if (!o) setFile(null); }}
              >
                <DialogTrigger asChild>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="h-4 w-4 mr-2" /> Upload Quotation
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-white max-w-md">
                  <DialogHeader>
                    <DialogTitle>Upload Final Quotation</DialogTitle>
                    <DialogDescription>Any file format (PDF / DOCX / image). Admin only.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <Label>File</Label>
                    <Input
                      type="file"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                    {file && (
                      <p className="text-xs text-slate-600 flex items-center gap-1">
                        <Upload className="h-3 w-3" /> {file.name} — {formatBytes(file.size)}
                      </p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={uploading}>
                      Cancel
                    </Button>
                    <Button onClick={handleUpload} disabled={uploading || !file} className="bg-blue-600 hover:bg-blue-700">
                      {uploading ? 'Uploading…' : 'Upload'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500 py-6 text-center">Loading…</p>
          ) : files.length === 0 ? (
            <div className="py-10 text-center text-slate-500">
              <FileText className="h-10 w-10 mx-auto text-slate-300 mb-2" />
              <p className="text-sm">No final quotation uploaded yet.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {files.map((f) => (
                <li key={f.id ?? f.file_id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{f.file_name}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(f.created_at).toLocaleString()} · {formatBytes(f.size_bytes)}
                      {f.mime_type && <span className="ml-1">· {f.mime_type}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => handleDownload(f)}>
                      <Download className="h-3 w-3 mr-1" /> Download
                    </Button>
                    {canUpload && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(f)}
                        className="text-red-600 border-red-200 hover:bg-red-50"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
