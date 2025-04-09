// src/components/LandingPage/SessionListTable.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    FileTextIcon,
    ChevronUpIcon,
    ChevronDownIcon
} from '@radix-ui/react-icons';
import type { Session } from '../../types';
import type { SessionSortCriteria, SortDirection } from '../../store'; // Import types
import { getBadgeClasses } from '../../helpers';
import { cn } from '../../utils';

interface SessionListTableProps {
    sessions: Session[];
    sortCriteria: SessionSortCriteria;
    sortDirection: SortDirection;
    onSort: (criteria: SessionSortCriteria) => void;
}

// Define the specific allowed values for aria-sort
type AriaSort = 'none' | 'ascending' | 'descending' | 'other' | undefined;

export function SessionListTable({ sessions, sortCriteria, sortDirection, onSort }: SessionListTableProps) {
    const navigate = useNavigate();

    const handleSessionClick = (sessionId: number) => {
        navigate(`/sessions/${sessionId}`);
    };

    const renderSortIcon = (criteria: SessionSortCriteria) => {
        if (sortCriteria !== criteria) {
            // Subtle icon visible on hover for non-active columns
            return <ChevronDownIcon className="h-3 w-3 ml-1 text-gray-400 dark:text-gray-500 invisible group-hover:visible" />;
        }
        // Active sort column icon
        if (sortDirection === 'asc') {
            return <ChevronUpIcon className="h-4 w-4 ml-1 text-gray-700 dark:text-gray-300" />;
        }
        return <ChevronDownIcon className="h-4 w-4 ml-1 text-gray-700 dark:text-gray-300" />;
    };

    // Updated getHeaderCellProps function
    const getHeaderCellProps = (criteria: SessionSortCriteria): React.ThHTMLAttributes<HTMLTableHeaderCellElement> => {
        const isActiveSortColumn = sortCriteria === criteria;
        // Calculate the aria-sort value and ensure it matches the AriaSort type
        const sortValue: AriaSort = isActiveSortColumn
            ? (sortDirection === 'asc' ? 'ascending' : 'descending')
            : 'none';

        return {
            scope: "col",
            className: "group px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors duration-150",
            onClick: () => onSort(criteria),
            'aria-sort': sortValue, // Use the correctly typed variable
        };
    };

    return (
        <div className="flex-grow overflow-y-auto border-t border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10"> {/* Sticky header */}
                    <tr>
                        {/* Spread the result of the updated function */}
                        <th {...getHeaderCellProps('sessionName')} className={cn(getHeaderCellProps('sessionName').className, "sm:px-6")}>
                            <div className="flex items-center">Session / File {renderSortIcon('sessionName')}</div>
                        </th>
                        <th {...getHeaderCellProps('clientName')}>
                            <div className="flex items-center">Client {renderSortIcon('clientName')}</div>
                        </th>
                        <th {...getHeaderCellProps('sessionType')}>
                            <div className="flex items-center">Type {renderSortIcon('sessionType')}</div>
                        </th>
                        <th {...getHeaderCellProps('therapy')}>
                            <div className="flex items-center">Therapy {renderSortIcon('therapy')}</div>
                        </th>
                        <th {...getHeaderCellProps('date')}>
                            <div className="flex items-center">Date {renderSortIcon('date')}</div>
                        </th>
                    </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                    {sessions.map((session: Session) => (
                        <tr
                            key={session.id}
                            onClick={() => handleSessionClick(session.id)}
                            className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors duration-150"
                            aria-label={`Load session: ${session.sessionName || session.fileName}`}
                            role="link"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && handleSessionClick(session.id)}
                        >
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 sm:px-6">
                                <div className="flex items-center space-x-2">
                                    <FileTextIcon className="h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
                                    <span className="font-medium truncate">{session.sessionName || session.fileName}</span>
                                </div>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                {session.clientName || <span className="italic text-gray-400 dark:text-gray-500">No Client</span>}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm">
                                {session.sessionType ? (
                                    <span className={getBadgeClasses(session.sessionType, 'session')}>
                                        {session.sessionType}
                                    </span>
                                ) : (
                                    <span className="text-gray-400 dark:text-gray-500">N/A</span>
                                )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm">
                                {session.therapy ? (
                                    <span className={getBadgeClasses(session.therapy, 'therapy')}>
                                        {session.therapy}
                                    </span>
                                ) : (
                                    <span className="text-gray-400 dark:text-gray-500">N/A</span>
                                )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                {session.date || <span className="italic text-gray-400 dark:text-gray-500">No Date</span>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
