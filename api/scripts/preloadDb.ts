// scripts/preloadDb.ts
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';

// Define the database path (matching your config)
const dbPath = path.resolve(process.cwd(), 'data/therapy-analyzer.sqlite');

// Sample data
const sampleSessions = [
  {
    fileName: 'session1.mp3',
    clientName: 'Jane Doe',
    sessionName: 'Initial Consultation',
    date: '2025-04-01',
    sessionType: 'Individual',
    therapy: 'CBT',
    transcriptPath: path.resolve(process.cwd(), 'data/transcripts/1.txt'),
    transcriptContent: `Therapist: Hi Jane, how are you feeling today?\n\nJane: Not great, honestly. Work's been stressful.\n\nTherapist: Let’s explore that. What happened at work?`,
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
    fileName: 'session2.mp3',
    clientName: 'John Smith',
    sessionName: 'Follow-up Session',
    date: '2025-04-02',
    sessionType: 'Individual',
    therapy: 'Mindfulness',
    transcriptPath: path.resolve(process.cwd(), 'data/transcripts/2.txt'),
    transcriptContent: `Therapist: John, how’s the mindfulness practice going?\n\nJohn: It’s helping a bit with anxiety.\n\nTherapist: Good to hear! Any specific moments?`,
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

// Main function to preload the database
async function preloadDatabase() {
  console.log(`[Preload] Connecting to database at ${dbPath}`);
  const db = new Database(dbPath, { verbose: console.log });

  try {
    // Ensure transcripts directory exists
    const transcriptsDir = path.resolve(process.cwd(), 'data/transcripts');
    await fs.mkdir(transcriptsDir, { recursive: true });

    // Prepare statements
    const insertSession = db.prepare(`
      INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, transcriptPath)
      VALUES (?, ?, ?, ?, ?, ?, ?)
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
          session.transcriptPath
        );
        const sessionId = sessionResult.lastInsertRowid as number;
        console.log(`[Preload] Added session ${sessionId}: ${session.sessionName}`);

        // Write transcript file
        fs.writeFile(session.transcriptPath, session.transcriptContent, 'utf-8')
          .then(() => console.log(`[Preload] Wrote transcript to ${session.transcriptPath}`))
          .catch(err => console.error(`[Preload] Error writing transcript: ${err}`));

        // Insert chats
        for (const chat of session.chats) {
          const timestamp = Date.now();
          const chatResult = insertChat.run(sessionId, timestamp, chat.name || null);
          const chatId = chatResult.lastInsertRowid as number;
          console.log(`[Preload] Added chat ${chatId} to session ${sessionId}`);

          // Insert messages
          for (const message of chat.messages) {
            const messageResult = insertMessage.run(chatId, message.sender, message.text, timestamp);
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
