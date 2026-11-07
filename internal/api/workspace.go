package api

import (
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net/http"

	"pi-webui/internal/workspace"
)

// registerWorkspace adds the right-hand panel's routes:
//
//	GET  /api/files?project=<key>&path=<rel>     one folder of the project (slash-separated, "" = root)
//	GET  /api/file?project=<key>&path=<rel>[&repo=1]   one file's content (repo=1: path from the repository's root)
//	GET  /api/git?project=<key>                  the git status of the project's repository
//	GET  /api/git/diff?project=<key>&path=&from=&group=&status=   one changed file's diff
//	POST /api/git?project=<key>                  {op, files, message, …} → {result, status}
//
// Only the folders of listed projects that still exist are read. POST takes
// JSON only, so another site's form can't post one (no CORS preflight answer).
func (h *Handler) registerWorkspace(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/files", h.files)
	mux.HandleFunc("GET /api/file", h.file)
	mux.HandleFunc("GET /api/git", h.gitStatus)
	mux.HandleFunc("GET /api/git/diff", h.gitDiff)
	mux.HandleFunc("POST /api/git", h.gitOp)
}

// projectFolder is the folder of ?project=<key> when it is a listed project's existing folder.
func (h *Handler) projectFolder(r *http.Request) string {
	key := r.URL.Query().Get("project")
	for _, p := range h.Catalog.Projects() {
		if p.Key == key && p.Exists && p.Path != "" {
			return p.Path
		}
	}
	return ""
}

func (h *Handler) files(w http.ResponseWriter, r *http.Request) {
	dir := h.projectFolder(r)
	if dir == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	entries, truncated, err := workspace.List(dir, r.URL.Query().Get("path"))
	if errors.Is(err, workspace.ErrBadPath) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "truncated": truncated})
}

func (h *Handler) gitStatus(w http.ResponseWriter, r *http.Request) {
	dir := h.projectFolder(r)
	if dir == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	st, err := workspace.Status(r.Context(), dir)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// file reads one file under the project's folder, or under its repository's root with repo=1.
func (h *Handler) file(w http.ResponseWriter, r *http.Request) {
	dir := h.projectFolder(r)
	if dir == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.URL.Query().Get("repo") == "1" {
		root, err := workspace.RepoRoot(r.Context(), dir)
		if err != nil {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		dir = root
	}
	f, err := workspace.ReadFile(dir, r.URL.Query().Get("path"))
	if errors.Is(err, workspace.ErrBadPath) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (h *Handler) gitDiff(w http.ResponseWriter, r *http.Request) {
	dir := h.projectFolder(r)
	if dir == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	q := r.URL.Query()
	text, truncated, err := workspace.Diff(r.Context(), dir, workspace.FileRef{
		Path: q.Get("path"), From: q.Get("from"), Group: q.Get("group"), Status: q.Get("status"),
	})
	if err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"diff": text, "truncated": truncated})
}

// gitOp runs an operation of the Git tab and answers its steps with the new status.
func (h *Handler) gitOp(w http.ResponseWriter, r *http.Request) {
	dir := h.projectFolder(r)
	if dir == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	var req workspace.Request
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "expected application/json")
		return
	}
	// A file written by the conflict resolver can be up to MaxFileBytes.
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2*workspace.MaxFileBytes)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	res, err := workspace.Apply(r.Context(), dir, req)
	if err != nil {
		writeGitError(w, err)
		return
	}
	if !res.OK {
		log.Printf("git %s in %s failed", req.Op, dir)
	}
	st, err := workspace.Status(r.Context(), dir)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"result": res})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": res, "status": st})
}

func writeGitError(w http.ResponseWriter, err error) {
	var bad *workspace.InvalidError
	switch {
	case errors.As(err, &bad):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, workspace.ErrNotRepo):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, workspace.ErrBusy), errors.Is(err, workspace.ErrChanged):
		writeError(w, http.StatusConflict, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}
