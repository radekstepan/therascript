// packages/ui/src/mocks/handlers/sessions.ts
//
// All /api/sessions/* endpoints: list, get, upload, transcript
// (read + update), metadata edit, delete, and the hardcoded
// fixtures for the upload + transcript-edit + session-chat specs
// (session 1 transcript paragraphs, session 3 post-upload target).
//
// Owned spec files: crud.spec.ts, sessions-list.spec.ts,
// transcript-edit.spec.ts, upload.spec.ts, chat-navigation.spec.ts
// (partial — session meta + chat creation), session-chat.spec.ts
// (partial — session meta), landing.spec.ts (list), readiness.spec.ts
// (list, as a side effect of the app bootstrap).
import { http, HttpResponse } from 'msw';
import {
  e2eSessionChats,
  e2eSessions,
  setE2eSessions,
  setE2eSessionChats,
  MOCK_INTAKE_SESSION,
} from '../state';

export const sessionHandlers = [
  // Structured transcript paragraphs for the intake session. Small but
  // non-empty so the Transcription panel renders content and the
  // transcript token count is plausibly non-zero.
  http.patch('/api/sessions/1/transcript', async () => {
    return HttpResponse.json([
      {
        id: 0,
        timestamp: 0,
        text: 'Therapist: Hi Jane, thanks for coming in today. Can you tell me what brought you here?',
        speaker: 'Therapist',
      },
      {
        id: 1,
        timestamp: 6000,
        text: 'Jane: I have been feeling VERY anxious for the past few months, especially at work.',
        speaker: 'Jane',
      },
      {
        id: 2,
        timestamp: 14000,
        text: 'Therapist: That sounds difficult. Let us explore that together.',
        speaker: 'Therapist',
      },
    ]);
  }),

  http.get('/api/sessions/1/transcript', () =>
    HttpResponse.json([
      {
        id: 0,
        timestamp: 0,
        text: 'Therapist: Hi Jane, thanks for coming in today. Can you tell me what brought you here?',
        speaker: 'Therapist',
      },
      {
        id: 1,
        timestamp: 6000,
        text: 'Jane: I have been feeling anxious for the past few months, especially at work.',
        speaker: 'Jane',
      },
      {
        id: 2,
        timestamp: 14000,
        text: 'Therapist: That sounds difficult. Let us explore that together.',
        speaker: 'Therapist',
      },
    ])
  ),

  http.post('/api/sessions/upload', async () => {
    return HttpResponse.json(
      {
        sessionId: 3,
        jobId: 'mock-job-id',
        message: 'Upload successful, transcription queued.',
      },
      { status: 202 }
    );
  }),

  http.get('/api/sessions/3', () =>
    HttpResponse.json({
      ...MOCK_INTAKE_SESSION,
      id: 3,
      status: 'completed',
      chats: [],
    })
  ),

  http.get('/api/sessions/3/transcript', () =>
    HttpResponse.json([
      {
        id: 0,
        timestamp: 0,
        text: 'New session transcript.',
        speaker: 'Therapist',
      },
    ])
  ),

  // --- Session CRUD (crud.spec.ts, sessions-list.spec.ts) ----------
  // GET /api/sessions/ — served from the mutable `e2eSessions` list
  // so delete + edit are observable on the next landing fetch.
  // Registered AFTER the hardcoded `/api/sessions/1/transcript` and
  // `/api/sessions/3*` handlers above so those keep matching first.
  http.get('/api/sessions/', () => HttpResponse.json(e2eSessions)),

  // PUT /api/sessions/:id/metadata — edit session. Returns the merged
  // record. The spec verifies the row's text + the toast.
  http.put('/api/sessions/:id/metadata', async ({ request, params }) => {
    const id = parseInt(params.id as string, 10);
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    setE2eSessions(
      e2eSessions.map((s) =>
        s.id === id
          ? {
              ...s,
              sessionName:
                typeof body.sessionName === 'string'
                  ? body.sessionName
                  : s.sessionName,
              clientName:
                typeof body.clientName === 'string'
                  ? body.clientName
                  : s.clientName,
              date: typeof body.date === 'string' ? body.date : s.date,
              sessionType:
                typeof body.sessionType === 'string'
                  ? body.sessionType
                  : s.sessionType,
              therapy:
                typeof body.therapy === 'string' ? body.therapy : s.therapy,
            }
          : s
      )
    );
    const updated = e2eSessions.find((s) => s.id === id);
    return HttpResponse.json(updated);
  }),

  // DELETE /api/sessions/:id — removes the session from the list.
  http.delete('/api/sessions/:id', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    setE2eSessions(e2eSessions.filter((s) => s.id !== id));
    const nextChats = { ...e2eSessionChats };
    delete nextChats[id];
    setE2eSessionChats(nextChats);
    return HttpResponse.json({ message: `Session ${id} deleted.` });
  }),

  // GET /api/sessions/:id — returns chats from the e2e mutable store.
  // The deep-analysis spec's `chatExistsInSession` check on
  // sessionMetadata.chats still passes for id=1 (id 10 + 11).
  http.get('/api/sessions/:id', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    const session = e2eSessions.find((s) => s.id === id);
    if (!session) {
      return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return HttpResponse.json({
      ...session,
      chats: e2eSessionChats[id] || [],
    });
  }),

  // POST /api/sessions/:id/chats/ — start a new chat for a session.
  http.post('/api/sessions/:id/chats/', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    const existing = e2eSessionChats[id] || [];
    const nextId = existing.length
      ? Math.max(...existing.map((c) => c.id)) + 1
      : 10;
    const newChat = {
      id: nextId,
      sessionId: id,
      timestamp: Date.now(),
      name: null,
    };
    setE2eSessionChats({ ...e2eSessionChats, [id]: [...existing, newChat] });
    return HttpResponse.json(newChat);
  }),
];
