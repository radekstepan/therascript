import React from 'react';
// Import UI Components
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { ScrollArea } from './ui/ScrollArea';
// Import Icons
import { History, PlusCircle, FileText } from './icons/Icons';
// Import Types
import type { LandingPageProps } from '../types';

export function LandingPage({ pastSessions, navigateToSession, openUploadModal }: LandingPageProps) {
  return (
    // Use flex-grow to take available vertical space
    <div className="w-full max-w-4xl mx-auto flex-grow flex flex-col">
       {/* Card takes remaining space */}
       <Card className="flex-grow flex flex-col overflow-hidden"> {/* Added overflow-hidden */}
            <CardHeader className="flex-shrink-0 border-b"> {/* Added border */}
                <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center">
                        <History className="mr-2 h-5 w-5 text-blue-600" /> Session History
                    </div>
                    {/* Upload Button */}
                    <Button
                         variant="ghost"
                         size="icon"
                         onClick={openUploadModal}
                         title="Upload New Session"
                         aria-label="Upload New Session"
                     >
                         <PlusCircle className="h-6 w-6 text-blue-600"/>
                    </Button>
                </CardTitle>
            </CardHeader>
            {/* Content area handles scrolling */}
            <CardContent className="flex-grow flex flex-col space-y-2 overflow-hidden p-0"> {/* Removed padding, handled by ScrollArea inner div */}
                {pastSessions.length === 0 ? (
                     // Centered placeholder text
                    <div className="flex-grow flex items-center justify-center p-4">
                         <p className="text-center text-gray-500 py-4">
                            No sessions found. Upload one to get started!
                        </p>
                    </div>
                ) : (
                    // Layout for session list
                    <div className="flex-grow flex flex-col overflow-hidden p-4 space-y-3"> {/* Padding here */}
                        <p className="text-sm text-gray-500 flex-shrink-0">
                            Select a session to view its details and analysis.
                        </p>
                        {/* Scrollable list container */}
                        <div className="flex-grow overflow-hidden border rounded-md"> {/* Border around scroll */}
                             <ScrollArea className="h-full"> {/* ScrollArea takes full height */}
                                <ul className="space-y-1 p-1"> {/* Padding inside ScrollArea */}
                                    {pastSessions.map((session) => (
                                        <li key={session.id}>
                                            <Button
                                                variant="ghost"
                                                onClick={() => navigateToSession(session.id)}
                                                className="w-full justify-between text-left h-auto py-2 px-3 text-gray-700 hover:bg-gray-100"
                                                title={`Load: ${session.sessionName || session.fileName}`}
                                            >
                                                {/* Left side: Icon, Name, Client */}
                                                <div className="flex items-center space-x-3 overflow-hidden mr-2"> {/* Added margin */}
                                                    <FileText className="h-5 w-5 flex-shrink-0 text-gray-500"/>
                                                    <div className="flex flex-col overflow-hidden">
                                                        <span className="font-medium truncate">{session.sessionName || session.fileName}</span>
                                                        <span className="text-xs text-gray-500 truncate">
                                                             {session.clientName || 'No Client'} - <span className="capitalize">{session.sessionType}</span>
                                                         </span>
                                                    </div>
                                                </div>
                                                {/* Right side: Therapy, Date */}
                                                <div className="flex flex-col items-end flex-shrink-0 ml-2 text-right">
                                                     <span className="text-xs font-medium text-gray-600">{session.therapy || 'N/A'}</span>
                                                     <span className="text-sm text-gray-500">{session.date}</span>
                                                </div>
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            </ScrollArea>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    </div>
  );
}
