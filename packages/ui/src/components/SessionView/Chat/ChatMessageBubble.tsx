// packages/ui/src/components/SessionView/Chat/ChatMessageBubble.tsx
import React, { useCallback, useMemo, useRef } from 'react';
import { Badge, Box, Flex, Text, Spinner, Callout } from '@radix-ui/themes';
import {
  StarIcon,
  CopyIcon,
  ExclamationTriangleIcon,
} from '@radix-ui/react-icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { cn } from '../../../utils';
import { useAnimatedText } from '../../../hooks/useAnimatedText';
import type { ChatMessage } from '../../../types';
import type {
  MessageVerification,
  VerifiedStatement,
} from '../../../api/verification';
import {
  VERIFIED_MARK_CLASS,
  getVerdictLabel,
  getVerdictMarkStyle,
  rehypeHighlightStatements,
  splitTextByStatementSpans,
  type HighlightableStatement,
  type TextSegment,
} from '../../../utils/highlightVerifiedStatements';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  isCurrentlyStreaming: boolean;
  streamPhase?: 'thinking' | 'responding' | null;
  isAiResponding: boolean;
  renderMd: boolean;
  onStarClick: (message: ChatMessage) => void;
  onCopyClick: (payload: { text: string; html?: string }) => void;
  tokensPerSecond?: number | null;
  /** Fact-check verdict for this message (session chats only). */
  verification?: MessageVerification | null;
  /** Briefly ring the bubble (deep-link highlight). */
  flashHighlight?: boolean;
  onStatementClick?: (messageId: number, statement: VerifiedStatement) => void;
}

function splitThinkingText(text: string) {
  const thinkRegex = /<think>([\s\S]*?)(<\/think>|$)/g;
  const thinkingParts: string[] = [];
  let visibleText = '';
  let lastIndex = 0;

  for (const match of text.matchAll(thinkRegex)) {
    const matchIndex = match.index ?? 0;
    visibleText += text.slice(lastIndex, matchIndex);
    const reasoningText = match[1]?.trim();
    if (reasoningText) {
      thinkingParts.push(reasoningText);
    }
    lastIndex = matchIndex + match[0].length;
  }

  visibleText += text.slice(lastIndex);

  return {
    thinkingText: thinkingParts.length > 0 ? thinkingParts.join('\n\n') : null,
    visibleText,
  };
}

export function ChatMessageBubble({
  message,
  isCurrentlyStreaming,
  streamPhase,
  isAiResponding,
  renderMd,
  onStarClick,
  onCopyClick,
  tokensPerSecond,
  verification,
  flashHighlight,
  onStatementClick,
}: ChatMessageBubbleProps) {
  const { thinkingText, visibleText } = splitThinkingText(message.text);
  const animatedText = useAnimatedText(
    visibleText,
    message.sender === 'ai' && isCurrentlyStreaming
  );
  const displayText = isCurrentlyStreaming ? animatedText : visibleText;
  const showThinkingMarquee =
    Boolean(thinkingText) && isCurrentlyStreaming && streamPhase === 'thinking';

  const showWaitingIndicator =
    isAiResponding &&
    isCurrentlyStreaming &&
    streamPhase === 'thinking' &&
    displayText.trim() === '' &&
    !thinkingText;

  const markdownContainerRef = useRef<HTMLDivElement>(null);

  const showCopyButton = message.sender === 'ai' && !isCurrentlyStreaming;
  const isUser = message.sender === 'user';
  const showMetrics =
    !isUser &&
    message.completionTokens !== null &&
    message.completionTokens !== undefined &&
    message.completionTokens > 0 &&
    message.duration !== null &&
    message.duration !== undefined &&
    message.duration > 10;

  // Show metrics if we have a real avg tokens/s OR if we are currently streaming (either thinking or responding)
  const displayTokensPerSecond = showMetrics
    ? (message.completionTokens! * 1000) / message.duration!
    : (tokensPerSecond ?? null);

  // If streaming but no tokens yet, we might still show 0.0 or ~0.0 if we have tokensPerSecond
  const displayMetrics =
    displayTokensPerSecond !== null ||
    (isCurrentlyStreaming && tokensPerSecond !== null);

  const hasBubbleContent =
    displayText.trim() !== '' || showThinkingMarquee || showWaitingIndicator;

  // --- Verification highlighting -------------------------------------------
  const verificationStatements: VerifiedStatement[] = useMemo(
    () =>
      verification?.status === 'completed' && !isCurrentlyStreaming
        ? (verification.statements ?? [])
        : [],
    [verification, isCurrentlyStreaming]
  );

  const statementById = useMemo(
    () => new Map(verificationStatements.map((s) => [s.id, s])),
    [verificationStatements]
  );

  // Inline highlights cover claims only (omissions have no in-text span).
  // All verified claims stay highlighted, including supported ones.
  const highlightable: HighlightableStatement[] = useMemo(
    () =>
      verificationStatements
        .filter((s) => s.kind === 'claim' && s.exact_quote.trim() !== '')
        .map((s) => ({
          id: s.id,
          exact_quote: s.exact_quote,
          start_char: s.start_char,
          end_char: s.end_char,
          verdict: s.verdict,
        })),
    [verificationStatements]
  );

  const handleMarkActivate = useCallback(
    (statementId: number) => {
      const stmt = statementById.get(statementId);
      if (stmt) onStatementClick?.(message.id, stmt);
    },
    [statementById, message.id, onStatementClick]
  );

  const handleMarkKeyDown = useCallback(
    (event: React.KeyboardEvent, statementId: number) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleMarkActivate(statementId);
      }
    },
    [handleMarkActivate]
  );

  // Markdown mode: rehype plugin wraps quotes in <mark>, rendered here.
  const rehypePlugins = useMemo(
    () =>
      highlightable.length > 0
        ? [() => rehypeHighlightStatements(highlightable)]
        : [],
    [highlightable]
  );

  const markdownComponents = useMemo(
    () => ({
      mark: ({ node: _node, ...props }: any) => {
        const rawId = props['data-statement-id'] ?? props.dataStatementId;
        const statementId = Number(rawId);
        const stmt =
          Number.isFinite(statementId) && statementId > 0
            ? statementById.get(statementId)
            : undefined;
        if (!stmt) {
          return <mark {...props} />;
        }
        return (
          <mark
            {...props}
            className={cn(VERIFIED_MARK_CLASS, props.className)}
            style={{ ...getVerdictMarkStyle(stmt.verdict), ...props.style }}
            role="button"
            tabIndex={0}
            title={`${getVerdictLabel(stmt.verdict)} — click for the Fact Check`}
            aria-label={`${getVerdictLabel(stmt.verdict)} statement. Activate for details.`}
            onClick={(event: React.MouseEvent) => {
              event.stopPropagation();
              handleMarkActivate(stmt.id);
            }}
            onKeyDown={(event: React.KeyboardEvent) =>
              handleMarkKeyDown(event, stmt.id)
            }
          />
        );
      },
    }),
    [statementById, handleMarkActivate, handleMarkKeyDown]
  );

  // Plain-text mode: slice displayText into plain/highlighted segments.
  const plainSegments: TextSegment[] = useMemo(
    () =>
      highlightable.length > 0
        ? splitTextByStatementSpans(displayText, highlightable)
        : [{ text: displayText, statementId: null, verdict: null }],
    [displayText, highlightable]
  );

  const renderPlainSegments = () => {
    if (highlightable.length === 0) return displayText;
    return plainSegments.map((segment, idx) => {
      if (segment.statementId === null || segment.verdict === null) {
        return <React.Fragment key={idx}>{segment.text}</React.Fragment>;
      }
      const stmt = statementById.get(segment.statementId);
      if (!stmt)
        return <React.Fragment key={idx}>{segment.text}</React.Fragment>;
      return (
        <mark
          key={idx}
          className={VERIFIED_MARK_CLASS}
          style={getVerdictMarkStyle(segment.verdict)}
          role="button"
          tabIndex={0}
          title={`${getVerdictLabel(segment.verdict)} — click for the Fact Check`}
          aria-label={`${getVerdictLabel(segment.verdict)} statement. Activate for details.`}
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
            handleMarkActivate(stmt.id);
          }}
          onKeyDown={(event: React.KeyboardEvent) =>
            handleMarkKeyDown(event, stmt.id)
          }
        >
          {segment.text}
        </mark>
      );
    });
  };

  // Footer badge counts.
  const showVerificationFooter =
    !isUser &&
    !isCurrentlyStreaming &&
    verification != null &&
    verification.status === 'completed';
  const hallucinationCount = showVerificationFooter
    ? verification.contradicted_claims + verification.fabricated_claims
    : 0;
  const partialCount = showVerificationFooter ? verification.partial_claims : 0;
  const omissionCount = showVerificationFooter
    ? verification.omissions_count
    : 0;
  const totalClaims = showVerificationFooter ? verification.total_claims : 0;
  const supportedCount = showVerificationFooter
    ? verification.supported_claims
    : 0;
  const isFullyClean =
    showVerificationFooter &&
    hallucinationCount === 0 &&
    partialCount === 0 &&
    omissionCount === 0;

  const firstOmission = useMemo(
    () =>
      verificationStatements.find(
        (s) => s.kind === 'omission' || s.verdict === 'omission'
      ) ?? null,
    [verificationStatements]
  );
  const firstIssue = useMemo(
    () =>
      verificationStatements.find(
        (s) => s.verdict === 'contradicted' || s.verdict === 'fabricated'
      ) ??
      verificationStatements.find((s) => s.verdict === 'partially_supported') ??
      null,
    [verificationStatements]
  );

  const authoredModel = verification?.authored_model ?? message.model ?? null;

  const handleCopy = () => {
    if (message.sender === 'ai' && renderMd && markdownContainerRef.current) {
      // Unwrap verification <mark> overlays so pasted notes stay clean.
      const clone = markdownContainerRef.current.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(`mark.${VERIFIED_MARK_CLASS}`).forEach((el) => {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      });
      onCopyClick({
        html: clone.innerHTML,
        text: message.text,
      });
    } else {
      onCopyClick({ text: message.text });
    }
  };

  return (
    <Flex
      key={message.id}
      direction="column"
      align="start"
      className="mb-4 group"
    >
      {hasBubbleContent && (
        <Box
          px="3"
          py="2"
          className={cn(
            'relative shadow-sm transition-all duration-200 w-fit',
            'max-w-[90%] md:max-w-[85%] lg:max-w-[75%]',
            // Modern bubble shapes: fully rounded with subtle differences
            isUser
              ? 'bg-[var(--accent-9)] text-white rounded-lg ml-auto'
              : 'bg-[var(--gray-2)] text-[var(--gray-12)] rounded-lg border border-[var(--gray-4)]',
            showWaitingIndicator && 'min-h-[3rem] flex items-center',
            flashHighlight &&
              !isUser &&
              'ring-2 ring-[var(--amber-8)] ring-offset-2 ring-offset-[var(--color-background)]'
          )}
          style={{
            // Subtle pop
            boxShadow: isUser
              ? '0 2px 8px -2px var(--accent-a5)'
              : '0 2px 4px -2px rgba(0,0,0,0.05)',
          }}
        >
          {/* Message Content */}
          {showWaitingIndicator ? (
            <Flex align="center" gap="2" className="text-[var(--gray-11)] px-1">
              <Spinner size="1" />
              <Box className="thinking-ticker" aria-label="Model is thinking">
                <Box className="thinking-ticker-track">
                  <Text size="2" style={{ fontStyle: 'italic' }}>
                    Thinking
                  </Text>
                  <Text size="2" style={{ fontStyle: 'italic' }}>
                    Reviewing context
                  </Text>
                  <Text size="2" style={{ fontStyle: 'italic' }}>
                    Preparing response
                  </Text>
                  <Text size="2" style={{ fontStyle: 'italic' }}>
                    Thinking
                  </Text>
                  <Text size="2" style={{ fontStyle: 'italic' }}>
                    Reviewing context
                  </Text>
                  <Text size="2" style={{ fontStyle: 'italic' }}>
                    Preparing response
                  </Text>
                </Box>
              </Box>
            </Flex>
          ) : (
            <Box className={cn(isUser ? 'text-white' : 'markdown-ai-message')}>
              {showThinkingMarquee && (
                <Box
                  mb={displayText.trim() !== '' ? '3' : '0'}
                  className="thinking-inline-strip"
                  aria-label="Model reasoning"
                >
                  <Text size="1" className="thinking-inline-label">
                    Thinking
                  </Text>
                  <Box className="thinking-inline-marquee">
                    <Box className="thinking-inline-track">
                      <Text size="1" className="thinking-inline-copy">
                        {thinkingText}
                      </Text>
                      <Text
                        size="1"
                        className="thinking-inline-copy"
                        aria-hidden="true"
                      >
                        {thinkingText}
                      </Text>
                    </Box>
                  </Box>
                </Box>
              )}
              {displayText.trim() !== '' &&
                (!isUser && renderMd ? (
                  <Box ref={markdownContainerRef}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkBreaks]}
                      rehypePlugins={rehypePlugins}
                      components={markdownComponents}
                    >
                      {displayText}
                    </ReactMarkdown>
                  </Box>
                ) : (
                  <Text
                    size="2"
                    style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      lineHeight: 1.6,
                    }}
                  >
                    {isUser ? displayText : renderPlainSegments()}
                  </Text>
                ))}
            </Box>
          )}
        </Box>
      )}

      {message.isTruncated && (
        <Box
          mt="2"
          width="100%"
          className="max-w-[90%] md:max-w-[85%] lg:max-w-[75%]"
        >
          <Callout.Root color="amber" size="1">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              Context limit reached. Some older messages or parts of the
              transcript were truncated and ignored by the LLM.
            </Callout.Text>
          </Callout.Root>
        </Box>
      )}

      {/* Warning for thinking-only response: model thought but produced no actual reply */}
      {!isUser &&
        !isCurrentlyStreaming &&
        thinkingText !== null &&
        visibleText.trim() === '' && (
          <Box
            mt="2"
            width="100%"
            className="max-w-[90%] md:max-w-[85%] lg:max-w-[75%]"
          >
            <Callout.Root color="orange" size="1">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                The model finished thinking but produced no response. It may
                have exhausted its output budget during reasoning. Try a shorter
                prompt, reduce the thinking budget, or use a different model.
              </Callout.Text>
            </Callout.Root>
          </Box>
        )}

      {/* Warning for 0 completion tokens when model exhausts context on thinking */}
      {!isUser && !isCurrentlyStreaming && message.completionTokens === 0 && (
        <Box
          mt="2"
          width="100%"
          className="max-w-[90%] md:max-w-[85%] lg:max-w-[75%]"
        >
          <Callout.Root color="orange" size="1">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              No response generated. The model may have reached its context
              limit while thinking. Try a shorter prompt or use a different
              model.
            </Callout.Text>
          </Callout.Root>
        </Box>
      )}

      {/* Metrics Row - only for AI messages */}
      {!isUser && displayMetrics && (
        <Flex
          mt="1"
          width="100%"
          justify="start"
          className="text-[var(--gray-9)]"
        >
          <Text size="1">
            {isCurrentlyStreaming && displayTokensPerSecond !== null
              ? `~${(tokensPerSecond ?? 0).toFixed(1)} tokens/s`
              : (() => {
                  const thinking = message.thinkingTokens ?? 0;
                  const response = message.completionTokens ?? 0;
                  if (thinking > 0) {
                    return `${thinking} thinking + ${response} response tokens (${displayTokensPerSecond!.toFixed(1)} tokens/s)`;
                  }
                  return `${response} tokens (${displayTokensPerSecond!.toFixed(1)} tokens/s)`;
                })()}
          </Text>
        </Flex>
      )}

      {/* Verification footer — only for verified AI messages */}
      {showVerificationFooter && (
        <Flex
          mt="1"
          width="100%"
          justify="start"
          align="center"
          gap="2"
          wrap="wrap"
        >
          {isFullyClean ? (
            <Badge color="green" variant="soft" size="1">
              ✓ Verified ({supportedCount}/{totalClaims} claims)
            </Badge>
          ) : (
            <>
              {hallucinationCount > 0 && (
                <Badge
                  color="red"
                  variant="soft"
                  size="1"
                  className="cursor-pointer hover:brightness-95 transition"
                  role={firstIssue ? 'button' : undefined}
                  tabIndex={firstIssue ? 0 : undefined}
                  title="Open the Fact Check"
                  onClick={
                    firstIssue
                      ? (event: React.MouseEvent) => {
                          event.stopPropagation();
                          onStatementClick?.(message.id, firstIssue);
                        }
                      : undefined
                  }
                  onKeyDown={
                    firstIssue
                      ? (event: React.KeyboardEvent) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onStatementClick?.(message.id, firstIssue);
                          }
                        }
                      : undefined
                  }
                >
                  {hallucinationCount} Hallucination
                  {hallucinationCount === 1 ? '' : 's'} / Contradiction
                  {hallucinationCount === 1 ? '' : 's'}
                </Badge>
              )}
              {partialCount > 0 && (
                <Badge color="amber" variant="soft" size="1">
                  {partialCount} Partially supported
                </Badge>
              )}
              {omissionCount > 0 && (
                <Badge
                  color="amber"
                  variant="soft"
                  size="1"
                  className="cursor-pointer hover:brightness-95 transition"
                  role={firstOmission ? 'button' : undefined}
                  tabIndex={firstOmission ? 0 : undefined}
                  title="Omissions have no in-text highlight — click to see what was missed"
                  onClick={
                    firstOmission
                      ? (event: React.MouseEvent) => {
                          event.stopPropagation();
                          onStatementClick?.(message.id, firstOmission);
                        }
                      : undefined
                  }
                  onKeyDown={
                    firstOmission
                      ? (event: React.KeyboardEvent) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onStatementClick?.(message.id, firstOmission);
                          }
                        }
                      : undefined
                  }
                >
                  {omissionCount} Omission{omissionCount === 1 ? '' : 's'}{' '}
                  detected
                </Badge>
              )}
            </>
          )}
          {authoredModel != null && authoredModel !== '' && (
            <Badge
              color="gray"
              variant="soft"
              size="1"
              title={`Authored by ${authoredModel}`}
              style={{
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {authoredModel}
            </Badge>
          )}
        </Flex>
      )}

      {/* Action Row */}
      {(showCopyButton || isUser) && (
        <Flex
          mt="1"
          width="100%"
          justify={isUser ? 'end' : 'start'}
          className={cn(
            'opacity-0 group-hover:opacity-100 transition-opacity duration-200',
            'text-[var(--gray-9)]'
          )}
        >
          {showCopyButton && (
            <Flex
              align="center"
              gap="1"
              className="cursor-pointer hover:text-[var(--gray-11)]"
              onClick={handleCopy}
            >
              <CopyIcon width={12} height={12} />
              <Text size="1">Copy</Text>
            </Flex>
          )}
          {isUser && (
            <Flex
              align="center"
              gap="1"
              className="cursor-pointer hover:text-[var(--gray-11)]"
              onClick={() => onStarClick(message)}
            >
              <StarIcon width={12} height={12} />
              <Text size="1">Save as template</Text>
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
}
