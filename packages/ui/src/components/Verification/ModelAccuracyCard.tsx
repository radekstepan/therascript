// packages/ui/src/components/Verification/ModelAccuracyCard.tsx
//
// Per-authoring-LLM accuracy comparison: stacked proportion bars + table.
import React from 'react';
import { Card, Flex, Heading, Text, Table, Badge } from '@radix-ui/themes';
import { Cpu } from 'lucide-react';
import type { ModelAccuracyStat } from '../../api/verification';

function accuracyColor(pct: number): 'green' | 'amber' | 'red' {
  if (pct >= 92) return 'green';
  if (pct >= 80) return 'amber';
  return 'red';
}

function ProportionBar({ stat }: { stat: ModelAccuracyStat }) {
  const total = stat.totalClaims;
  const supported = total > 0 ? (stat.supportedClaims / total) * 100 : 0;
  const partial = total > 0 ? (stat.partialClaims / total) * 100 : 0;
  const bad =
    total > 0
      ? ((stat.contradictedClaims + stat.fabricatedClaims) / total) * 100
      : 0;
  return (
    <div
      role="img"
      aria-label={`${stat.model}: ${supported.toFixed(0)}% supported, ${partial.toFixed(0)}% partial, ${bad.toFixed(0)}% contradicted or fabricated`}
      style={{
        display: 'flex',
        height: '10px',
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
        backgroundColor: 'var(--gray-a4)',
        minWidth: '120px',
      }}
    >
      <div
        style={{ width: `${supported}%`, backgroundColor: 'var(--green-9)' }}
      />
      <div
        style={{ width: `${partial}%`, backgroundColor: 'var(--amber-9)' }}
      />
      <div style={{ width: `${bad}%`, backgroundColor: 'var(--red-9)' }} />
    </div>
  );
}

export function ModelAccuracyCard({ stats }: { stats: ModelAccuracyStat[] }) {
  return (
    <Card size="3">
      <Flex align="center" gap="2" mb="1">
        <Cpu size={16} style={{ color: 'var(--gray-11)' }} />
        <Heading size="3">Accuracy by Authoring LLM</Heading>
      </Flex>
      <Text size="2" color="gray" mb="3" as="p">
        Which models hallucinate, contradict, or omit — across every audited
        response.
      </Text>

      {stats.length === 0 ? (
        <Flex direction="column" align="center" justify="center" gap="2" py="6">
          <Text size="2" color="gray">
            No audited responses yet. Run a verification audit to compare
            models.
          </Text>
        </Flex>
      ) : (
        <>
          <Flex gap="4" mb="3" wrap="wrap">
            {[
              { label: 'Supported', color: 'var(--green-9)' },
              { label: 'Partially supported', color: 'var(--amber-9)' },
              { label: 'Contradicted + fabricated', color: 'var(--red-9)' },
            ].map((item) => (
              <Flex key={item.label} align="center" gap="1">
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: item.color,
                    display: 'inline-block',
                  }}
                />
                <Text size="1" color="gray">
                  {item.label}
                </Text>
              </Flex>
            ))}
          </Flex>

          {/* Single horizontal scroll owner: the outer div. A plain
              table (not Table.Root, which mounts its own inner
              ScrollArea and a second scrollbar) carries the min-width
              itself — the repo's rt-sticky-table pattern. */}
          <div style={{ overflowX: 'auto' }}>
            <table
              className="rt-TableRootTable rt-sticky-table size-1"
              style={{ minWidth: '720px' }}
            >
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Model</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Claim mix</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell justify="end">
                    Audited
                  </Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell justify="end">
                    Claims
                  </Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell justify="end">
                    Accuracy
                  </Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell justify="end">
                    Fabricated
                  </Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell justify="end">
                    Contradicted
                  </Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell justify="end">
                    Omissions/msg
                  </Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {stats.map((stat) => (
                  <Table.Row key={stat.model}>
                    <Table.RowHeaderCell>
                      <Text size="2" weight="medium">
                        {stat.model}
                      </Text>
                    </Table.RowHeaderCell>
                    <Table.Cell>
                      <ProportionBar stat={stat} />
                    </Table.Cell>
                    <Table.Cell justify="end">
                      {stat.messagesAudited}
                    </Table.Cell>
                    <Table.Cell justify="end">{stat.totalClaims}</Table.Cell>
                    <Table.Cell justify="end">
                      <Badge
                        color={accuracyColor(stat.accuracyPercent)}
                        variant="soft"
                        size="1"
                      >
                        {stat.accuracyPercent.toFixed(1)}%
                      </Badge>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text
                        size="2"
                        color={stat.fabricatedClaims > 0 ? undefined : 'gray'}
                        style={
                          stat.fabricatedClaims > 0
                            ? { color: 'var(--red-11)' }
                            : undefined
                        }
                      >
                        {(stat.fabricationRate * 100).toFixed(1)}%
                      </Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text
                        size="2"
                        color={stat.contradictedClaims > 0 ? undefined : 'gray'}
                        style={
                          stat.contradictedClaims > 0
                            ? { color: 'var(--red-11)' }
                            : undefined
                        }
                      >
                        {(stat.contradictionRate * 100).toFixed(1)}%
                      </Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      {stat.omissionsPerMessage.toFixed(2)}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
