// packages/ui/src/components/Verification/IssuesFeedTab.tsx
//
// Filterable feed of flagged statements (fabrications, contradictions,
// partial support, omissions) with deep links into the session chat.
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Box,
  Flex,
  Text,
  TextField,
  Select,
  Checkbox,
  Button,
  Badge,
  Card,
  Spinner,
  Callout,
  Skeleton,
} from '@radix-ui/themes';
import {
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
} from '@radix-ui/react-icons';
import { ExternalLink, SearchX } from 'lucide-react';
import {
  fetchFlaggedStatements,
  type StatementSeverity,
  type StatementVerdict,
} from '../../api/verification';
import { useDebounce } from '../../hooks/useDebounce';
import { formatTimestamp } from '../../helpers';

const VERDICT_OPTIONS: {
  value: StatementVerdict;
  label: string;
  color: 'red' | 'orange' | 'amber';
}[] = [
  { value: 'fabricated', label: 'Fabricated', color: 'red' },
  { value: 'contradicted', label: 'Contradicted', color: 'red' },
  {
    value: 'partially_supported',
    label: 'Partially supported',
    color: 'amber',
  },
  { value: 'omission', label: 'Omission', color: 'amber' },
];

const SEVERITY_OPTIONS: {
  value: StatementSeverity | '__all__';
  label: string;
}[] = [
  { value: '__all__', label: 'All severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
];

const PAGE_SIZE = 25;

function verdictBadgeColor(
  verdict: StatementVerdict
): 'red' | 'orange' | 'amber' | 'green' {
  switch (verdict) {
    case 'fabricated':
    case 'contradicted':
      return 'red';
    case 'partially_supported':
      return 'amber';
    case 'omission':
      return 'orange';
    default:
      return 'green';
  }
}

function verdictLabel(verdict: StatementVerdict): string {
  switch (verdict) {
    case 'partially_supported':
      return 'Partially supported';
    default:
      return verdict.charAt(0).toUpperCase() + verdict.slice(1);
  }
}

function severityBadgeColor(
  severity: StatementSeverity
): 'red' | 'orange' | 'amber' | 'yellow' | 'gray' {
  switch (severity) {
    case 'critical':
      return 'red';
    case 'high':
      return 'orange';
    case 'medium':
      return 'amber';
    case 'low':
      return 'yellow';
    default:
      return 'gray';
  }
}

export function IssuesFeedTab({
  models,
  clients,
}: {
  models: string[];
  clients: string[];
}) {
  const navigate = useNavigate();
  const [verdicts, setVerdicts] = useState<StatementVerdict[]>([]);
  const [severity, setSeverity] = useState<string>('__all__');
  const [authoredModel, setAuthoredModel] = useState<string>('__all__');
  const [clientName, setClientName] = useState<string>('__all__');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const debouncedSearch = useDebounce(search, 350);

  const query = useQuery({
    queryKey: [
      'verificationStatements',
      { verdicts, severity, authoredModel, clientName, debouncedSearch, page },
    ],
    queryFn: () =>
      fetchFlaggedStatements({
        ...(verdicts.length > 0 ? { verdict: verdicts } : {}),
        ...(severity !== '__all__'
          ? { severity: [severity as StatementSeverity] }
          : {}),
        ...(authoredModel !== '__all__' ? { authoredModel } : {}),
        ...(clientName !== '__all__' ? { clientName } : {}),
        ...(debouncedSearch.trim().length > 0
          ? { search: debouncedSearch.trim() }
          : {}),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    staleTime: 15000,
  });

  const resetPage = () => setPage(0);

  const toggleVerdict = (verdict: StatementVerdict, checked: boolean) => {
    setVerdicts((prev) =>
      checked ? [...prev, verdict] : prev.filter((v) => v !== verdict)
    );
    resetPage();
  };

  const totalPages = query.data ? Math.ceil(query.data.total / PAGE_SIZE) : 0;

  return (
    <Flex direction="column" gap="3">
      <Flex gap="3" wrap="wrap" align="end">
        <Box style={{ minWidth: '220px', flex: '1 1 220px' }}>
          <Text as="div" size="1" color="gray" mb="1">
            Search claims
          </Text>
          <TextField.Root
            placeholder="Search claims, quotes, reasoning…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
          >
            <TextField.Slot>
              <MagnifyingGlassIcon height="16" width="16" />
            </TextField.Slot>
          </TextField.Root>
        </Box>
        <Box>
          <Text as="div" size="1" color="gray" mb="1">
            Severity
          </Text>
          <Select.Root
            value={severity}
            onValueChange={(v) => {
              setSeverity(v);
              resetPage();
            }}
          >
            <Select.Trigger aria-label="Filter by severity" />
            <Select.Content>
              {SEVERITY_OPTIONS.map((opt) => (
                <Select.Item key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Box>
        <Box>
          <Text as="div" size="1" color="gray" mb="1">
            Authoring LLM
          </Text>
          <Select.Root
            value={authoredModel}
            onValueChange={(v) => {
              setAuthoredModel(v);
              resetPage();
            }}
          >
            <Select.Trigger aria-label="Filter by authoring model" />
            <Select.Content>
              <Select.Item value="__all__">All models</Select.Item>
              {models.map((model) => (
                <Select.Item key={model} value={model}>
                  {model}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Box>
        <Box>
          <Text as="div" size="1" color="gray" mb="1">
            Client
          </Text>
          <Select.Root
            value={clientName}
            onValueChange={(v) => {
              setClientName(v);
              resetPage();
            }}
          >
            <Select.Trigger aria-label="Filter by client" />
            <Select.Content>
              <Select.Item value="__all__">All clients</Select.Item>
              {clients.map((client) => (
                <Select.Item key={client} value={client}>
                  {client}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Box>
      </Flex>

      <Flex gap="3" wrap="wrap" align="center">
        <Text size="1" color="gray">
          Verdict:
        </Text>
        {VERDICT_OPTIONS.map((opt) => (
          <Text as="label" size="2" key={opt.value}>
            <Flex gap="1" align="center">
              <Checkbox
                checked={verdicts.includes(opt.value)}
                onCheckedChange={(checked) =>
                  toggleVerdict(opt.value, checked as boolean)
                }
                className="cursor-pointer"
              />
              <Badge color={opt.color} variant="soft" size="1">
                {opt.label}
              </Badge>
            </Flex>
          </Text>
        ))}
        <Text size="1" color="gray">
          (none selected = all issues)
        </Text>
      </Flex>

      {query.isLoading ? (
        <Flex direction="column" gap="2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: '86px' }} />
          ))}
        </Flex>
      ) : query.isError ? (
        <Callout.Root color="red" size="2">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Failed to load issues: {(query.error as Error).message}{' '}
            <Button
              size="1"
              variant="soft"
              ml="2"
              onClick={() => query.refetch()}
            >
              Retry
            </Button>
          </Callout.Text>
        </Callout.Root>
      ) : !query.data || query.data.items.length === 0 ? (
        <Card size="3">
          <Flex direction="column" align="center" gap="2" py="6">
            <SearchX size={24} style={{ color: 'var(--gray-10)' }} />
            <Text size="2" weight="medium">
              No issues found
            </Text>
            <Text size="2" color="gray">
              {query.data && query.data.total === 0 && verdicts.length === 0
                ? 'No fabrications, contradictions, or omissions have been flagged yet.'
                : 'Try widening the filters or search query.'}
            </Text>
          </Flex>
        </Card>
      ) : (
        <>
          <Text size="1" color="gray">
            Showing {query.data.items.length} of{' '}
            {query.data.total.toLocaleString()} issues
            {query.isFetching && ' · refreshing…'}
          </Text>
          <Flex direction="column" gap="2">
            {query.data.items.map((item) => (
              <Card
                key={item.id}
                size="2"
                style={{ cursor: 'pointer' }}
                className="hover:border-[var(--accent-a8)] transition-colors"
                role="link"
                tabIndex={0}
                aria-label={`View ${verdictLabel(item.verdict)} issue in chat: ${item.normalized_claim}`}
                onClick={() =>
                  navigate(
                    `/sessions/${item.session_id}/chats/${item.chatId}?highlightMsg=${item.message_id}`
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(
                      `/sessions/${item.session_id}/chats/${item.chatId}?highlightMsg=${item.message_id}`
                    );
                  }
                }}
              >
                <Flex gap="2" wrap="wrap" align="center" mb="2">
                  <Badge
                    color={verdictBadgeColor(item.verdict)}
                    variant="solid"
                    size="1"
                  >
                    {verdictLabel(item.verdict).toUpperCase()}
                  </Badge>
                  <Badge
                    color={severityBadgeColor(item.severity)}
                    variant="soft"
                    size="1"
                  >
                    {item.severity}
                  </Badge>
                  <Text size="1" color="gray">
                    {Math.round(item.confidence * 100)}% confident
                  </Text>
                </Flex>
                <Text size="2" weight="medium" as="p" mb="1">
                  {item.normalized_claim}
                </Text>
                <Text size="1" color="gray" as="p" mb="2">
                  {item.reasoning.length > 220
                    ? `${item.reasoning.slice(0, 220)}…`
                    : item.reasoning}
                </Text>
                <Flex gap="2" wrap="wrap" align="center">
                  <Text size="1" color="gray">
                    <Link
                      to={`/sessions/${item.session_id}`}
                      title="Open session transcript"
                      aria-label={`Open transcript for ${item.sessionName}`}
                      className="hover:underline"
                      style={{ color: 'var(--accent-11)' }}
                      onClick={(event) => {
                        // The card itself navigates to the chat; keep the
                        // session link on the transcript route instead.
                        event.stopPropagation();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.stopPropagation();
                        }
                      }}
                    >
                      {item.sessionName}
                    </Link>{' '}
                    · {item.clientName}
                  </Text>
                  <Text size="1" color="gray">
                    ·
                  </Text>
                  <Text size="1" color="gray">
                    {item.authoredModel ?? 'Unknown model'} → Judge:{' '}
                    {item.judgeModel}
                  </Text>
                  <Text size="1" color="gray">
                    ·
                  </Text>
                  <Text size="1" color="gray">
                    {formatTimestamp(item.verifiedAt)}
                  </Text>
                  <Flex gap="1" align="center" ml="auto">
                    <Text size="1" style={{ color: 'var(--accent-11)' }}>
                      View in chat
                    </Text>
                    <ExternalLink
                      size={12}
                      style={{ color: 'var(--accent-11)' }}
                    />
                  </Flex>
                </Flex>
              </Card>
            ))}
          </Flex>
          {totalPages > 1 && (
            <Flex align="center" justify="center" gap="3" mt="2">
              <Button
                variant="soft"
                size="1"
                disabled={page === 0 || query.isFetching}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Text size="1" color="gray">
                Page {page + 1} of {totalPages}
              </Text>
              <Button
                variant="soft"
                size="1"
                disabled={page + 1 >= totalPages || query.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </Flex>
          )}
        </>
      )}

      {query.isFetching && !query.isLoading && (
        <Flex align="center" gap="2">
          <Spinner size="1" />
          <Text size="1" color="gray">
            Updating…
          </Text>
        </Flex>
      )}
    </Flex>
  );
}
