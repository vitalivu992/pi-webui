import { useCallback, useEffect, useRef, useState } from "react"
import { BrowserRouter, Route, Routes, useSearchParams } from "react-router"
import {
  LOGGED_OUT_EVENT,
  fetchConversations,
  fetchCronTasks,
  fetchFeatures,
  fetchMemory,
  fetchProjects,
  fetchSession,
  fetchSetup,
  logout,
} from "./lib/api.js"
import { readPrefs, writePref } from "./lib/prefs.js"
import { useFetch } from "./hooks/useFetch.js"
import { useLiveConversation } from "./hooks/useLiveConversation.js"
import { listPollDelay } from "./lib/live.js"
import { VIEWS, viewOf, viewsFor } from "./lib/views.js"
import { ProjectsPanel, isMissing } from "./components/ProjectsPanel.jsx"
import { ConversationList } from "./components/ConversationList.jsx"
import { ConversationView } from "./components/ConversationView.jsx"
import { ViewTabs } from "./components/ColumnHead.jsx"
import { CronList, CronView } from "./components/Cron.jsx"
import { MemoryList, MemoryView } from "./components/Memory.jsx"
import { SetupList, SetupView } from "./components/Setup.jsx"
import { LOCK_MS, LoginScreen, prefersReducedMotion } from "./components/LoginScreen.jsx"
import { ShellPanel, ShellProvider, useShells } from "./components/Shells.jsx"
import { NewConversation } from "./components/NewConversation.jsx"
import { RunsProvider, useRuns } from "./components/Runs.jsx"
import { SettingsPanel } from "./components/Settings.jsx"
import { WorkspacePanel } from "./components/WorkspacePanel.jsx"

export const APP_NAME = "pi WebUI"

/**
 * The browser: projects | conversations | conversation (or a new one) |
 * settings when open | the project's files and git status (a rail when collapsed). The selection lives in the URL
 * (`?project=<key>&c=<id>`, `&new=1` for a new conversation), so a
 * conversation can be linked to and the back button works. The second
 * column's other views (`&view=cron|memory|setup&item=<id>`, a cron run
 * `&run=<id>`) list what pi-hermes-memory and agents-cron hold for the project
 * and what pi loads there; the packages' views show only when pi has them installed.
 */
function Browser({ user, onLogout }) {
  const { openShell, setError: setShellError } = useShells()
  const runs = useRuns()
  const [params, setParams] = useSearchParams()
  const projectKey = params.get("project") || ""
  const id = params.get("c") || ""
  const creating = Boolean(params.get("new"))
  const item = params.get("item") || ""
  const runId = params.get("run") || ""
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => Boolean(readPrefs().projectsCollapsed))
  const [sideCollapsed, setSideCollapsed] = useState(() => readPrefs().workspaceCollapsed !== false)
  const [projectsReload, setProjectsReload] = useState(0)
  const [convsReload, setConvsReload] = useState(0)
  const [viewReload, setViewReload] = useState(0)

  // Asked once per login: which of the pi packages with a view pi has installed.
  const features = useFetch((signal) => fetchFeatures({ signal }), [])
  const requested = params.get("view") || ""
  const view = features.loading ? requested || "sessions" : viewOf(requested, features.data)
  const viewMeta = VIEWS.find((v) => v.id === view)

  // Both lists reload quietly, so the projects and conversations an agent is working on stay marked.
  const projects = useFetch((signal) => fetchProjects({ signal }), [projectsReload], {
    poll: (list) => listPollDelay(list?.some((p) => p.running)),
  })
  const conversations = useFetch((signal) => fetchConversations(projectKey, { signal }), [projectKey, convsReload], {
    enabled: Boolean(projectKey),
    poll: (list) => listPollDelay(list?.some((c) => c.active)),
  })
  const listed = (name) => ({ enabled: Boolean(projectKey) && view === name, poll: () => listPollDelay(false) })
  const cronTasks = useFetch((signal) => fetchCronTasks(projectKey, { signal }), [projectKey, viewReload], listed("cron"))
  const memory = useFetch((signal) => fetchMemory(projectKey, { signal }), [projectKey, viewReload], listed("memory"))
  // Not polled: it changes when pi's settings do. The refresh button skips the server's cache.
  const setup = useFetch((signal) => fetchSetup(projectKey, { signal, refresh: viewReload > 0 }), [projectKey, viewReload], {
    enabled: Boolean(projectKey) && view === "setup",
  })
  const run = runs.runFor(id)
  const conversation = useLiveConversation(id, { running: Boolean(run?.running) })

  // Open the most recently active project when none is selected, preferring one whose folder
  // still exists (the others are hidden by default).
  useEffect(() => {
    if (!projectKey && projects.data?.length) {
      const first = projects.data.find((p) => !isMissing(p)) || projects.data[0]
      setParams({ project: first.key }, { replace: true })
    }
  }, [projectKey, projects.data, setParams])

  const project = projects.data?.find((p) => p.key === projectKey) || null

  useEffect(() => {
    const title = conversation.data?.title || project?.name
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
  }, [conversation.data?.title, project?.name])

  // Another project keeps the view.
  const selectProject = useCallback((key) => setParams({ project: key, ...(view !== "sessions" ? { view } : {}) }), [setParams, view])
  const selectView = useCallback((v) => setParams({ project: projectKey, ...(v !== "sessions" ? { view: v } : {}) }), [setParams, projectKey])
  const selectItem = useCallback((key) => setParams({ project: projectKey, view, item: key }), [setParams, projectKey, view])
  const selectRun = useCallback(
    (key) => setParams({ project: projectKey, view: "cron", item, ...(key ? { run: key } : {}) }),
    [setParams, projectKey, item]
  )
  const selectConversation = useCallback((key) => setParams({ project: projectKey, c: key }), [setParams, projectKey])
  const newConversation = useCallback(() => setParams({ project: projectKey, new: "1" }), [setParams, projectKey])
  const conversationStarted = useCallback(
    (session) => {
      setParams({ project: projectKey, c: session }, { replace: true })
      setConvsReload((n) => n + 1)
    },
    [setParams, projectKey]
  )
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      writePref("projectsCollapsed", !v)
      return !v
    })
  }
  const toggleSide = () => {
    setSideCollapsed((v) => {
      writePref("workspaceCollapsed", !v)
      return !v
    })
  }

  const counts = {
    sessions: conversations.data?.length,
    cron: cronTasks.data?.length,
    memory: memory.data?.stores.reduce((n, st) => n + st.entries.length, 0),
    setup: setup.data?.items.length,
  }
  const tabs = <ViewTabs views={viewsFor(features.data)} view={viewMeta} count={counts[view]} onChange={selectView} />
  const column = { project, view: viewMeta, tabs, selectedId: item, onSelect: selectItem, onRefresh: () => setViewReload((n) => n + 1) }

  return (
    <div className={`pw-app${collapsed ? " is-collapsed" : ""}${sideCollapsed ? "" : " has-side"}${settingsOpen ? " has-settings" : ""}`}>
      <ProjectsPanel
        projects={projects.data}
        loading={projects.loading}
        error={projects.error}
        selectedKey={projectKey}
        onSelect={selectProject}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onRefresh={() => setProjectsReload((n) => n + 1)}
        user={user}
        onLogout={onLogout}
        onOpenSettings={openSettings}
        onOpenShell={(p) => openShell({ cwd: p.path }).catch(setShellError)}
      />
      {!project || view === "sessions" ? (
        <ConversationList
          key={projectKey}
          project={project}
          view={viewMeta}
          tabs={tabs}
          conversations={conversations.data}
          loading={conversations.loading}
          error={conversations.error}
          selectedId={creating ? "" : id}
          onSelect={selectConversation}
          onRefresh={() => setConvsReload((n) => n + 1)}
          onNew={newConversation}
          creating={creating}
        />
      ) : view === "cron" ? (
        <CronList key={projectKey} {...column} tasks={cronTasks.data} loading={cronTasks.loading} error={cronTasks.error} />
      ) : view === "memory" ? (
        <MemoryList {...column} memory={memory.data} loading={memory.loading} error={memory.error} />
      ) : (
        <SetupList key={projectKey} {...column} setup={setup.data} loading={setup.loading} error={setup.error} />
      )}
      <main className="pw-main">
        {view === "cron" ? (
          <CronView taskId={item} runId={runId} onSelectRun={selectRun} />
        ) : view === "memory" ? (
          <MemoryView key={item} store={memory.data?.stores.find((st) => st.id === item)} loading={memory.loading} />
        ) : view === "setup" ? (
          <SetupView key={item} id={item} projectKey={projectKey} setup={setup.data} onSelect={selectItem} />
        ) : creating ? (
          <NewConversation
            project={project}
            onStarted={conversationStarted}
            onCancel={() => setParams({ project: projectKey })}
            onOpenSettings={openSettings}
          />
        ) : (
          <ConversationView
            conversation={conversation.data}
            loading={conversation.loading}
            error={conversation.error}
            run={run}
            sentTurns={run ? runs.sentAt(run.id) : 0}
            onDismissRun={runs.dismiss}
            onOpenSettings={openSettings}
          />
        )}
        <ShellPanel defaultCwd={project?.exists ? project.path : ""} />
      </main>
      {settingsOpen ? (
        <SettingsPanel onClose={() => setSettingsOpen(false)} cwd={project?.exists ? project.path : ""} />
      ) : null}
      <WorkspacePanel project={project} collapsed={sideCollapsed} onToggle={toggleSide} />
    </div>
  )
}

/**
 * The login gate: the browser only mounts with a session. Right after a login
 * it mounts under the login screen, which plays its unlock sequence on top
 * while the projects load. A logout runs the other way: the login screen
 * comes in over the still-mounted browser, which unmounts once the session is
 * gone and the screen is opaque.
 */
function AuthGate() {
  // undefined: still asking the server; null: logged out.
  const [user, setUser] = useState(undefined)
  const [unlocking, setUnlocking] = useState(false)
  const [locking, setLocking] = useState(false)
  // While locking, the 401s of the browser's last requests don't cut the sequence short.
  const lockingRef = useRef(false)

  useEffect(() => {
    const ctrl = new AbortController()
    fetchSession({ signal: ctrl.signal }).then(
      (u) => setUser(u),
      () => !ctrl.signal.aborted && setUser(null)
    )
    const loggedOut = () => !lockingRef.current && setUser(null)
    window.addEventListener(LOGGED_OUT_EVENT, loggedOut)
    return () => {
      ctrl.abort()
      window.removeEventListener(LOGGED_OUT_EVENT, loggedOut)
    }
  }, [])

  useEffect(() => {
    if (user === null) document.title = `Log in · ${APP_NAME}`
  }, [user])

  const onLogin = useCallback((u) => {
    setUnlocking(true)
    setUser(u)
  }, [])
  const onUnlocked = useCallback(() => setUnlocking(false), [])
  const onLogout = useCallback(async () => {
    lockingRef.current = true
    setUnlocking(false)
    setLocking(true)
    const shown = new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 300 : LOCK_MS))
    try {
      await logout()
    } finally {
      await shown
      lockingRef.current = false
      setLocking(false)
      setUser(null)
    }
  }, [])

  if (user === undefined) return null
  return (
    <>
      {user ? (
        <ShellProvider>
          <RunsProvider>
            <Browser user={user} onLogout={onLogout} />
          </RunsProvider>
        </ShellProvider>
      ) : null}
      {!user || unlocking || locking ? (
        <LoginScreen unlockedAs={unlocking ? user : null} locking={locking} onLogin={onLogin} onDone={onUnlocked} />
      ) : null}
    </>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<AuthGate />} />
      </Routes>
    </BrowserRouter>
  )
}
