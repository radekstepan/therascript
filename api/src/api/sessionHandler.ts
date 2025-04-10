// src/api/sessionHandler.ts
import { Request, Response, NextFunction } from 'express';
import path from 'path';
// --- Corrected Relative Imports ---
import { sessionRepository } from '../repositories/sessionRepository';
import { chatRepository } from '../repositories/chatRepository';
// --- Other Imports ---
import {
    loadTranscriptContent,
    saveTranscriptContent,
    deleteTranscriptFile,
    deleteUploadedFile
} from '../services/fileService';
import { transcribeAudio } from '../services/transcriptionService';
import { createSessionListDTO, updateParagraphInTranscript, isNodeError } from '../utils/helpers';
import type { BackendSession, BackendSessionMetadata, BackendChatSession } from '../types';
import config from '../config';

// GET / - List all sessions (metadata only)
export const listSessions = (req: Request, res: Response, next: NextFunction): void => {
    try {
        const sessions = sessionRepository.findAll();
        // Explicitly type 's' in map function
        const sessionDTOs = sessions.map((s: BackendSession) => createSessionListDTO(s));
        res.status(200).json(sessionDTOs);
    } catch (error) {
        console.error("[API Error] listSessions:", error);
        next(error); // Pass errors to central handler
    }
};

// POST /upload - Upload audio and metadata
export const uploadSession = async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
    let metadata: BackendSessionMetadata;
    // --- Metadata Parsing and Validation ---
    try {
        if (req.body.metadata) {
             if (typeof req.body.metadata === 'string') {
                 metadata = JSON.parse(req.body.metadata);
             } else if (typeof req.body.metadata === 'object') {
                 metadata = req.body.metadata;
             } else {
                  throw new Error("Field 'metadata' has invalid type.");
             }
        } else {
            // Fallback to individual fields
            metadata = {
                clientName: req.body.clientName, sessionName: req.body.sessionName,
                date: req.body.date, sessionType: req.body.sessionType, therapy: req.body.therapy,
            };
        }
        // Basic field presence check
        if (!metadata.clientName || !metadata.sessionName || !metadata.date || !metadata.sessionType || !metadata.therapy) {
             throw new Error('Missing required metadata fields (clientName, sessionName, date, sessionType, therapy).');
        }
        // Date format validation
        if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.date)) {
             throw new Error('Invalid date format. Please use YYYY-MM-DD.');
        }
    } catch (parseError) {
        // If metadata parsing fails, delete uploaded file if it exists
        if (req.file?.path) await deleteUploadedFile(req.file.path);
        console.error('[API Error] Metadata processing error:', parseError);
        return res.status(400).json({ error: 'Invalid or missing metadata.', details: (parseError as Error).message });
    }
    // --- End Metadata Parsing ---

    // --- File Validation ---
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file uploaded.' });
    }
    // Check mimetype more reliably
    if (!req.file.mimetype || !req.file.mimetype.startsWith('audio/')) {
         // Clean up invalid file
         await deleteUploadedFile(req.file.path);
         return res.status(400).json({ error: `Invalid file type: ${req.file.mimetype}. Please upload an audio file.` });
    }
    // --- End File Validation ---

    const audioFilePath = req.file.path;
    const originalFileName = req.file.originalname;
    let newSession: BackendSession | null = null; // To hold created session for potential cleanup
    let savedTranscriptPath: string | null = null; // To hold saved transcript path for potential cleanup

    try {
        // 1. Transcribe Audio
        console.log(`[API] Starting transcription for ${originalFileName}...`);
        const transcriptContent = await transcribeAudio(audioFilePath);
        console.log(`[API] Transcription finished for ${originalFileName}.`);

        // 2. Determine transcript path placeholder (before we have the ID)
        const tempTranscriptPath = path.join(config.db.transcriptsDir, `temp-${Date.now()}.txt`);

        // 3. Create Session record in DB (this gives us the session ID)
        newSession = sessionRepository.create(metadata, originalFileName, tempTranscriptPath);
        // --- ADDED NULL CHECK ---
        if (!newSession) {
            throw new Error('Failed to create session record in the database.');
        }
        const sessionId = newSession.id; // Safe to access id now
        // --- END NULL CHECK ---
        const finalTranscriptPath = path.join(config.db.transcriptsDir, `${sessionId}.txt`); // Correct path using ID

        // 4. Save transcript content to the final path
        savedTranscriptPath = await saveTranscriptContent(sessionId, transcriptContent);
        // It's good practice to ensure the saved path matches expectations
        if (savedTranscriptPath !== finalTranscriptPath) {
             console.warn(`[API] Transcript saved path mismatch: Expected ${finalTranscriptPath}, Got ${savedTranscriptPath}. Attempting to update DB record.`);
             // Update DB record if the path differs (e.g., due to filesystem behavior)
             const sessionAfterPathCorrection = sessionRepository.updateMetadata(sessionId, { transcriptPath: savedTranscriptPath });
             // --- ADDED NULL CHECK for update ---
             if (!sessionAfterPathCorrection) throw new Error(`Failed to correct transcript path for session ${sessionId}.`);
             newSession = sessionAfterPathCorrection; // Use the corrected session data
             // --- END NULL CHECK for update ---
        } else {
             // If paths match, update the placeholder path in the DB record
              const sessionAfterPathUpdate = sessionRepository.updateMetadata(sessionId, { transcriptPath: finalTranscriptPath });
              // --- ADDED NULL CHECK for update ---
              if (!sessionAfterPathUpdate) throw new Error(`Failed to update transcript path for session ${sessionId}.`);
              newSession = sessionAfterPathUpdate; // Use the updated session data
              // --- END NULL CHECK for update ---
        }

        // 5. Create an initial chat for the new session
        const initialChat = chatRepository.createChat(sessionId);
        // Add an introductory message to the new chat
        chatRepository.addMessage(
             initialChat.id, 'ai',
             `Session "${metadata.sessionName}" (${metadata.date}) transcribed and loaded. Ask me anything.`
         );

        // 6. Fetch the complete session data (including the new chat) for the response
        const finalSessionState = sessionRepository.findById(sessionId);
         if (!finalSessionState) {
             // This indicates a serious issue if the session vanished after creation/update
             throw new Error(`Critical Error: Failed to fetch final state for newly created session ${sessionId}`);
         }
        // Fetch associated chats separately
        const chats = chatRepository.findChatsBySessionId(sessionId);
        // Combine session data with its chats for the final response object
        const responseSession = { ...finalSessionState, chats };

        console.log(`[API] Successfully created session ${sessionId} from upload: ${originalFileName}`);
        // Send the 201 Created response with the new session data
        res.status(201).json(responseSession);

    } catch (error) {
        // --- Error Handling & Cleanup ---
        console.error('[API Error] Error during session upload processing:', error);
        // Attempt to clean up artifacts if session creation was partially successful
        if (newSession?.id) {
            console.log(`[API Cleanup] Attempting cleanup for partially created session ${newSession.id}...`);
            try {
                // Delete transcript file using session ID (safer than using potentially incorrect savedTranscriptPath)
                await deleteTranscriptFile(newSession.id);
                // Delete session record from DB (this should cascade to chats/messages)
                sessionRepository.deleteById(newSession.id);
                console.log(`[API Cleanup] Cleanup successful for session ${newSession.id}.`);
            } catch (cleanupError) {
                // Log cleanup errors but don't overwrite the original error passed to next()
                console.error(`[API Cleanup] Error during cleanup for session ${newSession.id}:`, cleanupError);
            }
        }
        // Pass the original error to the central error handler middleware
        next(error);
        // --- End Error Handling & Cleanup ---
    } finally {
        // --- File Deletion ---
        // Always attempt to delete the temporary uploaded file from the uploads directory
        // Check if req.file exists before accessing path
        if (audioFilePath) {
             await deleteUploadedFile(audioFilePath);
        }
        // --- End File Deletion ---
    }
};


// GET /:sessionId - Get full session details
export const getSessionDetails = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const session: BackendSession = (req as any).sessionData; // Session guaranteed by middleware
    try {
        // Load transcript content for the session
        const transcriptContent = await loadTranscriptContent(session.id);
        // Load all chats associated with the session
        const chats = chatRepository.findChatsBySessionId(session.id);
        // Combine session data, transcript, and chats into one response object
        const fullSessionDetails = { ...session, transcriptContent, chats };
        res.status(200).json(fullSessionDetails);
    } catch (error) {
        console.error(`[API Error] getSessionDetails (ID: ${session?.id}):`, error);
        next(error); // Pass errors (e.g., file read, DB error)
    }
};

// PUT /:sessionId/metadata - Update metadata
export const updateSessionMetadata = (req: Request, res: Response, next: NextFunction): void | Response => {
    const session: BackendSession = (req as any).sessionData; // Session guaranteed by middleware
    const sessionId: number = session.id;
    const updatedMetadata: Partial<BackendSessionMetadata> = req.body;

    // --- Validation ---
    const allowedKeys: (keyof BackendSessionMetadata)[] = ['clientName', 'sessionName', 'date', 'sessionType', 'therapy'];
    for (const key in updatedMetadata) {
        // Ensure only allowed keys are present
        if (!allowedKeys.includes(key as keyof BackendSessionMetadata)) {
            return res.status(400).json({ error: `Invalid metadata key provided: ${key}` });
        }
        // Validate date format if provided
        if (key === 'date' && updatedMetadata.date && !/^\d{4}-\d{2}-\d{2}$/.test(updatedMetadata.date)) {
             return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD.' });
        }
        // Add more specific validation if needed (e.g., check sessionType/therapy against known values)
    }
    // Check if there's actually anything to update
    if (Object.keys(updatedMetadata).length === 0) {
         return res.status(400).json({ error: 'No metadata provided for update.' });
    }
    // --- End Validation ---

    try {
        // Update the session metadata in the repository
        const updatedSession = sessionRepository.updateMetadata(sessionId, updatedMetadata);
        // Check if the update was successful (session might have been deleted concurrently)
        if (!updatedSession) {
            return res.status(404).json({ error: `Session with ID ${sessionId} not found during update attempt.` });
        }
        console.log(`[API] Updated metadata for session ${sessionId}`);
        // Return the complete, updated session object
        res.status(200).json(updatedSession);
    } catch (error) {
        console.error(`[API Error] updateSessionMetadata (ID: ${sessionId}):`, error);
        next(error); // Pass DB errors
    }
};

// GET /:sessionId/transcript - Get transcript content only
export const getTranscript = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const sessionId: number = (req as any).sessionData.id; // Get ID from middleware-loaded session
    try {
        // Load only the transcript content
        const transcriptContent = await loadTranscriptContent(sessionId);
        // Handle case where transcript might be empty string vs not found?
        // loadTranscriptContent returns '' if not found, which is acceptable here.
        res.status(200).json({ transcriptContent });
    } catch (error) {
        console.error(`[API Error] getTranscript (ID: ${sessionId}):`, error);
        next(error); // Pass file system errors
    }
};

// PATCH /:sessionId/transcript - Update a specific paragraph
export const updateTranscriptParagraph = async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
    const sessionId: number = (req as any).sessionData.id; // Get ID from middleware-loaded session
    const { paragraphIndex, newText } = req.body;

    // --- Input Validation ---
    if (typeof paragraphIndex !== 'number' || !Number.isInteger(paragraphIndex) || paragraphIndex < 0) {
        return res.status(400).json({ error: 'Invalid body: requires paragraphIndex (non-negative integer).' });
    }
    if (typeof newText !== 'string') { // Allow empty string for clearing
        return res.status(400).json({ error: 'Invalid body: requires newText (string).' });
    }
    // --- End Input Validation ---

    try {
        // Load the current transcript content
        const currentTranscript = await loadTranscriptContent(sessionId);
        // Handle case where transcript doesn't exist or fails to load
        if (currentTranscript === null || currentTranscript === undefined) {
             return res.status(404).json({ error: `Transcript for session ${sessionId} not found or couldn't be loaded.` });
        }

        // Use the helper function to generate the potentially modified transcript string
        const updatedTranscript = updateParagraphInTranscript(currentTranscript, paragraphIndex, newText);

        // Only save the file back to disk if the content actually changed
        if (updatedTranscript !== currentTranscript) {
            await saveTranscriptContent(sessionId, updatedTranscript);
            console.log(`[API] Updated paragraph ${paragraphIndex} for session ${sessionId}`);
        } else {
             console.log(`[API] No change needed for paragraph ${paragraphIndex} in session ${sessionId} (content identical).`);
        }

        // Always return the latest transcript content (may be unchanged or updated)
        res.status(200).json({ transcriptContent: updatedTranscript });
    } catch (error) {
        console.error(`[API Error] updateTranscriptParagraph (ID: ${sessionId}, Index: ${paragraphIndex}):`, error);
        next(error); // Pass file system or helper errors
    }
};
