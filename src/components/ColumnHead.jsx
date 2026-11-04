import { plural } from "../lib/format.js"

/**
 * The second column's header: the project, the view it shows ("pi-webui · Cron jobs"),
 * a reload button and the view's own actions (`children`).
 */
export function ColumnHead({ project, view, loading, onRefresh, children }) {
  return (
    <header className="pw-panel-head">
      <div className="pw-convs__project" title={project.path}>
        <span className="pw-convs__heading">
          <span className="pw-convs__name">{project.name}</span>
          <span className="pw-convs__view" id="pwColumnView">
            {view.label}
          </span>
        </span>
        {project.path ? (
          <span className="pw-convs__path">
            <bdi>{project.path}</bdi>
          </span>
        ) : null}
      </div>
      <div className="pw-panel-head__actions">
        <button type="button" className="pw-icon-btn" onClick={onRefresh} title="Reload" aria-label={`Reload ${view.label.toLowerCase()}`}>
          <i className={`fa-solid fa-rotate${loading ? " fa-spin" : ""}`} aria-hidden="true"></i>
        </button>
        {children}
      </div>
    </header>
  )
}

/**
 * One line of view icons: the selected view spells out its name and `count`,
 * the others show only their icon.
 */
export function ViewTabs({ views, view, count, onChange }) {
  if (views.length < 2) return null
  return (
    <div className="pw-segmented pw-segmented--views" role="tablist" aria-label="View" id="pwViewTabs">
      {views.map((v) => {
        const active = v.id === view.id
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            className={active ? "is-active" : "is-icon"}
            aria-selected={active}
            aria-label={v.label}
            data-view={v.id}
            title={active && count != null ? `${v.label}: ${plural(count, "item")}` : v.label}
            onClick={() => onChange(v.id)}
          >
            <i className={v.icon} aria-hidden="true"></i>
            {active ? (
              <>
                {v.label}
                {count != null ? <span className="pw-count">{count}</span> : null}
              </>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
