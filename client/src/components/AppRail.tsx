import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import type { Theme } from '../types/theme'

const navigation = [
  { to: '/requests', label: 'Requests', icon: 'database' as const },
  { to: '/code', label: 'Code', icon: 'code' as const },
  { to: '/settings', label: 'Settings', icon: 'gear' as const },
]

export function AppRail({ theme: controlledTheme, onToggleTheme: controlledToggle }: { theme?: Theme; onToggleTheme?: () => void } = {}) {
  const [localTheme, setLocalTheme] = useState<Theme>(() => {
    const saved = window.localStorage.getItem('webhook-debugger:theme')
    return saved === 'light' || saved === 'dark' ? saved : 'dark'
  })
  const theme = controlledTheme ?? localTheme
  const onToggleTheme = controlledToggle ?? (() => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setLocalTheme(nextTheme)
    window.dispatchEvent(new CustomEvent<Theme>('webhook-debugger:theme-change', { detail: nextTheme }))
  })

  useEffect(() => {
    if (!controlledTheme) document.documentElement.dataset.theme = localTheme
  }, [controlledTheme, localTheme])

  return (
    <aside className="app-rail">
      <NavLink to="/requests" className="rail-logo" aria-label="Open requests">
        &lt;/&gt;
      </NavLink>
      <nav aria-label="Primary navigation">
        {navigation.map((item) => (
          <NavLink
            end={item.to === '/requests'}
            key={item.to}
            to={item.to}
            className={({ isActive }) => `rail-button ${isActive ? 'rail-button-active' : ''}`}
            aria-label={item.label}
            title={item.label}
          >
            <Icon name={item.icon} className="h-5 w-5" />
          </NavLink>
        ))}
      </nav>
      <div className="rail-bottom">
        <NavLink to="/help" className={({ isActive }) => `rail-button ${isActive ? 'rail-button-active' : ''}`} aria-label="Help" title="Help">
          <Icon name="help" className="h-5 w-5" />
        </NavLink>
        <button type="button" className="rail-button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={onToggleTheme}>
          <Icon name="sun" className="h-5 w-5" />
        </button>
        <span className="rail-avatar" aria-hidden="true">A</span>
      </div>
    </aside>
  )
}
