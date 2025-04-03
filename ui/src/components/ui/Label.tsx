import React from 'react';
import type { LabelProps } from '../../types'; // Import the specific props type

export const Label: React.FC<LabelProps> = ({ children, className = '', htmlFor, ...props }) => {
    // Ensure these classes exist in global.css
    // Note: peer-disabled classes are hard to replicate without Tailwind/JS logic
    const baseClass = "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70";
    const combinedClassName = `${baseClass} ${className}`;

    return (
        <label htmlFor={htmlFor} className={combinedClassName.trim()} {...props}>
            {children}
        </label>
    );
};
