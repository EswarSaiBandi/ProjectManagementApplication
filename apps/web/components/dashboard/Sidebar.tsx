'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard, FolderKanban, CalendarDays, Users, ListTodo,
    PieChart, Layers, Settings, Target, CalendarOff, HardHat,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRole } from '@/hooks/useRole';

const ALL_NAV_ITEMS = [
    { label: 'Dashboard',  icon: LayoutDashboard, href: '/dashboard',  roles: ['Admin', 'ProjectManager', 'SiteSupervisor', 'Client'] },
    { label: 'Leads',      icon: Target,          href: '/leads',      roles: ['Admin', 'ProjectManager'] },
    { label: 'Projects',   icon: FolderKanban,    href: '/projects',   roles: ['Admin', 'ProjectManager', 'SiteSupervisor', 'Client'] },
    { label: 'Schedule',   icon: CalendarDays,    href: '/schedule',   roles: ['Admin', 'ProjectManager', 'SiteSupervisor'] },
    { label: 'Team',       icon: Users,           href: '/team',       roles: ['Admin', 'ProjectManager'] },
    { label: 'Tasks',      icon: ListTodo,        href: '/tasks',      roles: ['Admin', 'ProjectManager', 'SiteSupervisor'] },
    { label: 'Leaves',     icon: CalendarOff,     href: '/leaves',     roles: ['Admin', 'ProjectManager', 'SiteSupervisor'] },
    { label: 'Reports',    icon: PieChart,        href: '/reports',    roles: ['Admin', 'ProjectManager', 'SiteSupervisor'] },
    { label: 'Inventory',  icon: Layers,          href: '/inventory',  roles: ['Admin'] },
    { label: 'Labour',     icon: HardHat,         href: '/labour',     roles: ['Admin'] },
];

export function Sidebar() {
    const pathname = usePathname();
    const { role, loading } = useRole();

    const navItems = role
        ? ALL_NAV_ITEMS.filter(item => item.roles.includes(role))
        : null; // null = still loading

    const showSettings = role === 'Admin' || role === 'ProjectManager';

    return (
        <TooltipProvider delayDuration={0}>
            <div className="flex h-screen w-16 flex-col border-r bg-white items-center py-4">
                <div className="mb-6 h-8 w-8 rounded-full bg-blue-900 flex items-center justify-center text-white font-bold text-xs">
                    PS
                </div>

                <nav className="flex-1 flex flex-col gap-2 w-full px-2">
                    {navItems === null ? (
                        // Skeleton placeholders while role is loading
                        Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="h-10 w-10 rounded-lg bg-gray-100 animate-pulse" />
                        ))
                    ) : (
                        navItems.map((item) => {
                            const isActive = pathname.startsWith(item.href);
                            return (
                                <Tooltip key={item.href}>
                                    <TooltipTrigger asChild>
                                        <Link
                                            href={item.href}
                                            className={cn(
                                                "flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-gray-100",
                                                isActive ? "bg-blue-50 text-blue-600" : "text-gray-500"
                                            )}
                                        >
                                            <item.icon className="h-5 w-5" />
                                            <span className="sr-only">{item.label}</span>
                                        </Link>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                        <p>{item.label}</p>
                                    </TooltipContent>
                                </Tooltip>
                            );
                        })
                    )}
                </nav>

                {showSettings && (
                    <div className="mt-auto pb-4 w-full px-2 flex flex-col items-center">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Link
                                    href="/settings"
                                    className={cn(
                                        "flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-gray-100",
                                        pathname.startsWith('/settings') ? "bg-blue-50 text-blue-600" : "text-gray-500"
                                    )}
                                >
                                    <Settings className="h-5 w-5" />
                                    <span className="sr-only">Settings</span>
                                </Link>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                                <p>Settings</p>
                            </TooltipContent>
                        </Tooltip>
                    </div>
                )}
            </div>
        </TooltipProvider>
    );
}
