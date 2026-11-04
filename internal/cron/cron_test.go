package cron

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestTasksAndRuns(t *testing.T) {
	home := t.TempDir()
	proj := filepath.Join(home, "app")
	write(t, Registry(home), `{"version":2,"tasks":[
		{"id":"task_b","projectDir":"`+proj+`","name":"Nightly","prompt":"audit","schedule":{"kind":"cron","expression":"0 0 * * *"},"enabled":true},
		{"id":"task_a","projectDir":"`+proj+`/","prompt":"ping","schedule":{"kind":"interval","everyMs":300000},"enabled":false},
		{"id":"task_c","projectDir":"/elsewhere","prompt":"x","schedule":{"kind":"once","runAt":"2026-11-05T00:00:00Z"},"enabled":true},
		{"id":"../evil","projectDir":"`+proj+`","prompt":"x","schedule":{"kind":"once"}}
	]}`)
	tasks, err := Tasks(home, proj)
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 2 || tasks[0].ID != "task_b" || tasks[1].ID != "task_a" {
		t.Fatalf("tasks %+v", tasks)
	}

	store := filepath.Join(proj, ".agents", "cron")
	session := filepath.Join(store, "sessions", "task_b", "run_2_x.jsonl")
	write(t, filepath.Join(store, "runs", "run_1_x.json"), `{"runId":"run_1_x","taskId":"task_b","trigger":"scheduled","startedAt":"2026-11-04T00:00:00Z","status":"error","error":"boom"}`)
	write(t, filepath.Join(store, "runs", "run_2_x.json"), `{"runId":"run_2_x","taskId":"task_b","trigger":"manual","startedAt":"2026-11-05T00:00:00Z","status":"success","sessionFile":"`+session+`"}`)
	write(t, filepath.Join(store, "runs", "run_3_x.json"), `{"runId":"run_3_x","taskId":"task_a","startedAt":"2026-11-05T00:00:00Z","status":"success"}`)
	write(t, filepath.Join(store, "reports", "task_b", "run_2_x.md"), "# Run report")

	b, _ := Find(home, "task_b")
	runs := Runs(b)
	if len(runs) != 2 || runs[0].RunID != "run_2_x" || runs[1].Error != "boom" {
		t.Fatalf("runs %+v", runs)
	}
	run, report, err := FindRun(b, "run_2_x")
	if err != nil || report != "# Run report" {
		t.Fatalf("FindRun: %v %q", err, report)
	}
	if got := SessionPath(b, run, ""); got != session {
		t.Errorf("session %q", got)
	}
	run.SessionFile = "/etc/passwd"
	if got := SessionPath(b, run, "/home/me/.pi/agent/sessions"); got != "" {
		t.Errorf("outside path allowed: %q", got)
	}
	run.SessionFile = "/home/me/.pi/agent/sessions/--app--/x.jsonl"
	if got := SessionPath(b, run, "/home/me/.pi/agent/sessions"); got != run.SessionFile {
		t.Errorf("pi store path: %q", got)
	}
	for _, id := range []string{"run_3_x", "../runs/run_2_x", "missing"} {
		if _, _, err := FindRun(b, id); err == nil {
			t.Errorf("FindRun(%q) should fail", id)
		}
	}
	if _, err := Find(home, "task_c"); err != nil {
		t.Error(err)
	}
}

func TestNoRegistry(t *testing.T) {
	tasks, err := Tasks(t.TempDir(), "/x")
	if err != nil || len(tasks) != 0 {
		t.Errorf("%v %v", tasks, err)
	}
}
