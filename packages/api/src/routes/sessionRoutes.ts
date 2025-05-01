// =========================================
// File: packages/api/src/routes/sessionRoutes.ts
// =========================================
import { Elysia, t, type Static, type Context as ElysiaContext, type Cookie } from 'elysia';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs'; // Sync version for stat check
import { Readable } from 'node:stream';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import { transcriptRepository } from '../repositories/transcriptRepository.js'; // <-- Import Transcript Repo
import { messageRepository } from '../repositories/messageRepository.js'; // <-- Import Message Repo
import {
    listSessions, getSessionDetails, updateSessionMetadata,
    getTranscript, updateTranscriptParagraph,
    deleteSessionAudioHandler
} from '../api/sessionHandler.js';
// --- Import from tokenizerService ---
import { calculateTokenCount } from '../services/tokenizerService.js';
import {
    // --- REMOVED saveTranscriptContent, deleteTranscriptFile ---
    deleteUploadedAudioFile,
    saveUploadedAudio,
    getAudioAbsolutePath,
} from '../services/fileService.js';
import {
    startTranscriptionJob,
    getTranscriptionStatus,
    getStructuredTranscriptionResult,
} from '../services/transcriptionService.js';
import type {
    BackendSession,
    BackendSessionMetadata,
    StructuredTranscript,
    TranscriptParagraphData,
    WhisperJobStatus,
    ChatMetadata,
} from '../types/index.js';
import { NotFoundError, InternalServerError, ApiError, BadRequestError, ConflictError } from '../errors.js';
import config from '../config/index.js';

// --- Schemas ---
const SessionIdParamSchema = t.Object({ sessionId: t.String({ pattern: '^[0-9]+$', error: "Session ID must be a positive number" }) });
const JobIdParamSchema = t.Object({ jobId: t.String({ minLength: 1, error: "Job ID must be provided" }) });
const ParagraphUpdateBodySchema = t.Object({ paragraphIndex: t.Numeric({ minimum: 0, error: "Paragraph index must be 0 or greater" }), newText: t.String() });
// Remove transcriptPath from metadata update body
const SessionMetadataUpdateBodySchema = t.Partial(t.Object({
    clientName: t.Optional(t.String({ minLength: 1 })), sessionName: t.Optional(t.String({ minLength: 1 })),
    date: t.Optional(t.RegExp(/^\d{4}-\d{2}-\d{2}$/, { error: "Date must be YYYY-MM-DD" })),
    sessionType: t.Optional(t.String({ minLength: 1 })), therapy: t.Optional(t.String({ minLength: 1 })),
    fileName: t.Optional(t.String()), status: t.Optional(t.Union([ t.Literal('pending'), t.Literal('transcribing'), t.Literal('completed'), t.Literal('failed') ])),
    whisperJobId: t.Optional(t.Union([t.String(), t.Null()])), audioPath: t.Optional(t.Union([t.String(), t.Null()])),
    transcriptTokenCount: t.Optional(t.Union([t.Number(), t.Null()])),
}));
// Remove transcriptPath from metadata response schema
const SessionMetadataResponseSchema = t.Object({
    id: t.Number(), fileName: t.String(), clientName: t.String(), sessionName: t.String(), date: t.String(),
    sessionType: t.String(), therapy: t.String(),
    // transcriptPath: t.Union([t.String(), t.Null()]), // Removed
    audioPath: t.Union([t.String(), t.Null()]), status: t.String(), whisperJobId: t.Union([t.String(), t.Null()]),
    transcriptTokenCount: t.Optional(t.Union([t.Number(), t.Null()])),
});
const SessionListResponseItemSchema = SessionMetadataResponseSchema;

// Chat Metadata Schema for session chats (explicitly omit tags)
const SessionChatMetadataSchema = t.Omit(t.Object({ // Use t.Omit if ChatMetadata includes tags
    id: t.Number(), sessionId: t.Number(), timestamp: t.Number(), name: t.Optional(t.Union([t.String(), t.Null()])), tags: t.Optional(t.Any()) // Include tags temporarily for Omit
}), ['tags']); // Omit tags for session-specific chat metadata

// Remove transcriptPath from Session With Chats response schema
const SessionWithChatsMetadataResponseSchema = t.Object({
    id: t.Number(), fileName: t.String(), clientName: t.String(), sessionName: t.String(), date: t.String(),
    sessionType: t.String(), therapy: t.String(),
    // transcriptPath: t.Union([t.String(), t.Null()]), // Removed
    audioPath: t.Union([t.String(), t.Null()]), status: t.String(), whisperJobId: t.Union([t.String(), t.Null()]),
    transcriptTokenCount: t.Optional(t.Union([t.Number(), t.Null()])),
    chats: t.Array(SessionChatMetadataSchema) // Use schema without tags
});

// Keep TranscriptParagraphSchema and TranscriptResponseSchema
const TranscriptParagraphSchema = t.Object({ id: t.Number(), timestamp: t.Number(), text: t.String() });
const TranscriptResponseSchema = t.Array(TranscriptParagraphSchema);
const UploadBodySchema = t.Object({ audioFile: t.File({ error: "Audio file required." }), clientName: t.String({ minLength: 1, error: "Client name required." }), sessionName: t.String({ minLength: 1, error: "Session name required." }), date: t.RegExp(/^\d{4}-\d{2}-\d{2}$/, { error: "Date must be YYYY-MM-DD." }), sessionType: t.String({ minLength: 1, error: "Session type required." }), therapy: t.String({ minLength: 1, error: "Therapy type required." }) });
const TranscriptionStatusResponseSchema = t.Object({ job_id: t.String(), status: t.Union([ t.Literal("queued"), t.Literal("processing"), t.Literal("completed"), t.Literal("failed"), t.Literal("canceled"), ]), progress: t.Optional(t.Number()), error: t.Optional(t.Union([t.String(), t.Null()])), duration: t.Optional(t.Union([t.Number(), t.Null()])), });
const DeleteResponseSchema = t.Object({ message: t.String() });

const parseSize = (sizeStr: string): number => { /* ... */ const l=sizeStr.toLowerCase(); const v=parseFloat(l); if(isNaN(v)) return 0; if(l.endsWith('g')||l.endsWith('gb')) return v*1024*1024*1024; if(l.endsWith('m')||l.endsWith('mb')) return v*1024*1024; if(l.endsWith('k')||l.endsWith('kb')) return v*1024; return v; };

// --- Elysia Plugins ---
const sessionRoutesInstance = new Elysia({ prefix: '/api' })
    .model({ sessionIdParam: SessionIdParamSchema, jobIdParam: JobIdParamSchema, paragraphUpdateBody: ParagraphUpdateBodySchema, metadataUpdateBody: SessionMetadataUpdateBodySchema, uploadBody: UploadBodySchema, sessionMetadataResponse: SessionMetadataResponseSchema, sessionWithChatsMetadataResponse: SessionWithChatsMetadataResponseSchema, transcriptResponse: TranscriptResponseSchema, transcriptionStatusResponse: TranscriptionStatusResponseSchema, deleteResponse: DeleteResponseSchema, })
    .group('/transcription', { detail: { tags: ['Transcription'] } }, (app) => app
        .get('/status/:jobId', async ({ params }) => { /* ... */ const {jobId}=params; try { const status=await getTranscriptionStatus(jobId); return {job_id:status.job_id, status:status.status, progress:status.progress, error:status.error, duration:status.duration}; } catch(err){ console.error(`[API Err] Tx Status ${jobId}:`, err); if(err instanceof ApiError) throw err; throw new InternalServerError('Failed get tx status', err instanceof Error ? err : undefined); } }, { params: 'jobIdParam', response: { 200: 'transcriptionStatusResponse' }, detail: { summary: 'Get transcription job status' } })
    )
    .group('/sessions', { detail: { tags: ['Session'] } }, (app) => app
        .get('/', listSessions, { response: { 200: t.Array(SessionListResponseItemSchema) }, detail: { summary: 'List all sessions (metadata only)' } })
        .post('/upload', async ({ body, set }) => { /* ... upload logic ... */
             // Remove transcriptPath from session creation
             const { audioFile, date, ...metadata } = body; let savedAudioId:string|null=null; let newSess:BackendSession|null=null; let tempAudioPath:string|null=null; try { const ts=new Date().toISOString(); newSess = sessionRepository.create({...metadata, date}, audioFile.name, /* REMOVED transcriptPath NULL */ null, ts); if(!newSess) throw new InternalServerError('Failed create initial session'); const sid=newSess.id; const buffer=await audioFile.arrayBuffer(); savedAudioId=await saveUploadedAudio(sid, audioFile.name, Buffer.from(buffer)); sessionRepository.updateMetadata(sid, {audioPath:savedAudioId}); tempAudioPath=getAudioAbsolutePath(savedAudioId); if(!tempAudioPath) throw new InternalServerError('Could not resolve abs audio path'); const jobId=await startTranscriptionJob(tempAudioPath); const finalSess = sessionRepository.updateMetadata(sid, {status:'transcribing', whisperJobId:jobId}); if(!finalSess) throw new InternalServerError('Failed update status/jobId'); set.status=202; return {sessionId:finalSess.id, jobId, message:"Upload ok, transcription started."}; } catch(err){ const origErr = err instanceof Error ? err : new Error(String(err)); console.error('[API Err] Upload:', origErr.message); if(!(err instanceof ApiError)) console.error(origErr.stack); if(newSess?.id){ try { const current = sessionRepository.findById(newSess.id); if(current){ if(savedAudioId){ try{await deleteUploadedAudioFile(savedAudioId);} catch(delErr){console.error(`Cleanup audio err ${savedAudioId}:`,delErr);} } sessionRepository.deleteById(newSess.id); }} catch(cleanupErr){console.error(`Cleanup err session ${newSess.id}:`,cleanupErr);} } if(err instanceof ApiError) throw err; throw new InternalServerError(`Upload failed: ${origErr.message}`, origErr); }
         }, { beforeHandle:({body})=>{ const f=body.audioFile; const maxS=parseSize(config.upload.maxFileSize); if(!config.upload.allowedMimeTypes.includes(f.type)) throw new BadRequestError(`Invalid type: ${f.type}`); if(f.size>maxS) throw new BadRequestError(`File size > ${config.upload.maxFileSize}`); if(f.size===0) throw new BadRequestError('File empty.'); }, body:'uploadBody', response:{ 202:t.Object({sessionId:t.Number(), jobId:t.String(), message:t.String()}), 400:t.Object({error:t.String(),message:t.String(),details:t.Optional(t.Any())}), 500:t.Object({error:t.String(),message:t.String(),details:t.Optional(t.Any())}), 503:t.Object({error:t.String(),message:t.String(),details:t.Optional(t.Any())}) }, detail:{summary:'Upload audio & metadata, start transcription'} })
        .guard({ params: 'sessionIdParam' }, (app) => app
             .derive(({ params }) => { const sid=parseInt(params.sessionId,10); if(isNaN(sid)) throw new BadRequestError('Invalid ID'); const s=sessionRepository.findById(sid); if(!s) throw new NotFoundError(`Session ID ${sid}`); return {sessionData: s}; })
             .get('/:sessionId', ({ sessionData, set }) => getSessionDetails({ sessionData, set }), { response: { 200: 'sessionWithChatsMetadataResponse' }, detail: { summary: 'Get session metadata & chat list' } })
             .put('/:sessionId/metadata', ({ sessionData, body, set }) => updateSessionMetadata({ sessionData, body, set }), { body: 'metadataUpdateBody', response: { 200: 'sessionMetadataResponse' }, detail: { summary: 'Update session metadata' } })
             .get('/:sessionId/transcript', ({ sessionData, set }) => getTranscript({ sessionData, set }), { response: { 200: 'transcriptResponse' }, detail: { summary: 'Get structured transcript content' } })
             .patch('/:sessionId/transcript', ({ sessionData, body, set }) => updateTranscriptParagraph({ sessionData, body, set }), { body: 'paragraphUpdateBody', response: { 200: 'transcriptResponse' }, detail: { summary: 'Update transcript paragraph' } })
             .get('/:sessionId/audio', (context: { /* ... */ params: Static<typeof SessionIdParamSchema>, request: Request, set: ElysiaContext['set'], sessionData: BackendSession, query: Record<string, string | undefined>, body: unknown, cookie: Record<string, Cookie<any>>, path: string, store: ElysiaContext['store'] }) => { /* ... audio streaming logic ... */ const { request, set, sessionData } = context; const sid=sessionData.id; const absPath = getAudioAbsolutePath(sessionData.audioPath); if (!absPath || !fsSync.existsSync(absPath)) throw new NotFoundError(`Audio for session ${sid}`); try { const stats = fsSync.statSync(absPath); const fileSize = stats.size; const range = request.headers.get('range'); const ext = path.extname(absPath).toLowerCase(); const mimeTypes:Record<string,string> = {'.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg', '.m4a':'audio/mp4', '.aac':'audio/aac'}; const contentType = mimeTypes[ext] || 'application/octet-stream'; if(range){ const parts = range.replace(/bytes=/,"").split("-"); const start = parseInt(parts[0],10); const end = parts[1] ? parseInt(parts[1],10) : fileSize-1; const chunksize = (end-start)+1; if (start>=fileSize||end>=fileSize||start>end){ set.status=416; set.headers['Content-Range']=`bytes */${fileSize}`; return "Range Not Satisfiable"; } const fileStream = fsSync.createReadStream(absPath,{start,end}); set.status=206; set.headers['Content-Range']=`bytes ${start}-${end}/${fileSize}`; set.headers['Accept-Ranges']='bytes'; set.headers['Content-Length']=chunksize.toString(); set.headers['Content-Type']=contentType; return new Response(Readable.toWeb(fileStream) as any); } else { set.status=200; set.headers['Content-Length']=fileSize.toString(); set.headers['Content-Type']=contentType; set.headers['Accept-Ranges']='bytes'; return new Response(Readable.toWeb(fsSync.createReadStream(absPath)) as any); } } catch (error) { console.error(`[API Audio Err] ${sid}:`, error); if (error instanceof ApiError) throw error; throw new InternalServerError('Failed stream audio', error instanceof Error ? error : undefined); } }, { response: { 200: t.Unknown(), 206: t.Unknown(), 404: t.Any(), 416: t.Any(), 500: t.Any() }, detail: { summary: 'Stream the original session audio file' } })

             // POST /:sessionId/finalize
             .post('/:sessionId/finalize', async ({ params, set, sessionData }) => {
                  const sessionId = sessionData.id;
                  console.log(`[API Finalize] Request received for session ${sessionId}`);
                  if (sessionData.status !== 'transcribing') { throw new ConflictError(`Session ${sessionId} status is '${sessionData.status}', not 'transcribing'.`); }
                  if (!sessionData.whisperJobId) { throw new InternalServerError(`Session ${sessionId} is transcribing but has no Whisper Job ID.`); }
                  const jobId = sessionData.whisperJobId;

                  try {
                      // 1. Get structured transcript result from Whisper service
                      const structuredTranscript = await getStructuredTranscriptionResult(jobId);

                      // 2. Calculate token count BEFORE saving to DB
                      const fullText = structuredTranscript.map(p => p.text).join('\n\n');
                      const tokenCount = calculateTokenCount(fullText);

                      // 3. Insert paragraphs into the database using transcriptRepository
                      transcriptRepository.insertParagraphs(sessionId, structuredTranscript);
                      console.log(`[API Finalize] Saved ${structuredTranscript.length} transcript paragraphs to DB for session ${sessionId}.`);

                      // 4. Update session status and token count in the DB
                      const finalizedSession = sessionRepository.updateMetadata(sessionId, {
                          status: 'completed',
                          transcriptTokenCount: tokenCount
                          // transcriptPath is no longer set here
                      });
                      if (!finalizedSession) throw new InternalServerError(`Failed to update session ${sessionId} status to completed.`);

                      // 5. Fetch the final session state (without transcriptPath)
                      const finalSessionState = sessionRepository.findById(sessionId);
                      if (!finalSessionState) throw new InternalServerError(`Failed to retrieve session ${sessionId} after finalizing.`);

                      // --- FIX: Exclude tags when fetching/assigning chat metadata ---
                      const chatsMetadataRaw = chatRepository.findChatsBySessionId(sessionId);
                      const chatsMetadata = chatsMetadataRaw.map(({ tags, ...rest }) => rest); // Explicitly omit tags
                      // --- END FIX ---

                      // 6. Create initial chat if none exist
                      if (!chatsMetadata || chatsMetadata.length === 0) {
                          const newFullChat = chatRepository.createChat(sessionId);
                          // --- FIX: Use messageRepository ---
                          messageRepository.addMessage(newFullChat.id, 'ai', `Session "${finalizedSession.sessionName}" uploaded on ${finalizedSession.date.split('T')[0]} has been transcribed...`);
                          // --- END FIX ---
                          console.log(`[API Finalize] Initial chat created (ID: ${newFullChat.id}) for session ${sessionId}.`);
                           // --- FIX: Exclude tags when fetching/assigning chat metadata ---
                          const updatedChatsMetadataRaw = chatRepository.findChatsBySessionId(sessionId);
                          finalSessionState.chats = updatedChatsMetadataRaw.map(({ tags, ...rest }) => rest); // Omit tags
                           // --- END FIX ---
                       } else {
                            finalSessionState.chats = chatsMetadata; // Assign metadata (tags already excluded)
                       }

                      console.log(`[API Finalize] Session ${sessionId} finalized successfully.`);
                      set.status = 200;
                      // --- Return final state directly (already matches updated schema) ---
                      return finalSessionState;
                      // --- End Return fix ---
                  } catch (error) {
                      console.error(`[API Error] Finalize Session ${sessionId}:`, error);
                      try { sessionRepository.updateMetadata(sessionId, { status: 'failed' }); console.log(`[API Finalize] Marked session ${sessionId} as 'failed'.`); } catch (updateError) { console.error(`[API Finalize] CRITICAL: Failed to mark session ${sessionId} as failed:`, updateError); }
                      if (error instanceof ApiError) throw error;
                      throw new InternalServerError(`Failed to finalize session ${sessionId}`, error instanceof Error ? error : undefined);
                   }
             }, { response: { 200: 'sessionWithChatsMetadataResponse', 409: t.Any(), 500: t.Any() }, detail: { summary: 'Finalize session after successful transcription' } })
             // DELETE /:sessionId
             .delete('/:sessionId', async ({ params, set, sessionData }) => { /* ... */
                const sid=sessionData.id;
                console.log(`[API Del] Req ${sid}`);
                // --- REMOVED transcriptPath and deleteTranscriptFile call ---
                // const transcriptPath=sessionData.transcriptPath;
                const audioId=sessionData.audioPath;
                try {
                    // if(transcriptPath){await deleteTranscriptFile(sid);} else {console.log(`[API Del] Session ${sid} no transcript path.`);}
                    if(audioId){await deleteUploadedAudioFile(audioId);} else {console.warn(`[API Del] No audio id for session ${sid}.`);}
                    // Deleting the session via repository will CASCADE DELETE paragraphs
                    const deleted = sessionRepository.deleteById(sid);
                    if(!deleted) console.warn(`[API Del] Session DB ${sid} not found during delete attempt.`);
                    else console.log(`[API Del] Deleted session DB ${sid} (and associated paragraphs via cascade).`);
                    set.status=200;
                    return { message: `Session ${sid} deleted.` };
                } catch (error) {
                    console.error(`[API Err] Delete Session ${sid}:`, error);
                    if(error instanceof ApiError) throw error;
                    throw new InternalServerError(`Failed delete session ${sid}`, error instanceof Error ? error : undefined);
                }
            }, { response: { 200: 'deleteResponse' }, detail: { summary: 'Delete session, files, chats, paragraphs' } })
             // DELETE /:sessionId/audio (unchanged)
             .delete('/:sessionId/audio', ({ sessionData, set }) => deleteSessionAudioHandler({ sessionData, set }), { response: { 200: 'deleteResponse', 404: t.Any(), 500: t.Any() }, detail: { summary: 'Delete original audio file' } })
         ) // End session ID guard
    )
    .get('/api/schema', ({ set }) => { set.status = 501; return { message: "API schema definition unavailable. Use /api/docs." }; }, { detail: { tags: ['Meta'] } });

export { sessionRoutesInstance as sessionRoutes };
