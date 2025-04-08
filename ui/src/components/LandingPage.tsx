import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';

// Import Tremor Components
import {
    Button,
    Card,
    Title,
    Text,
    Badge, // Import Badge
    Table, // Import Table components
    TableHead,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell
} from '@tremor/react';
// Import Icons
import { History, PlusCircle, FileText } from './icons/Icons';
// Import Atoms
import { pastSessionsAtom, openUploadModalAtom } from '../store';
import { Session } from '../types'; // Import Session type for clarity

export function LandingPage() {
  const pastSessions = useAtomValue(pastSessionsAtom);
  const openUploadModal = useSetAtom(openUploadModalAtom);
  const navigate = useNavigate();

  const handleSessionClick = (sessionId: number) => {
      navigate(`/sessions/${sessionId}`);
  };

  // Helper to get badge color based on type (customize as needed)
  const getSessionTypeColor = (type?: string): string => {
      switch(type?.toLowerCase()){
          case 'individual': return 'blue';
          case 'phone': return 'sky';
          case 'skills group': return 'teal';
          case 'family session': return 'emerald';
          case 'couples': return 'indigo';
          default: return 'gray';
      }
  }
    const getTherapyTypeColor = (type?: string): string => {
      switch(type?.toLowerCase()){
          case 'act': return 'purple';
          case 'dbt': return 'amber';
          case 'cbt': return 'lime';
          case 'erp': return 'rose';
          default: return 'cyan';
      }
  }


  return (
    <div className="w-full max-w-4xl mx-auto flex-grow flex flex-col p-4 md:p-6 lg:p-8">
       <Card className="flex-grow flex flex-col overflow-hidden h-full">
            <div className="flex items-center justify-between mb-4 px-1 pt-1">
                 <Title className="flex items-center">
                    <History className="mr-2 h-5 w-5 text-tremor-content" aria-hidden="true" />
                    Session History
                 </Title>
                 <Button
                     icon={PlusCircle}
                     variant="light"
                     onClick={openUploadModal}
                     tooltip="Upload New Session"
                     aria-label="Upload New Session"
                 >
                     New Session
                 </Button>
            </div>
            <div className="flex-grow flex flex-col overflow-hidden">
                {pastSessions.length === 0 ? (
                    <div className="flex-grow flex items-center justify-center p-6 text-center">
                         <Text>
                            No sessions found. Upload one to get started!
                         </Text>
                    </div>
                ) : (
                    // Use overflow-auto directly on the container around the Table if needed
                    // But usually the parent Card handles overflow with flex layout
                    <div className="flex-grow overflow-y-auto border-t border-tremor-border">
                         {/* Use Tremor Table */}
                         <Table>
                            <TableHead>
                                <TableRow>
                                    <TableHeaderCell>Session / File</TableHeaderCell>
                                    <TableHeaderCell>Client</TableHeaderCell>
                                    <TableHeaderCell>Type</TableHeaderCell>
                                    <TableHeaderCell>Therapy</TableHeaderCell>
                                    <TableHeaderCell>Date</TableHeaderCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {pastSessions.map((session: Session) => (
                                    <TableRow
                                        key={session.id}
                                        onClick={() => handleSessionClick(session.id)}
                                        className="cursor-pointer hover:bg-tremor-background-muted"
                                        aria-label={`Load session: ${session.sessionName || session.fileName}`}
                                        role="link" // Indicate row click action
                                    >
                                        <TableCell>
                                            <div className="flex items-center space-x-2">
                                                 <FileText className="h-4 w-4 flex-shrink-0 text-tremor-content-subtle" aria-hidden="true"/>
                                                 <Text className="font-medium text-tremor-content-strong truncate">{session.sessionName || session.fileName}</Text>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Text>{session.clientName || 'No Client'}</Text>
                                        </TableCell>
                                        <TableCell>
                                            {session.sessionType ? (
                                                <Badge color={getSessionTypeColor(session.sessionType)} className="capitalize">
                                                    {session.sessionType}
                                                </Badge>
                                            ) : (
                                                <Text className="text-tremor-content-subtle">N/A</Text>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {session.therapy ? (
                                                <Badge color={getTherapyTypeColor(session.therapy)}>
                                                    {session.therapy}
                                                </Badge>
                                            ) : (
                                                <Text className="text-tremor-content-subtle">N/A</Text>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Text>{session.date || 'N/A'}</Text>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>
        </Card>
    </div>
  );
}
