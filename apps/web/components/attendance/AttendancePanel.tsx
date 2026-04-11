'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Camera, Clock, Download, LocateFixed, SwitchCamera } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { normalizePhoneDigits } from '@/lib/phone';

export type AttendanceLog = {
  attendance_id: number;
  user_id: string | null;
  labour_id?: number | null;
  marked_by_user_id?: string | null;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_in_accuracy: number | null;
  check_in_photo_path: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  check_out_accuracy: number | null;
  check_out_photo_path: string | null;
};

type Me = { user_id: string; full_name: string | null; role: string | null; email: string | null } | null;

type NameRow = { user_id: string; full_name: string | null };

function getLocalISODate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function defaultAdminDateFrom() {
  const x = new Date();
  x.setDate(x.getDate() - 30);
  return getLocalISODate(x);
}

type CameraFacing = 'user' | 'environment';

/** Try several constraint shapes — mobile WebViews differ on ideal vs exact vs shorthand. */
async function getAttendanceCameraStream(facing: CameraFacing): Promise<MediaStream> {
  const candidates: MediaTrackConstraints[] = [
    { facingMode: { ideal: facing } },
    { facingMode: facing },
    { facingMode: { exact: facing } },
  ];
  let lastErr: unknown;
  for (const video of candidates) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Camera unavailable');
}

function formatAttendanceSaveError(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const o = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [o.message, o.details, o.hint].filter((x) => x && String(x).trim());
    return parts.length ? parts.join(' — ') : 'Failed to save attendance';
  }
  if (e instanceof Error) return e.message || 'Failed to save attendance';
  return 'Failed to save attendance';
}

function formatAttendanceDateTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : '';
}

async function downloadRowsAsExcel(
  rows: AttendanceLog[],
  sheetName: string,
  fileName: string,
  rowToRecord: (r: AttendanceLog) => Record<string, string | number | ''>
) {
  if (rows.length === 0) return;
  const XLSX = await import('xlsx');
  const data = rows.map(rowToRecord);
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

function osmEmbedUrl(lat: number, lng: number) {
  const d = 0.01;
  const left = lng - d;
  const right = lng + d;
  const top = lat + d;
  const bottom = lat - d;
  const bbox = `${left},${bottom},${right},${top}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(
    `${lat},${lng}`
  )}`;
}

type Props = {
  me: Me;
  /** Used to resolve names in the admin report and detail dialog */
  nameDirectory: NameRow[];
  /** When true, show the all-staff report block (still requires Admin or Project Manager). */
  showAdminReport: boolean;
  /** Team tab: report only, no check-in UI. Personal page: full self-service + optional staff report. */
  mode?: 'self-service' | 'team-overview';
};

export function AttendancePanel({ me, nameDirectory, showAdminReport, mode = 'self-service' }: Props) {
  const [todayLog, setTodayLog] = useState<AttendanceLog | null>(null);
  const [attendanceHistory, setAttendanceHistory] = useState<AttendanceLog[]>([]);
  const [isAttendanceDialogOpen, setIsAttendanceDialogOpen] = useState(false);
  const [attendanceAction, setAttendanceAction] = useState<'checkin' | 'checkout'>('checkin');
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  /** Mirrors whether a live stream is attached (refs don’t re-render). */
  const [hasLiveStream, setHasLiveStream] = useState(false);
  /** Rear = environment (world-facing), front = user (selfie). */
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('environment');
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isAttendanceDetailsOpen, setIsAttendanceDetailsOpen] = useState(false);
  const [selectedAttendance, setSelectedAttendance] = useState<AttendanceLog | null>(null);
  const [attendanceDetailsLoading, setAttendanceDetailsLoading] = useState(false);
  const [attendanceSignedUrls, setAttendanceSignedUrls] = useState<{ checkInUrl: string | null; checkOutUrl: string | null }>({
    checkInUrl: null,
    checkOutUrl: null,
  });

  const [adminAttFrom, setAdminAttFrom] = useState(defaultAdminDateFrom);
  const [adminAttTo, setAdminAttTo] = useState(() => getLocalISODate());
  const [adminAttUserId, setAdminAttUserId] = useState<string>('');
  const [adminAttRows, setAdminAttRows] = useState<AttendanceLog[]>([]);
  const [adminAttLoading, setAdminAttLoading] = useState(false);
  const [adminAttLabourId, setAdminAttLabourId] = useState<string>('');
  const [adminLabourPicklist, setAdminLabourPicklist] = useState<{ id: number; name: string }[]>([]);
  const [labourNameById, setLabourNameById] = useState<Record<number, string>>({});

  /** null = self attendance dialog; number = proxy for labour id */
  const [attendanceDialogLabourId, setAttendanceDialogLabourId] = useState<number | null>(null);
  type ProxyLabourRow = { id: number; name: string; phone: string | null };
  const [proxyEligibleLabour, setProxyEligibleLabour] = useState<ProxyLabourRow[]>([]);
  const [proxySelectedLabourId, setProxySelectedLabourId] = useState<string>('');
  const [proxyCardTodayLog, setProxyCardTodayLog] = useState<AttendanceLog | null>(null);

  const weeklyOffBypassRef = useRef(false);
  const [weeklyOffConfirmOpen, setWeeklyOffConfirmOpen] = useState(false);

  const canViewStaffReport = me?.role === 'Admin' || me?.role === 'ProjectManager';
  const showStaffReportBlock = Boolean(showAdminReport && canViewStaffReport);
  const isTeamOverview = mode === 'team-overview';
  /** Proxy (manpower, no login) check-in/out: site leads + office roles */
  const canProxyMarkAttendance =
    !isTeamOverview &&
    (me?.role === 'SiteSupervisor' || me?.role === 'Admin' || me?.role === 'ProjectManager');

  const resolveName = (userId: string) =>
    nameDirectory.find((n) => n.user_id === userId)?.full_name || userId.slice(0, 8) + '…';

  const rowSubjectLabel = (row: AttendanceLog) => {
    if (row.user_id) return resolveName(row.user_id);
    if (row.labour_id != null) {
      const nm = labourNameById[row.labour_id];
      return nm ? `${nm} (field)` : `Field staff #${row.labour_id}`;
    }
    return '—';
  };

  const exportStaffReportExcel = () => {
    void (async () => {
      try {
        await downloadRowsAsExcel(adminAttRows, 'Attendance', `attendance-${adminAttFrom}_to_${adminAttTo}`, (r) => ({
          'Work date': r.work_date,
          Person: rowSubjectLabel(r),
          'Check in': formatAttendanceDateTime(r.check_in_at),
          'Check out': formatAttendanceDateTime(r.check_out_at),
          'Has check-in GPS': r.check_in_lat != null && r.check_in_lng != null ? 'Yes' : 'No',
          'Has check-out GPS': r.check_out_lat != null && r.check_out_lng != null ? 'Yes' : 'No',
          'Check in lat': r.check_in_lat ?? '',
          'Check in lng': r.check_in_lng ?? '',
          'Check in accuracy (m)':
            r.check_in_accuracy != null ? Math.round(Number(r.check_in_accuracy)) : '',
          'Check out lat': r.check_out_lat ?? '',
          'Check out lng': r.check_out_lng ?? '',
          'Check out accuracy (m)':
            r.check_out_accuracy != null ? Math.round(Number(r.check_out_accuracy)) : '',
        }));
        toast.success('Excel file downloaded');
      } catch (e) {
        console.error(e);
        toast.error('Could not create Excel file');
      }
    })();
  };

  const exportMyAttendanceExcel = () => {
    void (async () => {
      try {
        await downloadRowsAsExcel(
          attendanceHistory,
          'My attendance',
          `my-attendance-${getLocalISODate()}`,
          (r) => ({
            Date: r.work_date,
            'Check in': r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString() : '',
            'Check out': r.check_out_at ? new Date(r.check_out_at).toLocaleTimeString() : '',
            'Accuracy (m)': r.check_in_accuracy != null ? Math.round(Number(r.check_in_accuracy)) : '',
          })
        );
        toast.success('Excel file downloaded');
      } catch (e) {
        console.error(e);
        toast.error('Could not create Excel file');
      }
    })();
  };

  const loadProxyEligibleLabour = async () => {
    if (!canProxyMarkAttendance || !me?.user_id) return;
    try {
      const [{ data: pm }, { data: labourRows }, { data: profs }] = await Promise.all([
        supabase.from('project_manpower').select('labour_id, team_member_id').not('labour_id', 'is', null),
        supabase.from('labour_master').select('id, name, phone').eq('is_active', true),
        supabase.from('profiles').select('phone'),
      ]);
      const linkedToMember = new Set(
        (pm || []).filter((r: { team_member_id?: string | null }) => r.team_member_id).map((r: { labour_id: number }) => r.labour_id)
      );
      const profPhones = new Set(
        (profs || [])
          .map((p: { phone?: string | null }) => normalizePhoneDigits(p.phone || null))
          .filter(Boolean)
      );
      const usedLabourIds = new Set(
        (pm || []).map((r: { labour_id?: number | null }) => r.labour_id).filter((id): id is number => typeof id === 'number')
      );
      const eligible = (labourRows || []).filter((l: { id: number; phone?: string | null }) => {
        if (!usedLabourIds.has(l.id)) return false;
        if (linkedToMember.has(l.id)) return false;
        const np = normalizePhoneDigits(l.phone || null);
        if (np && profPhones.has(np)) return false;
        return true;
      }) as ProxyLabourRow[];
      eligible.sort((a, b) => a.name.localeCompare(b.name));
      setProxyEligibleLabour(eligible);
      setLabourNameById((prev) => {
        const n = { ...prev };
        eligible.forEach((l) => {
          n[l.id] = l.name;
        });
        return n;
      });
    } catch (e) {
      console.error(e);
      setProxyEligibleLabour([]);
    }
  };

  const loadProxyCardTodayLog = async (labourId: number) => {
    const today = getLocalISODate();
    const { data, error } = await supabase
      .from('attendance_logs')
      .select('*')
      .eq('labour_id', labourId)
      .eq('work_date', today)
      .maybeSingle();
    if (error) {
      console.error(error);
      setProxyCardTodayLog(null);
      return;
    }
    setProxyCardTodayLog((data as AttendanceLog) || null);
  };

  const stopCamera = () => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    streamRef.current = null;
    setHasLiveStream(false);
    if (videoRef.current) {
      (videoRef.current as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = null;
    }
    setIsCameraReady(false);
  };

  const startCamera = async (facing: CameraFacing) => {
    stopCamera();
    setIsCameraReady(false);
    const stream = await getAttendanceCameraStream(facing);
    streamRef.current = stream;
    setHasLiveStream(true);
    if (videoRef.current) {
      (videoRef.current as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = stream;
      await videoRef.current.play();
      await new Promise<void>((resolve) => {
        let tries = 0;
        const tick = () => {
          const v = videoRef.current;
          if (v && v.videoWidth > 0 && v.videoHeight > 0) {
            setIsCameraReady(true);
            resolve();
            return;
          }
          tries += 1;
          if (tries >= 30) {
            resolve();
            return;
          }
          setTimeout(tick, 100);
        };
        tick();
      });
    }
  };

  const flipCamera = async () => {
    if (photoPreviewUrl) return;
    const prev = cameraFacing;
    const next: CameraFacing = prev === 'environment' ? 'user' : 'environment';
    setIsSwitchingCamera(true);
    setCameraFacing(next);
    try {
      await startCamera(next);
    } catch (e) {
      console.error(e);
      setCameraFacing(prev);
      toast.error(
        'Could not switch to the other camera. It may be busy, or this browser only exposes one camera to the site.'
      );
    } finally {
      setIsSwitchingCamera(false);
    }
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video) throw new Error('Camera not ready');
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('Camera not ready');

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to capture');
    ctx.drawImage(video, 0, 0, w, h);

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Capture failed'))), 'image/jpeg', 0.85);
    });

    const url = URL.createObjectURL(blob);
    setPhotoBlob(blob);
    setPhotoPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    stopCamera();
  };

  const requestLocation = async () => {
    setGeoError(null);
    setGeo(null);
    if (!('geolocation' in navigator)) {
      setGeoError('Geolocation is not supported in this browser');
      return;
    }
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      });
    });
    setGeo({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    });
  };

  const loadMyAttendance = async () => {
    if (isTeamOverview) return;
    if (!me?.user_id) return;
    const today = getLocalISODate();
    const { data: todayRows, error: todayError } = await supabase
      .from('attendance_logs')
      .select('*')
      .eq('user_id', me.user_id)
      .eq('work_date', today)
      .limit(1);
    if (todayError) {
      console.error('Attendance fetch error:', todayError);
      return;
    }
    setTodayLog((todayRows?.[0] as AttendanceLog) || null);

    const { data: hist, error: histError } = await supabase
      .from('attendance_logs')
      .select('*')
      .eq('user_id', me.user_id)
      .order('work_date', { ascending: false })
      .limit(30);
    if (histError) {
      console.error('Attendance history fetch error:', histError);
      return;
    }
    setAttendanceHistory((hist as AttendanceLog[]) || []);
  };

  const loadAdminAttendance = async () => {
    if (!showStaffReportBlock) return;
    setAdminAttLoading(true);
    try {
      let q = supabase.from('attendance_logs').select('*').order('work_date', { ascending: false }).limit(800);
      if (adminAttFrom) q = q.gte('work_date', adminAttFrom);
      if (adminAttTo) q = q.lte('work_date', adminAttTo);
      if (adminAttLabourId) q = q.eq('labour_id', Number(adminAttLabourId));
      else if (adminAttUserId) q = q.eq('user_id', adminAttUserId);
      const { data, error } = await q;
      if (error) throw error;
      setAdminAttRows((data as AttendanceLog[]) || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load attendance report';
      toast.error(msg);
      setAdminAttRows([]);
    } finally {
      setAdminAttLoading(false);
    }
  };

  useEffect(() => {
    if (isTeamOverview) return;
    if (!me?.user_id) return;
    loadMyAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.user_id, isTeamOverview]);

  useEffect(() => {
    if (!canProxyMarkAttendance) return;
    loadProxyEligibleLabour();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canProxyMarkAttendance, me?.user_id]);

  useEffect(() => {
    if (showStaffReportBlock) {
      loadAdminAttendance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStaffReportBlock, adminAttFrom, adminAttTo, adminAttUserId, adminAttLabourId]);

  useEffect(() => {
    if (!showStaffReportBlock) return;
    void (async () => {
      const { data } = await supabase.from('labour_master').select('id, name').eq('is_active', true).order('name');
      setAdminLabourPicklist((data as { id: number; name: string }[]) || []);
    })();
  }, [showStaffReportBlock]);

  useEffect(() => {
    if (!showStaffReportBlock || adminAttRows.length === 0) return;
    const ids = Array.from(
      new Set(
        adminAttRows.map((r) => r.labour_id).filter((x): x is number => x != null && Number.isFinite(Number(x)))
      )
    );
    if (ids.length === 0) return;
    void (async () => {
      const { data } = await supabase.from('labour_master').select('id, name').in('id', ids);
      if (!data?.length) return;
      setLabourNameById((prev) => {
        const n = { ...prev };
        (data as { id: number; name: string }[]).forEach((row) => {
          n[row.id] = row.name;
        });
        return n;
      });
    })();
  }, [adminAttRows, showStaffReportBlock]);

  useEffect(() => {
    if (!isAttendanceDialogOpen) {
      stopCamera();
      setCameraFacing('environment');
      setAttendanceDialogLabourId(null);
      setGeo(null);
      setGeoError(null);
      setPhotoBlob(null);
      setPhotoPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setWeeklyOffConfirmOpen(false);
      weeklyOffBypassRef.current = false;
      return;
    }
    setCameraFacing('environment');
    (async () => {
      try {
        await startCamera('environment');
      } catch (e) {
        console.error(e);
        toast.error('Camera permission denied or not available');
      }
      try {
        await requestLocation();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to get location';
        setGeoError(msg);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAttendanceDialogOpen]);

  useEffect(() => {
    if (!isAttendanceDetailsOpen || !selectedAttendance) {
      setAttendanceSignedUrls({ checkInUrl: null, checkOutUrl: null });
      return;
    }
    (async () => {
      setAttendanceDetailsLoading(true);
      try {
        const checkInPath = selectedAttendance.check_in_photo_path;
        const checkOutPath = selectedAttendance.check_out_photo_path;

        const [checkIn, checkOut] = await Promise.all([
          checkInPath
            ? supabase.storage.from('attendance').createSignedUrl(checkInPath, 60 * 30)
            : Promise.resolve({ data: null as { signedUrl: string } | null, error: null }),
          checkOutPath
            ? supabase.storage.from('attendance').createSignedUrl(checkOutPath, 60 * 30)
            : Promise.resolve({ data: null as { signedUrl: string } | null, error: null }),
        ]);

        if (checkIn?.error) throw checkIn.error;
        if (checkOut?.error) throw checkOut.error;

        setAttendanceSignedUrls({
          checkInUrl: checkIn?.data?.signedUrl || null,
          checkOutUrl: checkOut?.data?.signedUrl || null,
        });
      } catch (e: unknown) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : 'Failed to load attendance details');
        setAttendanceSignedUrls({ checkInUrl: null, checkOutUrl: null });
      } finally {
        setAttendanceDetailsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAttendanceDetailsOpen, selectedAttendance?.attendance_id]);

  const commitAttendanceAfterCapture = async () => {
    if (!me?.user_id) throw new Error('You must be logged in');
    if (!photoBlob) throw new Error('Please capture a photo');
    if (!geo) throw new Error('Location is required. Please allow location access.');

    const today = getLocalISODate();
    const proxyLabourId = attendanceDialogLabourId;
    const isProxy = proxyLabourId != null;

    const prefix = isProxy ? `${me.user_id}/proxy/${proxyLabourId}/${today}` : `${me.user_id}/${today}`;
    const fileName = `${attendanceAction}-${Date.now()}.jpg`;
    const path = `${prefix}/${fileName}`;

    const { error: uploadError } = await supabase.storage.from('attendance').upload(path, photoBlob, { contentType: 'image/jpeg' });
    if (uploadError) {
      const msg = String(uploadError.message || '');
      if (msg.toLowerCase().includes('bucket not found')) {
        throw new Error(
          'Storage bucket "attendance" not found. Apply migration `20260208120000_setup_attendance_storage.sql`, then retry.'
        );
      }
      throw uploadError;
    }

    if (isProxy) {
      const { error: rpcErr } = await supabase.rpc('attendance_proxy_upsert', {
        p_labour_id: proxyLabourId,
        p_work_date: today,
        p_checkin: attendanceAction === 'checkin',
        p_lat: geo.lat,
        p_lng: geo.lng,
        p_accuracy: geo.accuracy,
        p_photo_path: path,
      });
      if (rpcErr) throw rpcErr;
      toast.success(attendanceAction === 'checkin' ? 'Checked in (field staff)' : 'Checked out (field staff)');
    } else if (attendanceAction === 'checkin') {
      if (todayLog?.check_in_at) {
        toast.error('Already checked in today');
        return;
      }

      if (todayLog?.attendance_id) {
        const { error } = await supabase
          .from('attendance_logs')
          .update({
            check_in_at: new Date().toISOString(),
            check_in_lat: geo.lat,
            check_in_lng: geo.lng,
            check_in_accuracy: geo.accuracy,
            check_in_photo_path: path,
          })
          .eq('attendance_id', todayLog.attendance_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('attendance_logs').insert([
          {
            user_id: me.user_id,
            work_date: today,
            check_in_at: new Date().toISOString(),
            check_in_lat: geo.lat,
            check_in_lng: geo.lng,
            check_in_accuracy: geo.accuracy,
            check_in_photo_path: path,
          },
        ]);
        if (error) throw error;
      }

      toast.success('Checked in successfully');
    } else {
      if (!todayLog?.attendance_id || !todayLog.check_in_at) {
        toast.error('You must check in first');
        return;
      }
      if (todayLog.check_out_at) {
        toast.error('Already checked out today');
        return;
      }
      const { error } = await supabase
        .from('attendance_logs')
        .update({
          check_out_at: new Date().toISOString(),
          check_out_lat: geo.lat,
          check_out_lng: geo.lng,
          check_out_accuracy: geo.accuracy,
          check_out_photo_path: path,
        })
        .eq('attendance_id', todayLog.attendance_id);
      if (error) throw error;
      toast.success('Checked out successfully');
    }

    setIsAttendanceDialogOpen(false);
    setAttendanceDialogLabourId(null);
    await loadMyAttendance();
    if (isProxy && proxyLabourId != null) await loadProxyCardTodayLog(proxyLabourId);
    if (showStaffReportBlock) await loadAdminAttendance();
  };

  const handleConfirmAttendance = async () => {
    if (!me?.user_id) {
      toast.error('You must be logged in');
      return;
    }
    const today = getLocalISODate();
    const proxyLabourId = attendanceDialogLabourId;
    const isProxy = proxyLabourId != null;

    if (!photoBlob) {
      toast.error('Please capture a photo');
      return;
    }
    if (!geo) {
      toast.error('Location is required. Please allow location access.');
      return;
    }

    if (attendanceAction === 'checkin' && !weeklyOffBypassRef.current) {
      const { data: needsWeeklyOffConfirm, error: woErr } = await supabase.rpc('should_confirm_weekly_off_checkin', {
        p_profile_user_id: isProxy ? null : me.user_id,
        p_labour_id: isProxy ? proxyLabourId : null,
        p_work_date: today,
      });
      if (woErr) {
        toast.error(formatAttendanceSaveError(woErr));
        return;
      }
      if (needsWeeklyOffConfirm === true) {
        setWeeklyOffConfirmOpen(true);
        return;
      }
    }

    setIsCapturing(true);
    try {
      await commitAttendanceAfterCapture();
    } catch (e: unknown) {
      console.error(e);
      toast.error(formatAttendanceSaveError(e));
    } finally {
      setIsCapturing(false);
    }
  };

  const detailSubjectName = selectedAttendance
    ? selectedAttendance.user_id && me?.user_id === selectedAttendance.user_id
      ? 'You'
      : rowSubjectLabel(selectedAttendance)
    : '';

  return (
    <div className="space-y-6">
      {isTeamOverview && !canViewStaffReport && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Team attendance</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Only admins and project managers can view everyone&apos;s attendance here. Use{' '}
            <span className="font-medium text-foreground">Attendance</span> in the sidebar for your own check-in and history.
          </CardContent>
        </Card>
      )}

      {!isTeamOverview && (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Today</CardTitle>
          <div className="text-xs text-muted-foreground">{getLocalISODate()}</div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {todayLog?.check_in_at
                ? todayLog.check_out_at
                  ? `Checked out`
                  : `Checked in`
                : 'Not checked in'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setAttendanceAction('checkin');
                setAttendanceDialogLabourId(null);
                setIsAttendanceDialogOpen(true);
              }}
              disabled={!me?.user_id || !!todayLog?.check_in_at}
            >
              Check In
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setAttendanceAction('checkout');
                setAttendanceDialogLabourId(null);
                setIsAttendanceDialogOpen(true);
              }}
              disabled={!me?.user_id || !todayLog?.check_in_at || !!todayLog?.check_out_at}
            >
              Check Out
            </Button>
            <Button variant="ghost" onClick={loadMyAttendance}>
              Refresh
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Check-in and check-out each require a <span className="font-medium">camera photo</span> and{' '}
            <span className="font-medium">GPS location</span> (no submission without both).
          </p>
        </CardContent>
      </Card>
      )}

      {canProxyMarkAttendance && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Field staff (no app login)</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              For supervisors, admins, and project managers. Only people listed on a project in{' '}
              <span className="font-medium">Manpower</span> appear here. If their mobile matches a team profile, or they are linked as a
              team member on manpower, they must use their own account — you cannot mark attendance for them.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1 max-w-md">
              <Label className="text-xs">Person</Label>
              <Select
                value={proxySelectedLabourId || '__none__'}
                onValueChange={(v) => {
                  const id = v === '__none__' ? '' : v;
                  setProxySelectedLabourId(id);
                  if (id) void loadProxyCardTodayLog(Number(id));
                  else setProxyCardTodayLog(null);
                }}
              >
                <SelectTrigger className="bg-white w-full sm:w-[320px]">
                  <SelectValue placeholder="Select field staff…" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="__none__">— Select —</SelectItem>
                  {proxyEligibleLabour.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                      {l.phone ? ` · ${l.phone}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {proxySelectedLabourId ? (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>
                    {proxyCardTodayLog?.check_in_at
                      ? proxyCardTodayLog.check_out_at
                        ? 'Checked out'
                        : 'Checked in'
                      : 'Not checked in'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      const id = Number(proxySelectedLabourId);
                      if (!Number.isFinite(id)) return;
                      setAttendanceAction('checkin');
                      setAttendanceDialogLabourId(id);
                      setIsAttendanceDialogOpen(true);
                    }}
                    disabled={!!proxyCardTodayLog?.check_in_at}
                  >
                    Check In for selected
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const id = Number(proxySelectedLabourId);
                      if (!Number.isFinite(id)) return;
                      setAttendanceAction('checkout');
                      setAttendanceDialogLabourId(id);
                      setIsAttendanceDialogOpen(true);
                    }}
                    disabled={!proxyCardTodayLog?.check_in_at || !!proxyCardTodayLog?.check_out_at}
                  >
                    Check Out for selected
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void loadProxyCardTodayLog(Number(proxySelectedLabourId))}>
                    Refresh
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select someone from manpower who does not have their own login.</p>
            )}
          </CardContent>
        </Card>
      )}

      {!isTeamOverview && (
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm font-medium">My last 30 days</CardTitle>
          {attendanceHistory.length > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={exportMyAttendanceExcel}>
              <Download className="h-4 w-4 mr-1.5" aria-hidden />
              Download Excel
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {attendanceHistory.length === 0 ? (
            <div className="text-sm text-muted-foreground">No attendance records yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Check In</TableHead>
                    <TableHead>Check Out</TableHead>
                    <TableHead className="text-right">Accuracy (m)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendanceHistory.map((r) => (
                    <TableRow
                      key={r.attendance_id}
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedAttendance(r);
                        setIsAttendanceDetailsOpen(true);
                      }}
                    >
                      <TableCell className="font-medium">{r.work_date}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString() : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {r.check_out_at ? new Date(r.check_out_at).toLocaleTimeString() : '-'}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {r.check_in_accuracy ? Math.round(r.check_in_accuracy) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {showStaffReportBlock && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              {isTeamOverview ? 'Team attendance overview' : 'All staff attendance'}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Filter by date, team member, or field (manpower) row. Open a row for photos and maps. Apply migrations{' '}
              <code className="text-[11px]">20260401000800</code>, <code className="text-[11px]">20260401000900</code>, and{' '}
              <code className="text-[11px]">20260404120000</code>, <code className="text-[11px]">20260404131000</code>, and{' '}
              <code className="text-[11px]">20260404133000</code> for field-staff proxy attendance.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1 min-w-[200px]">
                <Label className="text-xs">Team member</Label>
                <Select
                  value={adminAttUserId || '__all__'}
                  onValueChange={(v) => {
                    const uid = v === '__all__' ? '' : v;
                    setAdminAttUserId(uid);
                    if (uid) setAdminAttLabourId('');
                  }}
                >
                  <SelectTrigger className="bg-white w-[220px]">
                    <SelectValue placeholder="Everyone" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="__all__">Everyone</SelectItem>
                    {[...nameDirectory]
                      .filter((n) => n.user_id)
                      .sort((a, b) => String(a.full_name || a.user_id).localeCompare(String(b.full_name || b.user_id)))
                      .map((n) => (
                        <SelectItem key={n.user_id} value={n.user_id}>
                          {n.full_name || n.user_id.slice(0, 8) + '…'}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 min-w-[200px]">
                <Label className="text-xs">Field staff (manpower)</Label>
                <Select
                  value={adminAttLabourId || '__all__'}
                  onValueChange={(v) => {
                    const lid = v === '__all__' ? '' : v;
                    setAdminAttLabourId(lid);
                    if (lid) setAdminAttUserId('');
                  }}
                >
                  <SelectTrigger className="bg-white w-[220px]">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="__all__">All</SelectItem>
                    {adminLabourPicklist.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input type="date" className="bg-white w-[160px]" value={adminAttFrom} onChange={(e) => setAdminAttFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To</Label>
                <Input type="date" className="bg-white w-[160px]" value={adminAttTo} onChange={(e) => setAdminAttTo(e.target.value)} />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={loadAdminAttendance} disabled={adminAttLoading}>
                {adminAttLoading ? 'Loading…' : 'Refresh'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={exportStaffReportExcel}
                disabled={adminAttLoading || adminAttRows.length === 0}
              >
                <Download className="h-4 w-4 mr-1.5" aria-hidden />
                Download Excel
              </Button>
            </div>
            {adminAttRows.length === 0 && !adminAttLoading ? (
              <div className="text-sm text-muted-foreground">No rows in this range.</div>
            ) : (
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Person</TableHead>
                      <TableHead>Check in</TableHead>
                      <TableHead>Check out</TableHead>
                      <TableHead className="text-center">In GPS</TableHead>
                      <TableHead className="text-center">Out GPS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adminAttRows.map((r) => (
                      <TableRow
                        key={r.attendance_id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => {
                          setSelectedAttendance(r);
                          setIsAttendanceDetailsOpen(true);
                        }}
                      >
                        <TableCell className="font-medium whitespace-nowrap">{r.work_date}</TableCell>
                        <TableCell className="text-sm">{rowSubjectLabel(r)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {r.check_in_at ? new Date(r.check_in_at).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {r.check_out_at ? new Date(r.check_out_at).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          {r.check_in_lat != null && r.check_in_lng != null ? 'Yes' : '—'}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          {r.check_out_lat != null && r.check_out_lng != null ? 'Yes' : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={isAttendanceDetailsOpen} onOpenChange={setIsAttendanceDetailsOpen}>
        <DialogContent className="max-w-4xl bg-white">
          <DialogHeader>
            <DialogTitle>Attendance details</DialogTitle>
            <DialogDescription>
              {selectedAttendance ? (
                <>
                  {detailSubjectName ? `${detailSubjectName} · ` : ''}
                  Work date: {selectedAttendance.work_date}
                </>
              ) : (
                ''
              )}
            </DialogDescription>
          </DialogHeader>

          {!selectedAttendance ? (
            <div className="text-sm text-muted-foreground">No record selected.</div>
          ) : attendanceDetailsLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="grid gap-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Check In</div>
                  <div className="text-xs text-muted-foreground">
                    {selectedAttendance.check_in_at ? new Date(selectedAttendance.check_in_at).toLocaleString() : '—'}
                  </div>
                  {selectedAttendance.check_in_lat != null && selectedAttendance.check_in_lng != null ? (
                    <>
                      <div className="text-xs text-muted-foreground">
                        Location: {Number(selectedAttendance.check_in_lat).toFixed(6)},{' '}
                        {Number(selectedAttendance.check_in_lng).toFixed(6)}
                        {selectedAttendance.check_in_accuracy != null
                          ? ` (±${Math.round(Number(selectedAttendance.check_in_accuracy))}m)`
                          : ''}
                      </div>
                      <div className="rounded-md overflow-hidden border">
                        <iframe
                          title="Check-in map"
                          src={osmEmbedUrl(Number(selectedAttendance.check_in_lat), Number(selectedAttendance.check_in_lng))}
                          className="w-full h-[240px]"
                        />
                      </div>
                      <a
                        className="text-xs text-blue-600 hover:underline"
                        target="_blank"
                        rel="noreferrer"
                        href={`https://www.google.com/maps?q=${selectedAttendance.check_in_lat},${selectedAttendance.check_in_lng}`}
                      >
                        Open in Google Maps
                      </a>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">No location captured.</div>
                  )}
                  {attendanceSignedUrls.checkInUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attendanceSignedUrls.checkInUrl}
                      alt="Check-in"
                      className="w-full rounded-md border object-cover max-h-[320px]"
                    />
                  ) : (
                    <div className="text-xs text-muted-foreground">No check-in photo.</div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Check Out</div>
                  <div className="text-xs text-muted-foreground">
                    {selectedAttendance.check_out_at ? new Date(selectedAttendance.check_out_at).toLocaleString() : '—'}
                  </div>
                  {selectedAttendance.check_out_lat != null && selectedAttendance.check_out_lng != null ? (
                    <>
                      <div className="text-xs text-muted-foreground">
                        Location: {Number(selectedAttendance.check_out_lat).toFixed(6)},{' '}
                        {Number(selectedAttendance.check_out_lng).toFixed(6)}
                        {selectedAttendance.check_out_accuracy != null
                          ? ` (±${Math.round(Number(selectedAttendance.check_out_accuracy))}m)`
                          : ''}
                      </div>
                      <div className="rounded-md overflow-hidden border">
                        <iframe
                          title="Check-out map"
                          src={osmEmbedUrl(Number(selectedAttendance.check_out_lat), Number(selectedAttendance.check_out_lng))}
                          className="w-full h-[240px]"
                        />
                      </div>
                      <a
                        className="text-xs text-blue-600 hover:underline"
                        target="_blank"
                        rel="noreferrer"
                        href={`https://www.google.com/maps?q=${selectedAttendance.check_out_lat},${selectedAttendance.check_out_lng}`}
                      >
                        Open in Google Maps
                      </a>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">No location captured.</div>
                  )}
                  {attendanceSignedUrls.checkOutUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attendanceSignedUrls.checkOutUrl}
                      alt="Check-out"
                      className="w-full rounded-md border object-cover max-h-[320px]"
                    />
                  ) : (
                    <div className="text-xs text-muted-foreground">No check-out photo.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAttendanceDetailsOpen(false);
                setSelectedAttendance(null);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAttendanceDialogOpen} onOpenChange={setIsAttendanceDialogOpen}>
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader>
            <DialogTitle>
              {attendanceDialogLabourId != null
                ? `${attendanceAction === 'checkin' ? 'Check In' : 'Check Out'} — field staff`
                : attendanceAction === 'checkin'
                  ? 'Check In'
                  : 'Check Out'}
            </DialogTitle>
            <DialogDescription>
              Capture a photo with the camera and record GPS location. Both are required to submit. On a phone, use{' '}
              <span className="font-medium">Switch camera</span> to choose the front or rear lens if both are available.
              {attendanceDialogLabourId != null && (
                <>
                  {' '}
                  This attendance is recorded for the selected field staff member under your account (marked by you).
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-slate-50 p-3">
              {photoPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoPreviewUrl} alt="Captured" className="w-full rounded-md object-cover max-h-[320px]" />
              ) : (
                <video
                  ref={videoRef}
                  className="w-full rounded-md max-h-[320px] bg-black"
                  playsInline
                  muted
                  onLoadedMetadata={() => setIsCameraReady(true)}
                  onCanPlay={() => setIsCameraReady(true)}
                />
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  setPhotoBlob(null);
                  setPhotoPreviewUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                  try {
                    await startCamera(cameraFacing);
                  } catch {
                    toast.error('Camera not available');
                  }
                }}
              >
                <Camera className="mr-2 h-4 w-4" />
                {photoPreviewUrl ? 'Retake' : 'Start camera'}
              </Button>
              {!photoPreviewUrl && hasLiveStream && (
                <Button type="button" variant="outline" onClick={() => void flipCamera()} disabled={isSwitchingCamera}>
                  <SwitchCamera className="mr-2 h-4 w-4" />
                  {isSwitchingCamera
                    ? 'Switching…'
                    : cameraFacing === 'environment'
                      ? 'Front camera'
                      : 'Rear camera'}
                </Button>
              )}
              <Button
                type="button"
                disabled={!hasLiveStream || !isCameraReady}
                onClick={async () => {
                  try {
                    await capturePhoto();
                  } catch (e: unknown) {
                    toast.error(e instanceof Error ? e.message : 'Camera not ready');
                  }
                }}
              >
                Capture photo
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    await requestLocation();
                  } catch (e: unknown) {
                    setGeoError(e instanceof Error ? e.message : 'Failed to get location');
                  }
                }}
              >
                <LocateFixed className="mr-2 h-4 w-4" />
                Refresh location
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {geo ? (
                <div>
                  Location: {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)} (±{Math.round(geo.accuracy)}m)
                </div>
              ) : geoError ? (
                <div className="text-red-600">Location error: {geoError}</div>
              ) : (
                <div>Location: waiting for permission…</div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAttendanceDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleConfirmAttendance()}
              disabled={isCapturing || !photoBlob || !geo}
            >
              {isCapturing ? 'Saving…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={weeklyOffConfirmOpen} onOpenChange={setWeeklyOffConfirmOpen}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Weekly off day</DialogTitle>
            <DialogDescription>
              Today is configured as a weekly off for {attendanceDialogLabourId != null ? 'this field staff member' : 'you'}. Do you still
              want to record check-in?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setWeeklyOffConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                weeklyOffBypassRef.current = true;
                setWeeklyOffConfirmOpen(false);
                void (async () => {
                  setIsCapturing(true);
                  try {
                    await commitAttendanceAfterCapture();
                  } catch (e: unknown) {
                    console.error(e);
                    toast.error(formatAttendanceSaveError(e));
                  } finally {
                    setIsCapturing(false);
                  }
                })();
              }}
            >
              Continue anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
