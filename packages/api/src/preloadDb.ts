// packages/api/src/preloadDb.ts
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs/promises';
// --- Use fileURLToPath to get directory ---
import { fileURLToPath } from 'node:url';
// --- Don't rely on config for paths in preload, resolve directly ---
import { initializeDatabase } from './db/sqliteService.js'; // Keep this import

// --- Determine paths relative to *this file's* location within packages/api ---
const __filename = fileURLToPath(import.meta.url);
// Assuming build output is in 'dist', navigate up to the 'packages/api' root
// dist/preloadDb.js -> dist/ -> packages/api/
const packageApiDir = path.resolve(__filename, '../../'); // Go up two levels from dist/preloadDb.js

// --- Construct paths *within* packages/api/data ---
const dbDir = path.join(packageApiDir, 'data'); // Target packages/api/data
const dbPath = path.join(dbDir, 'therapy-analyzer.sqlite'); // Target packages/api/data/therapy-analyzer.sqlite
const transcriptsBaseDir = path.join(dbDir, 'transcripts'); // Target packages/api/data/transcripts
// --- End Path Determination ---


interface SessionVerificationData {
    id: number;
    status: string;
    transcriptPath: string | null;
    date: string; // Expect ISO string now
}

// Helper to create ISO timestamp slightly offset for sorting demo
const createIsoTimestamp = (dateStr: string, offsetMinutes: number = 0): string => {
    const baseDate = new Date(dateStr + 'T12:00:00Z'); // Assume noon UTC for base date
    baseDate.setMinutes(baseDate.getMinutes() + offsetMinutes);
    return baseDate.toISOString();
};

// Sample data - Use helper for dates
const sampleSessions = [
  {
    localIdRef: 1,
    fileName: 'session1.mp3',
    clientName: 'Jane Doe',
    sessionName: 'Initial Consultation',
    date: createIsoTimestamp('2025-04-01', 0), // Use full timestamp
    sessionType: 'Individual',
    therapy: 'CBT',
    transcriptContent: [ /* ... transcript content ... */
        { id: 0, timestamp: 0, text: "Therapist: Hi Jane, thanks for coming in today. Let's start by talking a little bit about what brought you here. How have you been feeling lately?" },
        { id: 1, timestamp: 6500, text: "Jane: Hi. Um, thanks for seeing me. Lately... not great, honestly. Work's been incredibly stressful, more than usual. I feel overwhelmed most days." },
        { id: 2, timestamp: 14200, text: "Therapist: Okay, overwhelmed and stressed due to work. Can you tell me a bit more about what's happening at work? What specific situations are feeling stressful?" },
        { id: 3, timestamp: 21800, text: "Jane: Well, we have this huge project deadline coming up, and I feel like I'm carrying most of the weight. My manager keeps adding more tasks, and my colleagues... well, they aren't pulling their weight, or at least it feels that way. I'm working late almost every night." },
        { id: 4, timestamp: 30500, text: "Therapist: That sounds really demanding. Juggling a heavy workload, feeling unsupported by colleagues, and pressure from your manager with an upcoming deadline. How is this stress showing up for you? Physically or emotionally?" },
        { id: 5, timestamp: 39100, text: "Jane: Both, I guess. I have trouble sleeping. I wake up in the middle of the night thinking about work. And I'm irritable, snapping at my partner over small things. I also get these tension headaches by the afternoon." },
        { id: 6, timestamp: 47800, text: "Therapist: Difficulty sleeping, irritability, tension headaches – those are common signs the body is under significant stress. It sounds like it's spilling over into your personal life too. You mentioned snapping at your partner." },
        { id: 7, timestamp: 55300, text: "Jane: Yeah... I feel bad about it afterwards. He's usually very understanding, but I know it's not fair to him. I just feel so wound up all the time." },
        { id: 8, timestamp: 61000, text: "Therapist: It's understandable to feel wound up given the pressure you're describing. It seems like the work stress isn't staying contained at work. In Cognitive Behavioral Therapy, or CBT, we often look at the connection between situations, thoughts, feelings, and behaviors. Can you recall a specific instance recently at work that felt particularly overwhelming?" },
        { id: 9, timestamp: 72500, text: "Jane: Um, okay. Yesterday, my manager dropped another 'urgent' task on my desk right before I was about to leave. I already had a full plate for the next day. My first thought was, 'I'll never get this all done. I'm going to fail.' And I just felt this wave of panic and hopelessness." },
        { id: 10, timestamp: 83100, text: "Therapist: Thank you for sharing that specific example. So the situation was the new task. The thought was, 'I'll never get this done. I'm going to fail.' And the feeling was panic and hopelessness. What did you do then? What was the behavior?" },
        { id: 11, timestamp: 91500, text: "Jane: I stayed late, again. I worked for another two hours, feeling resentful and exhausted. I barely ate dinner when I got home." },
        { id: 12, timestamp: 98000, text: "Therapist: Okay. So the thought 'I'm going to fail' led to intense negative feelings and the behavior of overworking, even when exhausted. Does that thought pattern – predicting failure or catastrophe when faced with a challenge – sound familiar?" },
        { id: 13, timestamp: 106200, text: "Jane: (Sighs) Yeah, I suppose it does. I tend to assume the worst-case scenario, especially when I feel pressured." }
    ],
    status: 'completed',
    whisperJobId: null,
    chats: [
      { name: 'Work Stress Discussion', messages: [ { sender: 'user', text: 'What did Jane say about work?' }, { sender: 'ai', text: 'Jane mentioned that work has been incredibly stressful due to a major project deadline, feeling like she carries most of the weight, and her manager adding more tasks while colleagues seem unsupportive. She\'s working late frequently.' }, ] },
      { name: 'CBT Concepts Introduced', messages: [ { sender: 'user', text: 'Did the therapist explain CBT?' }, { sender: 'ai', text: 'Yes, the therapist briefly introduced Cognitive Behavioral Therapy (CBT) by explaining its focus on the connection between situations, thoughts, feelings, and behaviors, using Jane\'s example of receiving an urgent task.' }, ] },
    ],
  },
  {
    localIdRef: 2,
    fileName: 'session2.mp3',
    clientName: 'John Smith',
    sessionName: 'Follow-up Session',
    date: createIsoTimestamp('2025-04-02', 0), // Use full timestamp
    sessionType: 'Individual',
    therapy: 'Mindfulness',
    transcriptContent: [ /* ... transcript content ... */
        { id: 0, timestamp: 0, text: "Therapist: Hi John, welcome back. Last week we talked about incorporating some mindfulness practices to help manage anxiety. How has that been going over the past week?" },
        { id: 1, timestamp: 7100, text: "John: Hi. It's been... okay. I tried the breathing exercise you suggested a few times. It does seem to help a bit when I feel the anxiety start to ramp up, like before a meeting." },
        { id: 2, timestamp: 15800, text: "Therapist: That's great to hear that you tried it and noticed some benefit, especially in those moments before meetings. Can you describe what 'helping a bit' feels like? What changes did you notice?" },
        { id: 3, timestamp: 24500, text: "John: Well, normally my heart would be pounding, and my thoughts would be racing about everything that could go wrong. When I did the deep breaths for a minute or two, it felt like... things slowed down slightly. The physical pounding wasn't quite as intense." },
        { id: 4, timestamp: 33200, text: "Therapist: Slowing down, less intense physical sensations – those are positive shifts. It sounds like the breathing anchored you in the present moment, even just briefly, interrupting that cycle of racing thoughts and physical response. Were there times you intended to practice but didn't?" },
        { id: 5, timestamp: 42900, text: "John: Yeah, definitely. Mostly in the evenings. I'd tell myself I should do the 5-minute body scan we discussed, but then I'd get distracted by TV or scrolling on my phone, or just feel too tired." },
        { id: 6, timestamp: 51300, text: "Therapist: That's very common. Building a new habit takes time and mindfulness itself isn't about forcing relaxation, but more about noticing what's happening without judgment. What thoughts came up when you considered doing the body scan but then got distracted?" },
        { id: 7, timestamp: 60100, text: "John: Things like, 'I'm too tired for this,' or 'It probably won't help anyway,' or sometimes just 'I deserve to relax and zone out.' It felt like another chore sometimes." },
        { id: 8, timestamp: 68800, text: "Therapist: Acknowledging those thoughts is part of the process. 'Too tired,' 'won't help,' 'deserve to zone out,' 'a chore.' Instead of battling those thoughts, mindfulness invites us to just notice them, like clouds passing. Perhaps we can reframe it not as a chore, but as a brief moment of checking in with yourself. Did you notice any other moments of anxiety during the week where you didn't use the techniques?" },
        { id: 9, timestamp: 80500, text: "John: Yes, on Tuesday I got some critical feedback on a report I wrote. I felt that immediate wave of anxiety, that 'I messed up' feeling. I completely forgot about the breathing then, just kind of spiraled for a bit." },
        { id: 10, timestamp: 89900, text: "Therapist: Okay, so receiving critical feedback was a trigger. That's a challenging situation. It's perfectly normal to forget the tools when strong emotions hit, especially early on. The goal isn't perfection, but practice and awareness. The fact you recognized it now is valuable. What did that 'spiraling' look like for you?" },
        { id: 11, timestamp: 99600, text: "John: Just replaying the feedback in my head, thinking about how my boss must think I'm incompetent, worrying about my job. It took me a while to shake it off." },
        { id: 12, timestamp: 106300, text: "Therapist: That internal replay and catastrophic thinking is where anxiety can really take hold. Perhaps next time a similar situation arises, the intention could simply be to notice the initial feeling and the urge to spiral, even if you don't immediately jump to a breathing exercise. Just the noticing is a mindful step." }
    ],
    status: 'completed',
    whisperJobId: null,
    chats: [
      { name: 'Mindfulness Check-in', messages: [ { sender: 'user', text: 'How’s John doing with anxiety?' }, { sender: 'ai', text: 'John reported that the breathing exercises helped reduce the intensity of physical anxiety symptoms before meetings. However, he struggled to practice consistently, especially in the evenings, and forgot to use the techniques when triggered by critical feedback at work.' }, ] },
      { name: undefined, messages: [ { sender: 'user', text: 'What triggers John\'s anxiety according to the session?' }, { sender: 'ai', text: 'The session identified specific triggers for John\'s anxiety, including upcoming meetings and receiving critical feedback on his work.' }, ] },
      { name: 'Therapist Techniques', messages: [ { sender: 'user', text: 'What techniques did the therapist suggest or reinforce?' }, { sender: 'ai', text: 'The therapist reinforced the use of breathing exercises and the 5-minute body scan. They also reframed mindfulness practice as "checking in" rather than a chore and suggested simply noticing the initial anxious feeling and urge to spiral in triggering situations as a first step.' }, ] },
    ],
  },
   // Add another session on the same day for sorting check
  {
    localIdRef: 3,
    fileName: 'session3.mp3',
    clientName: 'Jane Doe',
    sessionName: 'Follow-up CBT',
    date: createIsoTimestamp('2025-04-01', 60), // Same day, but later time
    sessionType: 'Individual',
    therapy: 'CBT',
    transcriptContent: [ { id: 0, timestamp: 0, text: "Therapist: Welcome back, Jane. How was your week?" }, { id: 1, timestamp: 3000, text: "Jane: Better, I think. I tried noticing those automatic thoughts we talked about." } ],
    status: 'completed',
    whisperJobId: null,
    chats: [], // No chats initially
  },
];

async function preloadDatabase() {
    // --- Use paths resolved relative to this script ---
    console.log(`[Preload] Database file target: ${dbPath}`);
    console.log(`[Preload] Transcripts directory target: ${transcriptsBaseDir}`);

    // Ensure DB file is deleted before preloading for clean slate
    console.log(`[Preload] Attempting to delete existing database file: ${dbPath}`);
    try {
        await fs.unlink(dbPath);
        console.log(`[Preload] Deleted existing database file.`);
    } catch (err: any) {
        if (err.code === 'ENOENT') {
             console.log(`[Preload] Database file not found (ENOENT), proceeding.`);
        } else {
             console.error(`[Preload] Error deleting existing database file:`, err);
             // Don't exit immediately, let directory creation handle it
        }
    }

    // --- Ensure the target directory exists ---
    console.log(`[Preload] Ensuring database directory exists: ${dbDir}`);
    try {
        await fs.mkdir(dbDir, { recursive: true });
        console.log(`[Preload] Database directory confirmed/created: ${dbDir}`);
    } catch (err) {
         console.error(`[Preload] Failed to create database directory ${dbDir}:`, err);
         process.exit(1); // Exit if we can't create the directory
    }
    // --- End Directory Check ---

    // --- Connect using the resolved path ---
    console.log(`[Preload] Connecting to database at ${dbPath}`);
    let db: Database.Database | null = null; // Initialize as null
    let success = false;

    const fileWritePromises: Promise<void>[] = [];
    const sessionsToVerify: { name: string; expectedPathEnding: string; expectedDate: string }[] = [];

    try {
        // --- Initialize DB Connection Inside Try ---
        db = new Database(dbPath, { verbose: console.log });
        console.log(`[Preload] Database connection established: ${dbPath}`);
        // --- End Initialization ---


        console.log(`[Preload] Ensuring transcript directory exists: ${transcriptsBaseDir}`);
        await fs.mkdir(transcriptsBaseDir, { recursive: true });
        console.log(`[Preload] Transcript directory confirmed/created.`);

        // Initialize the schema using the imported function
        console.log('[Preload] Initializing database schema...');
        initializeDatabase(db); // This function needs the DB instance
        console.log('[Preload] Database schema initialized.');

        // Prepare statements (now safe, tables exist)
        const insertSession = db.prepare(/* SQL */ `
          INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, transcriptPath, status, whisperJobId)
          VALUES (@fileName, @clientName, @sessionName, @date, @sessionType, @therapy, NULL, @status, @whisperJobId)
        `);
        const updateSessionPath = db.prepare(/* SQL */ `
          UPDATE sessions SET transcriptPath = ? WHERE id = ?
        `);
        const insertChat = db.prepare(/* SQL */ `
          INSERT INTO chats (sessionId, timestamp, name)
          VALUES (?, ?, ?)
        `);
        const insertMessage = db.prepare(/* SQL */ `
          INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        console.log('[Preload] Starting DB transaction for data insertion...');
        db.transaction(() => {
            for (const session of sampleSessions) {
                // Insert session with ISO timestamp
                const sessionResult = insertSession.run({
                    fileName: session.fileName,
                    clientName: session.clientName,
                    sessionName: session.sessionName,
                    date: session.date, // Insert the ISO string
                    sessionType: session.sessionType,
                    therapy: session.therapy,
                    status: session.status,
                    whisperJobId: session.whisperJobId
                });
                const sessionId = sessionResult.lastInsertRowid as number;

                // Use correctly resolved transcriptsBaseDir
                const correctTranscriptPath = path.join(transcriptsBaseDir, `${sessionId}.json`);
                const expectedPathEnding = `${sessionId}.json`;
                updateSessionPath.run(correctTranscriptPath, sessionId);

                console.log(`[Preload DB] Added session ${sessionId}: ${session.sessionName} (Date: ${session.date}). Path set to: ${correctTranscriptPath}`);
                sessionsToVerify.push({ name: session.sessionName, expectedPathEnding, expectedDate: session.date });

                const transcriptJson = JSON.stringify(session.transcriptContent, null, 2);
                fileWritePromises.push(
                    fs.writeFile(correctTranscriptPath, transcriptJson, 'utf-8')
                        .then(() => console.log(`[Preload Files] Successfully wrote transcript to ${correctTranscriptPath}`))
                        .catch(err => {
                             console.error(`[Preload Files] Error writing transcript ${correctTranscriptPath}:`, err);
                             throw new Error(`Failed to write transcript for session ${sessionId}`);
                        })
                );

                for (const chat of session.chats) {
                    const timestamp = Date.now() + Math.floor(Math.random() * 1000); // Add small random offset for demo sorting
                    const chatResult = insertChat.run(sessionId, timestamp, chat.name === undefined ? null : chat.name);
                    const chatId = chatResult.lastInsertRowid;
                    for (const message of chat.messages) {
                        // Use timestamp slightly offset from chat timestamp for realism
                        const messageTimestamp = timestamp + Math.floor(Math.random() * 100);
                        insertMessage.run(chatId, message.sender, message.text, messageTimestamp, null, null);
                    }
                }
            }
        })(); // End of transaction

        console.log('[Preload] DB transaction committed.');
        console.log(`[Preload] Waiting for ${fileWritePromises.length} transcript file(s) to be written...`);
        await Promise.all(fileWritePromises);
        console.log('[Preload] All transcript files written successfully.');

        success = true;

    } catch (error) {
        console.error('[Preload] Error during preloading process:', error);
        success = false; // Ensure success is false on error
        // If the error is the Disk I/O error, provide more context
        if (error instanceof Error && error.message.includes('disk I/O error')) {
            console.error('[Preload Hint] Disk I/O errors often relate to permissions, file locking, or directory issues.');
            console.error(`[Preload Hint] Check write permissions for the target directory: ${dbDir}`);
            console.error('[Preload Hint] Ensure no other process is holding the database file open.');
        }
    } finally {
        // --- Verification Step ---
        // Check if db was successfully initialized before verifying
        if (success && db && db.open) {
            console.log('[Preload Verification] Checking database entries...');
            try {
                const verifyStmt = db.prepare('SELECT id, status, transcriptPath, date FROM sessions WHERE sessionName = ?');
                let verificationPassed = true;

                for (const sessionToVerify of sessionsToVerify) {
                    const dbSession: SessionVerificationData | undefined = verifyStmt.get(sessionToVerify.name) as SessionVerificationData | undefined;
                    console.log(`[Preload Verification] Data for name '${sessionToVerify.name}':`, dbSession);

                    if (!dbSession) {
                        console.error(`[Preload Verification] FAILED: Session '${sessionToVerify.name}' not found in DB!`);
                        verificationPassed = false; continue;
                    }
                    if (dbSession.status !== 'completed') {
                        console.error(`[Preload Verification] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) has status '${dbSession.status}', expected 'completed'.`);
                        verificationPassed = false;
                    }
                    if (dbSession.date !== sessionToVerify.expectedDate) {
                        console.error(`[Preload Verification] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) has date '${dbSession.date}', expected '${sessionToVerify.expectedDate}'.`);
                         verificationPassed = false;
                    }
                    if (!dbSession.transcriptPath || !dbSession.transcriptPath.endsWith(sessionToVerify.expectedPathEnding)) {
                        console.error(`[Preload Verification] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) path '${dbSession.transcriptPath}' mismatch or missing.`);
                        verificationPassed = false;
                    } else {
                        try { await fs.access(dbSession.transcriptPath); }
                        catch (fileError) { console.error(`[Preload Verification] FAILED: File check failed for path '${dbSession.transcriptPath}'. Error: ${fileError}`); verificationPassed = false; }
                    }
                }

                if(verificationPassed) console.log('[Preload Verification] All database entries and file checks look OK.');
                else { console.error('[Preload Verification] One or more verification checks FAILED.'); success = false; }

            } catch(verifyError) { console.error('[Preload Verification] Error checking DB entries:', verifyError); success = false; }
        } else if (!db) {
             console.error('[Preload] Database connection was not established. Skipping verification.');
             success = false; // Ensure success is false if DB connection failed
        }
        // --- End Verification ---

        // --- Close DB Connection ---
        if (db && db.open) {
             db.close();
             console.log('[Preload] Database connection closed.');
        }
        // --- End Close ---

        if (success) console.log('[Preload] Database preloaded successfully!');
        else { console.error('[Preload] Database preloading FAILED. Please check errors above.'); process.exitCode = 1; }
    }
}

// Execute the preload
preloadDatabase().catch(err => {
  console.error('[Preload] Fatal error during execution:', err);
  process.exit(1);
});
