// packages/ui/src/mocks/handlers/templates.ts
//
// /api/templates/* — list, create, update, delete. Owned by
// templates.spec.ts.
import { http, HttpResponse } from 'msw';
import {
  e2eNextTemplateId,
  e2eTemplates,
  setE2eNextTemplateId,
  setE2eTemplates,
} from '../state';

export const templatesHandlers = [
  // GET /api/templates — list seeded templates.
  http.get('/api/templates', () => HttpResponse.json(e2eTemplates)),

  // POST /api/templates — create.
  http.post('/api/templates', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      text?: string;
    };
    const tpl = {
      id: e2eNextTemplateId,
      title: body.title || 'Untitled',
      text: body.text || '',
      createdAt: Date.now(),
    };
    setE2eNextTemplateId(e2eNextTemplateId + 1);
    setE2eTemplates([...e2eTemplates, tpl]);
    return HttpResponse.json(tpl, { status: 201 });
  }),

  // PUT /api/templates/:id — update.
  http.put('/api/templates/:id', async ({ request, params }) => {
    const id = parseInt(params.id as string, 10);
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      text?: string;
    };
    setE2eTemplates(
      e2eTemplates.map((t) =>
        t.id === id
          ? {
              ...t,
              title: typeof body.title === 'string' ? body.title : t.title,
              text: typeof body.text === 'string' ? body.text : t.text,
            }
          : t
      )
    );
    const updated = e2eTemplates.find((t) => t.id === id);
    return HttpResponse.json(updated);
  }),

  // DELETE /api/templates/:id — remove.
  http.delete('/api/templates/:id', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    setE2eTemplates(e2eTemplates.filter((t) => t.id !== id));
    return HttpResponse.json({ message: `Template ${id} deleted.` });
  }),
];
