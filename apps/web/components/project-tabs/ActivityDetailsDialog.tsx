import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Mic, Paperclip, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

type Activity = {
    activity_id: number;
    activity_name: string;
    progress: number;
    owner: string;
};

type ActivityLog = {
    log_id: number;
    previous_progress: number;
    new_progress: number;
    comment: string;
    user_name: string;
    created_at: string;
    audio_path?: string | null;
    file_path?: string | null;
    file_name?: string | null;
    audio_url?: string | null;
    file_url?: string | null;
};

interface ActivityDetailsDialogProps {
    activity: Activity | null;
    isOpen: boolean;
    onClose: () => void;
    onUpdate: () => void; // Trigger refresh of parent list
}

export function ActivityDetailsDialog({ activity, isOpen, onClose, onUpdate }: ActivityDetailsDialogProps) {
    const [progress, setProgress] = useState(0);
    const [comment, setComment] = useState("");
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
    const [recordingSeconds, setRecordingSeconds] = useState(0);

    const [currentUserName, setCurrentUserName] = useState("Unknown");
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                // Try to get name from metadata, fallback to email
                const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || "User";
                setCurrentUserName(name);
            }
        };
        fetchUser();
    }, []);

    useEffect(() => {
        if (activity) {
            setProgress(activity.progress || 0);
            setComment("");
            setSelectedFile(null);
            setRecordedAudioBlob(null);
            setRecordingSeconds(0);
            fetchLogs(activity.activity_id);
        }
    }, [activity]);

    useEffect(() => {
        return () => {
            if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
        };
    }, []);

    const fetchLogs = async (activityId: number) => {
        setIsLoading(true);
        const { data, error } = await supabase
            .from('activity_logs')
            .select('*')
            .eq('activity_id', activityId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Error fetching logs:", error);
            toast.error("Failed to load history.");
        } else {
            const withUrls = await Promise.all(
                ((data || []) as ActivityLog[]).map(async (log) => {
                    let audio_url: string | null = null;
                    let file_url: string | null = null;

                    if (log.audio_path) {
                        const { data: audioData } = await supabase.storage.from('documents').createSignedUrl(log.audio_path, 60 * 30);
                        audio_url = audioData?.signedUrl || null;
                    }
                    if (log.file_path) {
                        const { data: fileData } = await supabase.storage.from('documents').createSignedUrl(log.file_path, 60 * 30);
                        file_url = fileData?.signedUrl || null;
                    }

                    return { ...log, audio_url, file_url };
                })
            );
            setLogs(withUrls);
        }
        setIsLoading(false);
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    };

    const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        setSelectedFile(file);
    };

    const handleToggleRecording = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
            if (recordingIntervalRef.current) {
                clearInterval(recordingIntervalRef.current);
                recordingIntervalRef.current = null;
            }
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            const chunks: BlobPart[] = [];
            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) chunks.push(event.data);
            };
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                setRecordedAudioBlob(blob);
                stream.getTracks().forEach((track) => track.stop());
            };
            recorder.start();
            mediaRecorderRef.current = recorder;
            setIsRecording(true);
            setRecordingSeconds(0);
            recordingIntervalRef.current = setInterval(() => {
                setRecordingSeconds((prev) => prev + 1);
            }, 1000);
        } catch (err: any) {
            toast.error(err?.message || "Microphone access denied");
        }
    };

    const handleSubmit = async () => {
        if (!activity) return;

        setIsSaving(true);

        try {
            // 1. Update site_activities
            const { error: updateError } = await supabase
                .from('site_activities')
                .update({
                    progress: progress,
                    status: progress === 100 ? 'Completed' : 'In Progress' // Auto-update status based on progress
                })
                .eq('activity_id', activity.activity_id);

            if (updateError) throw updateError;

            let uploadedAudioPath: string | null = null;
            let uploadedFilePath: string | null = null;
            if (recordedAudioBlob) {
                const audioPath = `projects/${activity.activity_id}/activity-logs/${Date.now()}-voice.webm`;
                const { error: audioUploadError } = await supabase.storage
                    .from('documents')
                    .upload(audioPath, recordedAudioBlob, { contentType: 'audio/webm' });
                if (audioUploadError) throw audioUploadError;
                uploadedAudioPath = audioPath;
            }
            if (selectedFile) {
                const filePath = `projects/${activity.activity_id}/activity-logs/${Date.now()}-${safeFileName(selectedFile.name)}`;
                const { error: fileUploadError } = await supabase.storage
                    .from('documents')
                    .upload(filePath, selectedFile, { contentType: selectedFile.type || undefined });
                if (fileUploadError) throw fileUploadError;
                uploadedFilePath = filePath;
            }

            // 2. Insert into activity_logs
            const { error: logError } = await supabase
                .from('activity_logs')
                .insert({
                    activity_id: activity.activity_id,
                    previous_progress: activity.progress,
                    new_progress: progress,
                    comment: comment,
                    user_name: currentUserName,
                    audio_path: uploadedAudioPath,
                    file_path: uploadedFilePath,
                    file_name: selectedFile?.name || null
                });

            if (logError) throw logError;

            toast.success("Activity updated successfully!");
            setComment("");
            setSelectedFile(null);
            setRecordedAudioBlob(null);
            setRecordingSeconds(0);
            onUpdate(); // Refresh parent
            fetchLogs(activity.activity_id); // Refresh local history

        } catch (error: any) {
            console.error("Error updating activity:", error);
            toast.error(`Failed to update: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (!activity) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
            <DialogContent className="max-w-4xl w-[95vw] p-0 gap-0 bg-slate-50 overflow-y-auto md:overflow-hidden h-[85vh] sm:h-[600px] flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 bg-white flex justify-between items-center">
                    <div>
                        <DialogTitle className="text-xl font-bold text-slate-800">{activity.activity_name}</DialogTitle>
                        <DialogDescription className="text-slate-500 hidden">Details and History</DialogDescription>
                    </div>
                </div>

                <div className="flex flex-1 min-h-0 overflow-hidden flex-col md:flex-row">
                    {/* Left Column: Update Form */}
                    <div className="w-full md:w-1/2 p-4 sm:p-6 bg-white md:border-r border-gray-200 overflow-y-auto md:min-h-0">
                        <div className="mb-6">
                            <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <span className="text-blue-600">🛠️</span> Update Status
                            </h3>

                            {/* Progress Slider */}
                            <div className="mb-8">
                                <div className="flex justify-between mb-2">
                                    <label className="text-sm font-medium text-slate-600">Status</label>
                                    <span className="text-2xl font-bold text-blue-600">{progress}%</span>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="relative w-full h-2 bg-gray-200 rounded-full">
                                        <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={progress}
                                            onChange={(e) => setProgress(Number(e.target.value))}
                                            className="absolute w-full h-full opacity-0 cursor-pointer z-10"
                                        />
                                        <div
                                            className="absolute top-0 left-0 h-full bg-blue-600 rounded-full transition-all duration-300"
                                            style={{ width: `${progress}%` }}
                                        ></div>
                                        <div
                                            className="absolute top-1/2 -mt-2.5 h-5 w-5 bg-blue-600 border-2 border-white shadow-md rounded-full transition-all duration-300 pointer-events-none"
                                            style={{ left: `${progress}%`, transform: 'translateX(-50%)' }}
                                        ></div>
                                    </div>
                                    <div className="h-6 w-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-400">
                                        <Check className="h-3 w-3" />
                                    </div>
                                </div>
                            </div>

                            {/* Remarks */}
                            <div className="mb-6 relative">
                                <label className="text-sm font-medium text-slate-600 mb-2 block">Remarks</label>
                                <textarea
                                    className="flex w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm ring-offset-background placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[120px] resize-none"
                                    placeholder="Add a note about this update..."
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                />
                                <div className="absolute right-3 bottom-3 flex items-center gap-2">
                                    <span className="text-xs text-slate-400">{formatDuration(recordingSeconds)}</span>
                                    <Button
                                        size="icon"
                                        type="button"
                                        onClick={handleToggleRecording}
                                        className={`h-8 w-8 rounded-full text-white shadow-md ${isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-purple-600 hover:bg-purple-700'}`}
                                    >
                                        <Mic className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            {/* File Upload */}
                            <div className="mb-8">
                                <label className="text-sm font-medium text-slate-600 mb-2 block">Select Files</label>
                                <div className="flex items-center gap-4">
                                    <span className="text-sm text-gray-500 italic">{selectedFile ? selectedFile.name : 'No files selected'}</span>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        className="hidden"
                                        onChange={handleFileSelect}
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="text-blue-600 border-blue-200 bg-blue-50 hover:bg-blue-100 gap-2"
                                    >
                                        <Paperclip className="h-3 w-3" /> Upload
                                    </Button>
                                    {selectedFile && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="text-red-600 hover:text-red-700"
                                            onClick={() => {
                                                setSelectedFile(null);
                                                if (fileInputRef.current) fileInputRef.current.value = '';
                                            }}
                                        >
                                            Clear
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <Button onClick={handleSubmit} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700 w-full md:w-auto px-8">
                                {isSaving ? "Submitting..." : "Submit"}
                            </Button>
                        </div>
                    </div>

                    {/* Right Column: History */}
                    <div className="w-full md:w-1/2 bg-slate-50 flex flex-col max-h-[40vh] md:max-h-none md:h-full border-t md:border-t-0 border-gray-200">
                        <div className="p-4 bg-slate-50 sticky top-0 z-10">
                            <h3 className="text-sm font-bold text-slate-800">Activity History</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {isLoading ? (
                                <p className="text-center text-gray-500 text-sm mt-10">Loading history...</p>
                            ) : logs.length === 0 ? (
                                <p className="text-center text-gray-500 text-sm mt-10">No history yet.</p>
                            ) : (
                                logs.map((log) => (
                                    <div key={log.log_id} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                        <div className="flex justify-between items-start mb-3">
                                            <h4 className="text-sm font-bold text-slate-800">
                                                Updated from {log.previous_progress ?? 0}% to {log.new_progress}%
                                            </h4>
                                            <span className="text-xs font-semibold text-slate-500">
                                                {new Date(log.created_at).toLocaleDateString()}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2 mb-3">
                                            <Avatar className="h-6 w-6">
                                                <AvatarFallback className="bg-blue-100 text-blue-600 text-[10px]">
                                                    {log.user_name?.substring(0, 2).toUpperCase() || "ME"}
                                                </AvatarFallback>
                                            </Avatar>
                                            <span className="text-xs font-medium text-slate-700">{log.user_name || "Unknown"}</span>
                                            <span className="text-[10px] text-slate-400 ml-auto">
                                                Created On : {new Date(log.created_at).toLocaleString()}
                                            </span>
                                        </div>

                                        {log.comment && (
                                            <div className="bg-slate-50 rounded-lg p-3 relative">
                                                <p className="text-sm text-slate-600 mb-1 font-medium">Comments <span className="text-blue-500 text-xs cursor-pointer font-normal">Show</span></p>
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2">
                                                        {log.file_url && (
                                                            <a
                                                                href={log.file_url}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="inline-flex items-center text-xs text-blue-600 hover:underline"
                                                            >
                                                                <Paperclip className="h-3.5 w-3.5 mr-1" />
                                                                {log.file_name || 'Attachment'}
                                                            </a>
                                                        )}
                                                        {log.audio_url && (
                                                            <audio controls className="h-8">
                                                                <source src={log.audio_url} type="audio/webm" />
                                                            </audio>
                                                        )}
                                                    </div>
                                                </div>
                                                <p className="text-sm text-slate-700 mt-2">{log.comment}</p>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
