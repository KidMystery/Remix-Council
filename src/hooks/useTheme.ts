import { useState, useEffect } from 'react';

export type Theme = 'dark' | 'light' | 'system';

export function useTheme(initialTheme?: Theme) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (initialTheme) return initialTheme;
    const saved = localStorage.getItem('ai_council_theme') as Theme;
    return saved || 'system';
  });

  useEffect(() => {
    localStorage.setItem('ai_council_theme', theme);
    const root = document.documentElement;

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const applySystemTheme = () => {
        if (mediaQuery.matches) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      };

      applySystemTheme();
      mediaQuery.addEventListener('change', applySystemTheme);
      return () => mediaQuery.removeEventListener('change', applySystemTheme);
    } else if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return {
    theme,
    setTheme,
    toggleTheme,
  };
}
