package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"pi-webui/internal/catalog"
)

func TestRoutes(t *testing.T) {
	dir := t.TempDir()
	mux := http.NewServeMux()
	(&Handler{Catalog: catalog.New(catalog.Config{PiDir: dir})}).Register(mux)
	cases := map[string]int{
		"/health":                          http.StatusOK,
		"/api/projects":                    http.StatusOK,
		"/api/conversations":               http.StatusBadRequest,
		"/api/conversations?project=/nope": http.StatusNotFound,
		"/api/conversations/missing":       http.StatusNotFound,
		"/api/conversations/..%2Fetc":      http.StatusNotFound,
	}
	for url, want := range cases {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
		if rec.Code != want {
			t.Errorf("GET %s = %d, want %d (%s)", url, rec.Code, want, rec.Body)
		}
	}
}

func TestConversationNotModified(t *testing.T) {
	dir := t.TempDir()
	lines := `{"type":"session","id":"p1","timestamp":"2026-10-20T10:00:00Z","cwd":"/w"}
{"type":"message","id":"u1","parentId":null,"timestamp":"2026-10-20T10:00:01Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}
`
	sessions := filepath.Join(dir, "agent", "sessions", "--w--")
	if err := os.MkdirAll(sessions, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sessions, "2026_p1.jsonl"), []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	(&Handler{Catalog: catalog.New(catalog.Config{PiDir: dir})}).Register(mux)
	get := func(etag string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/conversations/p1", nil)
		if etag != "" {
			req.Header.Set("If-None-Match", etag)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}
	first := get("")
	etag := first.Header().Get("ETag")
	if first.Code != http.StatusOK || etag == "" {
		t.Fatalf("first GET = %d, ETag %q", first.Code, etag)
	}
	if rec := get(etag); rec.Code != http.StatusNotModified || rec.Body.Len() != 0 {
		t.Errorf("same ETag = %d, body %q", rec.Code, rec.Body)
	}
	if rec := get(fmt.Sprintf(`W/%s`, etag)); rec.Code != http.StatusNotModified {
		t.Errorf("weak ETag = %d", rec.Code)
	}
	if rec := get(`"stale"`); rec.Code != http.StatusOK {
		t.Errorf("stale ETag = %d", rec.Code)
	}
}
