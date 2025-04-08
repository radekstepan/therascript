import React from 'react';
import { useAtomValue, useSetAtom, useAtom } from 'jotai'; // Import useAtom
import { useNavigate } from 'react-router-dom';
import { History, PlusCircle, FileText, ChevronUp, ChevronDown } from './icons/Icons'; // Add sort icons
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import {
    // pastSessionsAtom, // No longer directly used for display
    openUploadModalAtom,
    sortedSessionsAtom, // Use the sorted atom
    sessionSortCriteriaAtom, // Read current sort criteria
    sessionSortDirectionAtom, // Read current sort direction
    setSessionSortAtom, // Action to set sorting
    SessionSortCriteria // Import type
} from '../store';
import { Session } from '../types';
import { getBadgeClasses } from '../helpers';
import { cn } from '../utils'; // Import cn

export function LandingPage() {
  // const pastSessions = useAtomValue(pastSessionsAtom); // Replace with sorted
  const sortedSessions = useAtomValue(sortedSessionsAtom);
  const openUploadModal = useSetAtom(openUploadModalAtom);
  const navigate = useNavigate();

  // Get current sort state and setter action
  const currentSortCriteria = useAtomValue(sessionSortCriteriaAtom);
  const currentSortDirection = useAtomValue(sessionSortDirectionAtom);
  const setSort = useSetAtom(setSessionSortAtom);

  const handleSessionClick = (sessionId: number) => {
      navigate(`/sessions/${sessionId}`);
  };

  // Helper to render sort icon
  const renderSortIcon = (criteria: SessionSortCriteria) => {
    if (currentSortCriteria !== criteria) {
      // Show a subtle placeholder/unsorted icon if desired, or nothing
       return <ChevronDown className="h-3 w-3 ml-1 text-gray-300 dark:text-gray-600 invisible group-hover:visible" />; // Example: Dimmed, appears on hover
    }
    if (currentSortDirection === 'asc') {
      return <ChevronUp className="h-4 w-4 ml-1 text-gray-600 dark:text-gray-400" />;
    }
    return <ChevronDown className="h-4 w-4 ml-1 text-gray-600 dark:text-gray-400" />;
  };

  // Helper for header cell props and click handler
  const getHeaderCellProps = (criteria: SessionSortCriteria) => ({
    scope: "col" as const, // Ensure TS knows it's a valid scope value
    className: "group px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50",
    onClick: () => setSort(criteria),
  });

  return (
    <div className="w-full max-w-4xl mx-auto flex-grow flex flex-col p-4 md:p-6 lg:p-8">
       <Card className="flex-grow flex flex-col overflow-hidden h-full">
            <CardHeader className="flex-row items-center justify-between mb-4 px-4 pt-4 pb-2 sm:px-6">
                 <h2 className="text-xl font-semibold flex items-center text-gray-900 dark:text-gray-100">
                    Session History
                 </h2>
                 <Button
                     variant="light" size="sm" onClick={openUploadModal}
                     title="Upload New Session" aria-label="Upload New Session" icon={PlusCircle}
                 >
                     New Session
                 </Button>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col overflow-hidden p-0">
                {/* Use sortedSessions.length */}
                {sortedSessions.length === 0 ? (
                    <div className="flex-grow flex items-center justify-center p-6 text-center">
                         <p className="text-gray-600 dark:text-gray-400">
                            No sessions found. Upload one to get started!
                         </p>
                    </div>
                ) : (
                    <div className="flex-grow overflow-y-auto border-t border-gray-200 dark:border-gray-700">
                         <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-800">
                                <tr>
                                    {/* Apply props and render icon for sortable headers */}
                                    {/* Use cn to merge base classes with sm:px-6 */}
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
                            {/* Use sortedSessions in map */}
                            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                                {sortedSessions.map((session: Session) => (
                                    <tr
                                        key={session.id}
                                        onClick={() => handleSessionClick(session.id)}
                                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                                        aria-label={`Load session: ${session.sessionName || session.fileName}`}
                                        role="link"
                                        tabIndex={0}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSessionClick(session.id)}
                                    >
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 sm:px-6">
                                            <div className="flex items-center space-x-2">
                                                 <FileText className="h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true"/>
                                                 <span className="font-medium truncate">{session.sessionName || session.fileName}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {session.clientName || 'No Client'}
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
                                            {session.date || 'N/A'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    </div>
  );
}
