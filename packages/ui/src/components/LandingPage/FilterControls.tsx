// Purpose: Component for filtering session/search results on the landing page.
//          Provides controls for filtering by client name.
import React, { useCallback } from 'react';
import {
  Grid,
  Flex,
  Text,
  Select,
  // TextField, // Removed
  // IconButton, // Removed
  // Badge, // Removed
} from '@radix-ui/themes';
// import {
//   PlusIcon, // Removed
//   Cross1Icon, // Removed
// } from '@radix-ui/react-icons'; // Removed
import type { Session } from '../../types';

const getUniqueClientNames = (sessions: Session[] | undefined): string[] => {
  if (!sessions) return [];
  const names = new Set<string>();
  sessions.forEach((s) => {
    if (s.clientName) names.add(s.clientName.trim());
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
};

const ALL_CLIENTS_VALUE = '__ALL_CLIENTS__';

interface FilterControlsProps {
  sessions?: Session[];
  clientFilter: string;
  setClientFilter: (value: string) => void;
  // Removed props related to tags
}

export function FilterControls({
  sessions,
  clientFilter,
  setClientFilter,
}: FilterControlsProps) {
  const uniqueClientNames = React.useMemo(
    () => getUniqueClientNames(sessions),
    [sessions]
  );

  const handleClientFilterChange = (value: string) => {
    setClientFilter(value === ALL_CLIENTS_VALUE ? '' : value);
  };

  return (
    // Adjust Grid columns if only one filter is present or style as needed
    <Grid
      columns={{ initial: '1', sm: '2', md: '3' }}
      gap="3"
      width="100%"
      mt="2"
    >
      {/* Client Filter Dropdown */}
      <Flex direction="column" gap="1">
        <Text as="label" size="1" color="gray" htmlFor="client-filter-select">
          Filter by Client
        </Text>
        <Select.Root
          value={clientFilter || ALL_CLIENTS_VALUE}
          onValueChange={handleClientFilterChange}
          size="2"
          name="client-filter-select"
        >
          <Select.Trigger placeholder="All Clients..." />
          <Select.Content>
            <Select.Item value={ALL_CLIENTS_VALUE}>All Clients</Select.Item>
            {uniqueClientNames.map((name) => (
              <Select.Item key={name} value={name}>
                {name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>

      {/* Tag Filter Section Removed */}
    </Grid>
  );
}
