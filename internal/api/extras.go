package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"pi-webui/internal/catalog"
	"pi-webui/internal/cron"
	"pi-webui/internal/launch"
	"pi-webui/internal/memory"
	"pi-webui/internal/pi"
	"pi-webui/internal/setup"
)

// The pi packages the UI has views for, by their npm name.
const (
	memoryPackage = "pi-hermes-memory"
	cronPackage   = "agents-cron"
)

// registerExtras adds the routes of the views beside the conversations:
//
//	GET /api/features                         which of the packages pi has installed
//	GET /api/memory?project=<key>             pi-hermes-memory's stores, the project's first
//	GET /api/cron?project=<key>               the agents-cron tasks bound to the project
//	GET /api/cron/{task}                      one task and its runs, newest first
//	GET /api/cron/{task}/runs/{run}           one run, its report and its transcript
//	GET /api/setup?project=<key>[&refresh=1]  what pi loads in the project: packages, extensions,
//	                                          skills, prompt templates, themes (internal/setup)
//	GET /api/setup/{id}?project=<key>         one of them and its markdown (SKILL.md, README)
func (h *Handler) registerExtras(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/features", h.features)
	mux.HandleFunc("GET /api/memory", h.memory)
	mux.HandleFunc("GET /api/cron", h.cronTasks)
	mux.HandleFunc("GET /api/cron/{task}", h.cronTask)
	mux.HandleFunc("GET /api/cron/{task}/runs/{run}", h.cronRun)
	mux.HandleFunc("GET /api/setup", h.setup)
	mux.HandleFunc("GET /api/setup/{id}", h.setupItem)
}

// Installed reports whether pi's settings list the package (as npm:name[@v],
// git:…/name or a path ending in name).
func Installed(piDir, name string) bool {
	b, err := os.ReadFile(filepath.Join(piDir, "agent", "settings.json"))
	if err != nil {
		return false
	}
	var settings struct {
		Packages []json.RawMessage `json:"packages"`
	}
	if json.Unmarshal(b, &settings) != nil {
		return false
	}
	for _, raw := range settings.Packages {
		var source string
		if json.Unmarshal(raw, &source) != nil {
			var obj struct {
				Source string `json:"source"`
			}
			json.Unmarshal(raw, &obj)
			source = obj.Source
		}
		if packageName(source) == name {
			return true
		}
	}
	return false
}

func packageName(source string) string {
	if s, ok := strings.CutPrefix(source, "npm:"); ok {
		if i := strings.LastIndex(s, "@"); i > 0 {
			s = s[:i]
		}
		return s
	}
	return strings.TrimSuffix(filepath.Base(strings.TrimRight(source, `/\`)), ".git")
}

func (h *Handler) features(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{
		"memory": Installed(h.PiDir, memoryPackage),
		"cron":   Installed(h.PiDir, cronPackage),
	})
}

// projectDir is the folder of ?project=<key> ("" for sessions without one).
func projectDir(r *http.Request) string {
	key := r.URL.Query().Get("project")
	if key == catalog.NoWorkspaceKey || !filepath.IsAbs(key) {
		return ""
	}
	return filepath.Clean(key)
}

func (h *Handler) memory(w http.ResponseWriter, r *http.Request) {
	name := memory.ProjectName(h.PiDir, h.Home, projectDir(r))
	writeJSON(w, http.StatusOK, map[string]any{"project": name, "stores": memory.Stores(h.PiDir, name)})
}

func (h *Handler) cronTasks(w http.ResponseWriter, r *http.Request) {
	dir := projectDir(r)
	if dir == "" {
		writeJSON(w, http.StatusOK, map[string]any{"tasks": []cron.Task{}})
		return
	}
	tasks, err := cron.Tasks(h.Home, dir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (h *Handler) cronTask(w http.ResponseWriter, r *http.Request) {
	t, err := cron.Find(h.Home, r.PathValue("task"))
	if err != nil {
		writeCronError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": t, "runs": cron.Runs(t)})
}

func (h *Handler) cronRun(w http.ResponseWriter, r *http.Request) {
	t, err := cron.Find(h.Home, r.PathValue("task"))
	if err != nil {
		writeCronError(w, err)
		return
	}
	run, report, err := cron.FindRun(t, r.PathValue("run"))
	if err != nil {
		writeCronError(w, err)
		return
	}
	out := map[string]any{"task": t, "run": run, "report": report}
	if path := cron.SessionPath(t, run, filepath.Join(h.PiDir, "agent", "sessions")); path != "" {
		if c, err := pi.ParseFile(path); err == nil {
			c.Summary.ProjectPath = t.ProjectDir
			out["conversation"] = c
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func writeCronError(w http.ResponseWriter, err error) {
	if errors.Is(err, cron.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

// projectSetup: what pi's package manager reports for the project, plus the
// skills pi-hermes-memory saved (the project's, then its global ones), which
// the extension hands to pi only while it runs.
func (h *Handler) projectSetup(r *http.Request) setup.Setup {
	dir := projectDir(r)
	s := h.Setup.Resolve(r.Context(), dir, r.URL.Query().Get("refresh") != "")
	if name := memory.ProjectName(h.PiDir, h.Home, dir); name != "" {
		s.Add(launch.ReadSkills(filepath.Join(memory.ProjectsRoot(h.PiDir), name, "skills"), "project"), "memory", "npm:"+memoryPackage)
	}
	s.Add(launch.ReadSkills(filepath.Join(memory.Root(h.PiDir), "skills"), "user"), "memory", "npm:"+memoryPackage)
	return s
}

func (h *Handler) setup(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.projectSetup(r))
}

func (h *Handler) setupItem(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	for _, it := range h.projectSetup(r).Items {
		if it.ID == id {
			writeJSON(w, http.StatusOK, map[string]any{"item": it, "body": setup.Body(it)})
			return
		}
	}
	writeError(w, http.StatusNotFound, "not found")
}
