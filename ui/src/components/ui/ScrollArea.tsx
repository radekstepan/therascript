import React from 'react';
import type { ScrollAreaProps } from '../../types'; // Import the specific props type

// Simple ScrollArea mock - uses native browser scroll
// The 'elRef' prop allows passing a ref to the scrollable div if needed
export const ScrollArea: React.FC<ScrollAreaProps> = ({ children, className = '', elRef, ...props }) => {
    // Ensure these classes exist in global.css
    // Added a base height/max-height example, adjust as needed or control via className prop
    const baseClass = "relative overflow-auto border border-gray-200 rounded-md"; // Added border and rounding
    const combinedClassName = `${baseClass} ${className}`;

    return (
        <div ref={elRef} className={combinedClassName.trim()} {...props}>
             {/* Added inner div for padding, as ScrollArea itself often doesn't have it */}
            <div className="p-1">
                {children}
            </div>
        </div>
    );
};
