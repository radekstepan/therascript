import React from 'react';
import { Box } from '@radix-ui/themes';

interface SessionResizerProps {
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export function SessionResizer({ onMouseDown }: SessionResizerProps) {
    return (
        <Box
            className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]"
            onMouseDown={onMouseDown}
            title="Resize sidebar"
            aria-label="Resize sidebar" // Accessibility
            role="separator" // ARIA role for resizer
            aria-orientation="vertical"
        >
            {/* Visual indicator */}
            <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
        </Box>
    );
}
