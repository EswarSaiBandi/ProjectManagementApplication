'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PieChart, BarChart3, TrendingUp, Download, Calendar, FileText, Users, DollarSign, Package, Activity, Printer } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

type ReportData = {
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    activeProjects: number;
    completedProjects: number;
    teamMembers: number;
    completionRate: number;
    transactions: any[];
    projects: any[];
    activities: any[];
    purchaseRequests: any[];
    teamPerformance: any[];
};

type Project = {
    project_id: number;
    project_name: string;
};

export default function ReportsPage() {
    const [reportType, setReportType] = useState('overview');
    const [dateRange, setDateRange] = useState('month');
    const [selectedProject, setSelectedProject] = useState<string>('all');
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [reportData, setReportData] = useState<ReportData>({
        totalRevenue: 0,
        totalExpenses: 0,
        netProfit: 0,
        activeProjects: 0,
        completedProjects: 0,
        teamMembers: 0,
        completionRate: 0,
        transactions: [],
        projects: [],
        activities: [],
        purchaseRequests: [],
        teamPerformance: [],
    });

    useEffect(() => {
        fetchProjects();
    }, []);

    const fetchProjects = async () => {
        const { data } = await supabase
            .from('projects')
            .select('project_id, project_name')
            .order('project_name');
        if (data) setProjects(data);
    };

    const fetchReportData = useCallback(async () => {
        try {
            setLoading(true);
            
            // Calculate date range
            const endDate = new Date();
            const endDateStr = endDate.toISOString().split('T')[0];
            const startDate = new Date();
            switch (dateRange) {
                case 'week':
                    startDate.setDate(endDate.getDate() - 7);
                    break;
                case 'month':
                    startDate.setMonth(endDate.getMonth() - 1);
                    break;
                case 'quarter':
                    startDate.setMonth(endDate.getMonth() - 3);
                    break;
                case 'year':
                    startDate.setFullYear(endDate.getFullYear() - 1);
                    break;
            }
            const startDateStr = startDate.toISOString().split('T')[0];

            // Fetch transactions
            let transactionsQuery = supabase
                .from('transactions')
                .select('*')
                .gte('transaction_date', startDateStr)
                .lte('transaction_date', endDateStr)
                .order('transaction_date', { ascending: false });

            if (selectedProject !== 'all') {
                transactionsQuery = transactionsQuery.eq('project_id', parseInt(selectedProject));
            }

            const { data: transactions, error: txError } = await transactionsQuery;
            if (txError) console.error('Transaction fetch error:', txError);

            const credits = (transactions || []).filter((t: any) => t.type === 'Credit');
            const debits = (transactions || []).filter((t: any) => t.type === 'Debit');
            const totalRevenue = credits.reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0);
            const totalExpenses = debits.reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0);
            const netProfit = totalRevenue - totalExpenses;

            // Fetch projects
            let projectsQuery = supabase
                .from('projects')
                .select('*')
                .order('created_at', { ascending: false });

            if (selectedProject !== 'all') {
                projectsQuery = projectsQuery.eq('project_id', parseInt(selectedProject));
            }

            const { data: projectsData, error: projectsError } = await projectsQuery;
            if (projectsError) console.error('Projects fetch error:', projectsError);

            const activeProjects = (projectsData || []).filter(p => ['Planning', 'Execution', 'Handover'].includes(p.status)).length;
            const completedProjects = (projectsData || []).filter(p => p.status === 'Completed').length;

            // Fetch team members
            const { count: teamMembersCount, error: profilesError } = await supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true });
            if (profilesError) console.error('Profiles fetch error:', profilesError);

            // Fetch activities
            let activitiesQuery = supabase
                .from('site_activities')
                .select('*, projects:project_id(project_name)')
                .order('start_date', { ascending: false });

            if (selectedProject !== 'all') {
                activitiesQuery = activitiesQuery.eq('project_id', parseInt(selectedProject));
            }

            const { data: activities, error: activitiesError } = await activitiesQuery;
            if (activitiesError) console.error('Activities fetch error:', activitiesError);

            const totalActivities = activities?.length || 0;
            const completedActivities = activities?.filter(a => 
                a.status?.toLowerCase().includes('completed') || a.progress >= 100
            ).length || 0;
            const completionRate = totalActivities > 0 
                ? Math.round((completedActivities / totalActivities) * 100) 
                : 0;

            // Fetch purchase requests
            let prQuery = supabase
                .from('purchase_requests')
                .select('*, projects:project_id(project_name), profiles:requester_id(full_name)')
                .order('created_at', { ascending: false });

            if (selectedProject !== 'all') {
                prQuery = prQuery.eq('project_id', parseInt(selectedProject));
            }

            const { data: purchaseRequests, error: prError } = await prQuery;
            if (prError) console.error('Purchase requests fetch error:', prError);

            // Fetch team performance (activities by owner)
            const teamPerformanceMap = new Map();
            (activities || []).forEach((activity: any) => {
                const owner = activity.owner || 'Unassigned';
                if (!teamPerformanceMap.has(owner)) {
                    teamPerformanceMap.set(owner, { name: owner, total: 0, completed: 0, inProgress: 0 });
                }
                const perf = teamPerformanceMap.get(owner);
                perf.total++;
                if (activity.status?.toLowerCase().includes('completed') || activity.progress >= 100) {
                    perf.completed++;
                } else if (activity.status?.toLowerCase().includes('progress')) {
                    perf.inProgress++;
                }
            });
            const teamPerformance = Array.from(teamPerformanceMap.values()).map(perf => ({
                ...perf,
                completionRate: perf.total > 0 ? Math.round((perf.completed / perf.total) * 100) : 0,
            }));

            setReportData({
                totalRevenue,
                totalExpenses,
                netProfit,
                activeProjects,
                completedProjects,
                teamMembers: teamMembersCount || 0,
                completionRate,
                transactions: transactions || [],
                projects: projectsData || [],
                activities: activities || [],
                purchaseRequests: purchaseRequests || [],
                teamPerformance,
            });
        } catch (error) {
            console.error('Error fetching report data:', error);
            toast.error('Failed to load report data');
        } finally {
            setLoading(false);
        }
    }, [dateRange, reportType, selectedProject]);

    useEffect(() => {
        fetchReportData();
    }, [fetchReportData]);

    const exportToCSV = (data: any[], filename: string) => {
        if (data.length === 0) {
            toast.error('No data to export');
            return;
        }

        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(','),
            ...data.map(row => headers.map(header => {
                const value = row[header];
                if (value === null || value === undefined) return '';
                if (typeof value === 'object') return JSON.stringify(value);
                return String(value).replace(/,/g, ';');
            }).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success('Report exported successfully');
    };

    const handleExportReport = () => {
        switch (reportType) {
            case 'financial':
                exportToCSV(reportData.transactions, 'financial_report');
                break;
            case 'projects':
                exportToCSV(reportData.projects, 'project_report');
                break;
            case 'team':
                exportToCSV(reportData.teamPerformance, 'team_performance_report');
                break;
            default:
                const overviewData = [
                    { Metric: 'Total Revenue', Value: `₹${reportData.totalRevenue.toLocaleString('en-IN')}` },
                    { Metric: 'Total Expenses', Value: `₹${reportData.totalExpenses.toLocaleString('en-IN')}` },
                    { Metric: 'Net Profit', Value: `₹${reportData.netProfit.toLocaleString('en-IN')}` },
                    { Metric: 'Active Projects', Value: reportData.activeProjects },
                    { Metric: 'Completed Projects', Value: reportData.completedProjects },
                    { Metric: 'Team Members', Value: reportData.teamMembers },
                    { Metric: 'Completion Rate', Value: `${reportData.completionRate}%` },
                ];
                exportToCSV(overviewData, 'overview_report');
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const getStatusColor = (status: string) => {
        const statusLower = status?.toLowerCase() || '';
        if (statusLower.includes('completed')) return 'bg-green-100 text-green-800';
        if (statusLower.includes('progress')) return 'bg-blue-100 text-blue-800';
        if (statusLower.includes('pending')) return 'bg-yellow-100 text-yellow-800';
        return 'bg-gray-100 text-gray-800';
    };

    const getStatusBarColor = (status: string) => {
        const statusLower = status?.toLowerCase() || '';
        if (statusLower.includes('completed')) return 'bg-green-500';
        if (statusLower.includes('handover')) return 'bg-indigo-500';
        if (statusLower.includes('execution') || statusLower.includes('progress')) return 'bg-blue-500';
        if (statusLower.includes('planning') || statusLower.includes('pending')) return 'bg-yellow-500';
        return 'bg-slate-400';
    };

    const renderFinancialReport = () => (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                        <TrendingUp className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">
                            ₹{new Intl.NumberFormat('en-IN').format(reportData.totalRevenue)}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                        <DollarSign className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">
                            ₹{new Intl.NumberFormat('en-IN').format(reportData.totalExpenses)}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
                        <BarChart3 className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${reportData.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            ₹{new Intl.NumberFormat('en-IN').format(reportData.netProfit)}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Transaction Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Project</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Category</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                    <TableHead>Channel</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {reportData.transactions.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                                            No transactions found
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    reportData.transactions.map((tx: any) => (
                                        <TableRow key={tx.transaction_id}>
                                            <TableCell>{new Date(tx.transaction_date).toLocaleDateString()}</TableCell>
                                            <TableCell>
                                                <Link href={`/projects/${tx.project_id}`} className="text-blue-600 hover:underline">
                                                    Project #{tx.project_id}
                                                </Link>
                                            </TableCell>
                                            <TableCell>
                                                <Badge className={tx.type === 'Credit' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                                                    {tx.type}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{tx.category || 'N/A'}</TableCell>
                                            <TableCell className="text-right font-semibold">
                                                {tx.type === 'Credit' ? '+' : '-'}₹{parseFloat(tx.amount || 0).toLocaleString('en-IN')}
                                            </TableCell>
                                            <TableCell>{tx.payment_channel || 'N/A'}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );

    const renderProjectsReport = () => (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{reportData.projects.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Active</CardTitle>
                        <Badge className="bg-blue-500">Active</Badge>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{reportData.activeProjects}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Completed</CardTitle>
                        <Badge className="bg-green-500">Completed</Badge>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{reportData.completedProjects}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Completion Rate</CardTitle>
                        <PieChart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{reportData.completionRate}%</div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Project Details</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Project Name</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Start Date</TableHead>
                                    <TableHead>Location</TableHead>
                                    <TableHead>Activities</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {reportData.projects.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                                            No projects found
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    reportData.projects.map((project: any) => {
                                        const projectActivities = reportData.activities.filter((a: any) => a.project_id === project.project_id);
                                        return (
                                            <TableRow key={project.project_id}>
                                                <TableCell>
                                                    <Link href={`/projects/${project.project_id}`} className="font-semibold text-blue-600 hover:underline">
                                                        {project.project_name}
                                                    </Link>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className={getStatusColor(project.status)}>
                                                        {project.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    {project.start_date ? new Date(project.start_date).toLocaleDateString() : 'N/A'}
                                                </TableCell>
                                                <TableCell>{project.location || 'N/A'}</TableCell>
                                                <TableCell>{projectActivities.length}</TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );

    const renderTeamReport = () => (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Team Performance</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Team Member</TableHead>
                                    <TableHead>Total Activities</TableHead>
                                    <TableHead>Completed</TableHead>
                                    <TableHead>In Progress</TableHead>
                                    <TableHead>Completion Rate</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {reportData.teamPerformance.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                                            No team performance data found
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    reportData.teamPerformance.map((perf: any, idx: number) => (
                                        <TableRow key={idx}>
                                            <TableCell className="font-semibold">{perf.name}</TableCell>
                                            <TableCell>{perf.total}</TableCell>
                                            <TableCell>
                                                <Badge className="bg-green-100 text-green-800">{perf.completed}</Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Badge className="bg-blue-100 text-blue-800">{perf.inProgress}</Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                                                        <div 
                                                            className="bg-blue-600 h-2 rounded-full" 
                                                            style={{ width: `${perf.completionRate}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-sm font-semibold">{perf.completionRate}%</span>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Activity Progress</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Activity</TableHead>
                                    <TableHead>Project</TableHead>
                                    <TableHead>Owner</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Progress</TableHead>
                                    <TableHead>Dates</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {reportData.activities.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                                            No activities found
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    reportData.activities.slice(0, 20).map((activity: any) => (
                                        <TableRow key={activity.activity_id}>
                                            <TableCell className="font-semibold">{activity.activity_name}</TableCell>
                                            <TableCell>
                                                {activity.projects?.project_name || `Project #${activity.project_id}`}
                                            </TableCell>
                                            <TableCell>{activity.owner || 'Unassigned'}</TableCell>
                                            <TableCell>
                                                <Badge className={getStatusColor(activity.status)}>
                                                    {activity.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 bg-gray-200 rounded-full h-2">
                                                        <div 
                                                            className="bg-blue-600 h-2 rounded-full" 
                                                            style={{ width: `${activity.progress || 0}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-xs">{activity.progress || 0}%</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {new Date(activity.start_date).toLocaleDateString()} - {new Date(activity.end_date).toLocaleDateString()}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );

    const renderOverview = () => (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            ₹{new Intl.NumberFormat('en-IN').format(reportData.totalRevenue)}
                        </div>
                        <p className="text-xs text-muted-foreground">Total credits in selected period</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{reportData.activeProjects}</div>
                        <p className="text-xs text-muted-foreground">Currently in progress</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Team Members</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{reportData.teamMembers}</div>
                        <p className="text-xs text-muted-foreground">Total registered users</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Completion Rate</CardTitle>
                        <PieChart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{reportData.completionRate}%</div>
                        <p className="text-xs text-muted-foreground">Activities completed</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Recent Transactions</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {reportData.transactions.slice(0, 5).map((tx: any) => (
                                <div key={tx.transaction_id} className="flex items-center justify-between p-2 border rounded">
                                    <div>
                                        <p className="font-semibold text-sm">{tx.category || 'Transaction'}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {new Date(tx.transaction_date).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <div className={`font-semibold ${tx.type === 'Credit' ? 'text-green-600' : 'text-red-600'}`}>
                                        {tx.type === 'Credit' ? '+' : '-'}₹{parseFloat(tx.amount || 0).toLocaleString('en-IN')}
                                    </div>
                                </div>
                            ))}
                            {reportData.transactions.length === 0 && (
                                <p className="text-center text-muted-foreground py-4">No transactions found</p>
                            )}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Project Status Distribution</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {['Planning', 'Execution', 'Handover', 'Completed'].map(status => {
                                const count = reportData.projects.filter((p: any) => p.status === status).length;
                                const percentage = reportData.projects.length > 0 
                                    ? Math.round((count / reportData.projects.length) * 100) 
                                    : 0;
                                return (
                                    <div key={status} className="space-y-1">
                                        <div className="flex justify-between text-sm">
                                            <span>{status}</span>
                                            <span className="font-semibold">{count} ({percentage}%)</span>
                                        </div>
                                        <div className="flex-1 bg-slate-200 dark:bg-slate-800 rounded-full h-2">
                                            <div 
                                                className={`h-2 rounded-full ${getStatusBarColor(status)}`}
                                                style={{
                                                    width: `${percentage}%`,
                                                    minWidth: count > 0 ? '6px' : undefined,
                                                }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );

    return (
        <div className="space-y-6 print:space-y-4">
            <div className="flex items-center justify-between print:hidden">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Reports</h2>
                    <p className="text-muted-foreground">View analytics and generate reports</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={handlePrint}>
                        <Printer className="mr-2 h-4 w-4" />
                        Print
                    </Button>
                    <Button onClick={handleExportReport}>
                        <Download className="mr-2 h-4 w-4" />
                        Export Report
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <Card className="print:hidden">
                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="report_type">Report Type</Label>
                            <Select value={reportType} onValueChange={setReportType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                    <SelectItem value="overview" className="bg-white hover:bg-gray-100">Overview</SelectItem>
                                    <SelectItem value="financial" className="bg-white hover:bg-gray-100">Financial</SelectItem>
                                    <SelectItem value="projects" className="bg-white hover:bg-gray-100">Projects</SelectItem>
                                    <SelectItem value="team" className="bg-white hover:bg-gray-100">Team Performance</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="date_range">Date Range</Label>
                            <Select value={dateRange} onValueChange={setDateRange}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                    <SelectItem value="week" className="bg-white hover:bg-gray-100">Last Week</SelectItem>
                                    <SelectItem value="month" className="bg-white hover:bg-gray-100">Last Month</SelectItem>
                                    <SelectItem value="quarter" className="bg-white hover:bg-gray-100">Last Quarter</SelectItem>
                                    <SelectItem value="year" className="bg-white hover:bg-gray-100">Last Year</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="project">Project Filter</Label>
                            <Select value={selectedProject} onValueChange={setSelectedProject}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white border border-gray-200 shadow-lg">
                                    <SelectItem value="all" className="bg-white hover:bg-gray-100">All Projects</SelectItem>
                                    {projects.map(project => (
                                        <SelectItem key={project.project_id} value={project.project_id.toString()} className="bg-white hover:bg-gray-100">
                                            {project.project_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {loading ? (
                <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                        Loading report data...
                    </CardContent>
                </Card>
            ) : (
                <>
                    {reportType === 'overview' && renderOverview()}
                    {reportType === 'financial' && renderFinancialReport()}
                    {reportType === 'projects' && renderProjectsReport()}
                    {reportType === 'team' && renderTeamReport()}
                </>
            )}
        </div>
    );
}
