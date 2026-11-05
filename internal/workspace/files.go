// Package workspace reads a project's folder for the right-hand panel: one
// directory's entries (the file tree) and the git status of its repository.
// Both are read-only.
package workspace

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// MaxEntries caps one directory's listing.
const MaxEntries = 2000

// ErrBadPath is returned for a path that isn't a folder inside the project.
var ErrBadPath = errors.New("bad path")

// Entry is one item of a directory. Symlinks are listed as "link" and never
// followed, so the tree stays inside the project.
type Entry struct {
	Name string `json:"name"`
	Kind string `json:"kind"` // dir, file or link
	Size int64  `json:"size,omitempty"`
}

// List returns the entries of rel (slash-separated, "" = the root) under
// root: folders first, then by name; .git is left out. truncated is set when
// there were more than MaxEntries.
func List(root, rel string) (entries []Entry, truncated bool, err error) {
	rel = strings.Trim(rel, "/")
	if rel == "" {
		rel = "."
	}
	if !filepath.IsLocal(filepath.FromSlash(rel)) {
		return nil, false, ErrBadPath
	}
	r, err := os.OpenRoot(root)
	if err != nil {
		return nil, false, err
	}
	defer r.Close()
	// os.Root refuses paths (and symlinks) that lead out of the project.
	f, err := r.Open(filepath.FromSlash(rel))
	if err != nil {
		return nil, false, ErrBadPath
	}
	defer f.Close()
	items, err := f.ReadDir(-1)
	if err != nil {
		return nil, false, ErrBadPath
	}
	entries = make([]Entry, 0, len(items))
	for _, it := range items {
		if it.Name() == ".git" {
			continue
		}
		e := Entry{Name: it.Name(), Kind: "file"}
		switch {
		case it.Type()&fs.ModeSymlink != 0:
			e.Kind = "link"
		case it.IsDir():
			e.Kind = "dir"
		default:
			if info, err := it.Info(); err == nil {
				e.Size = info.Size()
			}
		}
		entries = append(entries, e)
	}
	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if (a.Kind == "dir") != (b.Kind == "dir") {
			return a.Kind == "dir"
		}
		la, lb := strings.ToLower(a.Name), strings.ToLower(b.Name)
		if la != lb {
			return la < lb
		}
		return a.Name < b.Name
	})
	if len(entries) > MaxEntries {
		return entries[:MaxEntries], true, nil
	}
	return entries, false, nil
}
