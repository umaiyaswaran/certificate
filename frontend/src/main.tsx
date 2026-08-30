import React from 'react';
import { createRoot } from 'react-dom/client';
import App, { VerificationPage } from './App';
import './style.css';

const path = window.location.pathname;
const root = createRoot(document.getElementById('root')!);

if (path.startsWith('/verify/')) {
  root.render(<React.StrictMode><VerificationPage /></React.StrictMode>);
} else {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
