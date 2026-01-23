'use client';

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
    File, Image, StickyNote, ListTodo, Percent, Triangle, FileText, ShoppingBag, Box, Activity, PieChart, Users, Banknote, ClipboardCheck, Sparkles, Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import FinancialTab from "@/components/project-tabs/FinancialTab";
import ActivitiesTab from "@/components/project-tabs/ActivitiesTab";
import ClientProgressTab from "@/components/project-tabs/ClientProgressTab";

export default function ProjectDetailsPage({ params }: { params: { id: string } }) {
    const [activeTab, setActiveTab] = useState("financials");
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

    const tabs = [
        { label: "Files", icon: File, value: "files" },
        { label: "Moodboard", icon: Image, value: "moodboard" },
        { label: "Notes", icon: StickyNote, value: "notes" },
        { label: "Tasks", icon: ListTodo, value: "tasks" },
        { label: "Quotes", icon: Percent, value: "quotes" },
        { label: "Orders", icon: Triangle, value: "orders" },
        { label: "Invoices", icon: FileText, value: "invoices" },
        { label: "Purchase Request", icon: ShoppingBag, value: "purchase-request" },
        { label: "Inventory", icon: Box, value: "inventory" },
        { label: "Activities", icon: Activity, value: "activities" },
        { label: "Client Progress", icon: PieChart, value: "client-progress" },
        { label: "Manpower", icon: Users, value: "manpower" },
        { label: "Financials", icon: Banknote, value: "financials" },
        { label: "Checklists", icon: ClipboardCheck, value: "checklists" },
        { label: "StudioAI", icon: Sparkles, value: "studio-ai", special: true },
        { label: "Details", icon: Info, value: "details" },
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
                        <Badge variant="secondary" className="text-sm px-3 py-1 bg-gray-200 text-gray-700">{project.code}</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                        <span className="text-sm text-gray-500">Status:</span>
                        <Badge variant="success" className="bg-green-100 text-green-700 border-green-200">{project.status}</Badge>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                {/* Wrapping Tab List */}
                <div className="w-full mb-6">
                    <TabsList className="w-full flex flex-wrap h-auto gap-4 bg-transparent p-0 justify-start">
                        {tabs.map((tab) => (
                            <TabsTrigger
                                key={tab.value}
                                value={tab.value}
                                className={cn(
                                    "rounded-none border-b-2 border-transparent px-2 py-2 gap-2 data-[state=active]:shadow-none transition-all",
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
                    {/* Financials Tab Content */}
                    {activeTab === 'financials' && <FinancialTab projectId={params.id} />}

                    {/* Placeholder for other tabs (Coming Soon) */}
                    {tabs.filter(t => t.value !== 'financials' && t.value !== 'activities' && t.value !== 'client-progress').map(tab => (
                        activeTab === tab.value && (
                            <div key={tab.value} className="min-h-[200px] flex items-center justify-center border rounded-lg border-dashed">
                                <div className="text-center text-muted-foreground">
                                    <tab.icon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                    <p>{tab.label} Module Coming Soon</p>
                                </div>
                            </div>
                        )
                    ))}

                    {/* Activities Tab Content */}
                    {activeTab === 'activities' && <ActivitiesTab projectId={params.id} />}

                    {/* Client Progress Tab Content */}
                    {activeTab === 'client-progress' && <ClientProgressTab projectId={params.id} />}
                </div>
            </Tabs>
        </div>
    );
}
