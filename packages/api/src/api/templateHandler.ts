// packages/api/src/api/templateHandler.ts
import { templateRepository } from '@therascript/data';
import {
  NotFoundError,
  InternalServerError,
  BadRequestError,
} from '../errors.js';
import type { Template } from '@therascript/domain';
import {
  createTemplateSchema,
  updateTemplateSchema,
} from '@therascript/domain';

interface TemplateHandlerContext {
  body: unknown;
  params: Record<string, string | undefined>;
  set: { status?: number | string };
}

export const getTemplates = ({ set }: TemplateHandlerContext): Template[] => {
  try {
    const templates = templateRepository.findAll();
    set.status = 200;
    return templates;
  } catch (error) {
    throw new InternalServerError(
      'Failed to retrieve templates',
      error instanceof Error ? error : undefined
    );
  }
};

export const createTemplate = ({
  body,
  set,
}: TemplateHandlerContext): Template => {
  const validatedBody = createTemplateSchema.parse(body);
  const { title, text } = validatedBody;

  try {
    const newTemplate = templateRepository.create(title.trim(), text.trim());
    set.status = 201;
    return newTemplate;
  } catch (error) {
    throw new InternalServerError(
      'Failed to create template',
      error instanceof Error ? error : undefined
    );
  }
};

export const updateTemplate = ({
  params,
  body,
  set,
}: TemplateHandlerContext): Template => {
  const { id } = params;
  if (!id) {
    throw new BadRequestError('Template ID is required');
  }
  const parsedId = parseInt(id, 10);

  if (isNaN(parsedId)) {
    throw new BadRequestError(`Invalid template ID: ${id}`);
  }

  const validatedBody = updateTemplateSchema.parse(body);
  const { title, text } = validatedBody;

  try {
    const updatedTemplate = templateRepository.update(
      parsedId,
      title.trim(),
      text.trim()
    );
    if (!updatedTemplate) {
      throw new NotFoundError(`Template with ID ${parsedId}`);
    }
    set.status = 200;
    return updatedTemplate;
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new InternalServerError(
      `Failed to update template ${parsedId}`,
      error instanceof Error ? error : undefined
    );
  }
};

export const deleteTemplate = ({
  params,
  set,
}: TemplateHandlerContext): { message: string } => {
  const { id } = params;
  if (!id) {
    throw new BadRequestError('Template ID is required');
  }
  const parsedId = parseInt(id, 10);

  if (isNaN(parsedId)) {
    throw new BadRequestError(`Invalid template ID: ${id}`);
  }

  try {
    const deleted = templateRepository.deleteById(parsedId);
    if (!deleted) {
      throw new NotFoundError(`Template with ID ${parsedId}`);
    }
    set.status = 200;
    return { message: `Template with ID ${parsedId} deleted successfully.` };
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new InternalServerError(
      `Failed to delete template ${parsedId}`,
      error instanceof Error ? error : undefined
    );
  }
};
