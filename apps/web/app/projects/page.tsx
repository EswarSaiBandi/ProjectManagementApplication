"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { toast } from "sonner";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Pencil, Trash } from "lucide-react";
import { useRole } from "@/hooks/useRole";

type Project = {
    project_id: number;
    project_name: string;
    status: string;
    location: string | null;
    project_type: string | null;
};

export default function ProjectsPage() {
    const { isClient, isAdmin, role } = useRole();
    const canWrite = isAdmin || role === 'ProjectManager';
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [projectTypeOptions, setProjectTypeOptions] = useState<string[]>([]);

    // New/Edit Project Form State
    const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [newProject, setNewProject] = useState({
        project_name: '',
        location: '',
        status: 'Planning',
        project_type: ''
    });

    // Delete Project State
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
    const [deleteConfirmationName, setDeleteConfirmationName] = useState('');

    const fetchProjects = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('projects')
            .select('project_id, project_name, status, location, project_type')
            .order('created_at', { ascending: false });

        if (data) {
            setProjects(data);
        } else if (error) {
            console.error("Error fetching projects:", error);
            toast.error("Failed to fetch projects.");
        }
        setLoading(false);
    };

    const fetchProjectTypeOptions = async () => {
        const { data, error } = await supabase
            .from('dynamic_field_options')
            .select('option_value')
            .eq('field_type', 'project_type')
            .eq('is_active', true)
            .order('display_order', { ascending: true });

        if (error) {
            console.error("Error fetching project types:", error);
            setProjectTypeOptions([]);
            return;
        }

        const dynamicOptions = (data || [])
            .map((item: { option_value: string }) => item.option_value?.trim())
            .filter((value): value is string => Boolean(value));

        const uniqueOptions = Array.from(new Set(dynamicOptions));
        setProjectTypeOptions(uniqueOptions);
    };

    useEffect(() => {
        fetchProjects();
        fetchProjectTypeOptions();
    }, []);

    useEffect(() => {
        if (!newProject.project_type && projectTypeOptions.length > 0) {
            setNewProject((prev) => ({ ...prev, project_type: projectTypeOptions[0] }));
        }
    }, [projectTypeOptions, newProject.project_type]);

    const handleCreateProject = async () => {
        if (!newProject.project_name) {
            toast.error("Project Name is required.");
            return;
        }
        if (!newProject.project_type) {
            toast.error("Project Type is required.");
            return;
        }

        const projectData = {
            project_name: newProject.project_name,
            location: newProject.location,
            status: newProject.status,
            project_type: newProject.project_type
        };

        let error;

        if (editingId) {
            // Update existing project
            const { error: updateError } = await supabase
                .from('projects')
                .update(projectData)
                .eq('project_id', editingId);
            error = updateError;
        } else {
            // Create new project
            const { error: insertError } = await supabase
                .from('projects')
                .insert([projectData]);
            error = insertError;
        }

        if (!error) {
            toast.success(editingId ? "Project updated successfully!" : "Project created successfully!");
            setIsNewProjectOpen(false);
            setNewProject({ project_name: '', location: '', status: 'Planning', project_type: projectTypeOptions[0] || '' });
            setEditingId(null);
            fetchProjects();
        } else {
            console.error("Error saving project:", error);
            toast.error(editingId ? "Failed to update project." : "Failed to create project.");
        }
    };

    const handleEditProject = (project: Project) => {
        setEditingId(project.project_id);
        const activeTypeSet = new Set(projectTypeOptions);
        const resolvedProjectType = project.project_type && activeTypeSet.has(project.project_type)
            ? project.project_type
            : (projectTypeOptions[0] || '');

        setNewProject({
            project_name: project.project_name,
            location: project.location || '',
            status: project.status,
            project_type: resolvedProjectType
        });
        setIsNewProjectOpen(true);
    };

    const handleDeleteClick = (project: Project) => {
        setProjectToDelete(project);
        setDeleteConfirmationName('');
        setIsDeleteDialogOpen(true);
    };

    const handleConfirmDelete = async () => {
        if (!projectToDelete) return;

        if (deleteConfirmationName !== projectToDelete.project_name) {
            toast.error("Project name does not match.");
            return;
        }

        try {
            // material_movement_logs.project_id is not cascade; clear dependent logs first.
            const { error: movementDeleteError } = await supabase
                .from('material_movement_logs')
                .delete()
                .eq('project_id', projectToDelete.project_id);

            if (movementDeleteError) throw movementDeleteError;

            const { error } = await supabase
                .from('projects')
                .delete()
                .eq('project_id', projectToDelete.project_id);

            if (error) throw error;

            toast.success("Project deleted successfully");
            setIsDeleteDialogOpen(false);
            setProjectToDelete(null);
            fetchProjects();
        } catch (error: any) {
            console.error("Error deleting project:", error);
            toast.error(error?.message || "Failed to delete project");
        }
    };

    const openNewProjectModal = () => {
        setEditingId(null);
        setNewProject({ project_name: '', location: '', status: 'Planning', project_type: projectTypeOptions[0] || '' });
        setIsNewProjectOpen(true);
    };

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">My Projects</h1>

                <Dialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen}>
                    {canWrite && (
                        <DialogTrigger asChild>
                            <Button onClick={openNewProjectModal} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
                                <Plus className="h-4 w-4" /> New Project
                            </Button>
                        </DialogTrigger>
                    )}
                    <DialogContent className="bg-white text-slate-900 border shadow-lg sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>{editingId ? 'Edit Project' : 'Create New Project'}</DialogTitle>
                            <DialogDescription>
                                {editingId ? 'Update the details of your project.' : 'Add the details of your new construction project.'}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="name" className="text-right text-slate-700">
                                    Name
                                </Label>
                                <Input
                                    id="name"
                                    value={newProject.project_name}
                                    onChange={(e) => setNewProject({ ...newProject, project_name: e.target.value })}
                                    className="col-span-3 bg-white text-slate-900 border-slate-300"
                                    placeholder="e.g. Oberoi Tower A"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="location" className="text-right text-slate-700">
                                    Location
                                </Label>
                                <Input
                                    id="location"
                                    value={newProject.location}
                                    onChange={(e) => setNewProject({ ...newProject, location: e.target.value })}
                                    className="col-span-3 bg-white text-slate-900 border-slate-300"
                                    placeholder="e.g. Mumbai, India"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="project_type" className="text-right text-slate-700">
                                    Project Type
                                </Label>
                                <div className="col-span-3">
                                    <Select
                                        value={newProject.project_type}
                                        onValueChange={(val: string) => setNewProject({ ...newProject, project_type: val })}
                                        disabled={projectTypeOptions.length === 0}
                                    >
                                        <SelectTrigger className="bg-white text-slate-900 border-slate-300">
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white border border-slate-200 shadow-xl z-[9999]">
                                            {projectTypeOptions.map((option) => (
                                                <SelectItem
                                                    key={option}
                                                    className="text-slate-900 focus:bg-gray-100 focus:text-slate-900 cursor-pointer my-1"
                                                    value={option}
                                                >
                                                    {option}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {projectTypeOptions.length === 0 && (
                                        <p className="mt-1 text-xs text-red-600">
                                            No active project types found. Add/activate from Settings - Dynamic Field Configuration.
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="status" className="text-right text-slate-700">
                                    Status
                                </Label>
                                <div className="col-span-3">
                                    <Select
                                        value={newProject.status}
                                        onValueChange={(val: string) => setNewProject({ ...newProject, status: val })}
                                    >
                                        <SelectTrigger className="bg-white text-slate-900 border-slate-300">
                                            <SelectValue placeholder="Select status" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-white border border-slate-200 shadow-xl z-[9999]">
                                            <SelectItem className="text-slate-900 focus:bg-gray-100 focus:text-slate-900 cursor-pointer my-1" value="Planning">Planning</SelectItem>
                                            <SelectItem className="text-slate-900 focus:bg-gray-100 focus:text-slate-900 cursor-pointer my-1" value="Execution">Execution</SelectItem>
                                            <SelectItem className="text-slate-900 focus:bg-gray-100 focus:text-slate-900 cursor-pointer my-1" value="Completed">Completed</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit" onClick={handleCreateProject} className="bg-blue-600 text-white hover:bg-blue-700">
                                {editingId ? 'Update Project' : 'Create Project'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Delete Confirmation Dialog */}
            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogContent className="bg-white text-slate-900 border shadow-lg sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle className="text-red-600">Delete Project</DialogTitle>
                        <DialogDescription>
                            This action cannot be undone. This will permanently delete the project
                            <span className="font-bold text-slate-900"> {projectToDelete?.project_name} </span>
                            and all associated data.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <Label htmlFor="confirm-name">
                            Type <span className="font-bold">{projectToDelete?.project_name}</span> to confirm:
                        </Label>
                        <Input
                            id="confirm-name"
                            value={deleteConfirmationName}
                            onChange={(e) => setDeleteConfirmationName(e.target.value)}
                            className="bg-white text-slate-900 border-slate-300"
                            placeholder="Type project name here"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            onClick={handleConfirmDelete}
                            disabled={deleteConfirmationName !== projectToDelete?.project_name}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            Delete Project
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Content */}
            {
                loading ? (
                    <div className="text-center py-20 text-gray-500">Loading projects...</div>
                ) : projects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed rounded-lg bg-gray-50">
                        <p className="text-lg text-gray-500 mb-4">No active projects found.</p>
                        {canWrite && (
                            <Button variant="outline" className="gap-2" onClick={openNewProjectModal}>
                                <Plus className="h-4 w-4" /> Click 'New Project' to start
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        {projects.map((project) => (
                            <Card key={project.project_id} className="relative hover:shadow-lg transition-shadow border-slate-200 h-full flex flex-col bg-white">
                                <CardHeader className="pb-2">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-1">
                                            <CardTitle className="text-xl font-bold line-clamp-1 pr-2">{project.project_name}</CardTitle>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <Badge variant={project.status === 'Execution' ? 'default' : 'secondary'} className={project.status === 'Execution' ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}>
                                                {project.status}
                                            </Badge>
                                            {canWrite && (
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" className="h-8 w-8 p-0 text-gray-500 hover:text-gray-900">
                                                            <span className="sr-only">Open menu</span>
                                                            <MoreVertical className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="bg-white border-slate-200 shadow-md">
                                                        <DropdownMenuItem onClick={() => handleEditProject(project)} className="cursor-pointer text-slate-700 hover:bg-slate-100 focus:bg-slate-100">
                                                            <Pencil className="mr-2 h-4 w-4" />
                                                            Edit
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleDeleteClick(project)} className="cursor-pointer text-red-600 hover:bg-red-50 focus:bg-red-50">
                                                            <Trash className="mr-2 h-4 w-4" />
                                                            Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            )}
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="flex-1 mt-2">
                                    <div className="flex items-center text-gray-500 text-sm mt-2">
                                        <MapPin className="h-4 w-4 mr-1 text-gray-400" />
                                        {project.location || "Unknown Location"}
                                    </div>
                                </CardContent>
                                <CardFooter className="pt-4 border-t bg-gray-50/50 rounded-b-lg">
                                    <Link href={`/projects/${project.project_id}`} className="w-full">
                                        <Button className="w-full bg-blue-600 text-white hover:bg-blue-700">
                                            View Dashboard
                                        </Button>
                                    </Link>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                )
            }
        </div >
    );
}
