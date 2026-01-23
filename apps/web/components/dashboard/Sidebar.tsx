'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FolderKanban, CalendarDays, Users, ListTodo, PieChart, Layers, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const NAV_ITEMS = [
    { label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
    { label: 'Projects', icon: FolderKanban, href: '/projects' },
    { label: 'Schedule', icon: CalendarDays, href: '/schedule' },
    { label: 'Team', icon: Users, href: '/team' },
    { label: 'Tasks', icon: ListTodo, href: '/tasks' },
    { label: 'Reports', icon: PieChart, href: '/reports' },
    { label: 'Inventory', icon: Layers, href: '/inventory' },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <TooltipProvider delayDuration={0}>
            <div className="flex h-screen w-16 flex-col border-r bg-white items-center py-4">
                {/* Logo Placeholder - Could be a small icon */}
                <div className="mb-6 h-8 w-8 rounded-full bg-blue-900 flex items-center justify-center text-white font-bold text-xs">
                    PS
                </div>

                <nav className="flex-1 flex flex-col gap-2 w-full px-2">
                    {NAV_ITEMS.map((item) => {
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
                    })}
                </nav>

                {/* Settings at the bottom */}
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
            </div>
        </TooltipProvider>
    );
}
