//go:build !windows

package runs

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"pi-webui/internal/catalog"
	"pi-webui/internal/launch"
)

// fakePi writes an executable shell script named `pi` into dir.
func fakePi(t *testing.T, dir, script string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "pi"), []byte("#!/bin/sh\n"+script), 0o755); err != nil {
		t.Fatal(err)
	}
}

// newManager: pi from a temp bin folder, a catalog over a temp pi dir with
// one conversation (conv-1) in `work`.
func newManager(t *testing.T) (*Manager, string, string) {
	t.Helper()
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	work := filepath.Join(root, "work")
	piDir := filepath.Join(root, "pi")
	sessions := filepath.Join(piDir, "agent", "sessions", "--work--")
	for _, d := range []string{bin, work, sessions} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	lines := `{"type":"session","id":"conv-1","timestamp":"2026-10-20T10:00:00Z","cwd":"` + work + `"}
{"type":"message","id":"u1","parentId":null,"timestamp":"2026-10-20T10:00:01Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}
`
	if err := os.WriteFile(filepath.Join(sessions, "2026_conv-1.jsonl"), []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := catalog.Config{PiDir: piDir, ActiveWindow: time.Minute}
	m := &Manager{Catalog: catalog.New(cfg), Dirs: launch.Dirs{Pi: piDir}, Path: bin + ":/usr/bin:/bin"}
	return m, bin, work
}

func wait(t *testing.T, m *Manager, id string) Info {
	t.Helper()
	m.mu.Lock()
	ru := m.runs[id]
	m.mu.Unlock()
	select {
	case <-ru.done:
	case <-time.After(10 * time.Second):
		t.Fatal("the run didn't end")
	}
	return ru.snapshot()
}

func TestStartNew(t *testing.T) {
	m, bin, work := newManager(t)
	// The fake writes its argv and folder, so the test sees what ran where.
	fakePi(t, bin, `pwd > "$0.cwd"; printf '%s\n' "$@" > "$0.args"; echo "the answer"`)
	info, err := m.Start(launch.Request{Cwd: work, Prompt: "hello there", Model: "anthropic/claude-x"})
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[0-9a-f-]{36}$`).MatchString(info.Session) || !info.Running {
		t.Fatalf("started: %+v", info)
	}
	end := wait(t, m, info.ID)
	if end.Running || end.ExitCode != 0 || end.Error != "" || end.EndedAt == nil {
		t.Errorf("ended: %+v", end)
	}
	args, _ := os.ReadFile(filepath.Join(bin, "pi.args"))
	want := "-p\n--session-id\n" + info.Session + "\n--model\nanthropic/claude-x\n--\nhello there\n"
	if string(args) != want {
		t.Errorf("args %q, want %q", args, want)
	}
	if cwd, _ := os.ReadFile(filepath.Join(bin, "pi.cwd")); strings.TrimSpace(string(cwd)) != work {
		t.Errorf("ran in %q", cwd)
	}
}

func TestFailures(t *testing.T) {
	m, bin, work := newManager(t)
	for script, want := range map[string]string{
		`echo "line 1" >&2; echo "Error: No API key found" >&2; exit 1`: "line 1\nError: No API key found",
		`echo "only stdout"; exit 2`:                                    "only stdout",
		`exit 3`:                                                        "exited with code 3",
	} {
		fakePi(t, bin, script)
		info, err := m.Start(launch.Request{Cwd: work, Prompt: "x"})
		if err != nil {
			t.Fatal(err)
		}
		if end := wait(t, m, info.ID); end.Error != want {
			t.Errorf("%s: error %q, want %q", script, end.Error, want)
		}
	}

	os.Remove(filepath.Join(bin, "pi"))
	_, err := m.Start(launch.Request{Cwd: work, Prompt: "x"})
	var re requestError
	if !errors.As(err, &re) || !strings.Contains(err.Error(), "pi isn't installed") {
		t.Errorf("missing CLI: %v", err)
	}
	if _, err := m.Start(launch.Request{Cwd: filepath.Join(work, "gone"), Prompt: "x"}); !errors.As(err, &re) {
		t.Errorf("missing folder: %v", err)
	}
	if _, err := m.Start(launch.Request{Session: "nope", Prompt: "x"}); !errors.Is(err, catalog.ErrNotFound) {
		t.Errorf("unknown conversation: %v", err)
	}
}

func TestContinueStopAndConflict(t *testing.T) {
	m, bin, work := newManager(t)
	fakePi(t, bin, `pwd > "$0.cwd"; exec sleep 30`)
	// The folder comes from the conversation, not the request.
	info, err := m.Start(launch.Request{Session: "conv-1", Cwd: "/elsewhere", Prompt: "more"})
	if err != nil {
		t.Fatal(err)
	}
	if info.Session != "conv-1" || info.Cwd != work {
		t.Errorf("started: %+v", info)
	}
	_, err = m.Start(launch.Request{Session: "conv-1", Prompt: "again"})
	var ce conflictError
	if !errors.As(err, &ce) {
		t.Errorf("second prompt while running: %v", err)
	}
	start := time.Now()
	if !m.Stop(info.ID) {
		t.Fatal("Stop: no such run")
	}
	end := wait(t, m, info.ID)
	if !end.Stopped || end.Error != "" || time.Since(start) > 3*time.Second {
		t.Errorf("stopped: %+v after %s", end, time.Since(start))
	}
	if m.Stop("nope") {
		t.Error("Stop of an unknown run")
	}
}

func TestHTTP(t *testing.T) {
	m, bin, work := newManager(t)
	fakePi(t, bin, `[ "$1" = --list-models ] && printf 'provider model context max-out thinking images\nanthropic claude-x 200K 64K yes yes\n'; exit 0`)
	mux := http.NewServeMux()
	m.Register(mux)
	do := func(method, url string, body any) *httptest.ResponseRecorder {
		var b bytes.Buffer
		if body != nil {
			json.NewEncoder(&b).Encode(body)
		}
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, url, &b)
		req.Header.Set("Content-Type", "application/json")
		mux.ServeHTTP(rec, req)
		return rec
	}

	// A form or text/plain post (what another site can send without a preflight) is refused.
	plain := httptest.NewRequest("POST", "/api/runs", strings.NewReader(`{"cwd":"`+work+`","prompt":"x"}`))
	plain.Header.Set("Content-Type", "text/plain")
	if rec := httptest.NewRecorder(); func() int { mux.ServeHTTP(rec, plain); return rec.Code }() != 415 || len(m.List()) != 0 {
		t.Errorf("text/plain post started a run")
	}

	rec := do("POST", "/api/runs/preview", launch.Request{Cwd: work, Prompt: "hi", Effort: "max"})
	var plan launch.Plan
	json.Unmarshal(rec.Body.Bytes(), &plan)
	if rec.Code != 200 || plan.Command != "cd "+work+" && pi -p --session-id new-session-uuid --thinking max -- hi" {
		t.Errorf("preview %d %s", rec.Code, rec.Body)
	}
	if rec := do("POST", "/api/runs/preview", launch.Request{Cwd: work, Prompt: "hi", Effort: "x y"}); rec.Code != 400 {
		t.Errorf("bad preview %d", rec.Code)
	}

	rec = do("GET", "/api/pi", nil)
	var pi piInfo
	json.Unmarshal(rec.Body.Bytes(), &pi)
	if pi.CLI != "pi" || pi.Found != filepath.Join(bin, "pi") || len(pi.Efforts) != len(launch.Efforts) {
		t.Errorf("pi %s", rec.Body)
	}
	if rec := do("GET", "/api/models", nil); !strings.Contains(rec.Body.String(), `"anthropic/claude-x"`) {
		t.Errorf("models %s", rec.Body)
	}
	if rec := do("GET", "/api/commands?cwd=relative", nil); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"commands":[]`) {
		t.Errorf("commands %d %s", rec.Code, rec.Body)
	}

	rec = do("POST", "/api/runs", launch.Request{Cwd: work, Prompt: "hi"})
	var info Info
	json.Unmarshal(rec.Body.Bytes(), &info)
	if rec.Code != 201 || info.ID == "" {
		t.Fatalf("start %d %s", rec.Code, rec.Body)
	}
	wait(t, m, info.ID)
	if rec := do("GET", "/api/runs/"+info.ID, nil); !strings.Contains(rec.Body.String(), `"running":false`) {
		t.Errorf("get %s", rec.Body)
	}
	if rec := do("GET", "/api/runs", nil); !strings.Contains(rec.Body.String(), info.ID) {
		t.Errorf("list %s", rec.Body)
	}
	if rec := do("DELETE", "/api/runs/"+info.ID, nil); rec.Code != 204 {
		t.Errorf("stop %d", rec.Code)
	}
	if rec := do("DELETE", "/api/runs/nope", nil); rec.Code != 404 {
		t.Errorf("stop unknown %d", rec.Code)
	}
}
