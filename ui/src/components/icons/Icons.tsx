import React from 'react';
import type { IconProps } from '../../types'; // Import the specific props type

// Base className for consistency (optional)
const iconBaseClass = "lucide"; // Keep if your CSS targets this

// --- Icon Components ---

export const Star: React.FC<IconProps> = ({ size = 16, className = '', filled = false }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-star ${className}`}>
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
);

export const List: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-list ${className}`}>
        <line x1="8" x2="21" y1="6" y2="6"/>
        <line x1="8" x2="21" y1="12" y2="12"/>
        <line x1="8" x2="21" y1="18" y2="18"/>
        <line x1="3" x2="3.01" y1="6" y2="6"/>
        <line x1="3" x2="3.01" y1="12" y2="12"/>
        <line x1="3" x2="3.01" y1="18" y2="18"/>
    </svg>
);

export const BookMarked: React.FC<IconProps> = ({ size = 16, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-book-marked ${className}`}>
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20a2 2 0 0 1 2 2v16a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1Z"/>
        <polyline points="10 2 10 10 13 7 16 10 16 2"/>
    </svg>
);

export const Edit: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-edit ${className}`}>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/>
    </svg>
);

export const Save: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-save ${className}`}>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
    </svg>
);

export const CalendarDays: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-calendar-days ${className}`}>
        <path d="M8 2v4"/><path d="M16 2v4"/>
        <rect width="18" height="18" x="3" y="4" rx="2"/>
        <path d="M3 10h18"/><path d="M8 14h.01"/>
        <path d="M12 14h.01"/><path d="M16 14h.01"/>
        <path d="M8 18h.01"/><path d="M12 18h.01"/>
        <path d="M16 18h.01"/>
    </svg>
);

export const Tag: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-tag ${className}`}>
        <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.432 0l6.568-6.568a2.426 2.426 0 0 0 0-3.432l-8.704-8.704Z"/>
        <path d="M6 9h.01"/>
    </svg>
);

export const Text: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-text ${className}`}>
        <path d="M17 6.1H3"/><path d="M21 12.1H3"/>
        <path d="M15.1 18.1H3"/>
    </svg>
);

export const Upload: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-upload ${className}`}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" x2="12" y1="3" y2="15"/>
    </svg>
);

export const MessageSquare: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-message-square ${className}`}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
);

export const Bot: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-bot ${className}`}>
        <path d="M12 8V4H8"/>
        <rect width="16" height="12" x="4" y="8" rx="2"/>
        <path d="M2 14h2"/><path d="M20 14h2"/>
        <path d="M15 13v2"/><path d="M9 13v2"/>
    </svg>
);

export const User: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-user ${className}`}>
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
    </svg>
);

export const Loader2: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         // Added animate-spin class here directly as it's intrinsic to this icon
         className={`${iconBaseClass} lucide-loader-2 animate-spin ${className}`}>
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
);

export const History: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-history ${className}`}>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
    </svg>
);

export const FileText: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-file-text ${className}`}>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
        <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
        <path d="M10 9H8"/><path d="M16 13H8"/>
        <path d="M16 17H8"/>
    </svg>
);

export const PlusCircle: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-plus-circle ${className}`}>
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" x2="12" y1="8" y2="16"/>
        <line x1="8" x2="16" y1="12" y2="12"/>
    </svg>
);

export const X: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-x ${className}`}>
        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
    </svg>
);

export const ArrowLeft: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-arrow-left ${className}`}>
        <path d="m12 19-7-7 7-7"/>
        <path d="M19 12H5"/>
    </svg>
);

export const UploadCloud: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-upload-cloud ${className}`}>
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
        <path d="M12 12v9"/><path d="m16 16-4-4-4 4"/>
    </svg>
);

export const Check: React.FC<IconProps> = ({ size = 24, className = '' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={`${iconBaseClass} lucide-check ${className}`}>
        <path d="M20 6 9 17l-5-5"/>
    </svg>
);
