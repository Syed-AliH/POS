import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './stores/themeStore';
import './styles.css';

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
