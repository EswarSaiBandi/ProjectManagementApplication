'use client';

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
    File, Image, StickyNote, ListTodo, Percent, Triangle, FileText, ShoppingBag, Box, Activity, PieChart, Users, Banknote, ClipboardCheck, Sparkles, Info, Package, Recycle, ArrowDownUp, Calculator
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import FinancialTab from "@/components/project-tabs/FinancialTab";
import ActivitiesTab from "@/components/project-tabs/ActivitiesTab";
import ClientProgressTab from "@/components/project-tabs/ClientProgressTab";
import FilesTab from "@/components/project-tabs/FilesTab";
import MoodboardTab from "@/components/project-tabs/MoodboardTab";
import NotesTab from "@/components/project-tabs/NotesTab";
import TasksTab from "@/components/project-tabs/TasksTab";
import QuotesTab from "@/components/project-tabs/QuotesTab";
import OrdersTab from "@/components/project-tabs/OrdersTab";
import InvoicesTab from "@/components/project-tabs/InvoicesTab";
import MaterialRequestTab from "@/components/project-tabs/MaterialRequestTab";
import ProjectInventoryTab from "@/components/project-tabs/ProjectInventoryTab";
import StockUsedTab from "@/components/project-tabs/StockUsedTab";
import ManpowerTab from "@/components/project-tabs/ManpowerTab";
import ChecklistsTab from "@/components/project-tabs/ChecklistsTab";
import DetailsTab from "@/components/project-tabs/DetailsTab";
import ExcessMaterialsTab from "@/components/project-tabs/ExcessMaterialsTab";
import MaterialMovementsTab from "@/components/project-tabs/MaterialMovementsTab";
import ProjectCostingTab from "@/components/project-tabs/ProjectCostingTab";
import ProjectMembersTab from "@/components/project-tabs/ProjectMembersTab";
import { useRole } from "@/hooks/useRole";

export default function ProjectDetailsPage({ params }: { params: { id: string } }) {
    const { role, isClient, loading: roleLoading } = useRole();
    const [activeTab, setActiveTab] = useState('activities');

    // Set default tab once role is known
    useEffect(() => {
        if (role === 'Admin') setActiveTab('project-costing');
    }, [role]);
    const [project, setProject] = useState<any>({
        name: "Loading...",
        code: "...",
        status: "...",
    });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchProjectData = async () => {
            console.log("Fetching project...", params.id);
            const { data: projectData, error: projectError } = await supabase
                .from('projects')
                .select('*')
                .eq('project_id', params.id)
                .single();

            if (projectError) {
                console.error("Error fetching project:", projectError);
                setError(projectError.message);
                setProject({ name: "Error", code: "ERR", status: "Error" });
                return;
            }

            if (projectData) {
                console.log("Project loaded:", projectData);
                setProject({
                    name: projectData.project_name,
                    code: `P-${projectData.project_id}`,
                    status: projectData.status,
                });
            } else {
                console.warn("No project data found for ID:", params.id);
                setProject({ name: "Not Found", code: "N/A", status: "Unknown" });
            }
        };
        fetchProjectData();
    }, [params.id]);

    if (error) {
        return <div className="p-10 text-red-600">Failed to load project: {error}</div>;
    }

    // Tabs visible per role
    const allTabs = [
        { label: "Project Costing",    icon: Calculator,    value: "project-costing",      roles: ['Admin'] },
        { label: "Financials",         icon: Banknote,      value: "financials",            roles: ['Admin','ProjectManager'] },
        { label: "Inventory",          icon: Package,       value: "inventory",             roles: ['Admin','ProjectManager','SiteSupervisor'] },
        { label: "Material Movements", icon: ArrowDownUp,   value: "material-movements",    roles: ['Admin','ProjectManager','SiteSupervisor'] },
        { label: "Stock Used",         icon: Box,           value: "stock-used",            roles: ['Admin','ProjectManager','SiteSupervisor'] },
        { label: "Excess Materials",   icon: Recycle,       value: "excess-materials",      roles: ['Admin','ProjectManager','SiteSupervisor'] },
        { label: "Manpower",           icon: Users,         value: "manpower",              roles: ['Admin','ProjectManager','SiteSupervisor'] },
        { label: "Activities",         icon: Activity,      value: "activities",            roles: ['Admin','ProjectManager','SiteSupervisor','Client'] },
        { label: "Client Progress",    icon: PieChart,      value: "client-progress",       roles: ['Admin','ProjectManager','SiteSupervisor','Client'] },
        { label: "Tasks",              icon: ListTodo,      value: "tasks",                 roles: ['Admin','ProjectManager','SiteSupervisor','Client'] },
        { label: "Quotes",             icon: Percent,       value: "quotes",                roles: ['Admin','ProjectManager'] },
        { label: "Orders",             icon: Triangle,      value: "orders",                roles: ['Admin','ProjectManager'] },
        { label: "Invoices",           icon: FileText,      value: "invoices",              roles: ['Admin','ProjectManager'] },
        { label: "Material Request",   icon: ShoppingBag,   value: "purchase-request",      roles: ['Admin','ProjectManager','SiteSupervisor'] },
        { label: "Checklists",         icon: ClipboardCheck,value: "checklists",            roles: ['Admin','ProjectManager','SiteSupervisor','Client'] },
        { label: "Files",              icon: File,          value: "files",                 roles: ['Admin','ProjectManager','SiteSupervisor','Client'] },
        { label: "Moodboard",          icon: Image,         value: "moodboard",             roles: ['Admin','ProjectManager','SiteSupervisor','Client'] },
        { label: "Notes",              icon: StickyNote,    value: "notes",                 roles: ['Admin','ProjectManager','SiteSupervisor'] },
        { label: "StudioAI",           icon: Sparkles,      value: "studio-ai",             roles: ['Admin','ProjectManager'], special: true },
        { label: "Details",            icon: Info,          value: "details",               roles: ['Admin','ProjectManager','SiteSupervisor','Client'] },
        { label: "Members",            icon: Users,         value: "members",               roles: ['Admin','ProjectManager'] },
    ];

    const tabs = roleLoading || !role
        ? []
        : allTabs.filter(t => t.roles.includes(role));

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight break-words">{project.name}</h1>
                        <Badge variant="secondary" className="text-sm px-3 py-1 bg-gray-200 text-gray-700">{project.code}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                        <span className="text-sm text-gray-500">Status:</span>
                        <Badge variant="success" className="bg-green-100 text-green-700 border-green-200">{project.status}</Badge>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                {/* Wrapping Tab List */}
                <div className="w-full mb-6 overflow-x-auto">
                    <TabsList className="w-max min-w-full flex h-auto gap-2 sm:gap-4 bg-transparent p-0 justify-start">
                        {tabs.map((tab) => (
                            <TabsTrigger
                                key={tab.value}
                                value={tab.value}
                                className={cn(
                                    "rounded-none border-b-2 border-transparent px-2 py-2 gap-1.5 sm:gap-2 data-[state=active]:shadow-none transition-all whitespace-nowrap text-xs sm:text-sm",
                                    tab.special
                                        ? "bg-purple-600 text-white hover:bg-purple-700 rounded-md border-b-0 px-4 py-2 data-[state=active]:bg-purple-700 data-[state=active]:text-white font-semibold"
                                        : "text-gray-500 hover:text-gray-900 data-[state=active]:border-blue-600 data-[state=active]:text-blue-600"
                                )}
                            >
                                <tab.icon className={cn("h-4 w-4", tab.special ? "text-white" : "")} />
                                {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>

                <div className="space-y-6">
                    {/* Project Modules */}
                    {activeTab === 'project-costing' && <ProjectCostingTab projectId={params.id} />}
                    {activeTab === 'financials' && <FinancialTab projectId={params.id} />}
                    {activeTab === 'inventory' && <ProjectInventoryTab projectId={params.id} />}
                    {activeTab === 'material-movements' && <MaterialMovementsTab projectId={params.id} />}
                    {activeTab === 'stock-used' && <StockUsedTab projectId={params.id} />}
                    {activeTab === 'excess-materials' && <ExcessMaterialsTab projectId={params.id} />}
                    {activeTab === 'manpower' && <ManpowerTab projectId={params.id} />}
                    {activeTab === 'activities' && <ActivitiesTab projectId={params.id} readOnly={isClient} />}
                    {activeTab === 'client-progress' && <ClientProgressTab projectId={params.id} readOnly={isClient} />}
                    {activeTab === 'tasks' && <TasksTab projectId={params.id} readOnly={isClient} />}
                    {activeTab === 'quotes' && <QuotesTab projectId={params.id} />}
                    {activeTab === 'orders' && <OrdersTab projectId={params.id} />}
                    {activeTab === 'invoices' && <InvoicesTab projectId={params.id} />}
                    {activeTab === 'purchase-request' && <MaterialRequestTab projectId={params.id} />}
                    {activeTab === 'checklists' && <ChecklistsTab projectId={params.id} readOnly={isClient} />}
                    {activeTab === 'files' && <FilesTab projectId={params.id} readOnly={isClient} />}
                    {activeTab === 'moodboard' && <MoodboardTab projectId={params.id} readOnly={isClient} />}
                    {activeTab === 'notes' && <NotesTab projectId={params.id} />}
                    {activeTab === 'details' && <DetailsTab projectId={params.id} readOnly={isClient} />}
                    {activeTab === 'members' && <ProjectMembersTab projectId={params.id} />}

                    {/* Placeholder for unimplemented tabs */}
                    {tabs.filter(t =>
                        ![
                            'project-costing','financials','inventory','material-movements',
                            'stock-used','excess-materials','manpower','activities',
                            'client-progress','tasks','quotes','orders','invoices',
                            'purchase-request','checklists','files','moodboard','notes',
                            'details','members'
                        ].includes(t.value)
                    ).map(tab => (
                        activeTab === tab.value && (
                            <div key={tab.value} className="min-h-[200px] flex items-center justify-center border rounded-lg border-dashed">
                                <div className="text-center text-muted-foreground">
                                    <tab.icon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                    <p>{tab.label} Module Coming Soon</p>
                                </div>
                            </div>
                        )
                    ))}
                </div>
            </Tabs>
        </div>
    );
}
