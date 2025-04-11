// src/components/LandingPage/SessionListTable.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileTextIcon, ChevronUpIcon, ChevronDownIcon } from '@radix-ui/react-icons';
import { Table, Badge, Text, Flex } from '@radix-ui/themes';
import type { Session } from '../../types';
// Import types directly from where they are defined/exported
import type { SessionSortCriteria, SortDirection } from '../../store/sessionAtoms'; // Correct path
import { cn } from '../../utils';

interface SessionListTableProps {
    sessions: Session[];
    sortCriteria: SessionSortCriteria; // Use imported type
    sortDirection: SortDirection; // Use imported type
    onSort: (criteria: SessionSortCriteria) => void; // Use imported type
}

type AriaSort = 'none' | 'ascending' | 'descending' | 'other' | undefined;
const sessionColorMap: Record<string, React.ComponentProps<typeof Badge>['color']> = { 'individual': 'blue', 'phone': 'sky', 'skills group': 'teal', 'family session': 'green', 'family skills': 'green', 'couples': 'indigo', 'couples individual': 'plum', 'default': 'gray' };
const therapyColorMap: Record<string, React.ComponentProps<typeof Badge>['color']> = { 'act': 'purple', 'dbt': 'amber', 'cbt': 'lime', 'erp': 'ruby', 'mindfulness': 'cyan', 'couples act': 'violet', 'couples dbt': 'yellow', 'dbt skills': 'orange', 'default': 'pink' };

export function SessionListTable({ sessions, sortCriteria, sortDirection, onSort }: SessionListTableProps) {
    const navigate = useNavigate();
    const handleSessionClick = (sessionId: number) => navigate(`/sessions/${sessionId}`);
    const renderSortIcon = (criteria: SessionSortCriteria) => {
        if (sortCriteria !== criteria) { return <ChevronDownIcon className="h-3 w-3 ml-1 text-[--gray-a9] opacity-0 group-hover:opacity-100 transition-opacity" />; }
        if (sortDirection === 'asc') { return <ChevronUpIcon className="h-4 w-4 ml-1 text-[--gray-a11]" />; }
        return <ChevronDownIcon className="h-4 w-4 ml-1 text-[--gray-a11]" />;
    };
    const getHeaderCellProps = (criteria: SessionSortCriteria): React.ThHTMLAttributes<HTMLTableHeaderCellElement> => {
        const isActiveSortColumn = sortCriteria === criteria;
        const sortValue: AriaSort = isActiveSortColumn ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';
        return { onClick: () => onSort(criteria), 'aria-sort': sortValue, style: { cursor: 'pointer', whiteSpace: 'nowrap' } };
    };
    const getBadgeColor = (type: string | undefined, category: 'session' | 'therapy'): React.ComponentProps<typeof Badge>['color'] => {
        const map = category === 'session' ? sessionColorMap : therapyColorMap;
        return type ? (map[type.toLowerCase()] || map['default']) : map['default'];
    }

    return (
         <div className="flex-grow overflow-y-auto">
             <Table.Root variant="surface" size="2">
                <Table.Header style={{ backgroundColor: 'var(--gray-a2)', position: 'sticky', top: 0, zIndex: 1 }}>
                    <Table.Row>
                         <Table.ColumnHeaderCell {...getHeaderCellProps('sessionName')} justify="start"> <Flex align="center" className="group"> Session / File {renderSortIcon('sessionName')} </Flex> </Table.ColumnHeaderCell>
                         <Table.ColumnHeaderCell {...getHeaderCellProps('clientName')}> <Flex align="center" className="group">Client {renderSortIcon('clientName')}</Flex> </Table.ColumnHeaderCell>
                         <Table.ColumnHeaderCell {...getHeaderCellProps('sessionType')}> <Flex align="center" className="group">Type {renderSortIcon('sessionType')}</Flex> </Table.ColumnHeaderCell>
                         <Table.ColumnHeaderCell {...getHeaderCellProps('therapy')}> <Flex align="center" className="group">Therapy {renderSortIcon('therapy')}</Flex> </Table.ColumnHeaderCell>
                         <Table.ColumnHeaderCell {...getHeaderCellProps('date')}> <Flex align="center" className="group">Date {renderSortIcon('date')}</Flex> </Table.ColumnHeaderCell>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {sessions.map((session: Session) => (
                         <Table.Row key={session.id} onClick={() => handleSessionClick(session.id)} className="cursor-pointer hover:bg-[--gray-a3] transition-colors duration-150" aria-label={`Load session: ${session.sessionName || session.fileName}`} tabIndex={0} onKeyDown={(e: React.KeyboardEvent<HTMLTableRowElement>) => e.key === 'Enter' && handleSessionClick(session.id)} >
                             <Table.RowHeaderCell justify="start"> <Flex align="center" gap="2"> <FileTextIcon className="text-[--gray-a10]" /> <Text weight="medium" truncate>{session.sessionName || session.fileName}</Text> </Flex> </Table.RowHeaderCell>
                             <Table.Cell> <Text color="gray">{session.clientName || <span style={{ fontStyle: 'italic' }}>No Client</span>}</Text> </Table.Cell>
                             <Table.Cell> {session.sessionType ? (<Badge color={getBadgeColor(session.sessionType, 'session')} variant="soft" radius="full"> {session.sessionType} </Badge>) : (<Text color="gray">N/A</Text>)} </Table.Cell>
                             <Table.Cell> {session.therapy ? (<Badge color={getBadgeColor(session.therapy, 'therapy')} variant="soft" radius="full"> {session.therapy} </Badge>) : (<Text color="gray">N/A</Text>)} </Table.Cell>
                             <Table.Cell> <Text color="gray">{session.date || <span style={{ fontStyle: 'italic' }}>No Date</span>}</Text> </Table.Cell>
                         </Table.Row>
                    ))}
                </Table.Body>
            </Table.Root>
        </div>
    );
}
