const KEY = 'glass-theme';

export type Theme = 'dark' | 'light';

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  try {
    if (theme === 'light') window.localStorage.setItem(KEY, 'light');
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the theme still applies for this visit.
  }
}

/** Wire the header toggle. Dark is the default; light only applies when chosen. */
export function mountThemeToggle(button: HTMLButtonElement) {
  const sync = () => {
    const light = currentTheme() === 'light';
    button.setAttribute('aria-pressed', String(light));
  };
  button.addEventListener('click', () => {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    sync();
  });
  sync();
}
