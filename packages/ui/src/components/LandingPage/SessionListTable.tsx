import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileTextIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  DotsHorizontalIcon,
  Pencil1Icon,
  TrashIcon,
} from '@radix-ui/react-icons';
import {
  Table,
  Badge,
  Text,
  Flex,
  IconButton,
  DropdownMenu,
  ScrollArea,
  Checkbox,
} from '@radix-ui/themes';
import type { Session } from '../../types';
import type { SessionSortCriteria, SortDirection } from '../../store';
import { sessionColorMap, therapyColorMap } from '../../constants';
import { formatIsoDateToYMD } from '../../helpers';
import { cn } from '../../utils';

interface SessionListTableProps {
  sessions: Session[];
  sortCriteria: SessionSortCriteria;
  sortDirection: SortDirection;
  onSort: (criteria: SessionSortCriteria) => void;
  onEditSession: (session: Session) => void;
  onDeleteSessionRequest: (session: Session) => void;
  // --- NEW PROPS for selection ---
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
}

type AriaSort = 'none' | 'ascending' | 'descending' | 'other' | undefined;

const getBadgeColor = (
  type: string | undefined,
  category: 'session' | 'therapy'
): React.ComponentProps<typeof Badge>['color'] => {
  const map = category === 'session' ? sessionColorMap : therapyColorMap;
  return type ? map[type.toLowerCase()] || map['default'] : map['default'];
};

const getStatusBadgeColor = (
  status: Session['status']
): React.ComponentProps<typeof Badge>['color'] => {
  switch (status) {
    case 'failed':
      return 'red';
    case 'transcribing':
    case 'queued':
      return 'blue';
    case 'pending':
    default:
      return 'gray';
  }
};

export function SessionListTable({
  sessions,
  sortCriteria,
  sortDirection,
  onSort,
  onEditSession,
  onDeleteSessionRequest,
  // --- DESTRUCTURE NEW PROPS ---
  selectedIds,
  onSelectionChange,
}: SessionListTableProps) {
  const navigate = useNavigate();

  const handleSessionClick = (
    e: React.MouseEvent<HTMLTableRowElement>,
    sessionId: number
  ) => {
    const target = e.target as HTMLElement;
    // Prevent navigation when clicking on interactive elements
    if (target.closest('button, [role="menu"], [role="checkbox"]')) {
      return;
    }
    navigate(`/sessions/${sessionId}`);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTableRowElement>,
    sessionId: number
  ) => {
    if (
      e.key === 'Enter' &&
      !(e.target as HTMLElement).closest(
        'button, [role="menu"], [role="checkbox"]'
      )
    ) {
      navigate(`/sessions/${sessionId}`);
    }
  };

  // --- NEW SELECTION HANDLERS ---
  const handleRowCheckboxChange = (sessionId: number, checked: boolean) => {
    const newSelectedIds = new Set(selectedIds);
    if (checked) {
      newSelectedIds.add(sessionId);
    } else {
      newSelectedIds.delete(sessionId);
    }
    onSelectionChange(newSelectedIds);
  };

  const handleSelectAllChange = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(sessions.map((s) => s.id));
      onSelectionChange(allIds);
    } else {
      onSelectionChange(new Set());
    }
  };

  const allSelected =
    sessions.length > 0 && selectedIds.size === sessions.length;
  const someSelected =
    selectedIds.size > 0 && selectedIds.size < sessions.length;
  // --- END NEW SELECTION HANDLERS ---

  const renderSortIcon = useCallback(
    (criteria: SessionSortCriteria) => {
      if (sortCriteria !== criteria) {
        return (
          <ChevronDownIcon className="h-3 w-3 ml-1 text-[--gray-a9] opacity-0 group-hover:opacity-100 transition-opacity" />
        );
      }
      if (sortDirection === 'asc') {
        return <ChevronUpIcon className="h-4 w-4 ml-1 text-[--gray-a11]" />;
      }
      return <ChevronDownIcon className="h-4 w-4 ml-1 text-[--gray-a11]" />;
    },
    [sortCriteria, sortDirection]
  );

  const getHeaderCellProps = useCallback(
    (
      criteria: SessionSortCriteria
    ): React.ThHTMLAttributes<HTMLTableHeaderCellElement> => {
      const isActiveSortColumn = sortCriteria === criteria;
      const sortValue: AriaSort = isActiveSortColumn
        ? sortDirection === 'asc'
          ? 'ascending'
          : 'descending'
        : 'none';

      return {
        onClick: () => onSort(criteria),
        'aria-sort': sortValue,
        style: { cursor: 'pointer', whiteSpace: 'nowrap' },
      };
    },
    [sortCriteria, sortDirection, onSort]
  );

  return (
    <ScrollArea
      type="auto"
      scrollbars="vertical"
      style={{ flexGrow: 1, minHeight: 0 }}
    >
      <Table.Root variant="surface" size="2">
        <Table.Header
          style={{
            backgroundColor: 'var(--gray-a2)',
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}
        >
          <Table.Row>
            {/* --- NEW CHECKBOX HEADER --- */}
            <Table.ColumnHeaderCell style={{ width: '1%' }}>
              <Checkbox
                checked={
                  allSelected || someSelected
                    ? someSelected
                      ? 'indeterminate'
                      : true
                    : false
                }
                onCheckedChange={(checked) =>
                  handleSelectAllChange(checked === true)
                }
                aria-label="Select all sessions"
              />
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell
              {...getHeaderCellProps('sessionName')}
              justify="start"
            >
              <Flex align="center" className="group">
                Session / File {renderSortIcon('sessionName')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell {...getHeaderCellProps('clientName')}>
              <Flex align="center" className="group">
                Client {renderSortIcon('clientName')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell {...getHeaderCellProps('sessionType')}>
              <Flex align="center" className="group">
                Type {renderSortIcon('sessionType')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell {...getHeaderCellProps('therapy')}>
              <Flex align="center" className="group">
                Therapy {renderSortIcon('therapy')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell {...getHeaderCellProps('date')}>
              <Flex align="center" className="group">
                Date {renderSortIcon('date')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell
              style={{ width: '1%', whiteSpace: 'nowrap' }}
              align="right"
            >
              Actions
            </Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {sessions.map((session: Session) => (
            <Table.Row
              key={session.id}
              onClick={(e) => handleSessionClick(e, session.id)}
              className={cn(
                'cursor-pointer hover:bg-[--gray-a3] transition-colors duration-150 group',
                session.status === 'failed' &&
                  'bg-[--red-a2] hover:bg-[--red-a4]',
                (session.status === 'pending' ||
                  session.status === 'queued' ||
                  session.status === 'transcribing') &&
                  'bg-[--blue-a2] hover:bg-[--blue-a4]'
              )}
              aria-label={`Load session: ${session.sessionName || session.fileName}`}
              tabIndex={0}
              onKeyDown={(e) => handleKeyDown(e, session.id)}
            >
              {/* --- NEW CHECKBOX CELL --- */}
              <Table.Cell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={selectedIds.has(session.id)}
                  onCheckedChange={(checked) =>
                    handleRowCheckboxChange(session.id, checked === true)
                  }
                  aria-label={`Select session ${session.id}`}
                />
              </Table.Cell>
              <Table.RowHeaderCell justify="start">
                <Flex align="center" gap="2">
                  <FileTextIcon className="text-[--gray-a10]" />
                  <Text weight="medium" truncate>
                    {session.sessionName || session.fileName}
                  </Text>
                  {session.status !== 'completed' && (
                    <Badge
                      color={getStatusBadgeColor(session.status)}
                      variant="soft"
                      radius="full"
                    >
                      {session.status}
                    </Badge>
                  )}
                </Flex>
              </Table.RowHeaderCell>
              <Table.Cell>
                <Text color="gray">
                  {session.clientName || (
                    <span style={{ fontStyle: 'italic' }}>No Client</span>
                  )}
                </Text>
              </Table.Cell>
              <Table.Cell>
                {session.sessionType ? (
                  <Badge
                    color={getBadgeColor(session.sessionType, 'session')}
                    variant="soft"
                    radius="full"
                  >
                    {session.sessionType}
                  </Badge>
                ) : (
                  <Text color="gray">N/A</Text>
                )}
              </Table.Cell>
              <Table.Cell>
                {session.therapy ? (
                  <Badge
                    color={getBadgeColor(session.therapy, 'therapy')}
                    variant="soft"
                    radius="full"
                  >
                    {session.therapy}
                  </Badge>
                ) : (
                  <Text color="gray">N/A</Text>
                )}
              </Table.Cell>
              <Table.Cell>
                <Text color="gray">
                  {formatIsoDateToYMD(session.date) || (
                    <span style={{ fontStyle: 'italic' }}>No Date</span>
                  )}
                </Text>
              </Table.Cell>
              <Table.Cell
                align="right"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <IconButton
                      variant="ghost"
                      color="gray"
                      size="1"
                      className="p-1"
                      aria-label="Session options"
                      title="Session options"
                    >
                      <DotsHorizontalIcon />
                    </IconButton>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content
                    align="end"
                    size="1"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <DropdownMenu.Item onSelect={() => onEditSession(session)}>
                      <Pencil1Icon width="14" height="14" className="mr-2" />{' '}
                      Edit Details
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      color="red"
                      onSelect={() => onDeleteSessionRequest(session)}
                    >
                      <TrashIcon width="14" height="14" className="mr-2" />{' '}
                      Delete Session
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </ScrollArea>
  );
}
