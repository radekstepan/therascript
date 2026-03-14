import type { StructuredTranscript } from '../../../types';

export function getUniqueSpeakers(
  transcript: StructuredTranscript | null | undefined
): string[] {
  if (!transcript) return [];
  const seen = new Set<string>();
  for (const p of transcript) {
    if (p.speaker) seen.add(p.speaker);
  }
  return Array.from(seen).sort();
}
