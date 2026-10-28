// Package runs sends prompts from the browser to pi: each run is one headless
// pi process (internal/launch builds its argv) in the conversation's folder.
// The conversation view follows it through the session file pi writes; the
// run itself only reports whether it is still going, and why it failed.
//
//	GET    /api/pi                            the pi CLI: thinking levels, found on PATH or not
//	GET    /api/models                        models to suggest in the settings
//	GET    /api/commands?cwd=                 the prompt templates and skills for a folder
//	POST   /api/runs/preview                  a launch.Request → the command it would run
//	GET    /api/runs                          the runs, newest first
//	POST   /api/runs                          a launch.Request → 201 the started run
//	GET    /api/runs/{id}                     one run
//	DELETE /api/runs/{id}                     stops it → 204
package runs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"pi-webui/internal/catalog"
	"pi-webui/internal/launch"
)

const (
	// keepEnded: how long a finished run is still listed (so the browser sees how it ended).
	keepEnded = 15 * time.Minute
	// tailBytes of each output stream are kept for the error message.
	tailBytes = 8 << 10
	// stopGrace: after the interrupt, how long before the run is killed.
	stopGrace = 5 * time.Second
	// modelsTTL: how long the model list is reused.
	modelsTTL = 10 * time.Minute
)

// Info is what the browser sees of a run.
type Info struct {
	ID string `json:"id"`
	// Session: the conversation id.
	Session   string     `json:"session"`
	Cwd       string     `json:"cwd"`
	Prompt    string     `json:"prompt"`
	Command   string     `json:"command"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
	Running   bool       `json:"running"`
	ExitCode  int        `json:"exitCode"`
	// Error: why the run failed (the CLI's last error output).
	Error string `json:"error,omitempty"`
	// Stopped: ended by the user.
	Stopped bool `json:"stopped,omitempty"`
}

// Manager owns the runs.
type Manager struct {
	Catalog *catalog.Catalog
	Dirs    launch.Dirs
	// Env is the CLIs' environment (PATH replaced, see Path). Nil: the server's.
	Env []string
	// Path is the PATH the CLIs are looked up in. "": the user's login shell's
	// (a service's own PATH rarely has ~/.local/bin or nvm's).
	Path string

	mu     sync.Mutex
	runs   map[string]*run
	models *modelsEntry

	pathMu   sync.Mutex
	pathVal  string
	pathTime time.Time
}

type modelsEntry struct {
	at     time.Time
	models []launch.Model
}

type run struct {
	cmd  *exec.Cmd
	done chan struct{}

	mu     sync.Mutex
	info   Info
	stdout tail
	stderr tail
}

func (r *run) snapshot() Info {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.info
}

// Register adds the routes to mux.
func (m *Manager) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/pi", m.handlePi)
	mux.HandleFunc("GET /api/models", m.handleModels)
	mux.HandleFunc("GET /api/commands", m.handleCommands)
	mux.HandleFunc("POST /api/runs/preview", m.handlePreview)
	mux.HandleFunc("GET /api/runs", m.handleList)
	mux.HandleFunc("POST /api/runs", m.handleStart)
	mux.HandleFunc("GET /api/runs/{id}", m.handleGet)
	mux.HandleFunc("DELETE /api/runs/{id}", m.handleStop)
}

// piInfo is what the settings need to know about the pi CLI.
type piInfo struct {
	CLI     string   `json:"cli"`
	Efforts []string `json:"efforts"`
	// Found: the CLI's path, "" when it isn't on PATH.
	Found string `json:"found"`
}

func (m *Manager) handlePi(w http.ResponseWriter, r *http.Request) {
	found, _ := lookPath(launch.CLI, m.searchPath())
	writeJSON(w, http.StatusOK, piInfo{CLI: launch.CLI, Efforts: launch.Efforts, Found: found})
}

func (m *Manager) handleModels(w http.ResponseWriter, r *http.Request) {
	refresh := r.URL.Query().Get("refresh") != ""
	m.mu.Lock()
	cached := m.models
	m.mu.Unlock()
	if cached != nil && !refresh && time.Since(cached.at) < modelsTTL {
		writeJSON(w, http.StatusOK, map[string]any{"models": cached.models})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	models, err := launch.Models(ctx, m.output)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("could not list the models: %v", err))
		return
	}
	if models == nil {
		models = []launch.Model{}
	}
	m.mu.Lock()
	m.models = &modelsEntry{at: time.Now(), models: models}
	m.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

func (m *Manager) handleCommands(w http.ResponseWriter, r *http.Request) {
	cwd := r.URL.Query().Get("cwd")
	if cwd != "" && !filepath.IsAbs(cwd) {
		cwd = ""
	}
	cmds := launch.Commands(cwd, m.Dirs)
	if cmds == nil {
		cmds = []launch.Command{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"commands": cmds})
}

// previewID stands for the id a new conversation will get.
const previewID = "new-session-uuid"

func (m *Manager) handlePreview(w http.ResponseWriter, r *http.Request) {
	var req launch.Request
	if !readJSON(w, r, &req) {
		return
	}
	// The settings preview a new conversation without a project: the home folder stands in.
	if req.Session == "" && req.Cwd == "" {
		req.Cwd = m.Dirs.Home
	}
	plan, err := m.plan(req, func() string { return previewID })
	if err != nil {
		writeRunError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

func (m *Manager) handleList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"runs": m.List()})
}

func (m *Manager) handleStart(w http.ResponseWriter, r *http.Request) {
	var req launch.Request
	if !readJSON(w, r, &req) {
		return
	}
	info, err := m.Start(req)
	if err != nil {
		writeRunError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, info)
}

func (m *Manager) handleGet(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	ru := m.runs[r.PathValue("id")]
	m.mu.Unlock()
	if ru == nil {
		writeError(w, http.StatusNotFound, "no such run")
		return
	}
	writeJSON(w, http.StatusOK, ru.snapshot())
}

func (m *Manager) handleStop(w http.ResponseWriter, r *http.Request) {
	if !m.Stop(r.PathValue("id")) {
		writeError(w, http.StatusNotFound, "no such run")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// requestError is a request the server refuses (400), conflictError a
// conversation that already has a run (409).
type requestError struct{ error }
type conflictError struct{ error }

func writeRunError(w http.ResponseWriter, err error) {
	var re requestError
	var ce conflictError
	switch {
	case errors.As(err, &ce):
		writeError(w, http.StatusConflict, err.Error())
	case errors.As(err, &re):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, catalog.ErrNotFound):
		writeError(w, http.StatusNotFound, "conversation not found")
	default:
		log.Printf("runs: %v", err)
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

// plan checks the request against the catalog (a conversation to continue
// must exist; it runs in the conversation's folder) and builds the command.
func (m *Manager) plan(req launch.Request, newID func() string) (launch.Plan, error) {
	if req.Session != "" {
		if m.Catalog == nil {
			return launch.Plan{}, catalog.ErrNotFound
		}
		c, err := m.Catalog.Conversation(req.Session)
		if err != nil {
			return launch.Plan{}, err
		}
		req.Cwd = c.Cwd
		if req.Cwd == "" {
			req.Cwd = c.ProjectPath
		}
	}
	if !filepath.IsAbs(req.Cwd) {
		return launch.Plan{}, requestError{errors.New("the folder must be an absolute path")}
	}
	if st, err := os.Stat(req.Cwd); err != nil || !st.IsDir() {
		return launch.Plan{}, requestError{fmt.Errorf("the folder %s doesn't exist", req.Cwd)}
	}
	plan, err := launch.Build(req, newID)
	if err != nil {
		return launch.Plan{}, requestError{err}
	}
	return plan, nil
}

// Start runs the request's CLI in the background.
func (m *Manager) Start(req launch.Request) (Info, error) {
	plan, err := m.plan(req, nil)
	if err != nil {
		return Info{}, err
	}
	path := m.searchPath()
	exe, err := lookPath(plan.Argv[0], path)
	if err != nil {
		return Info{}, requestError{fmt.Errorf("%s isn't installed (not found on PATH)", plan.Argv[0])}
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune()
	for _, ru := range m.runs {
		if i := ru.snapshot(); i.Running && i.Session == plan.Session {
			return Info{}, conflictError{errors.New("this conversation is already running a prompt")}
		}
	}

	cmd := exec.Command(exe, plan.Argv[1:]...)
	cmd.Dir = plan.Cwd
	cmd.Env = withPath(m.Env, path)
	setGroup(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return Info{}, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return Info{}, err
	}
	if err := cmd.Start(); err != nil {
		return Info{}, fmt.Errorf("start %s: %w", plan.Argv[0], err)
	}
	ru := &run{cmd: cmd, done: make(chan struct{}), info: Info{
		ID:        launch.NewUUID(),
		Session:   plan.Session,
		Cwd:       plan.Cwd,
		Prompt:    req.Prompt,
		Command:   plan.Command,
		StartedAt: time.Now().UTC(),
		Running:   true,
	}}
	if m.runs == nil {
		m.runs = map[string]*run{}
	}
	m.runs[ru.info.ID] = ru
	log.Printf("runs: %s started %s in %s", ru.info.ID, plan.Argv[0], plan.Cwd)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); ru.copy(&ru.stdout, stdout) }()
	go func() { defer wg.Done(); ru.copy(&ru.stderr, stderr) }()
	go func() {
		wg.Wait()
		err := cmd.Wait()
		ru.finish(err)
		close(ru.done)
		i := ru.snapshot()
		log.Printf("runs: %s ended (exit %d)", i.ID, i.ExitCode)
	}()
	return ru.snapshot(), nil
}

func (r *run) finish(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()
	r.info.Running = false
	r.info.EndedAt = &now
	r.info.ExitCode = r.cmd.ProcessState.ExitCode()
	if r.info.Stopped {
		return
	}
	if err == nil && r.info.ExitCode == 0 {
		return
	}
	r.info.Error = lastLines(r.stderr.String(), 12)
	if r.info.Error == "" {
		r.info.Error = lastLines(r.stdout.String(), 12)
	}
	if r.info.Error == "" {
		r.info.Error = fmt.Sprintf("exited with code %d", r.info.ExitCode)
	}
}

// copy keeps the tail of one of the CLI's output streams (for the error message).
func (r *run) copy(dst *tail, src io.Reader) {
	buf := make([]byte, 32<<10)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			r.mu.Lock()
			dst.Write(buf[:n])
			r.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

// List returns the runs, newest first.
func (m *Manager) List() []Info {
	m.mu.Lock()
	m.prune()
	out := make([]Info, 0, len(m.runs))
	for _, ru := range m.runs {
		out = append(out, ru.snapshot())
	}
	m.mu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out
}

// prune drops runs that ended a while ago. Callers hold m.mu.
func (m *Manager) prune() {
	for id, ru := range m.runs {
		if i := ru.snapshot(); !i.Running && i.EndedAt != nil && time.Since(*i.EndedAt) > keepEnded {
			delete(m.runs, id)
		}
	}
}

// Stop interrupts a run (as Ctrl+C would), then kills it if it is still
// going after stopGrace. False: no such run.
func (m *Manager) Stop(id string) bool {
	m.mu.Lock()
	ru := m.runs[id]
	m.mu.Unlock()
	if ru == nil {
		return false
	}
	ru.mu.Lock()
	running := ru.info.Running
	if running {
		ru.info.Stopped = true
	}
	ru.mu.Unlock()
	if !running {
		return true
	}
	interrupt(ru.cmd.Process)
	go func() {
		select {
		case <-ru.done:
		case <-time.After(stopGrace):
			kill(ru.cmd.Process)
		}
	}()
	return true
}

// StopAll stops every run (the server is shutting down).
func (m *Manager) StopAll() {
	for _, i := range m.List() {
		if i.Running {
			m.Stop(i.ID)
		}
	}
}

// output runs a CLI (the model lists) with the runs' PATH and environment.
func (m *Manager) output(ctx context.Context, argv ...string) ([]byte, error) {
	path := m.searchPath()
	exe, err := lookPath(argv[0], path)
	if err != nil {
		return nil, fmt.Errorf("%s isn't installed (not found on PATH)", argv[0])
	}
	cmd := exec.CommandContext(ctx, exe, argv[1:]...)
	cmd.Env = withPath(m.Env, path)
	var stderr tail
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if msg := lastLines(stderr.String(), 3); msg != "" {
			return nil, fmt.Errorf("%s: %s", argv[0], msg)
		}
		return nil, err
	}
	return out, nil
}

// searchPath is Path, else the login shell's PATH (asked again every few
// minutes, so a CLI installed meanwhile is found), else the server's.
func (m *Manager) searchPath() string {
	if m.Path != "" {
		return m.Path
	}
	m.pathMu.Lock()
	defer m.pathMu.Unlock()
	if m.pathVal != "" && time.Since(m.pathTime) < 5*time.Minute {
		return m.pathVal
	}
	m.pathVal = loginPath()
	if m.pathVal == "" {
		m.pathVal = os.Getenv("PATH")
	}
	m.pathTime = time.Now()
	return m.pathVal
}

// lookPath finds an executable in a PATH list.
func lookPath(name, path string) (string, error) {
	if filepath.IsAbs(name) {
		return exec.LookPath(name)
	}
	for _, dir := range filepath.SplitList(path) {
		if dir == "" {
			continue
		}
		for _, cand := range candidates(filepath.Join(dir, name)) {
			if isExecutable(cand) {
				// Absolute: a relative path would be taken from the run's folder.
				return filepath.Abs(cand)
			}
		}
	}
	return "", exec.ErrNotFound
}

// withPath is env with PATH set to path.
func withPath(env []string, path string) []string {
	if env == nil {
		env = os.Environ()
	}
	out := make([]string, 0, len(env)+1)
	for _, kv := range env {
		if name, _, _ := strings.Cut(kv, "="); !strings.EqualFold(name, "PATH") {
			out = append(out, kv)
		}
	}
	return append(out, "PATH="+path)
}

// tail keeps the last tailBytes written.
type tail struct {
	buf []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.buf = append(t.buf, p...)
	if over := len(t.buf) - tailBytes; over > 0 {
		t.buf = append(t.buf[:0], t.buf[over:]...)
	}
	return len(p), nil
}

func (t *tail) String() string { return string(t.buf) }

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

// readJSON takes JSON only: a page on another site (or another port) can't
// send that without a CORS preflight, which this server never answers, and a
// run is a command line.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "expected application/json")
		return false
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("runs: write response: %v", err)
	}
}
