// src/components/SessionView/SessionHeader.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import {
    ArrowLeftIcon,
    BookmarkIcon,
    CalendarIcon,
    Pencil1Icon,
    PersonIcon,
    BadgeIcon,
} from '@radix-ui/react-icons';
import type { Session } from '../../types';
import { getBadgeClasses } from '../../helpers';
import { cn } from '../../utils';

interface SessionHeaderProps {
    session: Session;
    onEditDetailsClick: () => void;
    onNavigateBack: () => void;
}

const renderHeaderDetail = (
    IconComponent: React.ElementType,
    value: string | undefined,
    label: string,
    category?: 'session' | 'therapy'
) => {
    if (!value) return null;
    const isBadge = category === 'session' || category === 'therapy';
    const badgeClasses = isBadge ? getBadgeClasses(value, category) : '';

    return (
        <div className="flex items-center space-x-1" title={label}>
            <IconComponent className={cn("h-3.5 w-3.5 flex-shrink-0", isBadge ? "text-inherit" : "text-gray-400 dark:text-gray-500")} aria-hidden="true" />
            <span className={cn("text-xs capitalize", isBadge ? badgeClasses : "text-gray-600 dark:text-gray-400")}>
                {value}
            </span>
        </div>
    );
};


export function SessionHeader({ session, onEditDetailsClick, onNavigateBack }: SessionHeaderProps) {
    const displayTitle = session.sessionName || session.fileName;

    return (
        <div className="sticky top-0 z-10 flex-shrink-0 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm flex items-center justify-between gap-6">
            {/* Back Button */}
            <div className="flex-shrink-0">
                <Button
                    onClick={onNavigateBack}
                    variant="ghost"
                    size="sm"
                    icon={ArrowLeftIcon}
                    className="text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 p-1"
                >
                    Back
                </Button>
            </div>

            {/* Title and Details */}
            <div className="flex flex-col items-center text-center flex-grow min-w-0 px-4">
                <h1 className="truncate text-lg font-bold text-gray-900 dark:text-gray-100" title={displayTitle}>
                    {displayTitle}
                </h1>
                <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 bg-gray-50 dark:bg-gray-800/50 rounded-md py-0.5 px-2 text-xs">
                     {renderHeaderDetail(PersonIcon, session.clientName, "Client")}
                     {renderHeaderDetail(CalendarIcon, session.date, "Date")}
                     {renderHeaderDetail(BadgeIcon, session.sessionType, "Session Type", 'session')}
                     {renderHeaderDetail(BookmarkIcon, session.therapy, "Therapy Type", 'therapy')}
                </div>
            </div>

            {/* Edit Button */}
            <div className="flex-shrink-0">
                <Button
                    variant="secondary"
                    size="sm"
                    icon={Pencil1Icon}
                    onClick={onEditDetailsClick}
                    disabled={!session} // Should always have session if rendered
                    className="bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:hover:bg-blue-900 dark:text-blue-200"
                >
                    Edit Details
                </Button>
            </div>
        </div>
    );
}
