// packages/ui/src/constants.ts
import type React from 'react';
import type { Badge } from '@radix-ui/themes';

// TODO we should be fetching these from the API
export const SESSION_TYPES = [
  'Individual',
  'Phone',
  'Skills Group',
  'Family Session',
  'Family Skills',
  'Couples',
  'Couples Individual',
];

export const THERAPY_TYPES = [
  'ACT',
  'DBT',
  'CBT',
  'ERP',
  'Mindfulness',
  'Couples ACT',
  'Couples DBT',
  'DBT Skills',
];

// Constants for allowed upload types, consistent with Whisper's capabilities
// This list is used for the <input accept> attribute and client-side validation logic.
export const ALLOWED_AUDIO_VIDEO_MIME_TYPES: string[] = [
  // Common Audio Formats
  'audio/mpeg', // .mp3, .mpga
  'audio/mp3', // .mp3 (often used as an alias)
  'audio/mp4', // .m4a (often used for this), .mp4 (audio only)
  'audio/wav', // .wav
  'audio/x-wav', // .wav (common alternative)
  'audio/aac', // .aac
  'audio/ogg', // .ogg (can contain Vorbis, Opus, Speex)
  'audio/webm', // .webm (audio only)
  'audio/flac', // .flac
  'audio/x-m4a', // .m4a (alternative MIME type)
  'audio/x-flac', // .flac (alternative MIME type, less common)

  // Common Video Formats (Whisper can extract audio from these via FFmpeg)
  'video/mp4', // .mp4
  'video/mpeg', // .mpeg, .mpg
  'video/webm', // .webm
  'video/quicktime', // .mov
  'video/x-msvideo', // .avi
  'video/x-matroska', // .mkv
  'video/x-flv', // .flv
  // 'video/x-ms-wmv', // .wmv (Consider adding if Whisper setup easily handles it)
];

// User-facing list of extensions for display in UI messages and tooltips.
// This should correspond to the MIME types above.
export const ALLOWED_AUDIO_VIDEO_EXTENSIONS_DISPLAY: string[] = [
  '.mp3',
  '.mpga',
  '.mp4',
  '.m4a',
  '.wav',
  '.aac',
  '.ogg',
  '.opus',
  '.webm',
  '.flac',
  '.mpeg',
  '.mpg',
  '.mov',
  '.avi',
  '.mkv',
  '.flv',
];

// Color mapping for badges
export const sessionColorMap: Record<
  string,
  React.ComponentProps<typeof Badge>['color']
> = {
  individual: 'blue',
  phone: 'sky',
  'skills group': 'teal',
  'family session': 'green',
  'family skills': 'green',
  couples: 'indigo',
  'couples individual': 'plum',
  default: 'gray',
};

export const therapyColorMap: Record<
  string,
  React.ComponentProps<typeof Badge>['color']
> = {
  act: 'purple',
  dbt: 'amber',
  cbt: 'lime',
  erp: 'ruby',
  mindfulness: 'cyan',
  'couples act': 'violet',
  'couples dbt': 'yellow',
  'dbt skills': 'orange',
  default: 'pink',
};
