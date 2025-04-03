import React from 'react';
import type { SelectProps } from '../../types'; // Import the specific props type

export const Select: React.FC<SelectProps> = ({ children, className = '', ...props }) => {
    // Ensure these classes exist in global.css
    const baseClass = "flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
    const combinedClassName = `${baseClass} ${className}`;

    return (
        <select
            className={combinedClassName.trim()}
            {...props}
        >
            {children}
        </select>
    );
};
