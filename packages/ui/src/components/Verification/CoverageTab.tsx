// packages/ui/src/components/Verification/CoverageTab.tsx
//
// Per-transcript verification coverage with 1-click audit / re-audit.
import React from 'react';
import { Link } from 'react-router-dom';
import { Flex, Text, Table, Badge, Button, Card } from '@radix-ui/themes';
import { ShieldCheck, RotateCcw, FolderSearch } from 'lucide-react';
import type { SessionVerificationSummary } from '../../api/verification';
import { formatIsoDateToYMD } from '../../helpers';

export function CoverageTab({
  sessions,
  onAuditSession,
  auditDisabled = false,
  onVerifySession,
}: {
  sessions: SessionVerificationSummary[];
  onAuditSession: (sessionId: number) => void;
  /** True while an audit job is running (mirrors the header button). */
  auditDisabled?: boolean;
  /**
   * Retry entry-point for failed messages: opens the audit dialog
   * pre-scoped to the session (skip-verified on by default). When
   * omitted, no retry button is rendered.
   */
  onVerifySession?: (sessionId: number) => void;
}) {
  if (sessions.length === 0) {
    return (
      <Card size="3">
        <Flex direction="column" align="center" gap="2" py="6">
          <FolderSearch size={24} style={{ color: 'var(--gray-10)' }} />
          <Text size="2" weight="medium">
            No completed sessions yet
          </Text>
          <Text size="2" color="gray">
            Transcribe a session and chat with it, then run a verification
            audit.
          </Text>
        </Flex>
      </Card>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <Table.Root size="2" style={{ minWidth: '880px' }}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Session</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Chat LLM</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">
              Coverage
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">
              Accuracy
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">
              Issues
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">
              Action
            </Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {sessions.map((session) => {
            const status = session.isFullyVerified
              ? 'verified'
              : session.verifiedAiMessages > 0
                ? 'partial'
                : 'unverified';
            return (
              <Table.Row key={session.sessionId}>
                <Table.RowHeaderCell>
                  <Link
                    to={`/sessions/${session.sessionId}`}
                    title="Open session transcript"
                    aria-label={`Open transcript for ${session.sessionName}`}
                    className="hover:underline"
                    style={{ color: 'var(--accent-11)' }}
                  >
                    <Text size="2" weight="medium">
                      {session.sessionName}
                    </Text>
                  </Link>
                </Table.RowHeaderCell>
                <Table.Cell>{session.clientName}</Table.Cell>
                <Table.Cell>
                  <Text size="2" color="gray">
                    {formatIsoDateToYMD(session.date)}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  {session.predominantModel ? (
                    <Text
                      size="2"
                      title={`Most common chat model across this session's chats`}
                      style={{
                        maxWidth: '180px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {session.predominantModel}
                    </Text>
                  ) : (
                    <Text
                      size="2"
                      color="gray"
                      title="No model recorded for this session's chats"
                    >
                      —
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {status === 'verified' ? (
                    <Badge color="green" variant="soft" size="1">
                      Verified
                    </Badge>
                  ) : status === 'partial' ? (
                    <Badge color="amber" variant="soft" size="1">
                      Partially verified
                    </Badge>
                  ) : (
                    <Badge color="gray" variant="soft" size="1">
                      Unverified
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell justify="end">
                  <Flex
                    direction="row"
                    align="center"
                    justify="end"
                    gap="2"
                    wrap="nowrap"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    <Text
                      size="2"
                      style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {session.verifiedAiMessages} / {session.totalAiMessages}{' '}
                      msgs
                    </Text>
                    {(session.failedAiMessages ?? 0) > 0 && (
                      <Badge
                        color="red"
                        variant="soft"
                        size="1"
                        style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                        title={`${session.failedAiMessages} message${session.failedAiMessages === 1 ? '' : 's'} failed verification (LLM error). Retry to re-audit ${session.failedAiMessages === 1 ? 'it' : 'them'}.`}
                      >
                        {session.failedAiMessages} failed
                      </Badge>
                    )}
                  </Flex>
                </Table.Cell>
                <Table.Cell justify="end">
                  {session.averageAccuracy === null ? (
                    <Text size="2" color="gray">
                      —
                    </Text>
                  ) : (
                    <Badge
                      color={
                        session.averageAccuracy >= 92
                          ? 'green'
                          : session.averageAccuracy >= 80
                            ? 'amber'
                            : 'red'
                      }
                      variant="soft"
                      size="1"
                      title={`Mean fact accuracy across ${session.verifiedAiMessages} verified AI response${session.verifiedAiMessages === 1 ? '' : 's'} — per response: supported claims plus half credit for partials, over extracted claims plus omissions`}
                    >
                      {session.averageAccuracy.toFixed(1)}%
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell justify="end">
                  {session.flaggedIssues > 0 ? (
                    <Text size="2" style={{ color: 'var(--red-11)' }}>
                      {session.flaggedIssues}
                    </Text>
                  ) : (
                    <Text size="2" color="gray">
                      0
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell justify="end">
                  <Flex gap="1" justify="end" wrap="wrap">
                    {(session.failedAiMessages ?? 0) > 0 && onVerifySession && (
                      <Button
                        size="1"
                        variant="soft"
                        color="red"
                        disabled={auditDisabled}
                        title={
                          auditDisabled
                            ? 'An audit is already running'
                            : `Retry the ${session.failedAiMessages} failed message${session.failedAiMessages === 1 ? '' : 's'} (opens the audit dialog, skipping already-verified ones)`
                        }
                        onClick={() => onVerifySession(session.sessionId)}
                      >
                        <RotateCcw size={12} /> Retry Failed
                      </Button>
                    )}
                    <Button
                      size="1"
                      variant="soft"
                      disabled={auditDisabled}
                      title={
                        auditDisabled
                          ? 'An audit is already running'
                          : undefined
                      }
                      onClick={() => onAuditSession(session.sessionId)}
                    >
                      {status === 'verified' ? (
                        <>
                          <RotateCcw size={12} /> Re-audit
                        </>
                      ) : (
                        <>
                          <ShieldCheck size={12} /> Audit session
                        </>
                      )}
                    </Button>
                  </Flex>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </div>
  );
}
