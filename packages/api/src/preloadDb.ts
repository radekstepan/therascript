import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import config from './config/index.js'; // Use config

// Use config path
const dbPath = config.db.sqlitePath;
// Use config path for transcripts directory
const transcriptsBaseDir = config.db.transcriptsDir;

// Sample data
const sampleSessions = [
  {
    id: 1, // Assuming IDs for path construction
    fileName: 'session1.mp3',
    clientName: 'Jane Doe',
    sessionName: 'Initial Consultation',
    date: '2025-04-01',
    sessionType: 'Individual',
    therapy: 'CBT',
    // Construct transcript path using config dir and ID
    transcriptPath: path.join(transcriptsBaseDir, '1.json'), // Use .json extension
    transcriptContent: [ // Sample structured content
        { id: 0, timestamp: 0, text: "Therapist: Hi Jane, how are you feeling today?" },
        { id: 1, timestamp: 3500, text: "Jane: Not great, honestly. Work's been stressful." },
        { id: 2, timestamp: 7200, text: "Therapist: Let’s explore that. What happened at work?" }
    ],
    status: 'completed', // Add status
    whisperJobId: null, // Add whisperJobId
    chats: [
      {
        name: 'Work Stress Discussion',
        messages: [
          { sender: 'user', text: 'What did Jane say about work?' },
          { sender: 'ai', text: 'Jane mentioned that work has been stressful.' },
        ],
      },
    ],
  },
  {
    id: 2, // Assuming IDs for path construction
    fileName: 'session2.mp3',
    clientName: 'John Smith',
    sessionName: 'Follow-up Session',
    date: '2025-04-02',
    sessionType: 'Individual',
    therapy: 'Mindfulness',
    // Construct transcript path using config dir and ID
    transcriptPath: path.join(transcriptsBaseDir, '2.json'), // Use .json extension
    transcriptContent: [ // Sample structured content
        { id: 0, timestamp: 0, text: "Therapist: John, how’s the mindfulness practice going?" },
        { id: 1, timestamp: 4100, text: "John: It’s helping a bit with anxiety." },
        { id: 2, timestamp: 8000, text: "Therapist: Good to hear! Any specific moments?" }
    ],
    status: 'completed', // Add status
    whisperJobId: null, // Add whisperJobId
    chats: [
      {
        name: 'Mindfulness Check-in',
        messages: [
          { sender: 'user', text: 'How’s John doing with anxiety?' },
          { sender: 'ai', text: 'John said the mindfulness practice is helping a bit with his anxiety.' },
        ],
      },
      {
        name: undefined, // No name for this chat
        messages: [
          { sender: 'user', text: 'What did the therapist ask?' },
          { sender: 'ai', text: 'The therapist asked how the mindfulness practice is going.' },
        ],
      },
    ],
  },
];

async function preloadDatabase() {
  console.log(`[Preload] Connecting to database at ${dbPath}`);
  const db = new Database(dbPath, { verbose: console.log });

  try {
    // Ensure transcripts directory exists (using path from config)
    await fs.mkdir(transcriptsBaseDir, { recursive: true });

    // Clear existing data before preloading
    console.log('[Preload] Clearing existing data...');
    // Order matters due to foreign key constraints (delete children first)
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM chats');
    db.exec('DELETE FROM sessions');
    console.log('[Preload] Existing data cleared.');

    // Prepare statements
    const insertSession = db.prepare(`
      INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, transcriptPath, status, whisperJobId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertChat = db.prepare(`
      INSERT INTO chats (sessionId, timestamp, name)
      VALUES (?, ?, ?)
    `);
    const insertMessage = db.prepare(`
      INSERT INTO messages (chatId, sender, text, timestamp)
      VALUES (?, ?, ?, ?)
    `);

    // Run in a transaction
    db.transaction(() => {
      for (const session of sampleSessions) {
        // Insert session
        const sessionResult = insertSession.run(
          session.fileName,
          session.clientName,
          session.sessionName,
          session.date,
          session.sessionType,
          session.therapy,
          session.transcriptPath, // Path is pre-determined here
          session.status,         // Add status
          session.whisperJobId    // Add whisperJobId
        );
        const sessionId = sessionResult.lastInsertRowid;
        console.log(`[Preload] Added session ${sessionId}: ${session.sessionName}`);

        // Write transcript file as JSON
        const transcriptJson = JSON.stringify(session.transcriptContent, null, 2);
        fs.writeFile(session.transcriptPath, transcriptJson, 'utf-8')
          .then(() => console.log(`[Preload] Wrote transcript to ${session.transcriptPath}`))
          .catch(err => console.error(`[Preload] Error writing transcript: ${err}`));

        // Insert chats
        for (const chat of session.chats) {
          const timestamp = Date.now();
          const chatResult = insertChat.run(sessionId, timestamp, chat.name || null);
          const chatId = chatResult.lastInsertRowid;
          console.log(`[Preload] Added chat ${chatId} to session ${sessionId}`);

          // Insert messages
          for (const message of chat.messages) {
            const messageTimestamp = Date.now() + Math.random(); // Ensure unique timestamps for sorting
            const messageResult = insertMessage.run(chatId, message.sender, message.text, messageTimestamp);
            console.log(`[Preload] Added message ${messageResult.lastInsertRowid} to chat ${chatId}`);
          }
        }
      }
    })();

    console.log('[Preload] Database preloaded successfully!');
  } catch (error) {
    console.error('[Preload] Error preloading database:', error);
  } finally {
    db.close();
    console.log('[Preload] Database connection closed.');
  }
}

// Execute the preload
preloadDatabase().catch(err => {
  console.error('[Preload] Fatal error:', err);
  process.exit(1);
});
