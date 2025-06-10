import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@elastic/elasticsearch';
import { calculateTokenCount } from './services/tokenizerService.js';
import {
  schema as sqliteSchema,
  initializeDatabase as initializeSqliteDatabase,
} from './db/sqliteService.js'; // Renamed to avoid conflict
import type {
  BackendTranscriptParagraph,
  TranscriptParagraphData,
} from './types/index.js';
import {
  getElasticsearchClient,
  initializeIndices as initializeEsIndices, // Renamed ES init
  deleteIndex as deleteEsIndex, // Renamed ES delete
  bulkIndexDocuments as bulkIndexEsDocuments, // Renamed ES bulk
  TRANSCRIPTS_INDEX,
  MESSAGES_INDEX,
} from '@therascript/elasticsearch-client';
import config from './config/index.js';

const __filename = fileURLToPath(import.meta.url);
const packageApiDir = path.resolve(__filename, '../../');

const dbPathFromEnv =
  process.env.DB_PATH || './data/therapy-analyzer-dev.sqlite';
if (!process.env.DB_PATH)
  console.warn(`[Preload] WARN: DB_PATH not found. Default: ${dbPathFromEnv}`);
else console.log(`[Preload] Read DB_PATH from env: ${process.env.DB_PATH}`);

const targetDbPath = path.resolve(packageApiDir, dbPathFromEnv);
const targetDataDir = path.dirname(targetDbPath);

const createIsoTimestamp = (
  dateStr: string,
  offsetMinutes: number = 0
): string => {
  const d = new Date(`${dateStr}T12:00:00Z`); // Use UTC noon
  d.setMinutes(d.getMinutes() + offsetMinutes);
  return d.toISOString();
};

interface SampleChatMessage {
  sender: 'user' | 'ai';
  text: string;
  starred?: boolean;
  starredName?: string;
}
interface SampleChat {
  name?: string;
  tags?: string[];
  messages: SampleChatMessage[];
}
interface SampleSession {
  localIdRef: number;
  fileName: string;
  clientName: string;
  sessionName: string;
  date: string;
  sessionType: string;
  therapy: string;
  transcriptContent: TranscriptParagraphData[];
  status: 'completed' | 'pending' | 'transcribing' | 'failed';
  whisperJobId: string | null;
  chats: SampleChat[];
}

const sampleSessions: SampleSession[] = [
  {
    localIdRef: 1,
    fileName: 'session1.mp3',
    clientName: 'Jane Doe',
    sessionName: 'Initial Consultation',
    date: createIsoTimestamp('2025-04-01', 0),
    sessionType: 'Individual',
    therapy: 'CBT',
    transcriptContent: [
      {
        id: 0,
        timestamp: 0,
        text: "T: Let's start by discussing what brought you in today.",
      },
      {
        id: 1,
        timestamp: 6500,
        text: "J: Well, I've been feeling really overwhelmed with work lately. It's constant pressure.",
      },
      {
        id: 2,
        timestamp: 12300,
        text: 'T: Tell me more about that pressure. What does it feel like?',
      },
      {
        id: 3,
        timestamp: 18800,
        text: 'J: Like I can never catch up. My thoughts race, and I find it hard to focus on one task.',
      },
      {
        id: 4,
        timestamp: 25000,
        text: 'T: That sounds exhausting. We can explore some CBT techniques to manage those racing thoughts.',
      },
    ],
    status: 'completed',
    whisperJobId: null,
    chats: [
      {
        name: 'Work Stress Discussion',
        tags: ['stress', 'work'],
        messages: [
          {
            sender: 'user',
            text: 'What did Jane say about work?',
            starred: true,
            starredName: 'Jane Work Stress Quote',
          },
          {
            sender: 'ai',
            text: 'Jane mentioned feeling really overwhelmed with work, describing it as constant pressure and feeling like she can never catch up. She also noted that her thoughts race and she finds it hard to focus.',
          },
        ],
      },
      {
        name: 'CBT Concepts Introduced',
        tags: ['cbt', 'introduction'],
        messages: [
          { sender: 'user', text: 'Did the therapist explain CBT?' },
          {
            sender: 'ai',
            text: "Yes, the therapist mentioned exploring CBT techniques to manage Jane's racing thoughts, indicating an introduction to the therapy modality.",
          },
        ],
      },
    ],
  },
  {
    localIdRef: 2,
    fileName: 'session2.mp3',
    clientName: 'John Smith',
    sessionName: 'Follow-up Session',
    date: createIsoTimestamp('2025-04-02', 0),
    sessionType: 'Individual',
    therapy: 'Mindfulness',
    transcriptContent: [
      {
        id: 0,
        timestamp: 0,
        text: 'T: Welcome back, John. How has your week been since our last mindfulness practice?',
      },
      {
        id: 1,
        timestamp: 7100,
        text: 'J: Better in some ways. I noticed my anxiety creeping up during a meeting, but I tried the breathing exercise.',
      },
      {
        id: 2,
        timestamp: 14500,
        text: "T: That's great self-awareness. How did the breathing exercise feel in that moment?",
      },
      {
        id: 3,
        timestamp: 21200,
        text: 'J: It helped ground me a bit, but the physical sensations were still strong.',
      },
      {
        id: 4,
        timestamp: 27800,
        text: "T: Okay, let's work on acknowledging those physical sensations without judgment. That's a key part of mindfulness.",
      },
    ],
    status: 'completed',
    whisperJobId: null,
    chats: [
      {
        name: 'Mindfulness Check-in',
        tags: ['anxiety', 'check-in', 'mindfulness'],
        messages: [
          { sender: 'user', text: 'How’s John doing with anxiety?' },
          {
            sender: 'ai',
            text: 'John reported that his week was better in some ways. He noticed his anxiety during a meeting and used a breathing exercise, which helped ground him, although the physical sensations remained strong.',
          },
        ],
      },
      {
        name: undefined,
        tags: ['anxiety', 'trigger'],
        messages: [
          {
            sender: 'user',
            text: "What triggers John's anxiety?",
            starred: true,
            starredName: 'John Triggers',
          },
          {
            sender: 'ai',
            text: 'The session explicitly mentioned John experiencing anxiety during a meeting.',
          },
        ],
      },
      {
        name: 'Therapist Techniques',
        tags: ['mindfulness', 'reframing', 'technique'],
        messages: [
          {
            sender: 'user',
            text: 'What techniques did the therapist suggest?',
          },
          {
            sender: 'ai',
            text: "The therapist acknowledged John's use of a breathing exercise and suggested working on acknowledging physical sensations without judgment as a key part of mindfulness.",
          },
        ],
      },
    ],
  },
  {
    localIdRef: 3,
    fileName: 'session3.mp3',
    clientName: 'Jane Doe',
    sessionName: 'CBT Homework Review', // Changed name
    date: createIsoTimestamp('2025-04-08', 0),
    sessionType: 'Individual',
    therapy: 'CBT',
    transcriptContent: [
      {
        id: 0,
        timestamp: 0,
        text: 'T: Last time we talked about identifying automatic negative thoughts. Have you noticed any this week?',
      },
      {
        id: 1,
        timestamp: 8000,
        text: "J: Yes, definitely. When my boss gave feedback, I immediately thought, 'I'm going to get fired.'",
      },
      {
        id: 2,
        timestamp: 15500,
        text: "T: That's a perfect example of catastrophizing. Let's challenge that thought. What's the evidence for and against it?",
      },
    ],
    status: 'completed',
    whisperJobId: null,
    chats: [],
  },
];

async function preloadDatabase() {
  console.log(`[Preload] Target DB Path: ${targetDbPath}`);
  let deletionAttempted = false;
  try {
    await fs.access(targetDataDir);
    console.log(`[Preload] Existing data dir at ${targetDataDir}. Deleting...`);
    deletionAttempted = true;
    await fs.rm(targetDataDir, { recursive: true, force: true });
    console.log(`[Preload] Deleted directory: ${targetDataDir}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      console.error(
        `[Preload] Error deleting data directory ${targetDataDir}:`,
        err
      );
      if (deletionAttempted) {
        process.exit(1);
      }
    } else {
      console.log(`[Preload] Data dir not found. No deletion needed.`);
    }
  }

  try {
    await fs.mkdir(targetDataDir, { recursive: true });
    const uploadsDirRelative = process.env.DB_UPLOADS_DIR || './data/uploads';
    const targetUploadsDir = path.resolve(packageApiDir, uploadsDirRelative);
    await fs.mkdir(targetUploadsDir, { recursive: true });
  } catch (err) {
    console.error(`[Preload] Failed create data/uploads directory:`, err);
    process.exit(1);
  }

  let db: Database.Database | null = null;
  let esClientInstance: Client | null = null;
  let success = false;
  const sessionsToVerify: Array<{
    name: string;
    expectedDate: string;
    expectedTokenCount: number | null;
    expectedParagraphCount: number;
  }> = [];

  try {
    db = new Database(targetDbPath, { verbose: console.log });
    initializeSqliteDatabase(db); // Initializes SQLite schema & verifies hash

    esClientInstance = getElasticsearchClient(config.elasticsearch.url);
    console.log('[Preload ES] Deleting existing Elasticsearch indices...');
    await deleteEsIndex(esClientInstance, TRANSCRIPTS_INDEX);
    await deleteEsIndex(esClientInstance, MESSAGES_INDEX);
    console.log('[Preload ES] Initializing Elasticsearch indices...');
    await initializeEsIndices(esClientInstance);

    const esTranscriptDocsToBulk: Array<{ id: string; document: any }> = [];
    const esMessageDocsToBulk: Array<{ id: string; document: any }> = [];

    const insertSession = db.prepare(
      `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, audioPath, status, whisperJobId, transcriptTokenCount) VALUES (@fileName, @clientName, @sessionName, @date, @sessionType, @therapy, @audioPath, @status, @whisperJobId, @transcriptTokenCount)`
    );
    const insertChat = db.prepare(
      `INSERT INTO chats (sessionId, timestamp, name, tags) VALUES (?, ?, ?, ?)`
    );
    const insertMessage = db.prepare(
      `INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, starred, starredName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertParagraph = db.prepare(
      `INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text) VALUES (?, ?, ?, ?)`
    );

    db.transaction(() => {
      for (const session of sampleSessions) {
        const fullTranscriptText = session.transcriptContent
          .map((p: TranscriptParagraphData) => p.text)
          .join('\n\n');
        const tokenCount = calculateTokenCount(fullTranscriptText);
        const audioIdentifier = session.fileName;

        const sessionResult = insertSession.run({
          fileName: session.fileName,
          clientName: session.clientName,
          sessionName: session.sessionName,
          date: session.date,
          sessionType: session.sessionType,
          therapy: session.therapy,
          audioPath: audioIdentifier,
          status: session.status,
          whisperJobId: session.whisperJobId,
          transcriptTokenCount: tokenCount,
        });
        const sessionId = sessionResult.lastInsertRowid as number;

        for (const paragraph of session.transcriptContent) {
          insertParagraph.run(
            sessionId,
            paragraph.id,
            paragraph.timestamp,
            paragraph.text
          );
          esTranscriptDocsToBulk.push({
            id: `${sessionId}_${paragraph.id}`,
            document: {
              session_id: sessionId,
              paragraph_index: paragraph.id,
              text: paragraph.text,
              timestamp_ms: paragraph.timestamp,
              client_name: session.clientName,
              session_name: session.sessionName,
              session_date: session.date,
              session_type: session.sessionType,
              therapy_type: session.therapy,
            },
          });
        }
        sessionsToVerify.push({
          name: session.sessionName,
          expectedDate: session.date,
          expectedTokenCount: tokenCount,
          expectedParagraphCount: session.transcriptContent.length,
        });

        let messageOffset = 0;
        for (const chat of session.chats) {
          const timestamp = Date.now() + messageOffset;
          messageOffset += Math.floor(Math.random() * 5000) + 5000; // Increase offset randomness
          const sortedTags = chat.tags
            ? [...chat.tags].sort((a, b) => a.localeCompare(b))
            : null;
          const tagsJson =
            sortedTags && sortedTags.length > 0
              ? JSON.stringify(sortedTags)
              : null;
          const chatResult = insertChat.run(
            sessionId,
            timestamp,
            chat.name === undefined ? null : chat.name,
            tagsJson
          );
          const chatId = chatResult.lastInsertRowid as number;

          let subMessageOffset = 0;
          for (const message of chat.messages) {
            const messageTimestamp = timestamp + subMessageOffset;
            subMessageOffset += Math.floor(Math.random() * 1000) + 100; // Increase offset
            const msgResult = insertMessage.run(
              chatId,
              message.sender,
              message.text,
              messageTimestamp,
              null,
              null,
              message.starred ? 1 : 0,
              message.starredName || null
            );
            const actualMessageId = msgResult.lastInsertRowid as number;
            esMessageDocsToBulk.push({
              id: String(actualMessageId),
              document: {
                message_id: String(actualMessageId),
                chat_id: chatId,
                session_id: sessionId,
                sender: message.sender,
                text: message.text,
                timestamp: messageTimestamp,
                client_name: session.clientName,
                session_name: session.sessionName,
                chat_name: null,
                tags: null,
              },
            });
          }
        }
      }
    })();

    if (esTranscriptDocsToBulk.length > 0) {
      console.log(
        `[Preload ES] Bulk indexing ${esTranscriptDocsToBulk.length} transcript documents...`
      );
      await bulkIndexEsDocuments(
        esClientInstance,
        TRANSCRIPTS_INDEX,
        esTranscriptDocsToBulk
      );
    }
    if (esMessageDocsToBulk.length > 0) {
      console.log(
        `[Preload ES] Bulk indexing ${esMessageDocsToBulk.length} message documents...`
      );
      await bulkIndexEsDocuments(
        esClientInstance,
        MESSAGES_INDEX,
        esMessageDocsToBulk
      );
    }

    console.log(
      '[Preload] Sample data DB transaction committed and ES data indexed.'
    );
    success = true;
  } catch (error) {
    console.error('[Preload] Error during preload execution:', error);
    success = false;
  } finally {
    if (success && db && db.open) {
      console.log('[Preload Verification] Checking database entries...');
      try {
        const verifySessionStmt = db.prepare(
          'SELECT id, status, date, transcriptTokenCount FROM sessions WHERE sessionName = ?'
        );
        const verifyParagraphCountStmt = db.prepare(
          'SELECT COUNT(*) as count FROM transcript_paragraphs WHERE sessionId = ?'
        );
        let verificationPassed = true;
        for (const sessionToVerify of sessionsToVerify) {
          const dbSession = verifySessionStmt.get(sessionToVerify.name) as any; // Cast for simplicity
          if (!dbSession) {
            verificationPassed = false;
            console.error(
              `[PV] FAILED: Session '${sessionToVerify.name}' not found!`
            );
            continue;
          }
          if (dbSession.status !== 'completed') {
            verificationPassed = false;
            console.error(
              `[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) status '${dbSession.status}' != 'completed'.`
            );
          }
          if (dbSession.date !== sessionToVerify.expectedDate) {
            verificationPassed = false;
            console.error(
              `[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) date '${dbSession.date}' != '${sessionToVerify.expectedDate}'.`
            );
          }
          if (
            dbSession.transcriptTokenCount !==
            sessionToVerify.expectedTokenCount
          ) {
            verificationPassed = false;
            console.error(
              `[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) token count '${dbSession.transcriptTokenCount}' != '${sessionToVerify.expectedTokenCount}'.`
            );
          }
          const paraCountResult = verifyParagraphCountStmt.get(
            dbSession.id
          ) as any; // Cast
          if (
            !paraCountResult ||
            paraCountResult.count !== sessionToVerify.expectedParagraphCount
          ) {
            verificationPassed = false;
            console.error(
              `[PV] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) paragraph count mismatch. Found: ${paraCountResult?.count}, Expected: ${sessionToVerify.expectedParagraphCount}.`
            );
          }
        }
        if (verificationPassed)
          console.log('[Preload Verification] All DB entries/counts look OK.');
        else {
          console.error('[PV] FAILED.');
          success = false;
        }
      } catch (verifyError) {
        console.error('[PV] Error:', verifyError);
        success = false;
      }
    } else if (!db) {
      console.error(
        '[Preload] DB connection not established during verification.'
      );
      success = false;
    }
    if (db && db.open) {
      db.close();
      console.log('[Preload] DB closed.');
    }
    if (success) console.log('[Preload] Success!');
    else {
      console.error('[Preload] FAILED.');
      process.exitCode = 1;
    }
  }
}

preloadDatabase().catch((err) => {
  console.error('[Preload] Fatal error:', err);
  process.exit(1);
});
