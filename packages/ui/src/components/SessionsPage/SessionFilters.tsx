// packages/ui/src/components/SessionsPage/SessionFilters.tsx
import React from 'react';
import { Flex, Text, DropdownMenu, Button } from '@radix-ui/themes';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { SESSION_TYPES, THERAPY_TYPES } from '../../constants';

const ITEM_CLS =
  'data-[highlighted]:bg-[var(--gray-a3)] data-[highlighted]:text-[var(--gray-12)]';

function FilterTrigger({ label }: { label: string }) {
  return (
    <DropdownMenu.Trigger>
      <Button
        variant="surface"
        color="gray"
        size="1"
        style={{
          gap: 6,
          paddingLeft: 10,
          paddingRight: 8,
          cursor: 'pointer',
          fontWeight: 400,
        }}
      >
        <Text size="1">{label}</Text>
        <ChevronDownIcon style={{ flexShrink: 0, opacity: 0.6 }} />
      </Button>
    </DropdownMenu.Trigger>
  );
}

interface SessionFiltersProps {
  clients: string[];
  filterClient: string;
  filterType: string;
  filterTherapy: string;
  onClientChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onTherapyChange: (value: string) => void;
}

export function SessionFilters({
  clients,
  filterClient,
  filterType,
  filterTherapy,
  onClientChange,
  onTypeChange,
  onTherapyChange,
}: SessionFiltersProps) {
  return (
    <Flex align="center" gap="2" wrap="wrap" mb="4">
      <Text
        size="1"
        color="gray"
        weight="medium"
        style={{ whiteSpace: 'nowrap', marginRight: 2 }}
      >
        Filter:
      </Text>

      {/* Client */}
      <DropdownMenu.Root>
        <FilterTrigger label={filterClient || 'All Clients'} />
        <DropdownMenu.Content size="1" align="start">
          <DropdownMenu.Item
            className={ITEM_CLS}
            onSelect={() => onClientChange('')}
          >
            <Text size="1" color="gray">
              All Clients
            </Text>
          </DropdownMenu.Item>
          {clients.length > 0 && <DropdownMenu.Separator />}
          {clients.map((c) => (
            <DropdownMenu.Item
              key={c}
              className={ITEM_CLS}
              onSelect={() => onClientChange(c)}
            >
              <Text size="1">{c}</Text>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      {/* Type */}
      <DropdownMenu.Root>
        <FilterTrigger label={filterType || 'All Types'} />
        <DropdownMenu.Content size="1" align="start">
          <DropdownMenu.Item
            className={ITEM_CLS}
            onSelect={() => onTypeChange('')}
          >
            <Text size="1" color="gray">
              All Types
            </Text>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          {SESSION_TYPES.map((t) => (
            <DropdownMenu.Item
              key={t}
              className={ITEM_CLS}
              onSelect={() => onTypeChange(t)}
            >
              <Text size="1">{t}</Text>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      {/* Therapy */}
      <DropdownMenu.Root>
        <FilterTrigger label={filterTherapy || 'All Therapies'} />
        <DropdownMenu.Content size="1" align="start">
          <DropdownMenu.Item
            className={ITEM_CLS}
            onSelect={() => onTherapyChange('')}
          >
            <Text size="1" color="gray">
              All Therapies
            </Text>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          {THERAPY_TYPES.map((t) => (
            <DropdownMenu.Item
              key={t}
              className={ITEM_CLS}
              onSelect={() => onTherapyChange(t)}
            >
              <Text size="1">{t}</Text>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </Flex>
  );
}
