// Package memory reads what the pi-hermes-memory package keeps in markdown:
// the global stores in ~/.pi/agent/pi-hermes-memory/ (MEMORY.md, USER.md,
// failures.md, STANDING.md) and a project's in
// ~/.pi/agent/projects-memory/<project>/ (MEMORY.md, failures.md). Its SQLite
// search index (sessions.db) is not read.
package memory

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Store is one memory file.
type Store struct {
	// ID: project, project-failures, memory, user, failures or standing.
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Scope     string  `json:"scope"` // "project" or "global"
	Path      string  `json:"path"`
	UpdatedAt string  `json:"updatedAt,omitempty"`
	Entries   []Entry `json:"entries"`
}

// Entry is one remembered item.
type Entry struct {
	Text     string `json:"text"`
	Category string `json:"category,omitempty"` // "[correction] …" → "correction"
	Created  string `json:"created,omitempty"`
	Last     string `json:"last,omitempty"`
	// Project: the project a global entry was written from.
	Project string `json:"project,omitempty"`
}

// delimiter separates the entries of a memory file.
const delimiter = "\n§\n"

var (
	metaRe     = regexp.MustCompile(`(?s)^(.*?)\s*<!--\s*created=([^,]+),\s*last=([^,>]+?)(?:,\s*project64=([A-Za-z0-9_-]+))?\s*-->\s*$`)
	categoryRe = regexp.MustCompile(`^\[([a-z][a-z-]*)\]\s*`)
)

// Root is the package's global folder under pi's dir (~/.pi).
func Root(piDir string) string { return filepath.Join(piDir, "agent", "pi-hermes-memory") }

// ProjectsRoot holds one folder per project.
func ProjectsRoot(piDir string) string { return filepath.Join(piDir, "agent", "projects-memory") }

// ProjectName is the folder pi-hermes-memory keeps a working directory's
// memory in: the git repository root's name (so worktrees share it), else
// the directory's own name — unless only a folder under the directory's
// name exists already. The home folder (and none) has no project.
func ProjectName(piDir, home, cwd string) string {
	if cwd == "" {
		return ""
	}
	cwd = filepath.Clean(cwd)
	if cwd == filepath.Clean(home) || cwd == "/" {
		return ""
	}
	name := filepath.Base(cwd)
	repo := repoRoot(cwd)
	if repo == "" || repo == cwd || repo == filepath.Clean(home) {
		return name
	}
	repoName := filepath.Base(repo)
	root := ProjectsRoot(piDir)
	if !exists(filepath.Join(root, repoName)) && exists(filepath.Join(root, name)) {
		return name
	}
	return repoName
}

// repoRoot: the nearest folder up from dir with a .git folder, or a .git
// file's main checkout (a linked worktree); "" outside a repository.
func repoRoot(dir string) string {
	for cur := dir; ; cur = filepath.Dir(cur) {
		dotGit := filepath.Join(cur, ".git")
		if st, err := os.Stat(dotGit); err == nil {
			if st.IsDir() {
				return cur
			}
			return worktreeMain(cur, dotGit)
		}
		if filepath.Dir(cur) == cur {
			return ""
		}
	}
}

// worktreeMain follows "gitdir: <main>/.git/worktrees/<name>" back to <main>.
func worktreeMain(cur, dotGit string) string {
	b, err := os.ReadFile(dotGit)
	if err != nil {
		return cur
	}
	gitDir, ok := strings.CutPrefix(strings.TrimSpace(string(b)), "gitdir:")
	if !ok {
		return cur
	}
	gitDir = strings.TrimSpace(gitDir)
	if !filepath.IsAbs(gitDir) {
		gitDir = filepath.Join(cur, gitDir)
	}
	common := filepath.Dir(filepath.Dir(gitDir)) // <main>/.git
	if c, err := os.ReadFile(filepath.Join(gitDir, "commondir")); err == nil {
		p := strings.TrimSpace(string(c))
		if !filepath.IsAbs(p) {
			p = filepath.Join(gitDir, p)
		}
		common = filepath.Clean(p)
	} else if filepath.Base(filepath.Dir(gitDir)) != "worktrees" {
		return cur
	}
	if filepath.Base(common) == ".git" {
		return filepath.Dir(common)
	}
	return common
}

// Stores lists the project's memory (when project isn't "") and then the
// global stores. Missing files are listed with no entries.
func Stores(piDir, project string) []Store {
	root := Root(piDir)
	failures := read(filepath.Join(root, "failures.md"))
	var out []Store
	if project != "" && !strings.ContainsAny(project, `/\`) && project != "." && project != ".." {
		dir := filepath.Join(ProjectsRoot(piDir), project)
		mem := store("project", "Project memory", "project", filepath.Join(dir, "MEMORY.md"))
		fail := store("project-failures", "Project failures", "project", filepath.Join(dir, "failures.md"))
		// Failures written to the global file from this project.
		for _, e := range failures.Entries {
			if e.Project == project {
				fail.Entries = append(fail.Entries, e)
			}
		}
		out = append(out, mem, fail)
	}
	return append(out,
		store("memory", "Memory", "global", filepath.Join(root, "MEMORY.md")),
		store("user", "User profile", "global", filepath.Join(root, "USER.md")),
		with(failures, "failures", "Failures", "global"),
		standing(filepath.Join(root, "STANDING.md")),
	)
}

func store(id, title, scope, path string) Store { return with(read(path), id, title, scope) }

func with(s Store, id, title, scope string) Store {
	s.ID, s.Title, s.Scope = id, title, scope
	return s
}

// read parses a §-separated memory file.
func read(path string) Store {
	s := Store{Path: path, Entries: []Entry{}}
	b, err := os.ReadFile(path)
	if err != nil {
		return s
	}
	s.UpdatedAt = modTime(path)
	for _, raw := range strings.Split(strings.ReplaceAll(string(b), "\r\n", "\n"), delimiter) {
		if raw = strings.TrimSpace(raw); raw != "" {
			s.Entries = append(s.Entries, parseEntry(raw))
		}
	}
	return s
}

func parseEntry(raw string) Entry {
	e := Entry{Text: raw}
	if m := metaRe.FindStringSubmatch(raw); m != nil {
		e.Text, e.Created, e.Last = strings.TrimSpace(m[1]), strings.TrimSpace(m[2]), strings.TrimSpace(m[3])
		if m[4] != "" {
			if p, err := base64.RawURLEncoding.DecodeString(m[4]); err == nil {
				e.Project = string(p)
			}
		}
	}
	if m := categoryRe.FindStringSubmatch(e.Text); m != nil {
		e.Category = m[1]
		e.Text = e.Text[len(m[0]):]
	}
	return e
}

// standing: STANDING.md is one instruction per line ("- " optional, "#" comments).
func standing(path string) Store {
	s := Store{ID: "standing", Title: "Standing instructions", Scope: "global", Path: path, Entries: []Entry{}}
	b, err := os.ReadFile(path)
	if err != nil {
		return s
	}
	s.UpdatedAt = modTime(path)
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "-*"))
		if line != "" && !strings.HasPrefix(line, "#") {
			s.Entries = append(s.Entries, Entry{Text: line})
		}
	}
	return s
}

func modTime(path string) string {
	st, err := os.Stat(path)
	if err != nil {
		return ""
	}
	return st.ModTime().UTC().Format(time.RFC3339)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
