import { bootstrapApp } from './app.bootstrap.js';

window.addEventListener('DOMContentLoaded', () => {
  bootstrapApp().catch((error) => {
    console.error('[App] Bootstrap error:', error);
  });
});

console.log('[Main] App initialized');
