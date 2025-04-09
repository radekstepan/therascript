// src/components/LandingPage.tsx
import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai'; // Removed useAtom if not needed directly here
import { useNavigate } from 'react-router-dom';
import {
    CounterClockwiseClockIcon, // Available
    PlusCircledIcon, // Available
    // Icons for table moved to SessionListTable
} from '@radix-ui/react-icons';
import { SessionListTable } from './LandingPage/SessionListTable'; // Import the new table component
import { Button } from './ui/Button'; // Keep Button import
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import {
    openUploadModalAtom, // This atom's action is still used
    sortedSessionsAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    setSessionSortAtom,
    SessionSortCriteria
} from '../store'; // Store path remains the same
// Session type is likely implicitly handled by sortedSessionsAtom or needed by SessionListTable
import { getBadgeClasses } from '../helpers';
import { cn } from '../utils';

export function LandingPage() {
  const sortedSessions = useAtomValue(sortedSessionsAtom);
  const openUploadModal = useSetAtom(openUploadModalAtom); // Use the action atom

  const currentSortCriteria = useAtomValue(sessionSortCriteriaAtom);
  const currentSortDirection = useAtomValue(sessionSortDirectionAtom);
  const setSort = useSetAtom(setSessionSortAtom);
  const navigate = useNavigate(); // Keep navigate if used outside the table

  // Handler for sorting to pass down
  const handleSort = (criteria: SessionSortCriteria) => {
      setSort(criteria);
  };


  return (
      <div className="w-full max-w-4xl mx-auto flex-grow flex flex-col p-4 md:p-6 lg:p-8">
          <Card className="flex-grow flex flex-col overflow-hidden h-full"> {/* Ensure Card fills height */}
              <CardHeader className="flex-row items-center justify-between px-4 pt-4 pb-2 sm:px-6 border-b dark:border-gray-700"> {/* Add border */}
                  <h2 className="text-xl font-semibold flex items-center text-gray-900 dark:text-gray-100">
                     <CounterClockwiseClockIcon className="mr-2 h-5 w-5 text-gray-600 dark:text-gray-400" aria-hidden="true" />
                     Session History
                  </h2>
                  {/* Use icon prop */}
                  <Button
                       variant="light" size="sm" onClick={openUploadModal}
                       title="Upload New Session" aria-label="Upload New Session"
                       icon={PlusCircledIcon} // Use icon prop
                  >
                      New Session
                  </Button>
             </CardHeader>
            {/* Use CardContent to wrap the table/empty state, allow it to grow and scroll */}
            <CardContent className="flex-grow flex flex-col overflow-hidden p-0"> {/* Remove padding */}
                {sortedSessions.length === 0 ? (
                    <div className="flex-grow flex items-center justify-center p-6 text-center">
                         <p className="text-gray-600 dark:text-gray-400">
                            No sessions found. Upload one to get started!
                         </p>
                    </div>
                ) : (
                    // Render the extracted table component
                    <SessionListTable
                        sessions={sortedSessions}
                        sortCriteria={currentSortCriteria}
                        sortDirection={currentSortDirection}
                        onSort={handleSort}
                    />
                )}
            </CardContent>
        </Card>
    </div>
  );
}
