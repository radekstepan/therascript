// Index names
export const TRANSCRIPTS_INDEX = 'therascript_transcripts';
export const MESSAGES_INDEX = 'therascript_messages';

// Common settings to define the 'en_stem' analyzer
const commonSettings = {
  analysis: {
    analyzer: {
      en_stem: {
        // Custom analyzer name
        type: 'english', // Uses the built-in English analyzer which includes Snowball stemmer
      },
    },
  },
};

// Mappings
export const transcriptsIndexMapping = {
  settings: commonSettings, // Add common settings here
  mappings: {
    properties: {
      paragraph_id: { type: 'keyword' },
      session_id: { type: 'integer' },
      paragraph_index: { type: 'integer' },
      text: {
        type: 'text',
        analyzer: 'standard', // Keep standard analyzer for the main field
        term_vector: 'with_positions_offsets',
        fields: {
          stem: {
            // New stemmed sub-field
            type: 'text',
            analyzer: 'en_stem', // Use our custom English stemmer analyzer
          },
        },
      },
      timestamp_ms: { type: 'long' },
      client_name: {
        type: 'text',
        fields: { keyword: { type: 'keyword', ignore_above: 256 } },
      },
      session_name: {
        type: 'text',
        fields: { keyword: { type: 'keyword', ignore_above: 256 } },
      },
      session_date: { type: 'date' },
      session_type: { type: 'keyword' },
      therapy_type: { type: 'keyword' },
    },
  },
};

export const messagesIndexMapping = {
  settings: commonSettings, // Add common settings here
  mappings: {
    properties: {
      message_id: { type: 'keyword' },
      chat_id: { type: 'integer' },
      session_id: { type: 'integer' },
      sender: { type: 'keyword' },
      text: {
        type: 'text',
        analyzer: 'standard', // Keep standard analyzer for the main field
        term_vector: 'with_positions_offsets',
        fields: {
          stem: {
            // New stemmed sub-field
            type: 'text',
            analyzer: 'en_stem', // Use our custom English stemmer analyzer
          },
        },
      },
      timestamp: { type: 'date', format: 'epoch_millis' },
      chat_name: {
        type: 'text',
        fields: { keyword: { type: 'keyword', ignore_above: 256 } },
      },
      tags: { type: 'keyword' },
      client_name: {
        type: 'text',
        fields: { keyword: { type: 'keyword', ignore_above: 256 } },
      },
      session_name: {
        type: 'text',
        fields: { keyword: { type: 'keyword', ignore_above: 256 } },
      },
    },
  },
};
