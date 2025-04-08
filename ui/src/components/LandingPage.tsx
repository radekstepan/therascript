// src/components/LandingPage.tsx
import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { History, PlusCircle, FileText } from './icons/Icons';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { pastSessionsAtom, openUploadModalAtom } from '../store';
import { Session } from '../types';
// Importing the centralized helper function:
import { getBadgeClasses } from '../helpers';

export function LandingPage() {
  const pastSessions = useAtomValue(pastSessionsAtom);
  const openUploadModal = useSetAtom(openUploadModalAtom);
  const navigate = useNavigate();

  const handleSessionClick = (sessionId: number) => {
      navigate(`/sessions/${sessionId}`);
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex-grow flex flex-col p-4 md:p-6 lg:p-8">
       <Card className="flex-grow flex flex-col overflow-hidden h-full">
            <CardHeader className="flex-row items-center justify-between mb-4 px-4 pt-4 pb-2 sm:px-6">
                 <h2 className="text-xl font-semibold flex items-center text-gray-900 dark:text-gray-100">
                    <History className="mr-2 h-5 w-5 text-gray-600 dark:text-gray-400" aria-hidden="true" />
                    Session History
                 </h2>
                 <Button
                     variant="light"
                     size="sm"
                     onClick={openUploadModal}
                     title="Upload New Session"
                     aria-label="Upload New Session"
                     icon={PlusCircle}
                 >
                     New Session
                 </Button>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col overflow-hidden p-0">
                {pastSessions.length === 0 ? (
                    <div className="flex-grow flex items-center justify-center p-6 text-center">
                         <p className="text-gray-600 dark:text-gray-400">
                            No sessions found. Upload one to get started!
                         </p>
                    </div>
                ) : (
                    <div className="flex-grow overflow-y-auto border-t border-gray-200 dark:border-gray-700">
                         <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead className="bg-gray-50 dark:bg-gray-800">
                                {/* Table headers... */}
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
                                        tabIndex={0}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSessionClick(session.id)}
                                    >
                                        {/* Session/File and Client Cells... */}
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 sm:px-6">
                                            <div className="flex items-center space-x-2">
                                                 <FileText className="h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true"/>
                                                 <span className="font-medium truncate">{session.sessionName || session.fileName}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                                            {session.clientName || 'No Client'}
                                        </td>

                                        {/* Type Cell - USING getBadgeClasses */}
                                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                                            {session.sessionType ? (
                                                // Correctly calling the helper with category 'session'
                                                <span className={getBadgeClasses(session.sessionType, 'session')}>
                                                    {session.sessionType}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400 dark:text-gray-500">N/A</span>
                                            )}
                                        </td>

                                        {/* Therapy Cell - USING getBadgeClasses */}
                                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                                            {session.therapy ? (
                                                 // Correctly calling the helper with category 'therapy'
                                                 <span className={getBadgeClasses(session.therapy, 'therapy')}>
                                                    {session.therapy}
                                                 </span>
                                            ) : (
                                                 <span className="text-gray-400 dark:text-gray-500">N/A</span>
                                            )}
                                        </td>
                                        {/* Date Cell... */}
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
