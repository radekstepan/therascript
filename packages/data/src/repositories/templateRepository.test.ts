import { describe, it, expect, vi, beforeEach } from 'vitest';

type Template = { id: number; title: string; text: string; createdAt: number };

const makeDbMock = () => {
  let seq = 0;
  let rows: Template[] = [];
  return {
    reset() {
      seq = 0;
      rows = [];
    },
    get rows() {
      return rows;
    },
    api: {
      run: vi.fn((sql: string, ...params: any[]) => {
        if (/INSERT INTO templates/i.test(sql)) {
          const [title, text, createdAt] = params as [string, string, number];
          const id = ++seq;
          rows.push({ id, title, text, createdAt });
          return { lastInsertRowid: id, changes: 1 };
        }
        if (/UPDATE templates SET/i.test(sql)) {
          const [title, text, id] = params as [string, string, number];
          const idx = rows.findIndex((r) => r.id === id);
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], title, text };
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (/DELETE FROM templates/i.test(sql)) {
          const [id] = params as [number];
          const before = rows.length;
          rows = rows.filter((r) => r.id !== id);
          return { changes: before - rows.length };
        }
        throw new Error('Unexpected SQL in run: ' + sql);
      }),
      get: vi.fn((sql: string, ...params: any[]) => {
        if (/SELECT \* FROM templates WHERE id = \?/i.test(sql)) {
          const [id] = params as [number];
          return rows.find((r) => r.id === id);
        }
        if (/SELECT \* FROM templates WHERE title = \?/i.test(sql)) {
          const [title] = params as [string];
          return rows.find((r) => r.title === title);
        }
        throw new Error('Unexpected SQL in get: ' + sql);
      }),
      all: vi.fn((sql: string) => {
        if (/SELECT \* FROM templates ORDER BY createdAt DESC/i.test(sql)) {
          return [...rows].sort((a, b) => b.createdAt - a.createdAt);
        }
        throw new Error('Unexpected SQL in all: ' + sql);
      }),
    },
  };
};

const dbMock = makeDbMock();

describe('templateRepository', () => {
  beforeEach(() => {
    vi.resetModules();
    dbMock.reset();
  });

  it('create/findAll/findById/findByTitle/update/deleteById work end-to-end', async () => {
    vi.doMock('@therascript/db', () => ({
      run: dbMock.api.run,
      get: dbMock.api.get,
      all: dbMock.api.all,
    }));
    const { templateRepository } = await import('./templateRepository.js');

    const created = templateRepository.create('t1', 'text1');
    expect(created.id).toBe(1);
    expect(created.title).toBe('t1');

    const all1 = templateRepository.findAll();
    expect(all1.length).toBe(1);

    const byId = templateRepository.findById(created.id);
    expect(byId?.text).toBe('text1');

    const byTitle = templateRepository.findByTitle('t1');
    expect(byTitle?.id).toBe(created.id);

    const updated = templateRepository.update(created.id, 't2', 'text2');
    expect(updated?.title).toBe('t2');
    expect(updated?.text).toBe('text2');

    const notFoundUpdate = templateRepository.update(999, 'x', 'y');
    expect(notFoundUpdate).toBeNull();

    const deleted = templateRepository.deleteById(created.id);
    expect(deleted).toBe(true);
    const deletedAgain = templateRepository.deleteById(created.id);
    expect(deletedAgain).toBe(false);
  });
});
