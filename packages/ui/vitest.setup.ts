// packages/ui/vitest.setup.ts
//
// Per-test setup for the @therascript/ui package. Runs once per test
// file before any specs execute.
//
// jsdom does not implement `ResizeObserver` or `IntersectionObserver`,
// but @radix-ui components reach for both in their layout effects.
// Without polyfills, every render of a Radix-themed form throws inside
// `act(...)` and the test suite goes red. Stub the constructors with
// no-op stand-ins; tests don't assert on observer behaviour.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds: ReadonlyArray<number> = [];
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  (
    globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }
  ).ResizeObserver = ResizeObserverStub;
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  (
    globalThis as unknown as {
      IntersectionObserver: typeof IntersectionObserverStub;
    }
  ).IntersectionObserver = IntersectionObserverStub;
}

// `matchMedia` is also missing in jsdom; @radix-ui calls it during
// `prefers-color-scheme` resolution. Return a no-op MediaQueryList.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
