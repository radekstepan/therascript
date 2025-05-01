// Purpose: Displays a modal showing the status of project-related Docker containers.
import React from 'react';
import { useQuery } from '@tanstack/react-query'; // For fetching data
import { Dialog, Button, Flex, Text, Box, Spinner, Callout, Badge, ScrollArea } from '@radix-ui/themes'; // Radix UI components
import {
    Cross2Icon,                // Close icon
    CheckCircledIcon,          // Icon for 'running' state
    CrossCircledIcon,          // Icon for 'exited' state
    QuestionMarkCircledIcon,   // Icon for 'not_found' state
    InfoCircledIcon            // Icon for other states and errors
} from '@radix-ui/react-icons';
import { fetchDockerStatus } from '../../api/api'; // API function to fetch status
import type { DockerContainerStatus } from '../../types'; // Type definition for container status
import { cn } from '../../utils'; // Utility for class names (optional here)

interface DockerStatusModalProps {
    isOpen: boolean; // Controls modal visibility
    onOpenChange: (open: boolean) => void; // Callback when modal requests open/close
}

/**
 * Helper function to determine the visual style (color and icon) for a container status badge.
 * @param state - The container state string (e.g., 'running', 'exited', 'not_found').
 * @returns An object with the badge color and icon component.
 */
const getStatusVisuals = (state: string): { color: React.ComponentProps<typeof Badge>['color'], Icon: React.ElementType } => {
    const lowerState = state.toLowerCase();
    if (lowerState === 'running') return { color: 'green', Icon: CheckCircledIcon };
    if (lowerState === 'exited' || lowerState === 'stopped') return { color: 'red', Icon: CrossCircledIcon };
    if (lowerState === 'not_found') return { color: 'gray', Icon: QuestionMarkCircledIcon };
    // Default for other states (e.g., 'restarting', 'paused')
    return { color: 'yellow', Icon: InfoCircledIcon };
};

/**
 * Helper function to format the port mappings array into a readable string.
 * @param ports - Array of port mapping objects from the DockerContainerStatus type.
 * @returns A comma-separated string representation of the ports (e.g., "0.0.0.0:8000->8000/tcp").
 */
const formatPorts = (ports: DockerContainerStatus['ports']): string => {
    if (!ports || ports.length === 0) return 'None'; // Handle case with no ports
    return ports
        // Format each port object: [HostIP:]PublicPort->PrivatePort/Type
        .map(p => `${p.PublicPort ? `${p.IP || '0.0.0.0'}:${p.PublicPort}->` : ''}${p.PrivatePort}/${p.Type}`)
        .join(', '); // Join multiple mappings with commas
};

/**
 * Renders a modal dialog displaying the status of relevant Docker containers.
 */
export function DockerStatusModal({ isOpen, onOpenChange }: DockerStatusModalProps) {
    // Fetch Docker status using Tanstack Query
    const { data: containers, isLoading, error, refetch } = useQuery<DockerContainerStatus[], Error>({
        queryKey: ['dockerStatus'], // Unique key for this query
        queryFn: fetchDockerStatus, // API function to call
        enabled: isOpen, // Only fetch data when the modal is open
        staleTime: 10 * 1000, // Consider data stale after 10 seconds
        refetchInterval: isOpen ? 10000 : false, // Refetch every 10s if modal remains open
        refetchOnWindowFocus: false, // Don't refetch just because the window gained focus
    });

    // Handler to explicitly close the modal via the props callback
    const handleClose = () => {
        onOpenChange(false);
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
            <Dialog.Content style={{ maxWidth: 650 }}> {/* Set max width for the modal */}
                <Dialog.Title>Docker Container Status</Dialog.Title>
                <Dialog.Description size="2" mb="4" color="gray">
                    Status of relevant Docker containers (Whisper, Ollama) for this project.
                </Dialog.Description>

                {/* Scrollable area for the container list */}
                <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '50vh', minHeight: '200px' }}>
                    <Box pr="4"> {/* Padding-right to avoid scrollbar overlap */}
                        {/* Loading State */}
                        {isLoading && (
                            <Flex align="center" justify="center" py="6">
                                <Spinner size="3" />
                                <Text ml="2" color="gray">Loading Docker status...</Text>
                            </Flex>
                        )}
                        {/* Error State */}
                        {error && !isLoading && (
                            <Callout.Root color="red" role="alert" size="1" mt="2">
                                <Callout.Icon><InfoCircledIcon /></Callout.Icon>
                                <Callout.Text>Error fetching Docker status: {error.message}</Callout.Text>
                            </Callout.Root>
                        )}
                        {/* Data Loaded State */}
                        {!isLoading && !error && containers && containers.length > 0 && (
                            <Box className="space-y-3"> {/* Add vertical spacing between items */}
                                {containers.map((container) => {
                                    // Get the color and icon based on the container state
                                    const { color, Icon } = getStatusVisuals(container.state);
                                    return (
                                        // Container Item Box
                                        <Box key={container.id + container.name} p="3" style={{ backgroundColor: 'var(--gray-a2)', borderRadius: 'var(--radius-3)' }}>
                                            <Flex justify="between" align="start" gap="3">
                                                {/* Left Side: Name, State Badge, Image */}
                                                <Flex direction="column" gap="1" style={{ minWidth: 0 }}> {/* minWidth prevents flex overflow */}
                                                    <Flex align="center" gap="2">
                                                        {/* Container Name (truncated) */}
                                                        <Text size="2" weight="medium" truncate title={container.name}>{container.name}</Text>
                                                        {/* State Badge */}
                                                        <Badge color={color} variant="soft" size="1">
                                                            <Icon width="12" height="12" style={{ marginRight: '3px' }}/>
                                                            {container.state}
                                                         </Badge>
                                                    </Flex>
                                                    {/* Container Image (truncated) */}
                                                    <Text size="1" color="gray" truncate title={container.image}>{container.image}</Text>
                                                </Flex>
                                                {/* Right Side: Status Text, Ports */}
                                                <Flex direction="column" gap="1" align="end" flexShrink="0" style={{ textAlign: 'right' }}>
                                                    {/* Human-readable Status */}
                                                    <Text size="1" color="gray" title={container.status}>{container.status}</Text>
                                                    {/* Formatted Ports */}
                                                    <Text size="1" color="gray" truncate title={`Ports: ${formatPorts(container.ports)}`}>
                                                        Ports: {formatPorts(container.ports)}
                                                    </Text>
                                                </Flex>
                                            </Flex>
                                        </Box>
                                    );
                                })}
                            </Box>
                        )}
                        {/* Empty State (No containers found) */}
                         {!isLoading && !error && (!containers || containers.length === 0) && (
                            <Flex align="center" justify="center" py="6">
                                <Text color="gray">No project containers found.</Text>
                            </Flex>
                         )}
                    </Box>
                </ScrollArea>

                {/* Modal Footer Buttons */}
                <Flex gap="3" mt="4" justify="end">
                     {/* Refresh Button */}
                     <Button type="button" variant="soft" color="gray" onClick={() => refetch()} disabled={isLoading} title="Refetch container status">
                        Refresh
                     </Button>
                     {/* Close Button */}
                     <Button type="button" variant="surface" onClick={handleClose}>
                        <Cross2Icon /> Close
                     </Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
