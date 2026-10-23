// The public front door stays light; the kitchen loads only when the player enters.
const play = import.meta.env.MODE === 'e2e' || new URLSearchParams(location.search).has('play');
if (play) {
  const [{ default: React }, { createRoot }, { App }] = await Promise.all([
    import('react'), import('react-dom/client'), import('./experience/App'), import('./experience/styles.css'),
  ]);
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
} else {
  const { showWelcome } = await import('./showcase');
  showWelcome(document.getElementById('root')!);
}
