package api

import (
	"errors"
	"net/http"

	"pi-webui/internal/workspace"
)

// registerWorkspace adds the right-hand panel's routes:
//
//	GET /api/files?project=<key>&path=<rel>   one folder of the project (slash-separated, "" = root)
//	GET /api/git?project=<key>                the git status of the project's repository
//
// Only the folders of listed projects that still exist are read.
func (h *Handler) registerWorkspace(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/files", h.files)
	mux.HandleFunc("GET /api/git", h.gitStatus)
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
