// <file path="packages/api/src/preloadDb.ts">
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import config from './config/index.js'; // Use config

// Use config path
const dbPath = config.db.sqlitePath;
// Use config path for transcripts directory
const transcriptsBaseDir = config.db.transcriptsDir;

// Type for Verification Step
interface SessionVerificationData {
    id: number;
    status: string;
    transcriptPath: string | null;
}

// Sample data - REMOVED transcriptPath pre-calculation
const sampleSessions = [
  {
    // Local ID is only for reference within this array if needed, NOT for DB ID or file path
    localIdRef: 1,
    fileName: 'session1.mp3',
    clientName: 'Jane Doe',
    sessionName: 'Initial Consultation', // Use this for verification query
    date: '2025-04-01',
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
    status: 'completed', // Set status directly
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
    sessionName: 'Follow-up Session', // Use this for verification query
    date: '2025-04-02',
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
    status: 'completed', // Set status directly
    whisperJobId: null,
    chats: [
      { name: 'Mindfulness Check-in', messages: [ { sender: 'user', text: 'How’s John doing with anxiety?' }, { sender: 'ai', text: 'John reported that the breathing exercises helped reduce the intensity of physical anxiety symptoms before meetings. However, he struggled to practice consistently, especially in the evenings, and forgot to use the techniques when triggered by critical feedback at work.' }, ] },
      { name: undefined, messages: [ { sender: 'user', text: 'What triggers John\'s anxiety according to the session?' }, { sender: 'ai', text: 'The session identified specific triggers for John\'s anxiety, including upcoming meetings and receiving critical feedback on his work.' }, ] },
      { name: 'Therapist Techniques', messages: [ { sender: 'user', text: 'What techniques did the therapist suggest or reinforce?' }, { sender: 'ai', text: 'The therapist reinforced the use of breathing exercises and the 5-minute body scan. They also reframed mindfulness practice as "checking in" rather than a chore and suggested simply noticing the initial anxious feeling and urge to spiral in triggering situations as a first step.' }, ] },
    ],
  },
];

async function preloadDatabase() {
  console.log(`[Preload] Connecting to database at ${dbPath}`);
  const db = new Database(dbPath, { verbose: console.log, fileMustExist: false });
  let success = false;

  const fileWritePromises: Promise<void>[] = [];
  const sessionsToVerify: { name: string; expectedPathEnding: string }[] = []; // Store info for verification

  try {
    console.log(`[Preload] Ensuring transcript directory exists: ${transcriptsBaseDir}`);
    await fs.mkdir(transcriptsBaseDir, { recursive: true });
    console.log(`[Preload] Transcript directory confirmed/created.`);

    console.log('[Preload] Clearing existing data...');
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM chats');
    db.exec('DELETE FROM sessions');
    console.log('[Preload] Existing data cleared.');

    // Prepare statements
    const insertSession = db.prepare(`
      INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, transcriptPath, status, whisperJobId)
      VALUES (@fileName, @clientName, @sessionName, @date, @sessionType, @therapy, NULL, @status, @whisperJobId)
    `);
    const updateSessionPath = db.prepare(`
      UPDATE sessions SET transcriptPath = ? WHERE id = ?
    `);
    const insertChat = db.prepare(`
      INSERT INTO chats (sessionId, timestamp, name)
      VALUES (?, ?, ?)
    `);
    const insertMessage = db.prepare(`
      INSERT INTO messages (chatId, sender, text, timestamp)
      VALUES (?, ?, ?, ?)
    `);

    console.log('[Preload] Starting DB transaction...');
    db.transaction(() => {
      for (const session of sampleSessions) {
        // 1. Insert session data, leaving transcriptPath as NULL for now
        const sessionResult = insertSession.run({
          fileName: session.fileName,
          clientName: session.clientName,
          sessionName: session.sessionName,
          date: session.date,
          sessionType: session.sessionType,
          therapy: session.therapy,
          // transcriptPath is NULL here
          status: session.status,
          whisperJobId: session.whisperJobId
        });
        const sessionId = sessionResult.lastInsertRowid as number; // Get the actual inserted ID

        // 2. Construct the CORRECT transcript path using the actual sessionId
        const correctTranscriptPath = path.join(transcriptsBaseDir, `${sessionId}.json`);
        const expectedPathEnding = `${sessionId}.json`; // Store for verification

        // 3. Update the session row with the correct path
        updateSessionPath.run(correctTranscriptPath, sessionId);

        console.log(`[Preload DB] Added session ${sessionId}: ${session.sessionName} (Status: ${session.status}). Path set to: ${correctTranscriptPath}`);
        sessionsToVerify.push({ name: session.sessionName, expectedPathEnding }); // Add to verification list

        // 4. Prepare file writing using the CORRECT path
        const transcriptJson = JSON.stringify(session.transcriptContent, null, 2);
        fileWritePromises.push(
          fs.writeFile(correctTranscriptPath, transcriptJson, 'utf-8') // Use correct path
            .then(() => console.log(`[Preload Files] Successfully wrote transcript to ${correctTranscriptPath}`))
            .catch(err => {
                 console.error(`[Preload Files] Error writing transcript ${correctTranscriptPath}:`, err);
                 throw new Error(`Failed to write transcript for session ${sessionId}`);
            })
        );

        // 5. Insert chats and messages (as before)
        for (const chat of session.chats) {
          const timestamp = Date.now();
          const chatResult = insertChat.run(sessionId, timestamp, chat.name || null);
          const chatId = chatResult.lastInsertRowid;
          for (const message of chat.messages) {
            const messageTimestamp = Date.now() + Math.floor(Math.random() * 100);
            insertMessage.run(chatId, message.sender, message.text, messageTimestamp);
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
    success = false;
  } finally {
    // --- Verification Step (Corrected Loop Variable) ---
    if (success && db.open) {
        console.log('[Preload Verification] Checking database entries and file existence...');
        try {
            const verifyStmt = db.prepare('SELECT id, status, transcriptPath FROM sessions WHERE sessionName = ?');
            let verificationPassed = true; // Track overall verification

            // *** CORRECTED: Use the array name `sessionsToVerify` here ***
            for (const sessionToVerify of sessionsToVerify) {
                const dbSession: SessionVerificationData | undefined = verifyStmt.get(sessionToVerify.name) as SessionVerificationData | undefined;
                console.log(`[Preload Verification] Data for name '${sessionToVerify.name}':`, dbSession);

                if (!dbSession) {
                    console.error(`[Preload Verification] FAILED: Session '${sessionToVerify.name}' not found in DB!`);
                    verificationPassed = false;
                    continue; // Skip further checks for this session
                }
                if (dbSession.status !== 'completed') {
                    console.error(`[Preload Verification] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) has status '${dbSession.status}', expected 'completed'.`);
                    verificationPassed = false;
                }
                if (!dbSession.transcriptPath) {
                     console.error(`[Preload Verification] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) has NULL transcriptPath in DB.`);
                    verificationPassed = false;
                } else if (!dbSession.transcriptPath.endsWith(sessionToVerify.expectedPathEnding)) {
                    console.error(`[Preload Verification] FAILED: Session '${sessionToVerify.name}' (ID: ${dbSession.id}) path '${dbSession.transcriptPath}' doesn't end with expected '${sessionToVerify.expectedPathEnding}'.`);
                    verificationPassed = false;
                } else {
                    // Check if the file actually exists at the path stored in DB
                    try {
                        await fs.access(dbSession.transcriptPath);
                        console.log(`[Preload Verification] File check PASSED for path: ${dbSession.transcriptPath}`);
                    } catch (fileError) {
                        console.error(`[Preload Verification] FAILED: File check failed for path '${dbSession.transcriptPath}'. Error: ${fileError}`);
                        verificationPassed = false;
                    }
                }
            } // End loop

            if(verificationPassed) {
                console.log('[Preload Verification] All database entries and file checks look OK.');
            } else {
                 console.error('[Preload Verification] One or more verification checks FAILED.');
                 success = false; // Ensure overall success reflects verification failure
            }

        } catch(verifyError) {
             console.error('[Preload Verification] Error checking DB entries:', verifyError);
             success = false;
        }
    }
    // --- End Verification ---

    if (db.open) {
        db.close();
        console.log('[Preload] Database connection closed.');
    }
    if (success) {
        console.log('[Preload] Database preloaded successfully!');
    } else {
         console.error('[Preload] Database preloading FAILED. Please check errors above.');
         process.exitCode = 1;
    }
  }
}

// Execute the preload
preloadDatabase().catch(err => {
  console.error('[Preload] Fatal error during execution:', err);
  process.exit(1);
});
// </file>