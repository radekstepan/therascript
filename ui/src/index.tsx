import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'jotai';
import { BrowserRouter } from 'react-router-dom'; // Import BrowserRouter
import App from './App';
import './styles/global.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Fatal Error: Root element with ID 'root' not found in the DOM.");
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    {/* Wrap App with Jotai Provider and BrowserRouter */}
    <Provider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Provider>
  </React.StrictMode>
);
