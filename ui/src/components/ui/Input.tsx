import React from 'react';
import type { InputProps } from '../../types'; // Import the specific props type

export const Input: React.FC<InputProps> = ({ className = '', type, ...props }) => {
    // Ensure these classes exist in global.css
    const baseClass = "flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
    const combinedClassName = `${baseClass} ${className}`;

    return (
        <input
            type={type}
            className={combinedClassName.trim()}
            {...props}
        />
    );
};
