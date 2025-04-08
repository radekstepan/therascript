import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { History, PlusCircle, FileText } from './icons/Icons';
import { Button } from './ui/Button'; // Import new Button
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card'; // Import new Card
import { pastSessionsAtom, openUploadModalAtom } from '../store';
import { Session } from '../types';
import { cn } from '../utils'; // Import cn

// Helper function to get Tailwind badge classes
const getBadgeClasses = (type?: string, category: 'session' | 'therapy' = 'session'): string => {
    const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize"; // Base classes
    let colorClasses = "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"; // Default

    const typeLower = type?.toLowerCase();

    if (category === 'session') {
        switch(typeLower){
            case 'individual': colorClasses = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'; break;
            case 'phone': colorClasses = 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200'; break;
            case 'skills group': colorClasses = 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200'; break;
            case 'family session': colorClasses = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'; break;
            case 'couples': colorClasses = 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200'; break;
        }
    } else { // therapy
         switch(typeLower){
            case 'act': colorClasses = 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'; break;
            case 'dbt': colorClasses = 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'; break;
            case 'cbt': colorClasses = 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200'; break;
            case 'erp': colorClasses = 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200'; break;
            case 'mindfulness': colorClasses = 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200'; break;
        }
    }
    return cn(base, colorClasses);
}

export function LandingPage() {
  const pastSessions = useAtomValue(pastSessionsAtom);
  const openUploadModal = useSetAtom(openUploadModalAtom);
  const navigate = useNavigate();

  const handleSessionClick = (sessionId: number) => {
      navigate(`/sessions/${sessionId}`);
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex-grow flex flex-col p-4 md:p-6 lg:p-8">
       {/* Use new Card */}
       <Card className="flex-grow flex flex-col overflow-hidden h-full">
            {/* Use CardHeader for padding and layout */}
            <CardHeader className="flex-row items-center justify-between mb-4 px-4 pt-4 pb-2 sm:px-6"> {/* Adjusted padding */}
                 {/* Use CardTitle or a simple h2/span */}
                 <h2 className="text-xl font-semibold flex items-center text-gray-900 dark:text-gray-100">
                    <History className="mr-2 h-5 w-5 text-gray-600 dark:text-gray-400" aria-hidden="true" />
                    Session History
                 </h2>
                 <Button
                     variant="light" // Use appropriate variant
                     size="sm"
                     onClick={openUploadModal}
                     title="Upload New Session" // Use title for tooltip
                     aria-label="Upload New Session"
                     icon={PlusCircle}
                 >
                     New Session
                 </Button>
            </CardHeader>
            {/* Use CardContent for the main area */}
            <CardContent className="flex-grow flex flex-col overflow-hidden p-0"> {/* Remove padding if table handles it */}
                {pastSessions.length === 0 ? (
                    <div className="flex-grow flex items-center justify-center p-6 text-center">
                         {/* Use p element */}
                         <p className="text-gray-600 dark:text-gray-400">
                            No sessions found. Upload one to get started!
                         </p>
                    </div>
                ) : (
                    <div className="flex-grow overflow-y-auto border-t border-gray-200 dark:border-gray-700">
                         {/* Use standard HTML Table with Tailwind styling */}
                         <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-800">
                                <tr>
                                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sm:px-6">Session / File</th>
                                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Client</th>
                                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Type</th>
                                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Therapy</th>
                                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Date</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                                {pastSessions.map((session: Session) => (
                                    <tr
                                        key={session.id}
                                        onClick={() => handleSessionClick(session.id)}
                                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                                        aria-label={`Load session: ${session.sessionName || session.fileName}`}
                                        role="link"
                                        tabIndex={0} // Make it focusable
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
