import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'jotai';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

// MSW worker startup. Only loaded when E2E_TESTING=true (inlined by webpack
// DefinePlugin in webpack.config.js). Dynamic import keeps the worker +
// handlers out of the production bundle entirely.
//
// `onUnhandledRequest: 'bypass'` lets webpack-dev-server's HMR, asset
// requests, and favicon fetches through without being treated as test
// failures.
async function enableMocking(): Promise<void> {
  if (process.env.E2E_TESTING !== 'true') {
    return;
  }
  const { worker } = await import('./mocks/browser');
  // Service-worker registration occasionally fails under the parallel
  // Playwright load (every worker registers at once against one dev
  // server). Retry a few times: a worker that never registers mounts
  // the app unmocked and every /api/* falls through to the dev-server
  // proxy, which surfaces as confusing locator timeouts plus HPM
  // ECONNREFUSED noise.
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await worker.start({ onUnhandledRequest: 'bypass' });
      // `start()` resolves once the worker is active, but this page is
      // only intercepted after the worker *claims* it. Mounting the app
      // in that gap lets boot requests (readiness, sessions, gpu-stats,
      // …) bypass MSW and hit the dev-server proxy — the HPM
      // ECONNREFUSED spam. Wait for control first.
      await waitForWorkerControl();
      return;
    } catch (error) {
      lastError = error;
      console.error(
        `[E2E] MSW worker.start() attempt ${attempt} failed:`,
        error
      );
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  // Still mount (fail-open, as before) but leave a marker: the
  // document title names the cause so traces/snapshots diagnose
  // themselves instead of looking like app bugs.
  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  document.title = `MSW_START_FAILED: ${detail}`;
  throw lastError;
}

/**
 * Resolve once the MSW service worker controls this page
 * (`navigator.serviceWorker.controller` set after `clients.claim()`).
 * Rejects after 10s so a stuck claim still mounts the app (fail-open)
 * instead of hanging the boot forever.
 */
function waitForWorkerControl(timeoutMs = 10_000): Promise<void> {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    navigator.serviceWorker.controller
  ) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const done = () => {
      window.clearInterval(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
    };
    const onChange = () => {
      done();
      resolve();
    };
    const timer = window.setInterval(() => {
      if (navigator.serviceWorker.controller) {
        done();
        resolve();
      } else if (Date.now() - startedAt >= timeoutMs) {
        done();
        reject(
          new Error('MSW service worker did not claim the page within 10s.')
        );
      }
    }, 50);
    const startedAt = Date.now();
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
  });
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error(
    "Fatal Error: Root element with ID 'root' not found in the DOM."
  );
}

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// `.finally` (not `.then`) so a failed worker registration still mounts the
// app — Playwright surfaces the worker failure separately in the trace, and
// the UI's own fail-open posture (App.tsx readiness handler) matches the
// "always show the UI" intent.
enableMocking().finally(() => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <Provider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </Provider>
      </QueryClientProvider>
    </React.StrictMode>
  );
});
