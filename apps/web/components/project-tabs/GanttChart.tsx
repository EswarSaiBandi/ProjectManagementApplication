import React from 'react';
import { cn } from "@/lib/utils";
import { format, addDays, min, max, parseISO, isValid, differenceInDays } from 'date-fns';

type Activity = {
    activity_id: number;
    activity_name: string;
    start_date: string;
    end_date: string;
    progress: number;
};

interface GanttChartProps {
    activities: Activity[];
}

export default function GanttChart({ activities }: GanttChartProps) {
    if (!activities || activities.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-10 h-64 bg-slate-50 rounded-lg border border-dashed border-gray-300">
                <p className="text-gray-500 font-medium">No activities to display.</p>
                <p className="text-sm text-gray-400">Add activities to see the timeline.</p>
            </div>
        );
    }

    // 1. Calculate Timeline Range
    const dates = activities
        .map(a => [parseISO(a.start_date), parseISO(a.end_date)])
        .flat()
        .filter(d => isValid(d));

    if (dates.length === 0) return <div>Invalid dates</div>;

    const rawMin = min(dates);
    const rawMax = max(dates);

    // Buffer: 2 days before, 5 days after
    const startDate = addDays(rawMin, -2);
    const endDate = addDays(rawMax, 5);
    const totalDays = differenceInDays(endDate, startDate) + 1;

    // Config
    const LEFT_PANEL_WIDTH = 300;
    const MIN_DAY_WIDTH = 40; // px
    // CSS variable for min width to ensure equal distribution in flex

    const days = Array.from({ length: totalDays }, (_, i) => addDays(startDate, i));

    // 2. Helper for Bar Positioning (Percentages)
    const getBarStyle = (start: string, end: string) => {
        const startD = parseISO(start);
        const endD = parseISO(end);

        if (!isValid(startD) || !isValid(endD)) return { left: '0%', width: '0%' };

        const offsetDays = differenceInDays(startD, startDate);
        const durationDays = differenceInDays(endD, startD) + 1;

        const left = (offsetDays / totalDays) * 100;
        const width = (durationDays / totalDays) * 100;

        return { left: `${left}%`, width: `${width}%` };
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-lg shadow-sm overflow-hidden border border-gray-200 w-full">

            {/* Main Scrollable Container */}
            <div className="flex-1 overflow-auto relative">

                {/* -------------------- HEADER ROW (Sticky Top) -------------------- */}
                <div className="flex sticky top-0 z-30 min-w-max border-b border-gray-200 bg-slate-50 h-10 shadow-sm">

                    {/* Left Table Header (Sticky Left) */}
                    <div
                        className="sticky left-0 z-40 bg-slate-100 border-r border-gray-200 flex items-center divide-x divide-gray-200 text-xs font-bold text-slate-600 uppercase tracking-wider shrink-0 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
                        style={{ width: `${LEFT_PANEL_WIDTH}px` }}
                    >
                        <div className="flex-1 px-4 truncate">Task</div>
                        <div className="w-20 px-2 text-center shrink-0">Start</div>
                        <div className="w-20 px-2 text-center shrink-0">End</div>
                        <div className="w-12 px-1 text-center shrink-0">%</div>
                    </div>

                    {/* Timeline Header (Flexible) */}
                    {/* "min-w-full" ensures it takes full width of empty space if small, or expands if large */}
                    <div className="flex min-w-full flex-1">
                        {days.map((day, i) => (
                            <div
                                key={i}
                                className="flex flex-col items-center justify-center border-r border-gray-200 bg-slate-50 flex-1"
                                style={{ minWidth: `${MIN_DAY_WIDTH}px` }}
                            >
                                <span className="text-[9px] font-semibold text-slate-400 uppercase leading-none">{format(day, 'MMM')}</span>
                                <span className="text-[10px] font-bold text-slate-700 leading-none">{format(day, 'dd')}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* -------------------- DATA ROWS -------------------- */}
                <div className="min-w-max relative group/container">

                    {/* Grid Background Layer - Must match Header Flex Logic */}
                    <div className="absolute top-0 bottom-0 pointer-events-none z-0 flex min-w-full" style={{ left: `${LEFT_PANEL_WIDTH}px`, width: `calc(100% - ${LEFT_PANEL_WIDTH}px)` }}>
                        {days.map((_, i) => (
                            <div
                                key={i}
                                className="h-full border-r border-gray-50 border-dashed flex-1"
                                style={{ minWidth: `${MIN_DAY_WIDTH}px` }}
                            ></div>
                        ))}
                    </div>

                    {/* Activity Rows */}
                    {activities.map((activity) => {
                        const { left, width } = getBarStyle(activity.start_date, activity.end_date);
                        const progress = activity.progress || 0;
                        const startStr = isValid(parseISO(activity.start_date)) ? format(parseISO(activity.start_date), 'dd MMM') : '-';
                        const endStr = isValid(parseISO(activity.end_date)) ? format(parseISO(activity.end_date), 'dd MMM') : '-';

                        return (
                            <div key={activity.activity_id} className="flex border-b border-gray-100 hover:bg-slate-50/80 transition-colors h-12 relative group/row">

                                {/* 1. Left Table Columns - (Sticky Left) */}
                                <div
                                    className="sticky left-0 z-20 bg-white group-hover/row:bg-slate-50 border-r border-gray-200 flex items-center divide-x divide-gray-100 text-xs shrink-0 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] text-slate-600"
                                    style={{ width: `${LEFT_PANEL_WIDTH}px` }}
                                >
                                    <div className="flex-1 px-4 font-medium text-slate-800 truncate" title={activity.activity_name}>
                                        {activity.activity_name}
                                    </div>
                                    <div className="w-20 px-2 text-center shrink-0 truncate">{startStr}</div>
                                    <div className="w-20 px-2 text-center shrink-0 truncate">{endStr}</div>
                                    <div className="w-12 px-1 text-center font-semibold text-blue-600 shrink-0">{progress}%</div>
                                </div>

                                {/* 2. Timeline Bar Area */}
                                {/* Must match Header Layout: flex-1, min-w-full logic */}
                                <div className="relative z-10 flex-1 min-w-full">
                                    {/* 
                                        TRICKY: 
                                        We need absolute positioning relative to THIS container.
                                        BUT this container expands based on children (grid lines) or needs to match header.
                                        The Grid Background Layer above handles the visual grid.
                                        This div is just the canvas for the bar.
                                        It needs to exactly match the width of the grid area.
                                     */}

                                    {/* 
                                         Solution: 
                                         We are in a flex-row with the Left Fixed Panel.
                                         The remaining space is this div.
                                         This div essentially mimics the header's right side.
                                     */}

                                    {/* 
                                        Wait, absolute positioning 'left: %' works on the container width.
                                        If the container width is determined by 'flex-1 min-w-[total * 40]', then it matches the header.
                                     */}

                                    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                                        {/* We need an invisible spacer to force width? No, the background grid defines the width of the parent 'min-w-max' container? 
                                              Actually, the header forces the 'min-w-max' container width.
                                              So simply taking 100% of available width here is correct.
                                          */}
                                        <div
                                            className="absolute top-3 h-6 rounded flex overflow-hidden shadow-sm hover:shadow-md cursor-pointer group/bar transition-all"
                                            style={{ left, width }}
                                        >
                                            {/* Green Progress */}
                                            <div
                                                className="bg-green-500 h-full flex items-center justify-end pr-2 text-[9px] font-bold text-white whitespace-nowrap overflow-hidden"
                                                style={{ width: `${progress}%` }}
                                            >
                                                {progress >= 20 && `${progress}%`}
                                            </div>

                                            {/* Blue Remaining */}
                                            <div className="bg-blue-400 h-full flex-1"></div>

                                            {/* Hover Tooltip */}
                                            <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-xl border border-gray-700">
                                                <span className="font-semibold">{activity.activity_name}</span>
                                                <span className="text-gray-300 ml-1">
                                                    {startStr} - {endStr}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
