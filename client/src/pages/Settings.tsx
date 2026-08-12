import type { Theme } from '../types/theme'

export function Settings({ theme, onThemeChange }: { theme: Theme; onThemeChange: (theme: Theme) => void }) {
  return (
    <section className="route-page settings-page">
      <div className="route-page-header">
        <p className="editorial-kicker">Workspace settings</p>
        <h1>Make the workspace yours.</h1>
        <p>These settings are intentionally kept in this file so you can extend them as the debugger grows.</p>
      </div>
      <div className="settings-grid">
        <section className="settings-card">
          <div>
            <p className="settings-card-kicker">Appearance</p>
            <h2>Theme</h2>
            <p>Choose the surface that feels best while you inspect requests.</p>
          </div>
          <div className="theme-options" role="group" aria-label="Theme">
            {(['dark', 'light'] as const).map((option) => (
              <button type="button" key={option} className={`theme-option ${theme === option ? 'theme-option-active' : ''}`} onClick={() => onThemeChange(option)} aria-pressed={theme === option}>
                <span className={`theme-swatch theme-swatch-${option}`} />
                <span>{option[0].toUpperCase() + option.slice(1)}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="settings-card settings-card-muted">
          <div>
            <p className="settings-card-kicker">Your extension point</p>
            <h2>Add your settings here</h2>
            <p>This card is ready for inbox preferences, retention controls, or integrations you want to add next.</p>
          </div>
        </section>
      </div>
    </section>
  )
}
