// src/routes.ts
import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import path from 'path';
import config from './config'; // Relative
// Corrected Relative Imports
import { sessionRepository } from './repositories/sessionRepository';
import { chatRepository } from './repositories/chatRepository';
// Handler Imports
import {
    listSessions, uploadSession, getSessionDetails, updateSessionMetadata, getTranscript, updateTranscriptParagraph
} from './api/sessionHandler';
import {
    createChat, addChatMessage, renameChat, deleteChat
} from './api/chatHandler';
// Type Imports
import type { ActionSchema, BackendSession } from './types'; // Relative

// --- Type Definitions ---
type ExpressMiddleware = RequestHandler; // Use Express's built-in type
type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RouteDefinition {
    path: string;
    method: HttpMethod;
    handler: ExpressMiddleware;
    middleware?: ExpressMiddleware[];
    schema: Omit<ActionSchema, 'endpoint' | 'method'>;
}

// --- Middleware Setup ---
const upload = multer({ dest: config.db.uploadsDir });

const loadSessionMiddleware: ExpressMiddleware = (req, res, next) => {
    const sessionId = parseInt(req.params.sessionId, 10);
    if (isNaN(sessionId)) return res.status(400).json({ error: 'Invalid session ID format.' });
    try {
        const session = sessionRepository.findById(sessionId);
        if (!session) return res.status(404).json({ error: `Session ${sessionId} not found.` });
        (req as any).sessionData = session;
        next();
    } catch (error) { next(error); }
};

const loadChatMiddleware: ExpressMiddleware = (req, res, next) => {
    const chatId = parseInt(req.params.chatId, 10);
    const session: BackendSession | undefined = (req as any).sessionData;
    if (isNaN(chatId)) return res.status(400).json({ error: 'Invalid chat ID format.' });
    if (!session) {
         console.error('CRITICAL: loadChatMiddleware executing without sessionData.');
         return res.status(500).json({ error: 'Internal server error.' });
    }
    try {
        const chat = chatRepository.findChatById(chatId);
        if (!chat || chat.sessionId !== session.id) return res.status(404).json({ error: `Chat ${chatId} not found in session ${session.id}.` });
        (req as any).chatData = chat;
        next();
    } catch (error) { next(error); }
};

// --- Route Definitions Array ---
// (Schema descriptions shortened)
export const routes: RouteDefinition[] = [
    // Sessions
    { path: '/api/sessions', method: 'get', handler: listSessions, schema: { description: 'List sessions.', responseBody: { sessions: '...' } } },
    {
        path: '/api/sessions/upload', method: 'post',
        // --- FIX: Cast Multer middleware to 'any' as a workaround ---
        middleware: [upload.single('audioFile') as any],
        // --- END FIX ---
        handler: uploadSession,
        schema: { description: 'Upload session.', requestBody: { metadata: '{...}', audioFile: 'file' }, responseBody: { session: '...' } }
    },
    { path: '/api/sessions/:sessionId', method: 'get', middleware: [loadSessionMiddleware], handler: getSessionDetails, schema: { description: 'Get session details.', pathParams: { sessionId: 'number' }, responseBody: { session: '...' } } },
    { path: '/api/sessions/:sessionId/metadata', method: 'put', middleware: [loadSessionMiddleware], handler: updateSessionMetadata, schema: { description: 'Update session metadata.', pathParams: { sessionId: 'number' }, requestBody: { metadata: 'Partial<...>' }, responseBody: { session: '...' } } },
    { path: '/api/sessions/:sessionId/transcript', method: 'get', middleware: [loadSessionMiddleware], handler: getTranscript, schema: { description: 'Get transcript.', pathParams: { sessionId: 'number' }, responseBody: { transcriptContent: 'string' } } },
    { path: '/api/sessions/:sessionId/transcript', method: 'patch', middleware: [loadSessionMiddleware], handler: updateTranscriptParagraph, schema: { description: 'Update transcript paragraph.', pathParams: { sessionId: 'number' }, requestBody: { update: '{...}' }, responseBody: { transcriptContent: 'string' } } },
    // Chats
    { path: '/api/sessions/:sessionId/chats', method: 'post', middleware: [loadSessionMiddleware], handler: createChat, schema: { description: 'Create chat.', pathParams: { sessionId: 'number' }, responseBody: { chat: '...' } } },
    { path: '/api/sessions/:sessionId/chats/:chatId/messages', method: 'post', middleware: [loadSessionMiddleware, loadChatMiddleware], handler: addChatMessage, schema: { description: 'Add chat message.', pathParams: { sessionId: 'number', chatId: 'number' }, requestBody: { message: '{...}' }, responseBody: { userMessage: '...', aiMessage: '...' } } },
    { path: '/api/sessions/:sessionId/chats/:chatId/name', method: 'patch', middleware: [loadSessionMiddleware, loadChatMiddleware], handler: renameChat, schema: { description: 'Rename chat.', pathParams: { sessionId: 'number', chatId: 'number' }, requestBody: { name: 'string|null' }, responseBody: { chat: '...' } } },
    { path: '/api/sessions/:sessionId/chats/:chatId', method: 'delete', middleware: [loadSessionMiddleware, loadChatMiddleware], handler: deleteChat, schema: { description: 'Delete chat.', pathParams: { sessionId: 'number', chatId: 'number' }, responseBody: { message: 'string' } } },
];

// --- Route Registration Function ---
export const registerRoutes = (app: express.Application): ActionSchema[] => {
    const generatedSchema: ActionSchema[] = [];
    console.log(`[Server] Registering ${routes.length} API routes...`);
    routes.forEach(route => {
        const handlers = [...(route.middleware ?? []), route.handler];
        try {
             switch (route.method) { // Use specific methods
                 case 'get':    app.get(route.path, handlers); break;
                 case 'post':   app.post(route.path, handlers); break;
                 case 'put':    app.put(route.path, handlers); break;
                 case 'patch':  app.patch(route.path, handlers); break;
                 case 'delete': app.delete(route.path, handlers); break;
                 default: throw new Error(`Unsupported method: ${route.method}`);
             }
            generatedSchema.push({ // Add to schema
                endpoint: route.path,
                method: route.method.toUpperCase() as ActionSchema['method'],
                ...route.schema,
            });
        } catch (registrationError) {
            console.error(`[Server] FAILED route registration: ${route.method.toUpperCase()} ${route.path}`, registrationError);
        }
    });
     generatedSchema.unshift( // Add static schemas
        { endpoint: '/api/health', method: 'GET', description: 'Check health.', responseBody: { status: 'string'} },
        { endpoint: '/api/schema', method: 'GET', description: 'Get API schema.', responseBody: { schema: 'ActionSchema[]' } }
     );
    console.log('[Server] Route registration complete.');
    return generatedSchema.sort((a, b) => a.endpoint.localeCompare(b.endpoint));
};
