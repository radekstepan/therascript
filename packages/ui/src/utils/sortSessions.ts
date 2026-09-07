// packages/ui/src/utils/sortSessions.ts
//
// Shared session-list ordering. The dashboard (LandingPage) and the
// All Sessions page (SessionsPage) both render SessionListTable and must
// agree on order — and SessionView's prev/next navigation must follow
// that same order. Keep the comparator in exactly one place so the table
// and the navigation can never drift apart.

import type { Session } from '../types';
import type { SessionSortCriteria } from '../store/session/sessionSortCriteriaAtom';
import type { SortDirection } from '../store/session/sessionSortDirectionAtom';

export type { SessionSortCriteria, SortDirection };

/**
 * Sort a session list exactly the way SessionListTable displays it.
 *
 * Note the intentional `date` quirk: the comparator itself sorts newest
 * first, so the direction flip is inverted for `date` relative to every
 * other criterion. Duplicated from the tables verbatim — do not
 * "simplify" without updating the tables too (they now call this).
 */
export function sortSessions(
  sessions: Session[],
  criteria: SessionSortCriteria,
  direction: SortDirection
): Session[] {
  const getString = (value: string | null | undefined): string => value ?? '';
  return [...sessions].sort((a, b) => {
    let compareResult = 0;
    try {
      switch (criteria) {
        case 'sessionName': {
          const nameA = getString(a.sessionName) || getString(a.fileName);
          const nameB = getString(b.sessionName) || getString(b.fileName);
          compareResult = nameA.localeCompare(nameB, undefined, {
            sensitivity: 'base',
            usage: 'sort',
          });
          break;
        }
        case 'clientName':
          compareResult = getString(a.clientName).localeCompare(
            getString(b.clientName),
            undefined,
            { sensitivity: 'base', usage: 'sort' }
          );
          break;
        case 'sessionType':
          compareResult = getString(a.sessionType).localeCompare(
            getString(b.sessionType),
            undefined,
            { sensitivity: 'base', usage: 'sort' }
          );
          break;
        case 'therapy':
          compareResult = getString(a.therapy).localeCompare(
            getString(b.therapy),
            undefined,
            { sensitivity: 'base', usage: 'sort' }
          );
          break;
        case 'date':
          compareResult = getString(b.date).localeCompare(getString(a.date));
          break;
        case 'duration':
          compareResult = (a.duration ?? 0) - (b.duration ?? 0);
          break;
        case 'transcriptTokenCount':
          compareResult =
            (a.transcriptTokenCount ?? 0) - (b.transcriptTokenCount ?? 0);
          break;
        case 'id':
          compareResult = (a.id ?? 0) - (b.id ?? 0);
          break;
        default:
          return 0;
      }
    } catch {
      return 0;
    }
    if (direction === 'desc' && criteria !== 'date') compareResult *= -1;
    else if (direction === 'asc' && criteria === 'date') compareResult *= -1;
    return compareResult;
  });
}

export interface SessionNeighbor {
  /** Session id, or null when there is no neighbor on that side. */
  id: number | null;
  /** Display name (`sessionName || fileName`) for the tooltip, else null. */
  name: string | null;
}

export interface SessionNeighbors {
  prev: SessionNeighbor;
  next: SessionNeighbor;
}

/**
 * Ordered session list for SessionView prev/next navigation.
 *
 * Prefers `stateOrder` — the exact row order of the table the user came
 * from (passed via router state by SessionListTable, sort + filters
 * included) — and falls back to the global sort for every other entry
 * point: sidebar, search, upload, jobs modal, direct URL, or refresh
 * (router state does not survive reload). A stale/invalid order that no
 * longer contains the current session also falls back instead of
 * stranding the user with no neighbors.
 */
export function resolveSessionOrder(
  allSessions: Session[],
  currentId: number | null,
  stateOrder: unknown,
  criteria: SessionSortCriteria,
  direction: SortDirection
): Session[] {
  if (
    Array.isArray(stateOrder) &&
    stateOrder.every((id): id is number => typeof id === 'number') &&
    currentId !== null &&
    stateOrder.includes(currentId)
  ) {
    const byId = new Map(allSessions.map((s) => [s.id, s]));
    const ordered = stateOrder
      .map((id) => byId.get(id))
      .filter((s): s is Session => !!s);
    if (ordered.some((s) => s.id === currentId)) return ordered;
  }
  return sortSessions(allSessions, criteria, direction);
}

const noNeighbor: SessionNeighbor = { id: null, name: null };

function displayName(session: Session | undefined): string | null {
  if (!session) return null;
  return session.sessionName || session.fileName || null;
}

/**
 * Prev/next neighbors of `currentId` within an ordered session list.
 *
 * `orderedSessions` must already be in display order (i.e. the output of
 * sortSessions, or the exact row order of the table the user came from).
 * Out-of-range sides yield `{ id: null, name: null }` so callers can
 * disable the corresponding button. An unknown `currentId` yields no
 * neighbors rather than wrapping around.
 */
export function getSessionNeighbors(
  orderedSessions: Session[],
  currentId: number | null
): SessionNeighbors {
  if (currentId === null || currentId === undefined) {
    return { prev: noNeighbor, next: noNeighbor };
  }
  const index = orderedSessions.findIndex((s) => s.id === currentId);
  if (index === -1) {
    return { prev: noNeighbor, next: noNeighbor };
  }
  const prevSession = index > 0 ? orderedSessions[index - 1] : undefined;
  const nextSession =
    index < orderedSessions.length - 1 ? orderedSessions[index + 1] : undefined;
  return {
    prev: prevSession
      ? { id: prevSession.id, name: displayName(prevSession) }
      : noNeighbor,
    next: nextSession
      ? { id: nextSession.id, name: displayName(nextSession) }
      : noNeighbor,
  };
}
