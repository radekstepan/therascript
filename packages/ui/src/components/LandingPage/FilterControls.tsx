// =========================================
// File: packages/ui/src/components/LandingPage/FilterControls.tsx
// NEW FILE
// =========================================
import React, { useCallback } from 'react';
import {
    Grid,
    Flex,
    Text,
    Select,
    TextField,
    IconButton,
    Badge,
} from '@radix-ui/themes';
import {
    PlusIcon,
    Cross1Icon,
} from '@radix-ui/react-icons';
import type { Session } from '../../types';

// Helper function to get unique, sorted client names
const getUniqueClientNames = (sessions: Session[] | undefined): string[] => {
    if (!sessions) return [];
    const names = new Set<string>();
    sessions.forEach(s => {
        if (s.clientName) names.add(s.clientName.trim());
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
};

// Special value for the 'All Clients' option to avoid empty string value prop
const ALL_CLIENTS_VALUE = "__ALL_CLIENTS__";

interface FilterControlsProps {
    sessions?: Session[]; // Pass sessions for client name extraction
    clientFilter: string;
    setClientFilter: (value: string) => void;
    filterTags: string[];
    setFilterTags: React.Dispatch<React.SetStateAction<string[]>>;
    newFilterTagInput: string;
    setNewFilterTagInput: (value: string) => void;
    onAddFilterTag: () => void;
    onRemoveFilterTag: (tag: string) => void;
    onFilterTagInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function FilterControls({
    sessions,
    clientFilter,
    setClientFilter,
    filterTags,
    setFilterTags, // We don't use setFilterTags directly, but keep it for completeness if needed later
    newFilterTagInput,
    setNewFilterTagInput,
    onAddFilterTag,
    onRemoveFilterTag,
    onFilterTagInputKeyDown,
}: FilterControlsProps) {

    const uniqueClientNames = React.useMemo(() => getUniqueClientNames(sessions), [sessions]);

    const handleClientFilterChange = (value: string) => {
        setClientFilter(value === ALL_CLIENTS_VALUE ? '' : value);
    };

    return (
        <Grid columns={{ initial: '1', md: '2' }} gap="3" width="100%" mt="2">
            {/* Client Filter Dropdown */}
            <Flex direction="column" gap="1">
                <Text as="label" size="1" color="gray" htmlFor="client-filter-select">Filter by Client</Text>
                <Select.Root
                    value={clientFilter || ALL_CLIENTS_VALUE}
                    onValueChange={handleClientFilterChange}
                    size="2"
                    name="client-filter-select"
                >
                    <Select.Trigger placeholder="All Clients..." />
                    <Select.Content>
                        <Select.Item value={ALL_CLIENTS_VALUE}>All Clients</Select.Item>
                        {uniqueClientNames.map(name => (
                            <Select.Item key={name} value={name}>{name}</Select.Item>
                        ))}
                    </Select.Content>
                </Select.Root>
            </Flex>

            {/* Tag Filter Input */}
            <Flex direction="column" gap="1">
                <Text as="label" size="1" color="gray" htmlFor="tag-filter-input">Filter by Tags (AND)</Text>
                {filterTags.length > 0 && (
                    <Flex gap="1" wrap="wrap" mb="1" style={{minHeight: '28px'}}>
                        {filterTags.map((tag, index) => (
                            <Badge key={`${tag}-${index}`} color="gray" variant="soft" radius="full">
                                {tag}
                                <IconButton size="1" variant="ghost" color="gray" radius="full" onClick={() => onRemoveFilterTag(tag)} aria-label={`Remove filter tag ${tag}`} style={{ marginLeft: '4px', marginRight: '-5px', height: '12px', width: '12px', cursor: 'pointer' }} > <Cross1Icon width="10" height="10" /> </IconButton>
                            </Badge>
                        ))}
                    </Flex>
                )}
                <Flex gap="2" align="center">
                    <TextField.Root id="tag-filter-input" size="2" placeholder="Add tag filter..." value={newFilterTagInput} onChange={(e) => setNewFilterTagInput(e.target.value)} onKeyDown={onFilterTagInputKeyDown} disabled={filterTags.length >= 5} style={{ flexGrow: 1 }} />
                    <IconButton size="2" variant="soft" onClick={onAddFilterTag} disabled={!newFilterTagInput.trim() || filterTags.length >= 5} aria-label="Add filter tag" title="Add filter tag" > <PlusIcon /> </IconButton>
                </Flex>
            </Flex>
        </Grid>
    );
}
