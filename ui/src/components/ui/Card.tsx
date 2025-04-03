import React from 'react';
import type { CardElementProps, CardTitleProps } from '../../types'; // Import the specific props types

// --- Card Component ---
export const Card: React.FC<CardElementProps> = ({ children, className = '', ...props }) => {
    // Ensure these classes exist in global.css
    const baseClass = "rounded-lg border border-gray-200 bg-white text-card-foreground shadow-sm";
    const combinedClassName = `${baseClass} ${className}`;

    return (
        <div className={combinedClassName.trim()} {...props}>
            {children}
        </div>
    );
};

// --- CardHeader Component ---
export const CardHeader: React.FC<CardElementProps> = ({ children, className = '', ...props }) => {
    // Ensure these classes exist in global.css
    const baseClass = "flex flex-col space-y-1.5 p-6";
    const combinedClassName = `${baseClass} ${className}`;

    return (
        <div className={combinedClassName.trim()} {...props}>
            {children}
        </div>
    );
};

// --- CardTitle Component ---
export const CardTitle: React.FC<CardTitleProps> = ({ children, className = '', as = 'h3', ...props }) => {
    const Tag = as; // Use the 'as' prop to determine the HTML tag

    // Ensure these classes exist in global.css
    const baseClass = "text-lg font-semibold leading-none tracking-tight"; // Example classes
    const combinedClassName = `${baseClass} ${className}`;

    return (
        <Tag className={combinedClassName.trim()} {...props}>
            {children}
        </Tag>
    );
};

// --- CardContent Component ---
export const CardContent: React.FC<CardElementProps> = ({ children, className = '', ...props }) => {
    // Ensure these classes exist in global.css
    const baseClass = "p-6 pt-0"; // pt-0 removes top padding added by CardHeader's p-6
    const combinedClassName = `${baseClass} ${className}`;

    return (
        <div className={combinedClassName.trim()} {...props}>
            {children}
        </div>
    );
};

// Note: No default export, use named imports: import { Card, CardHeader, CardTitle, CardContent } from '...'
