// Package cron reads the agents-cron package's store: task definitions in the
// global registry (~/.agents/cron/tasks.json), each bound to a project, and
// per project <project>/.agents/cron/ with the run records (runs/<run>.json),
// their reports (reports/<task>/<run>.md) and the runs' pi transcripts
// (sessions/<task>/<run>.jsonl, or pi's own session store when the package is
// set to write there).
package cron

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Schedule says when a task runs: once at RunAt, every EveryMs, or on a cron expression.
type Schedule struct {
	Kind       string `json:"kind"` // "once", "interval" or "cron"
	RunAt      string `json:"runAt,omitempty"`
	EveryMs    int64  `json:"everyMs,omitempty"`
	Expression string `json:"expression,omitempty"`
	Timezone   string `json:"timezone,omitempty"`
}

// Task is a scheduled prompt, as the registry keeps it.
type Task struct {
	ID           string   `json:"id"`
	ProjectDir   string   `json:"projectDir"`
	Name         string   `json:"name,omitempty"`
	Prompt       string   `json:"prompt"`
	Schedule     Schedule `json:"schedule"`
	Enabled      bool     `json:"enabled"`
	NextRunAt    string   `json:"nextRunAt,omitempty"`
	Agent        string   `json:"agent,omitempty"`
	Model        string   `json:"model,omitempty"`
	Thinking     string   `json:"thinking,omitempty"`
	Cwd          string   `json:"cwd,omitempty"`
	LastRunAt    string   `json:"lastRunAt,omitempty"`
	LastStatus   string   `json:"lastStatus,omitempty"`
	SuccessCount int      `json:"successCount,omitempty"`
	ErrorCount   int      `json:"errorCount,omitempty"`
	MissedCount  int      `json:"missedCount,omitempty"`
	CreatedAt    string   `json:"createdAt,omitempty"`
	UpdatedAt    string   `json:"updatedAt,omitempty"`
}

// Run is one attempt at a task.
type Run struct {
	RunID       string `json:"runId"`
	TaskID      string `json:"taskId"`
	Trigger     string `json:"trigger"`
	StartedAt   string `json:"startedAt"`
	FinishedAt  string `json:"finishedAt,omitempty"`
	Status      string `json:"status"` // running, success, error, skipped or missed
	ExitCode    *int   `json:"exitCode,omitempty"`
	Agent       string `json:"agent,omitempty"`
	SessionFile string `json:"sessionFile,omitempty"`
	Summary     string `json:"summary,omitempty"`
	Error       string `json:"error,omitempty"`
}

// ErrNotFound: no such task or run.
var ErrNotFound = errors.New("not found")

// idRe: task_<hex> and run_<stamp>_<hex>; ids become file names, so nothing else.
var idRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

// Registry is the global task list under the home folder.
func Registry(home string) string { return filepath.Join(home, ".agents", "cron", "tasks.json") }

func storeDir(projectDir string) string { return filepath.Join(projectDir, ".agents", "cron") }

// Tasks lists the tasks bound to projectDir, by name; all of them when projectDir is "".
func Tasks(home, projectDir string) ([]Task, error) {
	b, err := os.ReadFile(Registry(home))
	if errors.Is(err, os.ErrNotExist) {
		return []Task{}, nil
	}
	if err != nil {
		return nil, err
	}
	var reg struct {
		Tasks []Task `json:"tasks"`
	}
	if err := json.Unmarshal(b, &reg); err != nil {
		return nil, err
	}
	out := []Task{}
	for _, t := range reg.Tasks {
		if idRe.MatchString(t.ID) && (projectDir == "" || filepath.Clean(t.ProjectDir) == filepath.Clean(projectDir)) {
			out = append(out, t)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return label(out[i]) < label(out[j]) })
	return out, nil
}

func label(t Task) string {
	if t.Name != "" {
		return strings.ToLower(t.Name)
	}
	return t.ID
}

// Find returns the task with the id.
func Find(home, id string) (Task, error) {
	tasks, err := Tasks(home, "")
	if err != nil {
		return Task{}, err
	}
	for _, t := range tasks {
		if t.ID == id {
			return t, nil
		}
	}
	return Task{}, ErrNotFound
}

// Runs lists the task's run records, newest first. Unreadable records are skipped.
func Runs(t Task) []Run {
	dir := filepath.Join(storeDir(t.ProjectDir), "runs")
	entries, _ := os.ReadDir(dir)
	out := []Run{}
	for _, e := range entries {
		id, ok := strings.CutSuffix(e.Name(), ".json")
		if !ok || !idRe.MatchString(id) {
			continue
		}
		if r, err := readRun(dir, id); err == nil && r.TaskID == t.ID {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].StartedAt > out[j].StartedAt })
	return out
}

// FindRun returns one of the task's runs and its markdown report ("" when there is none).
func FindRun(t Task, runID string) (Run, string, error) {
	if !idRe.MatchString(runID) {
		return Run{}, "", ErrNotFound
	}
	r, err := readRun(filepath.Join(storeDir(t.ProjectDir), "runs"), runID)
	if err != nil || r.TaskID != t.ID {
		return Run{}, "", ErrNotFound
	}
	report, _ := os.ReadFile(filepath.Join(storeDir(t.ProjectDir), "reports", t.ID, runID+".md"))
	return r, string(report), nil
}

func readRun(dir, id string) (Run, error) {
	b, err := os.ReadFile(filepath.Join(dir, id+".json"))
	if err != nil {
		return Run{}, err
	}
	var r Run
	if err := json.Unmarshal(b, &r); err != nil {
		return Run{}, err
	}
	if r.RunID != id {
		return Run{}, ErrNotFound
	}
	return r, nil
}

// SessionPath is the run's transcript file, when the record points at the
// task's sessions folder or into pi's session store (piSessions); "" for
// anywhere else, so a record can't make the server read other files.
func SessionPath(t Task, r Run, piSessions string) string {
	if r.SessionFile == "" || !filepath.IsAbs(r.SessionFile) {
		return ""
	}
	p := filepath.Clean(r.SessionFile)
	if p == filepath.Join(storeDir(t.ProjectDir), "sessions", t.ID, r.RunID+".jsonl") {
		return p
	}
	if piSessions != "" && strings.HasSuffix(p, ".jsonl") && strings.HasPrefix(p, filepath.Clean(piSessions)+string(filepath.Separator)) {
		return p
	}
	return ""
}
