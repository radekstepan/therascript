// packages/ui/src/components/SessionView/Chat/ChatVerifiedStatusIcon.tsx
//
// Passive all-verified status icon for the session chat header. It is
// purely informational: it never starts verification (audits launch
// from the /verification hub) and renders only when every eligible AI
// note in the selected chat has a `completed` verification.
//
// State derives from the chat's messages plus the shared
// `chatVerifications` query cache (same key/options as ChatMessages, so
// no second fetch or polling loop). Audit progress, clear-verification,
// and chat-switch invalidations refresh it automatically; a newly added
// unchecked AI note hides it on the next render.
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { AppTooltip } from '../../Shared/AppTooltip';
import {
  chatVerificationsQueryKey,
  fetchChatVerifications,
  summarizeChatVerifications,
} from '../../../api/verification';
import type { ChatMessage } from '../../../types';

interface ChatVerifiedStatusIconProps {
  messages: ChatMessage[];
  sessionId: number | null;
  chatId: number | null;
}

export function ChatVerifiedStatusIcon({
  messages,
  sessionId,
  chatId,
}: ChatVerifiedStatusIconProps) {
  const enabled = sessionId !== null && chatId !== null;

  // Same key and options as ChatMessages: one shared cache entry, no
  // extra polling. Standalone chats pass null ids and stay disabled.
  const { data: verifications } = useQuery({
    queryKey: chatVerificationsQueryKey(sessionId, chatId),
    queryFn: () => fetchChatVerifications(sessionId!, chatId!),
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const summary = useMemo(
    () => summarizeChatVerifications(messages, verifications ?? []),
    [messages, verifications]
  );

  if (!enabled || !summary.allVerified) return null;

  const eligible = summary.eligibleMessageIds.length;
  const checked = summary.checkedMessageIds.length;
  const failed = summary.failedMessageIds.length;
  const accessibleName = `All ${eligible} chat notes fact-checked`;

  // Radix Themes renders tooltip content inside a <p>, so lines must be
  // phrasing content (spans, not divs). Each line is a single string
  // child for stable text matching.
  const lines = [
    `Checked ${checked} / ${eligible} notes`,
    `Failed: ${failed}`,
    `Claims — supported: ${summary.supportedClaims}, partial: ${summary.partialClaims}, contradicted: ${summary.contradictedClaims}, fabricated: ${summary.fabricatedClaims}`,
    `Omissions: ${summary.omissionsCount}`,
    summary.accuracyPercent === null
      ? 'Accuracy: unknown (no claims assessed)'
      : `Accuracy: ${summary.accuracyPercent.toFixed(1)}%`,
  ];

  return (
    <AppTooltip
      content={
        <span>
          {lines.map((line, index) => (
            <React.Fragment key={line}>
              {index > 0 && <br />}
              <span>{line}</span>
            </React.Fragment>
          ))}
        </span>
      }
    >
      <span
        role="img"
        aria-label={accessibleName}
        tabIndex={0}
        className="inline-flex cursor-default items-center rounded-sm text-green-600 outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-green-600 dark:text-green-500"
      >
        <ShieldCheck size={14} aria-hidden="true" />
      </span>
    </AppTooltip>
  );
}
