// packages/ui/src/constants.ts
import type React from 'react';
import type { Badge } from '@radix-ui/themes';

// TODO we should be fetching these from the API
export const SESSION_TYPES = [
  "Individual", "Phone", "Skills Group", "Family Session",
  "Family Skills", "Couples", "Couples Individual"
];

export const THERAPY_TYPES = [
  "ACT", "DBT", "CBT", "ERP", "Mindfulness",
  "Couples ACT", "Couples DBT", "DBT Skills"
];

// Constants for allowed upload types (should ideally align with backend config)
export const ALLOWED_AUDIO_MIME_TYPES: string[] = [
  'audio/mpeg', // .mp3
  // Add other types supported by the backend AND Whisper
  // 'audio/mp3', // Often redundant with audio/mpeg
  // 'audio/wav',
  // 'audio/x-m4a',
  // 'audio/ogg',
  // 'audio/aac',
];
export const ALLOWED_AUDIO_EXTENSIONS: string[] = ['.mp3']; // Keep simple for user display for now

// Color mapping for badges
export const sessionColorMap: Record<string, React.ComponentProps<typeof Badge>['color']> = {
    'individual': 'blue',
    'phone': 'sky',
    'skills group': 'teal',
    'family session': 'green',
    'family skills': 'green',
    'couples': 'indigo',
    'couples individual': 'plum',
    'default': 'gray'
};

export const therapyColorMap: Record<string, React.ComponentProps<typeof Badge>['color']> = {
    'act': 'purple',
    'dbt': 'amber',
    'cbt': 'lime',
    'erp': 'ruby',
    'mindfulness': 'cyan',
    'couples act': 'violet',
    'couples dbt': 'yellow',
    'dbt skills': 'orange',
    'default': 'pink'
};
