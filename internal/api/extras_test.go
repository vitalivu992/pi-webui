package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"pi-webui/internal/catalog"
)

func writeFile(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestPackageName(t *testing.T) {
	cases := map[string]string{
		"npm:agents-cron":                            "agents-cron",
		"npm:pi-hermes-memory@0.10.0":                "pi-hermes-memory",
		"npm:@scope/pkg@1":                           "@scope/pkg",
		"git:github.com/chandra447/pi-hermes-memory": "pi-hermes-memory",
		"https://github.com/x/agents-cron.git":       "agents-cron",
		"/home/me/src/agents-cron/":                  "agents-cron",
	}
	for in, want := range cases {
		if got := packageName(in); got != want {
			t.Errorf("packageName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExtras(t *testing.T) {
	home := t.TempDir()
	piDir := filepath.Join(home, ".pi")
	proj := filepath.Join(home, "app")
	writeFile(t, filepath.Join(piDir, "agent", "settings.json"),
		`{"packages":["npm:pi-extmgr",{"source":"npm:pi-hermes-memory@0.10.0"}]}`)
	writeFile(t, filepath.Join(proj, ".pi", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Ship it\n---\n\n# Deploy\n")
	writeFile(t, filepath.Join(piDir, "agent", "pi-hermes-memory", "skills", "debug-ts", "SKILL.md"), "---\nname: debug-ts\nuser-invocable: false\n---\nSteps\n")
	writeFile(t, filepath.Join(piDir, "agent", "projects-memory", "app", "MEMORY.md"), "uses make")

	mux := http.NewServeMux()
	(&Handler{Catalog: catalog.New(catalog.Config{PiDir: piDir}), PiDir: piDir, Home: home}).Register(mux)
	get := func(url string, v any) int {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
		if v != nil && rec.Code == http.StatusOK {
			if err := json.Unmarshal(rec.Body.Bytes(), v); err != nil {
				t.Fatal(err)
			}
		}
		return rec.Code
	}
	q := "?project=" + proj

	var features map[string]bool
	get("/api/features", &features)
	if !features["memory"] || features["cron"] {
		t.Errorf("features %v", features)
	}

	var skills struct {
		Skills []struct {
			Name, Source string
			Invocable    bool
		}
	}
	get("/api/skills"+q, &skills)
	if len(skills.Skills) != 2 || skills.Skills[0].Name != "debug-ts" || skills.Skills[0].Source != "memory" ||
		skills.Skills[0].Invocable || skills.Skills[1].Source != "project" {
		t.Errorf("skills %+v", skills.Skills)
	}
	var skill struct{ Body string }
	if code := get("/api/skills/deploy"+q, &skill); code != http.StatusOK || skill.Body != "# Deploy\n" {
		t.Errorf("skill %d %q", code, skill.Body)
	}

	var mem struct {
		Project string
		Stores  []struct {
			ID      string
			Entries []struct{ Text string }
		}
	}
	get("/api/memory"+q, &mem)
	if mem.Project != "app" || mem.Stores[0].ID != "project" || mem.Stores[0].Entries[0].Text != "uses make" {
		t.Errorf("memory %+v", mem)
	}

	for url, want := range map[string]int{
		"/api/skills/deploy":             http.StatusNotFound, // not without the project
		"/api/skills/nope" + q:           http.StatusNotFound,
		"/api/cron" + q:                  http.StatusOK,
		"/api/cron?project=no-workspace": http.StatusOK,
		"/api/cron/task_x":               http.StatusNotFound,
		"/api/cron/task_x/runs/run_1":    http.StatusNotFound,
	} {
		if code := get(url, nil); code != want {
			t.Errorf("GET %s = %d, want %d", url, code, want)
		}
	}
}
