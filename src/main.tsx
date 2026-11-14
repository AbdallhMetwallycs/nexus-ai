import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './theme/ThemeContext';
import { ToastProvider } from './components/ui/Toast';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './index.css';

// NEXUS AI — UI entry point. Fonts are vendored with the bundle so a cold start
// makes no request to a font CDN; the app must work with the network unplugged.
// HashRouter is used deliberately: the Tauri shell serves the app from the
// filesystem, where BrowserRouter paths would break.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
