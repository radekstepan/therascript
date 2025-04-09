import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Flex, Text, Badge, IconButton, Box, Heading, Container } from '@radix-ui/themes';
import {
    ArrowLeftIcon,
    BookmarkIcon,
    CalendarIcon,
    Pencil1Icon,
    PersonIcon,
    BadgeIcon as SessionTypeIcon,
} from '@radix-ui/react-icons';
import type { Session } from '../../types';
import { cn } from '../../utils';

interface SessionHeaderProps {
    session: Session;
    onEditDetailsClick: () => void;
    onNavigateBack: () => void;
}

// Consistent color maps as used elsewhere
const sessionColorMap: Record<string, React.ComponentProps<typeof Badge>['color']> = {
    'individual': 'blue', 'phone': 'sky', 'skills group': 'teal',
    'family session': 'green', 'family skills': 'green', 'couples': 'indigo',
    'couples individual': 'plum', 'default': 'gray'
};
const therapyColorMap: Record<string, React.ComponentProps<typeof Badge>['color']> = {
    'act': 'purple', 'dbt': 'amber', 'cbt': 'lime', 'erp': 'ruby',
    'mindfulness': 'cyan', 'couples act': 'violet', 'couples dbt': 'yellow',
    'dbt skills': 'orange', 'default': 'pink'
};
const getBadgeColor = (type: string | undefined, category: 'session' | 'therapy'): React.ComponentProps<typeof Badge>['color'] => {
    const map = category === 'session' ? sessionColorMap : therapyColorMap;
    return type ? (map[type.toLowerCase()] || map['default']) : map['default'];
};

// Helper to render header details consistently
const renderHeaderDetail = (
    IconComponent: React.ElementType,
    value: string | undefined,
    label: string,
    category?: 'session' | 'therapy'
) => {
    if (!value) return null;

    const isBadge = category === 'session' || category === 'therapy';
    const badgeColor = isBadge ? getBadgeColor(value, category) : undefined;

    return (
        // Use Themes Flex for alignment and gap
        <Flex align="center" gap="1" title={label}>
            <IconComponent className={cn("flex-shrink-0", isBadge ? "opacity-80" : "text-[--gray-a10]")} width="14" height="14" />
            {isBadge && badgeColor ? (
                <Badge color={badgeColor} variant="soft" radius="full" size="1">
                    {value}
                </Badge>
            ) : (
                <Text size="1" color="gray">{value}</Text>
            )}
        </Flex>
    );
};


export function SessionHeader({ session, onEditDetailsClick, onNavigateBack }: SessionHeaderProps) {
    const displayTitle = session.sessionName || session.fileName;

    return (
        // Header outer box spans full width
        <Box className="border-b flex-shrink-0" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
            {/* Container constrains the content within the header */}
            <Container size="4">
                 <Flex align="center" justify="between" gap="4" py="3" px={{ initial: '3', sm: '0' }}>
                    {/* Back Button */}
                    <Box flexShrink="0">
                        <Button onClick={onNavigateBack} variant="ghost" color="gray" size="2">
                            <ArrowLeftIcon />
                            Back
                        </Button>
                    </Box>

                    {/* Session Title and Details (Centered) */}
                    <Flex direction="column" align="center" gap="1" style={{ minWidth: 0, flexGrow: 1 }} px="4">
                        <Heading as="h1" size="4" weight="bold" truncate title={displayTitle}>
                            {displayTitle}
                        </Heading>
                        {/* Details rendered using the helper */}
                        <Flex align="center" justify="center" gap="3" wrap="wrap" mt="1">
                             {renderHeaderDetail(PersonIcon, session.clientName, "Client")}
                             {renderHeaderDetail(CalendarIcon, session.date, "Date")}
                             {renderHeaderDetail(SessionTypeIcon, session.sessionType, "Session Type", 'session')}
                             {renderHeaderDetail(BookmarkIcon, session.therapy, "Therapy Type", 'therapy')}
                        </Flex>
                    </Flex>

                    {/* Edit Button */}
                    <Box flexShrink="0">
                        <Button
                            variant="soft"
                            size="2"
                            onClick={onEditDetailsClick}
                            disabled={!session}
                            aria-label="Edit session details" // Added aria-label
                        >
                            <Pencil1Icon width="16" height="16" />
                             {/* Add margin to text instead of wrapping span */}
                             <Text ml="2">Edit Details</Text>
                        </Button>
                    </Box>
                </Flex>
            </Container>
        </Box>
    );
}
