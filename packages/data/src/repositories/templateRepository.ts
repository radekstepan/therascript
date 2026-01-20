import { db, run, all, get } from '@therascript/db';
import type { Template } from '@therascript/domain';

const insertTemplateSql =
  'INSERT INTO templates (title, text, createdAt) VALUES (?, ?, ?)';
const selectAllTemplatesSql = 'SELECT * FROM templates ORDER BY createdAt DESC';
const selectTemplateByIdSql = 'SELECT * FROM templates WHERE id = ?';
const selectTemplateByTitleSql = 'SELECT * FROM templates WHERE title = ?';
const updateTemplateSql =
  'UPDATE templates SET title = ?, text = ? WHERE id = ?';
const deleteTemplateSql = 'DELETE FROM templates WHERE id = ?';

export const templateRepository = {
  create: (title: string, text: string): Template => {
    try {
      const createdAt = Date.now();
      const info = run(insertTemplateSql, title, text, createdAt);
      const newId = info.lastInsertRowid as number;
      const newTemplate = get<Template>(selectTemplateByIdSql, newId);
      if (!newTemplate)
        throw new Error('Failed to retrieve template after creation.');
      return newTemplate;
    } catch (error) {
      console.error('[TemplateRepo] Error creating template:', error);
      throw new Error('Database error creating template.');
    }
  },

  findAll: (): Template[] => {
    try {
      return all<Template>(selectAllTemplatesSql);
    } catch (error) {
      console.error('[TemplateRepo] Error finding all templates:', error);
      throw new Error('Database error fetching templates.');
    }
  },

  findById: (id: number): Template | null => {
    try {
      const template = get<Template>(selectTemplateByIdSql, id);
      return template ?? null;
    } catch (error) {
      console.error(
        `[TemplateRepo] Error finding template by id ${id}:`,
        error
      );
      throw new Error('Database error fetching template.');
    }
  },

  findByTitle: (title: string): Template | null => {
    try {
      const template = get<Template>(selectTemplateByTitleSql, title);
      return template ?? null;
    } catch (error) {
      console.error(
        `[TemplateRepo] Error finding template by title "${title}":`,
        error
      );
      throw new Error('Database error fetching template by title.');
    }
  },

  update: (id: number, title: string, text: string): Template | null => {
    try {
      const info = run(updateTemplateSql, title, text, id);
      if (info.changes === 0) {
        return null;
      }
      return get<Template>(selectTemplateByIdSql, id) ?? null;
    } catch (error) {
      console.error(`[TemplateRepo] Error updating template ${id}:`, error);
      throw new Error('Database error updating template.');
    }
  },

  deleteById: (id: number): boolean => {
    try {
      const info = run(deleteTemplateSql, id);
      return info.changes > 0;
    } catch (error) {
      console.error(`[TemplateRepo] Error deleting template ${id}:`, error);
      throw new Error('Database error deleting template.');
    }
  },
};
