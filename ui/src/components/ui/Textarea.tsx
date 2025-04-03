import React from 'react';
import type { TextareaProps } from '../../types'; // Import the specific props type

export const Textarea: React.FC<TextareaProps> = ({ className = '', ...props }) => {
    // Ensure these classes exist in global.css
    const baseClass = "flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
    const combinedClassName = `${baseClass} ${className}`;

    return (
        <textarea
            className={combinedClassName.trim()}
            {...props}
        />
    );
};
