import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom'; // Import useNavigate

// Import UI Components
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { ScrollArea } from './ui/ScrollArea';
// Import Icons
import { History, PlusCircle, FileText } from './icons/Icons';
// Import Atoms
import { pastSessionsAtom, /*navigateToSessionAtom,*/ openUploadModalAtom } from '../store'; // Remove navigateToSessionAtom

export function LandingPage() {
  const pastSessions = useAtomValue(pastSessionsAtom);
  const openUploadModal = useSetAtom(openUploadModalAtom);
  // const navigateToSessionAction = useSetAtom(navigateToSessionAtom); // Remove atom action
  const navigate = useNavigate(); // Get navigate function

  const handleSessionClick = (sessionId: number) => {
      // Use react-router's navigate function
      navigate(`/sessions/${sessionId}`);
      // The atom logic for setting activeSessionId/activeChatId will now live in SessionView's useEffect
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex-grow flex flex-col">
       <Card className="flex-grow flex flex-col overflow-hidden">
            <CardHeader className="flex-shrink-0 border-b">
                <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center">
                        <History className="mr-2 h-5 w-5 text-blue-600" /> Session History
                    </div>
                    <Button
                         variant="ghost"
                         size="icon"
                         onClick={openUploadModal} // Use atom setter directly
                         title="Upload New Session"
                         aria-label="Upload New Session"
                     >
                         <PlusCircle className="h-6 w-6 text-blue-600"/>
                    </Button>
                </CardTitle>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col space-y-2 overflow-hidden p-0">
                {pastSessions.length === 0 ? (
                    // ... (no changes needed here)
                    <div className="flex-grow flex items-center justify-center p-4">
                         <p className="text-center text-gray-500 py-4">
                            No sessions found. Upload one to get started!
                        </p>
                    </div>
                ) : (
                    <div className="flex-grow flex flex-col overflow-hidden p-4 space-y-3">
                        {/* ... (no changes needed here) */}
                        <p className="text-sm text-gray-500 flex-shrink-0">
                            Select a session to view its details and analysis.
                        </p>
                        <div className="flex-grow overflow-hidden border rounded-md">
                             <ScrollArea className="h-full">
                                <ul className="space-y-1 p-1">
                                    {pastSessions.map((session) => (
                                        <li key={session.id}>
                                            <Button
                                                variant="ghost"
                                                // onClick={() => navigateToSessionAction(session.id)} // Use handleSessionClick instead
                                                onClick={() => handleSessionClick(session.id)}
                                                className="w-full justify-between text-left h-auto py-2 px-3 text-gray-700 hover:bg-gray-100"
                                                title={`Load: ${session.sessionName || session.fileName}`}
                                            >
                                                {/* ... (rest of the button content unchanged) ... */}
                                                <div className="flex items-center space-x-3 overflow-hidden mr-2">
                                                    {/* ... icon and text ... */}
                                                    <FileText className="h-5 w-5 flex-shrink-0 text-gray-500"/>
                                                    <div className="flex flex-col overflow-hidden">
                                                        <span className="font-medium truncate">{session.sessionName || session.fileName}</span>
                                                        <span className="text-xs text-gray-500 truncate">
                                                             {session.clientName || 'No Client'} - <span className="capitalize">{session.sessionType}</span>
                                                         </span>
                                                    </div>
                                                </div>
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
