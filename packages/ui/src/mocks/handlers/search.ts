// packages/ui/src/mocks/handlers/search.ts
//
// GET /api/search — Mirrors src/api/search.ts. Query is the
// lowercase "q" param. Returns one transcript hit + one chat hit
// for "anxiety" so search.spec.ts can assert both navigation
// branches, and an empty result set for any other query.
import { http, HttpResponse } from 'msw';

export const searchHandlers = [
  http.get('/api/search', ({ request }) => {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').toLowerCase();
    if (!q || (!q.includes('anxious') && !q.includes('anxiety'))) {
      return HttpResponse.json({ query: q, total: 0, results: [] });
    }
    return HttpResponse.json({
      query: q,
      total: 2,
      results: [
        {
          id: '1_1',
          type: 'transcript',
          chatId: null,
          sessionId: 1,
          sender: null,
          timestamp: 6000,
          snippet:
            'I have been feeling anxious for the past few months, especially at work.',
          highlights: {
            text: [
              'I have been feeling <mark>anxious</mark> for the past few months, especially at work.',
            ],
          },
          score: 2.5,
          clientName: 'Jane Doe',
        },
        {
          id: 'chat-msg-100',
          type: 'chat',
          chatId: 10,
          sessionId: 1,
          sender: 'user',
          timestamp: Date.now() - 60_000,
          snippet: 'What coping strategies have you tried for anxiety?',
          highlights: {
            text: [
              'What coping strategies have you tried for <mark>anxiety</mark>?',
            ],
          },
          score: 1.8,
          clientName: 'Jane Doe',
        },
      ],
    });
  }),
];
