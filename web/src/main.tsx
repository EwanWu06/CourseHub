import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// every axis: optical size (crisp hairlines at display sizes), weight, softness
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

document.documentElement.dataset.fresh = ''; // until the first page change: see withTransition

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* last line of defence: even a broken frame shows how to recover instead of a blank page */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
