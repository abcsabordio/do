export type Theme = 'dark' | 'light'

const KEY = 'todo.theme'

// Browser bar color on phones, matching --bg for each theme.
const BAR_COLOR: Record<Theme, string> = { dark: '#0e1013', light: '#f3f4f6' }

/** The saved theme (dark unless the user picked light). */
export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** Apply a theme to the page and remember it for next time. */
export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLOR[theme])
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Still applied for this visit.
  }
}
