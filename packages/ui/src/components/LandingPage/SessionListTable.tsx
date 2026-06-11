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
  Checkbox,
  Tooltip,
} from '@radix-ui/themes';
import { TableVirtuoso } from 'react-virtuoso';
import type { Session } from '../../types';
import type { SessionSortCriteria, SortDirection } from '../../store';
import { sessionColorMap, therapyColorMap } from '../../constants';
import { formatIsoDateToYMD, formatDuration } from '../../helpers';
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

const cellStyle: React.CSSProperties = { verticalAlign: 'middle' };

interface SessionRowCellsProps {
  session: Session;
  isSelected: boolean;
  onCheckboxChange: (sessionId: number, checked: boolean) => void;
  onEditSession: (session: Session) => void;
  onDeleteSessionRequest: (session: Session) => void;
}

const SessionRowCells = React.memo(function SessionRowCells({
  session,
  isSelected,
  onCheckboxChange,
  onEditSession,
  onDeleteSessionRequest,
}: SessionRowCellsProps) {
  return (
    <>
      <Table.Cell onClick={(e) => e.stopPropagation()} style={cellStyle}>
        <Flex align="center" justify="center">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) =>
              onCheckboxChange(session.id, checked === true)
            }
            aria-label={`Select session ${session.id}`}
            className="cursor-pointer"
          />
        </Flex>
      </Table.Cell>
      <Table.RowHeaderCell
        justify="start"
        style={{ ...cellStyle, maxWidth: 0 }}
      >
        <Flex align="center" gap="3" style={{ minWidth: 0 }}>
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
          <Flex direction="column" gap="0" style={{ minWidth: 0 }}>
            <Text weight="medium" size="2" truncate>
              {session.sessionName || session.fileName}
            </Text>
            {session.status !== 'completed' && (
              <div className="mt-0.5">
                <Tooltip
                  content={
                    session.status === 'failed'
                      ? session.errorMessage ||
                        'An error occurred during processing. Please try again or contact support.'
                      : `Status: ${session.status}`
                  }
                >
                  <Badge
                    color={getStatusBadgeColor(session.status)}
                    variant="soft"
                    radius="full"
                    size="1"
                    className={
                      session.status === 'failed' ? 'cursor-help' : undefined
                    }
                  >
                    {session.status}
                  </Badge>
                </Tooltip>
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
      <Table.Cell style={cellStyle}>
        <Text size="2" color="gray">
          {formatDuration(session.duration)}
        </Text>
      </Table.Cell>
      <Table.Cell style={cellStyle}>
        <Text size="2" color="gray">
          {session.transcriptTokenCount?.toLocaleString() || '-'}
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
            <DropdownMenu.Item onSelect={() => onEditSession(session)}>
              <Pencil1Icon width="14" height="14" className="mr-2" /> Edit
              Details
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              color="red"
              onSelect={() => onDeleteSessionRequest(session)}
            >
              <TrashIcon width="14" height="14" className="mr-2" /> Delete
              Session
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Table.Cell>
    </>
  );
});

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

  const handleSessionClick = useCallback(
    (e: React.MouseEvent<HTMLTableRowElement>, sessionId: number) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, [role="menu"], [role="checkbox"]')) {
        return;
      }
      navigate(`/sessions/${sessionId}`);
    },
    [navigate]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableRowElement>, sessionId: number) => {
      if (
        e.key === 'Enter' &&
        !(e.target as HTMLElement).closest(
          'button, [role="menu"], [role="checkbox"]'
        )
      ) {
        navigate(`/sessions/${sessionId}`);
      }
    },
    [navigate]
  );

  const handleRowCheckboxChange = useCallback(
    (sessionId: number, checked: boolean) => {
      const newSet = new Set(selectedIds);
      if (checked) {
        newSet.add(sessionId);
      } else {
        newSet.delete(sessionId);
      }
      onSelectionChange(newSet);
    },
    [selectedIds, onSelectionChange]
  );

  const handleSelectAllChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        const allIds = new Set(sessions.map((s) => s.id));
        onSelectionChange(allIds);
      } else {
        onSelectionChange(new Set());
      }
    },
    [sessions, onSelectionChange]
  );

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

  const renderHeaderRow = useCallback(
    () => (
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
        {(
          [
            ['sessionName', 'Session / File'],
            ['clientName', 'Client'],
            ['sessionType', 'Type'],
            ['therapy', 'Therapy'],
            ['date', 'Date'],
            ['duration', 'Length'],
            ['transcriptTokenCount', 'Tokens'],
          ] as const
        ).map(([criteria, label]) => {
          const headerProps = getHeaderCellProps(criteria);
          return (
            <Table.ColumnHeaderCell
              key={criteria}
              {...headerProps}
              justify={criteria === 'sessionName' ? 'start' : undefined}
              style={{ ...headerProps.style, ...cellStyle }}
            >
              <Flex align="center" className="group">
                {label} {renderSortIcon(criteria)}
              </Flex>
            </Table.ColumnHeaderCell>
          );
        })}
        <Table.ColumnHeaderCell
          style={{ width: '1%', whiteSpace: 'nowrap', ...cellStyle }}
          align="right"
        >
          Actions
        </Table.ColumnHeaderCell>
      </Table.Row>
    ),
    [
      allSelected,
      someSelected,
      handleSelectAllChange,
      getHeaderCellProps,
      renderSortIcon,
    ]
  );

  return (
    <TableVirtuoso
      style={{ flexGrow: 1, minHeight: 0, borderRadius: 'var(--radius-3)' }}
      data={sessions}
      computeItemKey={(_index, session) => session.id}
      fixedHeaderContent={renderHeaderRow}
      itemContent={(_index, session) => {
        return (
          <SessionRowCells
            session={session}
            isSelected={selectedIds.has(session.id)}
            onCheckboxChange={handleRowCheckboxChange}
            onEditSession={onEditSession}
            onDeleteSessionRequest={onDeleteSessionRequest}
          />
        );
      }}
      components={{
        Table: (props) => (
          <table
            {...props}
            className="rt-TableRootTable rt-sticky-table size-2"
          />
        ),
        TableHead: ({ style, ...props }) => (
          <Table.Header
            {...props}
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              background: 'var(--color-panel-solid)',
              ...style,
            }}
          />
        ),
        TableBody: (props) => <Table.Body {...props} />,
        TableRow: ({ children, ...props }) => {
          const session = sessions[props['data-index']];
          if (!session) return <tr {...props}>{children}</tr>;
          return (
            <tr
              {...props}
              onClick={(e) => handleSessionClick(e, session.id)}
              onKeyDown={(e) => handleKeyDown(e, session.id)}
              className={cn(
                'cursor-pointer transition-colors duration-150 group',
                selectedIds.has(session.id)
                  ? 'bg-[var(--accent-a2)] hover:bg-[var(--accent-a3)]'
                  : 'hover:bg-[var(--gray-a3)]',
                session.status === 'failed' && 'bg-red-50 dark:bg-red-950/20'
              )}
              aria-label={`Load session: ${session.sessionName || session.fileName}`}
              tabIndex={0}
              style={cellStyle}
            >
              {children}
            </tr>
          );
        },
      }}
    />
  );
}
