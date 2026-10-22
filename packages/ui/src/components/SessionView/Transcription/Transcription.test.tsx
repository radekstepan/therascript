// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Transcription/Transcription.test.tsx
//
// Missing-audio warning coverage: a null `audioPath` (normal in-app
// deletion) and a stale path whose file no longer exists (external
// deletion) both show the amber "The audio file doesn't exist." warning.
// Genuine decode, unsupported-format, and network failures keep their own
// red error messages — the server availability probe (not the ambiguous
// browser media error code 4) decides what counts as missing.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Theme } from '@radix-ui/themes';
import { Transcription } from './Transcription';
import type { Session, StructuredTranscript } from '../../../types';

// jsdom does not implement the MediaError global, but the component maps
// `error.code` through its constants like a real browser. Polyfill the
// spec values so fired media errors exercise the real mapping.
if (typeof globalThis.MediaError === 'undefined') {
  (globalThis as unknown as { MediaError: unknown }).MediaError = {
    MEDIA_ERR_ABORTED: 1,
    MEDIA_ERR_NETWORK: 2,
    MEDIA_ERR_DECODE: 3,
    MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
  };
}

const { checkAudioMock } = vi.hoisted(() => ({
  checkAudioMock: vi.fn(),
}));

vi.mock('../../../api/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../api/api')>();
  return {
    ...original,
    checkSessionAudioAvailability: checkAudioMock,
  };
});

// react-virtuoso measures its container to decide what to render; in jsdom
// every measurement is 0 so it renders no rows. Replace it with a plain
// list that renders every paragraph through the real `itemContent`.
vi.mock('react-virtuoso', async (importOriginal) => {
  const React = await import('react');
  return {
    Virtuoso: React.forwardRef(function MockVirtuoso(
      props: {
        data: unknown[];
        itemContent: (index: number, item: any) => React.ReactNode;
        components?: Record<string, (() => React.ReactNode) | undefined>;
      },
      _ref: unknown
    ) {
      if (props.data.length === 0) {
        const Empty = props.components?.EmptyPlaceholder;
        return <div data-testid="virtuoso-mock">{Empty?.()}</div>;
      }
      return (
        <div data-testid="virtuoso-mock">
          {props.data.map((item: any, index: number) => (
            <div key={item.id ?? index}>{props.itemContent(index, item)}</div>
          ))}
        </div>
      );
    }),
  };
});

const TRANSCRIPT: StructuredTranscript = [
  {
    id: 0,
    timestamp: 0,
    text: 'Patient reports low mood.',
    speaker: 'PATIENT',
  },
  {
    id: 1,
    timestamp: 5000,
    text: 'Therapist reflects back.',
    speaker: 'THERAPIST',
  },
];

const makeSession = (overrides?: Partial<Session>): Session => ({
  id: 1,
  clientName: 'Client',
  sessionName: 'Intake',
  date: new Date('2024-01-02T12:00:00.000Z').toISOString(),
  sessionType: 'intake',
  therapy: 'cbt',
  numSpeakers: 2,
  fileName: 'audio.mp3',
  audioPath: '1-1234.mp3',
  status: 'completed',
  whisperJobId: null,
  showSpeakers: 1,
  chats: [],
  ...overrides,
});

function renderTranscription(session: Session) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <Theme>
          <Transcription
            session={session}
            transcriptContent={TRANSCRIPT}
            isTabActive
            isLoadingTranscript={false}
            transcriptError={null}
          />
        </Theme>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const rerenderSession = (next: Session) => {
    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Theme>
            <Transcription
              session={next}
              transcriptContent={TRANSCRIPT}
              isTabActive
              isLoadingTranscript={false}
              transcriptError={null}
            />
          </Theme>
        </QueryClientProvider>
      </MemoryRouter>
    );
  };
  return { ...view, rerenderSession };
}

const audioElement = () =>
  document.querySelector('audio') as HTMLAudioElement | null;

const bannerBackgroundOf = (el: HTMLElement): string | undefined => {
  // Text -> Flex -> status Box (which carries the inline palette style).
  const box = el.parentElement?.parentElement as HTMLElement | null;
  return box?.style?.backgroundColor;
};

function fireMediaError(audio: HTMLAudioElement, code: number) {
  Object.defineProperty(audio, 'error', {
    value: { code, message: '' },
    configurable: true,
  });
  fireEvent.error(audio);
}

beforeEach(() => {
  checkAudioMock.mockReset();
  checkAudioMock.mockResolvedValue(true);
  vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(
    () => {}
  );
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(
    () => {}
  );
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(
    undefined as unknown as void
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Transcription missing-audio warning', () => {
  it('shows the amber missing warning for a null audio path without probing', async () => {
    renderTranscription(makeSession({ audioPath: null }));

    const warning = await screen.findByTestId('audio-missing-warning');
    expect(warning.textContent).toBe("The audio file doesn't exist.");
    expect(bannerBackgroundOf(warning)).toBe('var(--amber-a3)');
    // No probe: the metadata itself confirms the file is gone.
    expect(checkAudioMock).not.toHaveBeenCalled();
    // No indefinite spinner, no media element, no play controls.
    expect(screen.queryByTestId('audio-loading-message')).toBeNull();
    expect(document.querySelector('.rt-Spinner')).toBeNull();
    expect(audioElement()).toBeNull();
    expect(
      screen.queryByRole('button', { name: /play paragraph/i })
    ).toBeNull();
    // The transcript itself stays readable.
    expect(screen.getByText('Patient reports low mood.')).not.toBeNull();
    expect(screen.getByText('Therapist reflects back.')).not.toBeNull();
  });

  it('shows the warning for a stale path whose file is server-confirmed missing', async () => {
    checkAudioMock.mockResolvedValue(false);
    renderTranscription(makeSession({ id: 7, audioPath: '7-stale.mp3' }));

    const warning = await screen.findByTestId('audio-missing-warning');
    expect(warning.textContent).toBe("The audio file doesn't exist.");
    expect(bannerBackgroundOf(warning)).toBe('var(--amber-a3)');
    expect(checkAudioMock).toHaveBeenCalledTimes(1);
    expect(checkAudioMock).toHaveBeenCalledWith(7);
    // Loading stops: no spinner, no audio element, no seek controls.
    await waitFor(() =>
      expect(screen.queryByTestId('audio-loading-message')).toBeNull()
    );
    expect(document.querySelector('.rt-Spinner')).toBeNull();
    expect(audioElement()).toBeNull();
    expect(
      screen.queryByRole('button', { name: /play paragraph/i })
    ).toBeNull();
    expect(screen.queryByTestId('audio-error-message')).toBeNull();
    expect(screen.getByText('Patient reports low mood.')).not.toBeNull();
  });

  it('plays valid supported audio normally after the probe confirms it', async () => {
    renderTranscription(makeSession());

    await waitFor(() => expect(audioElement()).not.toBeNull());
    const audio = audioElement()!;
    fireEvent.canPlay(audio);
    await waitFor(() =>
      expect(screen.queryByTestId('audio-loading-message')).toBeNull()
    );
    expect(screen.queryByTestId('audio-missing-warning')).toBeNull();
    expect(screen.queryByTestId('audio-error-message')).toBeNull();

    // Seek + play from the first paragraph.
    Object.defineProperty(audio, 'readyState', {
      value: 4,
      configurable: true,
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: /play paragraph/i })[0]!
    );
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
    fireEvent.play(audio);
    await screen.findByRole('button', { name: 'Pause paragraph playback' });
    expect(screen.queryByTestId('audio-missing-warning')).toBeNull();
  });

  it('keeps a genuine unsupported-format failure red and distinct', async () => {
    renderTranscription(makeSession());

    await waitFor(() => expect(audioElement()).not.toBeNull());
    fireMediaError(audioElement()!, 4);

    const error = await screen.findByTestId('audio-error-message');
    expect(error.textContent).toBe('Audio Error: Audio format not supported.');
    expect(bannerBackgroundOf(error)).toBe('var(--red-a3)');
    expect(screen.queryByTestId('audio-missing-warning')).toBeNull();
    // The media failure must not trigger another availability probe.
    expect(checkAudioMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a genuine network failure red and distinct', async () => {
    renderTranscription(makeSession());

    await waitFor(() => expect(audioElement()).not.toBeNull());
    fireMediaError(audioElement()!, 2);

    const error = await screen.findByTestId('audio-error-message');
    expect(error.textContent).toBe('Audio Error: Network error loading audio.');
    expect(bannerBackgroundOf(error)).toBe('var(--red-a3)');
    expect(screen.queryByTestId('audio-missing-warning')).toBeNull();
    expect(checkAudioMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a genuine decode failure red and distinct', async () => {
    renderTranscription(makeSession());

    await waitFor(() => expect(audioElement()).not.toBeNull());
    fireMediaError(audioElement()!, 3);

    const error = await screen.findByTestId('audio-error-message');
    expect(error.textContent).toBe('Audio Error: Error decoding audio file.');
    expect(screen.queryByTestId('audio-missing-warning')).toBeNull();
  });

  it('falls through to media errors when the probe itself fails', async () => {
    // Offline probe: inconclusive, so the element still mounts and the
    // genuine network failure keeps its own message (never the warning).
    checkAudioMock.mockRejectedValue(new Error('offline'));
    renderTranscription(makeSession());

    await waitFor(() => expect(audioElement()).not.toBeNull());
    fireMediaError(audioElement()!, 2);

    const error = await screen.findByTestId('audio-error-message');
    expect(error.textContent).toBe('Audio Error: Network error loading audio.');
    expect(screen.queryByTestId('audio-missing-warning')).toBeNull();
  });

  it('resets stale warning state when switching to a session with valid audio', async () => {
    checkAudioMock.mockImplementation(async (id: number) => id !== 7);
    const { rerenderSession } = renderTranscription(
      makeSession({ id: 7, audioPath: '7-stale.mp3' })
    );

    await screen.findByTestId('audio-missing-warning');
    expect(audioElement()).toBeNull();

    rerenderSession(makeSession({ id: 8, audioPath: '8-fresh.mp3' }));

    await waitFor(() => expect(audioElement()).not.toBeNull());
    const audio = audioElement()!;
    fireEvent.canPlay(audio);
    await waitFor(() =>
      expect(screen.queryByTestId('audio-missing-warning')).toBeNull()
    );
    expect(screen.queryByTestId('audio-error-message')).toBeNull();
    expect(checkAudioMock).toHaveBeenCalledWith(7);
    expect(checkAudioMock).toHaveBeenCalledWith(8);

    // ...and the new session plays normally.
    Object.defineProperty(audio, 'readyState', {
      value: 4,
      configurable: true,
    });
    fireEvent.click(
      screen.getAllByRole('button', { name: /play paragraph/i })[0]!
    );
    fireEvent.play(audio);
    await screen.findByRole('button', { name: 'Pause paragraph playback' });
  });

  it('fires exactly one probe per source across rerenders and media errors', async () => {
    const { rerenderSession } = renderTranscription(makeSession());
    await waitFor(() => expect(audioElement()).not.toBeNull());

    // Same session rerendered (new object identity) + a media error.
    rerenderSession(makeSession());
    fireMediaError(audioElement()!, 4);
    await screen.findByTestId('audio-error-message');

    expect(checkAudioMock).toHaveBeenCalledTimes(1);
    // The stale probe error clears when the same source reloads cleanly.
    rerenderSession(makeSession({ id: 2, audioPath: '2-other.mp3' }));
    await waitFor(() => expect(audioElement()).not.toBeNull());
    fireEvent.canPlay(audioElement()!);
    await waitFor(() =>
      expect(screen.queryByTestId('audio-error-message')).toBeNull()
    );
    expect(checkAudioMock).toHaveBeenCalledTimes(2);
  });
});
