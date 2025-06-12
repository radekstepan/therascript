// packages/api/src/api/templateHandler.ts
import { templateRepository } from '../repositories/templateRepository.js';
import {
  NotFoundError,
  InternalServerError,
  BadRequestError,
} from '../errors.js';
import type { Template } from '../types/index.js';

export const getTemplates = ({ set }: any): Template[] => {
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

export const createTemplate = ({ body, set }: any): Template => {
  const { title, text } = body as { title: string; text: string };
  if (!title?.trim() || !text?.trim()) {
    throw new BadRequestError('Title and text are required for a template.');
  }

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

export const updateTemplate = ({ params, body, set }: any): Template => {
  const { id } = params;
  const { title, text } = body as { title: string; text: string };

  if (!title?.trim() || !text?.trim()) {
    throw new BadRequestError('Title and text are required for an update.');
  }

  try {
    const updatedTemplate = templateRepository.update(
      id,
      title.trim(),
      text.trim()
    );
    if (!updatedTemplate) {
      throw new NotFoundError(`Template with ID ${id}`);
    }
    set.status = 200;
    return updatedTemplate;
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new InternalServerError(
      `Failed to update template ${id}`,
      error instanceof Error ? error : undefined
    );
  }
};

export const deleteTemplate = ({ params, set }: any): { message: string } => {
  const { id } = params;
  try {
    const deleted = templateRepository.deleteById(id);
    if (!deleted) {
      throw new NotFoundError(`Template with ID ${id}`);
    }
    set.status = 200;
    return { message: `Template with ID ${id} deleted successfully.` };
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new InternalServerError(
      `Failed to delete template ${id}`,
      error instanceof Error ? error : undefined
    );
  }
};
