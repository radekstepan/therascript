import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App'; // Using alias from tsconfig/webpack
import './styles/global.css'; // Import global styles FIRST

const rootElement = document.getElementById('root');

// Type assertion to tell TypeScript we're sure rootElement exists
// Use a check in production code for more safety.
if (!rootElement) {
  throw new Error("Fatal Error: Root element with ID 'root' not found in the DOM.");
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
