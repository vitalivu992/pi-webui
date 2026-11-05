package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"pi-webui/internal/catalog"
)

func TestWorkspaceRoutes(t *testing.T) {
	piDir := t.TempDir()
	project := t.TempDir()
	other := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "README.md"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	head := `{"type":"session","id":"p1","timestamp":"2026-10-20T10:00:00Z","cwd":"` + project + `"}
{"type":"message","id":"u1","parentId":null,"timestamp":"2026-10-20T10:00:01Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}
`
	sessions := filepath.Join(piDir, "agent", "sessions", "--p--")
	if err := os.MkdirAll(sessions, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sessions, "2026_p1.jsonl"), []byte(head), 0o644); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	(&Handler{Catalog: catalog.New(catalog.Config{PiDir: piDir})}).Register(mux)
	get := func(path string, q url.Values) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path+"?"+q.Encode(), nil))
		return rec
	}

	rec := get("/api/files", url.Values{"project": {project}})
	var files struct {
		Entries []struct{ Name string } `json:"entries"`
	}
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &files) != nil || len(files.Entries) != 1 || files.Entries[0].Name != "README.md" {
		t.Fatalf("files = %d %s", rec.Code, rec.Body)
	}
	for _, q := range []url.Values{
		{"project": {other}},                     // not a listed project
		{"project": {project}, "path": {".."}},   // out of the project
		{"project": {project}, "path": {"nope"}}, // missing
		{"project": {catalog.NoWorkspaceKey}},    // no folder
	} {
		if rec := get("/api/files", q); rec.Code != http.StatusNotFound {
			t.Errorf("files %v = %d, want 404", q, rec.Code)
		}
	}
	if rec := get("/api/git", url.Values{"project": {other}}); rec.Code != http.StatusNotFound {
		t.Errorf("git of an unlisted folder = %d, want 404", rec.Code)
	}
}
