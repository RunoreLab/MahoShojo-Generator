import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './styles/globals.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('desktop root container is missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
