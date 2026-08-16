import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@trinetra/ui/styles.css';

import { App } from './App';
import './web.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
