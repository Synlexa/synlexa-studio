import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FeedbackProvider } from './components/ui';
import { applyUiScale, getSettings } from './lib/appSettings';
import { relayPopupCallback } from './lib/studioAuth';
import './index.css';

applyUiScale(getSettings().uiScale);

const root = createRoot(document.getElementById('root')!);

// The synlexa.com sign-in popup lands back here: hand the result to the main
// Studio window and close immediately, instead of booting a second copy of the app.
if (relayPopupCallback(window.location.href)) {
  window.history.replaceState({}, '', window.location.pathname || '/');
  try {
    window.close();
  } catch {
    /* ignore */
  }
  root.render(
    <div className="flex h-full items-center justify-center bg-[#0d1117] p-6 text-center">
      <div>
        <div className="text-base font-medium text-slate-100">You&apos;re signed in</div>
        <p className="mt-1 text-sm text-slate-400">Closing sign-in window and returning to Synlexa Studio…</p>
        <button
          type="button"
          onClick={() => window.close()}
          className="mt-4 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          Close window
        </button>
      </div>
    </div>,
  );
  window.setTimeout(() => {
    try {
      window.close();
    } catch {
      /* ignore */
    }
  }, 80);
  window.setTimeout(() => {
    try {
      window.close();
    } catch {
      /* ignore */
    }
  }, 350);
} else {
  root.render(
    <StrictMode>
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    </StrictMode>,
  );
}
