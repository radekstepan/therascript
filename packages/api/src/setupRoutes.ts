import { Elysia } from 'elysia';
import { sessionRoutes } from './routes/sessionRoutes.js';
import { chatRoutes } from './routes/chatRoutes.js';
import { standaloneChatRoutes } from './routes/standaloneChatRoutes.js';
import { templateRoutes } from './routes/templateRoutes.js';
import { llmRoutes } from './routes/llmRoutes.js';
import { dockerRoutes } from './routes/dockerRoutes.js';
import { metaRoutes } from './routes/metaRoutes.js';
import { systemRoutes } from './routes/systemRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { searchRoutes } from './routes/searchRoutes.js';
import { analysisRoutes } from './routes/analysisRoutes.js';
import { transcriptionRoutes } from './routes/transcriptionRoutes.js';
import { jobsRoutes } from './routes/jobsRoutes.js';
import { usageRoutes } from './routes/usageRoutes.js';

export function setupRoutes() {
  return new Elysia({ name: 'routes' })
    .use(metaRoutes)
    .use(llmRoutes)
    .use(dockerRoutes)
    .use(systemRoutes)
    .use(adminRoutes)
    .use(searchRoutes)
    .use(analysisRoutes)
    .use(transcriptionRoutes)
    .use(jobsRoutes)
    .use(sessionRoutes)
    .use(chatRoutes)
    .use(standaloneChatRoutes)
    .use(templateRoutes)
    .use(usageRoutes);
}
