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
    case 'completed':
      return 'green';
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
  selectedIds,
  onSelectionChange,
}: SessionListTableProps) {
  const navigate = useNavigate();

  const handleSessionClick = (
    e: React.MouseEvent<HTMLTableRowElement>,
    sessionId: number
  ) => {
    const target = e.target as HTMLElement;
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

  const renderSortIcon = useCallback(
    (criteria: SessionSortCriteria) => {
      if (sortCriteria !== criteria) {
        return (
          <ChevronDownIcon className="h-3 w-3 ml-1 text-[--gray-a8] opacity-0 group-hover:opacity-100 transition-opacity" />
        );
      }
      if (sortDirection === 'asc') {
        return <ChevronUpIcon className="h-4 w-4 ml-1 text-[--accent-9]" />;
      }
      return <ChevronDownIcon className="h-4 w-4 ml-1 text-[--accent-9]" />;
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

  // Common cell style for vertical centering
  const cellStyle: React.CSSProperties = { verticalAlign: 'middle' };

  return (
    <ScrollArea
      type="auto"
      scrollbars="vertical"
      style={{ flexGrow: 1, minHeight: 0, borderRadius: 'var(--radius-3)' }}
    >
      <Table.Root variant="surface" size="2">
        <Table.Header
          style={{
            backgroundColor: 'var(--gray-a2)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
            // Removed manual box-shadow to fix double border issue.
            // Radix table variants handle borders.
          }}
        >
          <Table.Row>
            <Table.ColumnHeaderCell style={{ width: '1%', ...cellStyle }}>
              <Flex align="center" justify="center">
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
                  className="cursor-pointer"
                />
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell
              {...getHeaderCellProps('sessionName')}
              justify="start"
              style={{
                ...getHeaderCellProps('sessionName').style,
                ...cellStyle,
              }}
            >
              <Flex align="center" className="group">
                Session / File {renderSortIcon('sessionName')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell
              {...getHeaderCellProps('clientName')}
              style={{
                ...getHeaderCellProps('clientName').style,
                ...cellStyle,
              }}
            >
              <Flex align="center" className="group">
                Client {renderSortIcon('clientName')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell
              {...getHeaderCellProps('sessionType')}
              style={{
                ...getHeaderCellProps('sessionType').style,
                ...cellStyle,
              }}
            >
              <Flex align="center" className="group">
                Type {renderSortIcon('sessionType')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell
              {...getHeaderCellProps('therapy')}
              style={{ ...getHeaderCellProps('therapy').style, ...cellStyle }}
            >
              <Flex align="center" className="group">
                Therapy {renderSortIcon('therapy')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell
              {...getHeaderCellProps('date')}
              style={{ ...getHeaderCellProps('date').style, ...cellStyle }}
            >
              <Flex align="center" className="group">
                Date {renderSortIcon('date')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell
              style={{ width: '1%', whiteSpace: 'nowrap', ...cellStyle }}
              align="right"
            >
              Actions
            </Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {sessions.map((session: Session) => {
            const isSelected = selectedIds.has(session.id);
            return (
              <Table.Row
                key={session.id}
                onClick={(e) => handleSessionClick(e, session.id)}
                className={cn(
                  'cursor-pointer transition-colors duration-150 group',
                  isSelected
                    ? 'bg-[var(--accent-a2)] hover:bg-[var(--accent-a3)]'
                    : 'hover:bg-[var(--gray-a3)]',
                  session.status === 'failed' && 'bg-red-50 dark:bg-red-950/20'
                )}
                aria-label={`Load session: ${session.sessionName || session.fileName}`}
                tabIndex={0}
                onKeyDown={(e) => handleKeyDown(e, session.id)}
                style={{ verticalAlign: 'middle' }} // Enforce vertical alignment on row
              >
                <Table.Cell
                  onClick={(e) => e.stopPropagation()}
                  style={cellStyle}
                >
                  <Flex align="center" justify="center">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) =>
                        handleRowCheckboxChange(session.id, checked === true)
                      }
                      aria-label={`Select session ${session.id}`}
                      className="cursor-pointer"
                    />
                  </Flex>
                </Table.Cell>
                <Table.RowHeaderCell justify="start" style={cellStyle}>
                  <Flex align="center" gap="3">
                    <div
                      className={cn(
                        'p-1.5 rounded-md flex-shrink-0',
                        isSelected
                          ? 'bg-[var(--accent-a4)] text-[var(--accent-11)]'
                          : 'bg-[var(--gray-a3)] text-[var(--gray-11)]'
                      )}
                    >
                      <FileTextIcon width={16} height={16} />
                    </div>
                    <Flex direction="column" gap="0">
                      <Text weight="medium" size="2" truncate>
                        {session.sessionName || session.fileName}
                      </Text>
                      {session.status !== 'completed' && (
                        <div className="mt-0.5">
                          <Badge
                            color={getStatusBadgeColor(session.status)}
                            variant="soft"
                            radius="full"
                            size="1"
                          >
                            {session.status}
                          </Badge>
                        </div>
                      )}
                    </Flex>
                  </Flex>
                </Table.RowHeaderCell>
                <Table.Cell style={cellStyle}>
                  {session.clientName ? (
                    <Text size="2">{session.clientName}</Text>
                  ) : (
                    <Text size="2" color="gray" style={{ fontStyle: 'italic' }}>
                      No Client
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell style={cellStyle}>
                  {session.sessionType ? (
                    <Badge
                      color={getBadgeColor(session.sessionType, 'session')}
                      variant="surface"
                      radius="full"
                    >
                      {session.sessionType}
                    </Badge>
                  ) : (
                    <Text color="gray" size="2">
                      -
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell style={cellStyle}>
                  {session.therapy ? (
                    <Badge
                      color={getBadgeColor(session.therapy, 'therapy')}
                      variant="outline"
                      radius="full"
                    >
                      {session.therapy}
                    </Badge>
                  ) : (
                    <Text color="gray" size="2">
                      -
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell style={cellStyle}>
                  <Text size="2" color="gray">
                    {formatIsoDateToYMD(session.date) || '-'}
                  </Text>
                </Table.Cell>
                <Table.Cell
                  align="right"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  style={cellStyle}
                >
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <IconButton
                        variant="ghost"
                        color="gray"
                        size="1"
                        // Removed opacity-0 classes to keep actions always visible
                        className="transition-opacity data-[state=open]:opacity-100"
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
                      <DropdownMenu.Item
                        onSelect={() => onEditSession(session)}
                      >
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
            );
          })}
        </Table.Body>
      </Table.Root>
    </ScrollArea>
  );
}
