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
  if (process.env.E2E_TESTING === 'true') {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  }
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
