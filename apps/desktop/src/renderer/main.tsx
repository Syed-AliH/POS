import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { mark, perfReport, setPerfEnabled } from '@shared/perf';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './stores/themeStore';
import './styles.css';

// Timing harness: on in dev only. Disabled it costs one boolean read per call.
if (import.meta.env.DEV) {
  setPerfEnabled(true, { label: 'ui' });
  mark('startup.renderer');
  // window.posPerf() in devtools prints the summary table.
  (window as unknown as { posPerf: () => void }).posPerf = () => console.log(perfReport());
}

const root = document.getElementById('root');
if (!root) {
  document.body.innerHTML = '<p style="padding:2rem;color:red">Root element not found</p>';
} else {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
