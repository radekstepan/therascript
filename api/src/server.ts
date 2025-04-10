// src/server.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path'; // Import path
import config from './config'; // Relative
import { registerRoutes } from './routes'; // Relative
import { ApiErrorResponse, ActionSchema } from './types'; // Relative
import { db } from './db/sqliteService'; // Import db instance for potential direct use or logging

const app: Express = express();
const port = config.server.port;

// --- Middleware ---
// CORS configuration
app.use(cors({ origin: config.server.corsOrigin, credentials: true })); // Adjust origin as needed
// Body Parsers
app.use(express.json({ limit: '10mb' })); // For JSON payloads
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // For form data

// Simple Request Logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
     const duration = Date.now() - start;
     console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// --- API Routes & Schema Generation ---
// registerRoutes attaches all defined routes to the 'app' instance
const apiSchema: ActionSchema[] = registerRoutes(app);

// --- Static Endpoints (Registered via registerRoutes now) ---
// GET /api/health
app.get('/api/health', (req: Request, res: Response) => {
    try {
        // Check DB connection basic liveness
        db.pragma('integrity_check'); // Basic check
        res.status(200).json({
            status: 'OK',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch(dbError) {
         console.error("[Health Check] Database error:", dbError);
         res.status(503).json({
            status: 'Error',
            database: 'disconnected',
            error: (dbError as Error).message,
            timestamp: new Date().toISOString()
        });
    }
});

// GET /api/schema
app.get('/api/schema', (req: Request, res: Response) => {
    res.status(200).json(apiSchema); // Serve the dynamically generated schema
});


// --- Default Route ---
app.get('/', (req: Request, res: Response) => {
  res.contentType('text/plain').status(200).send('Therapy Analyzer Backend API (SQLite)');
});

// --- Not Found Handler (404) ---
// This should come after all other routes
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found', message: `The requested resource ${req.method} ${req.path} does not exist.` });
});

// --- Global Error Handler ---
// Must have these 4 arguments for Express to recognize it as an error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`[Error Handler] Path: ${req.path}, Error:`, err);

  let statusCode = 500; // Default to Internal Server Error
  let errorMessage = 'Internal Server Error';

  // Check for specific error types or codes if needed
  if ((err as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
       statusCode = 409; // Conflict
       errorMessage = 'Resource conflict (e.g., duplicate entry).';
  } else if ((err as any).message?.includes('not found')) { // Generic not found check
      statusCode = 404;
      errorMessage = err.message;
  }
  // Add more specific checks for validation errors, auth errors, etc.


  // Structure the response
  const responseBody: ApiErrorResponse = {
    error: errorMessage,
    // Provide more details only in non-production environments
    details: config.server.isProduction ? undefined : err.message + (err.stack ? `\n${err.stack}` : ''),
  };

  // Ensure response headers haven't already been sent
  if (!res.headersSent) {
       res.status(statusCode).json(responseBody);
  } else {
      // If headers are sent, delegate to Express default handler
       next(err);
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`-------------------------------------------------------`);
  console.log(`🚀 Therapy Analyzer Backend listening on port ${port}`);
  console.log(`   Mode: ${config.server.isProduction ? 'Production' : 'Development'}`);
  console.log(`   DB Path: ${config.db.sqlitePath}`);
  console.log(`   CORS Origin: ${config.server.corsOrigin}`);
  console.log(`   Ollama URL: ${config.ollama.baseURL}`);
  console.log(`   Ollama Model: ${config.ollama.model}`);
  console.log(`-------------------------------------------------------`);
  console.log(`Access API Schema at: http://localhost:${port}/api/schema`);
  console.log(`Health Check: http://localhost:${port}/api/health`);
  console.log(`-------------------------------------------------------`);
});
