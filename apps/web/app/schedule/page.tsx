'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calendar, ChevronLeft, ChevronRight, Plus, Clock, MapPin, Users, Pencil, Trash } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type ScheduleEvent = {
    activity_id: number;
    activity_name: string;
    project_id: number;
    project_name?: string;
    start_date: string;
    end_date: string;
    owner: string | null;
    tag: string | null;
    status: string;
    description: string | null;
};

type Project = {
    project_id: number;
    project_name: string;
};

export default function SchedulePage() {
    const [viewMode, setViewMode] = useState('week');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [events, setEvents] = useState<ScheduleEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [projects, setProjects] = useState<Project[]>([]);
    
    // Dialog states
    const [isEventDialogOpen, setIsEventDialogOpen] = useState(false);
    const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [currentUser, setCurrentUser] = useState('');
    
    // Form state
    const [eventForm, setEventForm] = useState({
        activity_name: '',
        project_id: '',
        start_date: '',
        end_date: '',
        tag: 'Site Work',
        owner: '',
        status: 'Pending',
        description: '',
    });

    useEffect(() => {
        fetchScheduleEvents();
        fetchProjects();
        fetchCurrentUser();
    }, [currentDate, viewMode]);

    const fetchCurrentUser = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User';
            setCurrentUser(name);
            setEventForm(prev => ({ ...prev, owner: name }));
        }
    };

    const fetchProjects = async () => {
        const { data, error } = await supabase
            .from('projects')
            .select('project_id, project_name')
            .order('project_name');
        
        if (data) {
            setProjects(data);
        }
    };

    const fetchScheduleEvents = async () => {
        try {
            setLoading(true);
            const startDate = new Date(currentDate);
            const endDate = new Date(currentDate);
            
            if (viewMode === 'week') {
                startDate.setDate(startDate.getDate() - startDate.getDay());
                endDate.setDate(startDate.getDate() + 6);
            } else if (viewMode === 'month') {
                startDate.setDate(1);
                endDate.setMonth(endDate.getMonth() + 1);
                endDate.setDate(0);
            }

            // Fetch all activities first, then filter by date range
            const { data, error } = await supabase
                .from('site_activities')
                .select(`
                    activity_id,
                    activity_name,
                    project_id,
                    start_date,
                    end_date,
                    owner,
                    tag,
                    status,
                    description,
                    projects:project_id (
                        project_name
                    )
                `)
                .order('start_date', { ascending: true });

            if (error) throw error;

            // Filter by date range in JavaScript since Supabase date filtering can be tricky
            const filteredData = (data || []).filter((event: any) => {
                const eventStart = new Date(event.start_date);
                const eventEnd = new Date(event.end_date);
                return eventStart <= endDate && eventEnd >= startDate;
            });

            const eventsWithProjectNames = filteredData.map((event: any) => ({
                ...event,
                project_name: event.projects?.project_name || 'Unknown Project',
            }));

            setEvents(eventsWithProjectNames);
        } catch (error) {
            console.error('Error fetching schedule events:', error);
            toast.error('Failed to load schedule');
        } finally {
            setLoading(false);
        }
    };

    const getEventTypeColor = (tag: string | null) => {
        const tagLower = tag?.toLowerCase() || '';
        if (tagLower.includes('civil') || tagLower.includes('construction')) {
            return 'bg-blue-100 text-blue-800 border-blue-200';
        } else if (tagLower.includes('electrical')) {
            return 'bg-yellow-100 text-yellow-800 border-yellow-200';
        } else if (tagLower.includes('plumbing')) {
            return 'bg-green-100 text-green-800 border-green-200';
        } else if (tagLower.includes('site work')) {
            return 'bg-orange-100 text-orange-800 border-orange-200';
        }
        return 'bg-gray-100 text-gray-800 border-gray-200';
    };

    const getDaysInView = () => {
        if (viewMode === 'week') {
            const start = new Date(currentDate);
            start.setDate(start.getDate() - start.getDay());
            return Array.from({ length: 7 }, (_, i) => {
                const date = new Date(start);
                date.setDate(start.getDate() + i);
                return date;
            });
        }
        return [currentDate];
    };

    const getEventsForDate = (date: Date) => {
        const dateStr = date.toISOString().split('T')[0];
        return events.filter(event => {
            const startDate = new Date(event.start_date);
            const endDate = new Date(event.end_date);
            const checkDate = new Date(dateStr);
            return checkDate >= startDate && checkDate <= endDate;
        });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    };

    const navigateDate = (direction: 'prev' | 'next') => {
        const newDate = new Date(currentDate);
        if (viewMode === 'week') {
            newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
        } else {
            newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
        }
        setCurrentDate(newDate);
    };

    const handleNewEvent = () => {
        setEditingEvent(null);
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        
        setEventForm({
            activity_name: '',
            project_id: projects.length > 0 ? projects[0].project_id.toString() : '',
            start_date: today,
            end_date: tomorrowStr,
            tag: 'Site Work',
            owner: currentUser || '',
            status: 'Pending',
            description: '',
        });
        setIsEventDialogOpen(true);
    };

    const handleEditEvent = (event: ScheduleEvent) => {
        setEditingEvent(event);
        setEventForm({
            activity_name: event.activity_name,
            project_id: event.project_id.toString(),
            start_date: event.start_date.split('T')[0],
            end_date: event.end_date.split('T')[0],
            tag: event.tag || 'Site Work',
            owner: event.owner || currentUser,
            status: event.status,
            description: event.description || '',
        });
        setIsEventDialogOpen(true);
    };

    const handleSaveEvent = async () => {
        if (!eventForm.activity_name || !eventForm.project_id || !eventForm.start_date || !eventForm.end_date) {
            toast.error('Please fill in all required fields');
            return;
        }

        setIsSaving(true);
        try {
            const eventData = {
                activity_name: eventForm.activity_name,
                project_id: parseInt(eventForm.project_id),
                start_date: eventForm.start_date,
                end_date: eventForm.end_date,
                tag: eventForm.tag,
                owner: eventForm.owner,
                status: eventForm.status,
                description: eventForm.description || null,
                progress: 0,
            };

            if (editingEvent) {
                // Update existing event
                const { error } = await supabase
                    .from('site_activities')
                    .update(eventData)
                    .eq('activity_id', editingEvent.activity_id);

                if (error) throw error;
                toast.success('Event updated successfully');
            } else {
                // Create new event
                const { error } = await supabase
                    .from('site_activities')
                    .insert([eventData]);

                if (error) throw error;
                toast.success('Event created successfully');
            }

            setIsEventDialogOpen(false);
            fetchScheduleEvents();
        } catch (error: any) {
            console.error('Error saving event:', error);
            toast.error(error.message || 'Failed to save event');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteEvent = async (event: ScheduleEvent) => {
        if (!confirm(`Are you sure you want to delete "${event.activity_name}"?`)) {
            return;
        }

        try {
            const { error } = await supabase
                .from('site_activities')
                .delete()
                .eq('activity_id', event.activity_id);

            if (error) throw error;
            toast.success('Event deleted successfully');
            fetchScheduleEvents();
        } catch (error: any) {
            console.error('Error deleting event:', error);
            toast.error(error.message || 'Failed to delete event');
        }
    };

    const stats = {
        today: events.filter(e => {
            const today = new Date().toISOString().split('T')[0];
            const startDate = new Date(e.start_date).toISOString().split('T')[0];
            const endDate = new Date(e.end_date).toISOString().split('T')[0];
            return today >= startDate && today <= endDate;
        }).length,
        thisWeek: events.filter(e => {
            const today = new Date();
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            const eventStart = new Date(e.start_date);
            return eventStart >= weekStart && eventStart <= weekEnd;
        }).length,
        upcoming: events.filter(e => new Date(e.start_date) > new Date()).length,
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Schedule</h2>
                    <p className="text-muted-foreground">View and manage your calendar events</p>
                </div>
                <Button onClick={handleNewEvent}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Event
                </Button>
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Today</CardTitle>
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.today}</div>
                        <p className="text-xs text-muted-foreground">events scheduled</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">This Week</CardTitle>
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.thisWeek}</div>
                        <p className="text-xs text-muted-foreground">events scheduled</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Upcoming</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.upcoming}</div>
                        <p className="text-xs text-muted-foreground">future events</p>
                    </CardContent>
                </Card>
            </div>

            {/* Calendar Controls */}
            <Card>
                <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Button variant="outline" size="sm" onClick={() => navigateDate('prev')}>
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <h3 className="font-semibold">
                                {viewMode === 'week' 
                                    ? `Week of ${formatDate(getDaysInView()[0])}`
                                    : formatDate(currentDate)
                                }
                            </h3>
                            <Button variant="outline" size="sm" onClick={() => navigateDate('next')}>
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>
                                Today
                            </Button>
                        </div>
                        <Select value={viewMode} onValueChange={setViewMode}>
                            <SelectTrigger className="w-[120px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="day">Day</SelectItem>
                                <SelectItem value="week">Week</SelectItem>
                                <SelectItem value="month">Month</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* Calendar View */}
            <Card>
                <CardHeader>
                    <CardTitle>Calendar</CardTitle>
                </CardHeader>
                <CardContent>
                    {viewMode === 'week' ? (
                        <div className="grid grid-cols-7 gap-4">
                            {getDaysInView().map((date, idx) => {
                                const dayEvents = getEventsForDate(date);
                                const isToday = date.toDateString() === new Date().toDateString();
                                return (
                                    <div key={idx} className={`border rounded-lg p-3 ${isToday ? 'bg-blue-50 border-blue-200' : ''}`}>
                                        <div className={`text-sm font-semibold mb-2 ${isToday ? 'text-blue-600' : ''}`}>
                                            {formatDate(date)}
                                        </div>
                                        <div className="space-y-2">
                                            {dayEvents.map(event => (
                                                <div
                                                    key={event.activity_id}
                                                    onClick={() => handleEditEvent(event)}
                                                    className={`p-2 rounded border text-xs cursor-pointer hover:opacity-80 ${getEventTypeColor(event.tag)}`}
                                                >
                                                    <div className="font-semibold truncate">{event.activity_name}</div>
                                                    {event.tag && (
                                                        <div className="text-xs opacity-75">{event.tag}</div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : loading ? (
                        <div className="text-center py-8 text-muted-foreground">Loading schedule...</div>
                    ) : (
                        <div className="space-y-4">
                            {getEventsForDate(currentDate).map(event => (
                                <div key={event.activity_id} className="p-4 border rounded-lg hover:bg-gray-50">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1 cursor-pointer" onClick={() => handleEditEvent(event)}>
                                            <div className="flex items-center gap-2 mb-2">
                                                {event.tag && (
                                                    <Badge className={getEventTypeColor(event.tag)}>
                                                        {event.tag}
                                                    </Badge>
                                                )}
                                                <span className="font-semibold">{event.activity_name}</span>
                                            </div>
                                            <div className="space-y-1 text-sm text-muted-foreground">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="h-4 w-4" />
                                                    {new Date(event.start_date).toLocaleDateString()} - {new Date(event.end_date).toLocaleDateString()}
                                                </div>
                                                {event.owner && (
                                                    <div className="flex items-center gap-2">
                                                        <Users className="h-4 w-4" />
                                                        {event.owner}
                                                    </div>
                                                )}
                                                {event.description && (
                                                    <p className="mt-2">{event.description}</p>
                                                )}
                                                <div className="flex items-center gap-2 mt-2">
                                                    <span className="text-xs">Status: {event.status}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button variant="outline" size="sm" onClick={() => handleEditEvent(event)}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => handleDeleteEvent(event)}>
                                                <Trash className="h-4 w-4" />
                                            </Button>
                                            <Link href={`/projects/${event.project_id}`}>
                                                <Button variant="outline" size="sm">
                                                    View
                                                </Button>
                                            </Link>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {getEventsForDate(currentDate).length === 0 && (
                                <div className="text-center py-8 text-muted-foreground">
                                    No events scheduled for this day
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Event Dialog */}
            <Dialog open={isEventDialogOpen} onOpenChange={setIsEventDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white">
                    <DialogHeader>
                        <DialogTitle>{editingEvent ? 'Edit Event' : 'New Event'}</DialogTitle>
                        <DialogDescription>
                            {editingEvent ? 'Update event details' : 'Create a new calendar event'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {projects.length === 0 && (
                            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                                <p className="text-sm text-yellow-800">
                                    No projects available. Please create a project first before adding events.
                                </p>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="activity_name">Event Name *</Label>
                            <Input
                                id="activity_name"
                                value={eventForm.activity_name}
                                onChange={(e) => setEventForm({ ...eventForm, activity_name: e.target.value })}
                                placeholder="e.g., Site Inspection"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="project_id">Project *</Label>
                                <Select 
                                    value={eventForm.project_id} 
                                    onValueChange={(value) => setEventForm({ ...eventForm, project_id: value })}
                                    disabled={projects.length === 0}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={projects.length === 0 ? "No projects available" : "Select project"} />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                        {projects.map(project => (
                                            <SelectItem key={project.project_id} value={project.project_id.toString()} className="bg-white hover:bg-gray-100">
                                                {project.project_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {projects.length === 0 && (
                                    <p className="text-xs text-muted-foreground">Create a project first</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="tag">Category</Label>
                                <Select value={eventForm.tag} onValueChange={(value) => setEventForm({ ...eventForm, tag: value })}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                        <SelectItem value="Site Work" className="bg-white hover:bg-gray-100">Site Work</SelectItem>
                                        <SelectItem value="Civil" className="bg-white hover:bg-gray-100">Civil</SelectItem>
                                        <SelectItem value="Electrical" className="bg-white hover:bg-gray-100">Electrical</SelectItem>
                                        <SelectItem value="Plumbing" className="bg-white hover:bg-gray-100">Plumbing</SelectItem>
                                        <SelectItem value="MEP" className="bg-white hover:bg-gray-100">MEP</SelectItem>
                                        <SelectItem value="Finishing" className="bg-white hover:bg-gray-100">Finishing</SelectItem>
                                        <SelectItem value="Design" className="bg-white hover:bg-gray-100">Design</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="start_date">Start Date *</Label>
                                <Input
                                    id="start_date"
                                    type="date"
                                    value={eventForm.start_date}
                                    onChange={(e) => setEventForm({ ...eventForm, start_date: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="end_date">End Date *</Label>
                                <Input
                                    id="end_date"
                                    type="date"
                                    value={eventForm.end_date}
                                    onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="owner">Owner</Label>
                                <Input
                                    id="owner"
                                    value={eventForm.owner}
                                    onChange={(e) => setEventForm({ ...eventForm, owner: e.target.value })}
                                    placeholder="Event owner"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="status">Status</Label>
                                <Select value={eventForm.status} onValueChange={(value) => setEventForm({ ...eventForm, status: value })}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                        <SelectItem value="Pending" className="bg-white hover:bg-gray-100">Pending</SelectItem>
                                        <SelectItem value="In Progress" className="bg-white hover:bg-gray-100">In Progress</SelectItem>
                                        <SelectItem value="Completed" className="bg-white hover:bg-gray-100">Completed</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea
                                id="description"
                                value={eventForm.description}
                                onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                                placeholder="Event description..."
                                rows={3}
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setIsEventDialogOpen(false)}>
                            Cancel
                        </Button>
                        {editingEvent && (
                            <Button variant="outline" onClick={() => {
                                setIsEventDialogOpen(false);
                                handleDeleteEvent(editingEvent);
                            }}>
                                <Trash className="mr-2 h-4 w-4" />
                                Delete
                            </Button>
                        )}
                        <Button onClick={handleSaveEvent} disabled={isSaving || projects.length === 0}>
                            {isSaving ? 'Saving...' : editingEvent ? 'Update Event' : 'Create Event'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

