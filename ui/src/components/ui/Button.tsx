import React from 'react';
import type { ButtonProps } from '../../types'; // Import the specific props type

export const Button: React.FC<ButtonProps> = ({
    children,
    onClick,
    disabled,
    className = '',
    variant = 'default',
    size = 'default',
    title = '',
    type = 'button', // Default type to button
    ...props
}) => {
    // Base styles (ensure these classes exist in global.css)
    const baseStyle = "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

    // Variant styles (ensure these classes exist in global.css)
    const variants = {
        default: "bg-blue-600 text-white hover:bg-blue-700",
        secondary: "bg-gray-200 text-gray-800 hover:bg-gray-300",
        ghost: "hover:bg-gray-100 hover:text-gray-900", // Assuming accent is default text
        destructive: "bg-red-600 text-white hover:bg-red-700",
        outline: "border border-gray-300 bg-white hover:bg-gray-100 text-gray-800", // Added text color
        link: "text-blue-600 underline-offset-4 hover:underline",
    };

    // Size styles (ensure these classes exist in global.css)
    const sizes = {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3", // Use rounded-md consistent with base
        lg: "h-11 rounded-md px-8", // Use rounded-md consistent with base
        icon: "h-10 w-10",
    };

    // Combine classes
    // Order matters slightly: base -> size -> variant -> custom className
    const combinedClassName = `${baseStyle} ${sizes[size]} ${variants[variant] || variants.default} ${className}`;

    return (
        <button
            type={type} // Set the button type
            onClick={onClick}
            disabled={disabled}
            className={combinedClassName.trim()} // Trim potential extra spaces
            title={title}
            {...props} // Spread remaining button attributes
        >
            {children}
        </button>
    );
};
