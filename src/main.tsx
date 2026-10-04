import './style.css';
import './ui.css';
import { mountApplication } from './app';

const host = document.getElementById('app');
if (!host) throw new Error('Missing application host');
let application = mountApplication(host);

if (import.meta.hot) {
  let stopped = false;
  let replacement = Promise.resolve();
  import.meta.hot.accept('./app', (next) => {
    if (!next) return;
    // Vite does not await accept callbacks. Keep every replacement under this owner,
    // including saves still pending when another update arrives.
    replacement = replacement.then(async () => {
      if (stopped) return;
      await application.dispose();
      if (!stopped) application = next.mountApplication(host);
    });
    void replacement.catch((error) => console.error('Application hot replacement failed', error));
  });
  import.meta.hot.accept();
  import.meta.hot.dispose(async () => {
    stopped = true;
    // Begin reader destruction synchronously; Vite awaits this before replacing the entry.
    await Promise.all([application.dispose(), replacement]);
  });
}
