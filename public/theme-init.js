// Applies a saved light theme before first paint. Dark is the default and
// needs no script at all. Kept as an external file because the page's CSP
// forbids inline scripts.
try {
  if (window.localStorage.getItem('glass-theme') === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
} catch {
  // Storage blocked: stay on the dark default.
}
