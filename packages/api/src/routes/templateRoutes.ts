// packages/api/src/routes/templateRoutes.ts
import { Elysia, t } from 'elysia';
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../api/templateHandler.js';

// Schemas
const TemplateSchema = t.Object({
  id: t.Number(),
  title: t.String(),
  text: t.String(),
  createdAt: t.Number(),
});

const TemplateListResponseSchema = t.Array(TemplateSchema);

const TemplateBodySchema = t.Object({
  title: t.String({ minLength: 1, error: 'Title cannot be empty' }),
  text: t.String({ minLength: 1, error: 'Text cannot be empty' }),
});

const TemplateIdParamSchema = t.Object({
  id: t.Numeric({ minimum: 1, error: 'ID must be a positive number' }),
});

const DeleteResponseSchema = t.Object({ message: t.String() });

export const templateRoutes = new Elysia({ prefix: '/api/templates' })
  .model({
    template: TemplateSchema,
    templateList: TemplateListResponseSchema,
    templateBody: TemplateBodySchema,
    templateIdParam: TemplateIdParamSchema,
    deleteResponse: DeleteResponseSchema,
  })
  .group('', { detail: { tags: ['Templates'] } }, (app) =>
    app
      .get('/', getTemplates, {
        response: { 200: 'templateList' },
        detail: { summary: 'Get all saved templates' },
      })
      .post('/', createTemplate, {
        body: 'templateBody',
        response: { 201: 'template' },
        detail: { summary: 'Create a new template' },
      })
      .put(
        '/:id',
        (context: any) =>
          updateTemplate({
            ...context,
            params: { id: Number(context.params.id) },
          }),
        {
          params: 'templateIdParam',
          body: 'templateBody',
          response: { 200: 'template' },
          detail: { summary: 'Update an existing template' },
        }
      )
      .delete(
        '/:id',
        (context: any) =>
          deleteTemplate({
            ...context,
            params: { id: Number(context.params.id) },
          }),
        {
          params: 'templateIdParam',
          response: { 200: 'deleteResponse' },
          detail: { summary: 'Delete a template' },
        }
      )
  );
