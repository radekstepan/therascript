// Purpose: Component for filtering session/search results on the landing page.
//          Provides controls for filtering by client name and tags.
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
    PlusIcon,       // Icon for adding a tag
    Cross1Icon,     // Icon for removing a tag
} from '@radix-ui/react-icons';
import type { Session } from '../../types'; // Session type needed for extracting client names

/**
 * Helper function to extract unique client names from a list of sessions
 * and sort them alphabetically.
 * @param sessions - Array of session objects.
 * @returns Sorted array of unique client names.
 */
const getUniqueClientNames = (sessions: Session[] | undefined): string[] => {
    if (!sessions) return []; // Return empty if no sessions provided
    const names = new Set<string>(); // Use a Set to automatically handle uniqueness
    sessions.forEach(s => {
        // Add non-empty, trimmed client names to the set
        if (s.clientName) names.add(s.clientName.trim());
    });
    // Convert set to array and sort alphabetically
    return Array.from(names).sort((a, b) => a.localeCompare(b));
};

// Special value for the 'All Clients' option in the dropdown to avoid conflicts
// with potential actual client names that might be empty strings (though unlikely).
const ALL_CLIENTS_VALUE = "__ALL_CLIENTS__";

interface FilterControlsProps {
    sessions?: Session[]; // Sessions data to populate client filter dropdown
    clientFilter: string; // Currently selected client filter value
    setClientFilter: (value: string) => void; // Callback to update client filter
    filterTags: string[]; // Array of currently active tag filters
    setFilterTags: React.Dispatch<React.SetStateAction<string[]>>; // Callback to set the entire tag array (can be used for clearing)
    newFilterTagInput: string; // Current value in the "add tag" input field
    setNewFilterTagInput: (value: string) => void; // Callback to update the "add tag" input
    onAddFilterTag: () => void; // Callback to add the tag from the input field
    onRemoveFilterTag: (tag: string) => void; // Callback to remove a specific tag filter
    onFilterTagInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void; // Handler for key events (Enter) in the tag input
}

/**
 * Renders the filter controls UI, including a dropdown for client selection
 * and an input area for managing tag filters.
 */
export function FilterControls({
    sessions,
    clientFilter,
    setClientFilter,
    filterTags,
    setFilterTags, // Currently unused directly, but available if needed (e.g., for a "Clear All" button)
    newFilterTagInput,
    setNewFilterTagInput,
    onAddFilterTag,
    onRemoveFilterTag,
    onFilterTagInputKeyDown,
}: FilterControlsProps) {

    // Memoize the unique client names to avoid recalculating on every render unless sessions change
    const uniqueClientNames = React.useMemo(() => getUniqueClientNames(sessions), [sessions]);

    // Handler for the client filter dropdown change
    const handleClientFilterChange = (value: string) => {
        // If the special 'All Clients' value is selected, set the filter to an empty string
        setClientFilter(value === ALL_CLIENTS_VALUE ? '' : value);
    };

    return (
        <Grid columns={{ initial: '1', md: '2' }} gap="3" width="100%" mt="2">
            {/* Client Filter Dropdown */}
            <Flex direction="column" gap="1">
                <Text as="label" size="1" color="gray" htmlFor="client-filter-select">Filter by Client</Text>
                <Select.Root
                    // Use the special value if clientFilter is empty, otherwise use the filter value
                    value={clientFilter || ALL_CLIENTS_VALUE}
                    onValueChange={handleClientFilterChange}
                    size="2"
                    name="client-filter-select" // Accessible name
                >
                    <Select.Trigger placeholder="All Clients..." />
                    <Select.Content>
                        {/* Add the default "All Clients" option */}
                        <Select.Item value={ALL_CLIENTS_VALUE}>All Clients</Select.Item>
                        {/* Map unique client names to Select.Item components */}
                        {uniqueClientNames.map(name => (
                            <Select.Item key={name} value={name}>{name}</Select.Item>
                        ))}
                    </Select.Content>
                </Select.Root>
            </Flex>

            {/* Tag Filter Input & Display */}
            <Flex direction="column" gap="1">
                <Text as="label" size="1" color="gray" htmlFor="tag-filter-input">Filter by Tags (AND)</Text>
                {/* Display active filter tags as badges */}
                {filterTags.length > 0 && (
                    <Flex gap="1" wrap="wrap" mb="1" style={{minHeight: '28px'}}> {/* Ensure minimum height */}
                        {filterTags.map((tag, index) => (
                            <Badge key={`${tag}-${index}`} color="gray" variant="soft" radius="full">
                                {tag}
                                {/* Button to remove the tag */}
                                <IconButton
                                    size="1"
                                    variant="ghost"
                                    color="gray"
                                    radius="full"
                                    onClick={() => onRemoveFilterTag(tag)}
                                    aria-label={`Remove filter tag ${tag}`}
                                    // Styling for the small remove icon button within the badge
                                    style={{ marginLeft: '4px', marginRight: '-5px', height: '12px', width: '12px', cursor: 'pointer' }}
                                >
                                    <Cross1Icon width="10" height="10" />
                                </IconButton>
                            </Badge>
                        ))}
                    </Flex>
                )}
                {/* Input field and button to add new tags */}
                <Flex gap="2" align="center">
                    <TextField.Root
                        id="tag-filter-input"
                        size="2"
                        placeholder="Add tag filter..."
                        value={newFilterTagInput}
                        onChange={(e) => setNewFilterTagInput(e.target.value)}
                        onKeyDown={onFilterTagInputKeyDown} // Handle Enter key
                        disabled={filterTags.length >= 5} // Limit number of tags
                        style={{ flexGrow: 1 }} // Allow input to take available space
                    />
                    <IconButton
                        size="2"
                        variant="soft"
                        onClick={onAddFilterTag}
                        // Disable button if input is empty or tag limit is reached
                        disabled={!newFilterTagInput.trim() || filterTags.length >= 5}
                        aria-label="Add filter tag"
                        title="Add filter tag"
                    >
                        <PlusIcon />
                    </IconButton>
                </Flex>
            </Flex>
        </Grid>
    );
}
