package workspace

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// GitStatus is a repository's state the way VS Code's Source Control shows
// it: merge conflicts, staged changes and changes in the working tree.
// Paths are relative to the repository root.
type GitStatus struct {
	Repo     bool     `json:"repo"`
	Root     string   `json:"root,omitempty"`
	Branch   string   `json:"branch,omitempty"` // "" when detached
	Commit   string   `json:"commit,omitempty"` // short HEAD, "" before the first commit
	Upstream string   `json:"upstream,omitempty"`
	Ahead    int      `json:"ahead,omitempty"`
	Behind   int      `json:"behind,omitempty"`
	Merge    []Change `json:"merge"`
	Staged   []Change `json:"staged"`
	Changes  []Change `json:"changes"`
}

// Change is one file in a group. Status is VS Code's letter: M modified,
// A added, D deleted, R renamed, C copied, T type changed, U untracked,
// ! conflict. Added / Deleted count lines; Binary files have no counts.
type Change struct {
	Path    string `json:"path"`
	From    string `json:"from,omitempty"` // a rename's or copy's source
	Status  string `json:"status"`
	Added   int    `json:"added"`
	Deleted int    `json:"deleted"`
	Binary  bool   `json:"binary,omitempty"`
}

const (
	gitTimeout = 10 * time.Second
	// Untracked files have no diff: their lines are counted here, up to these limits.
	maxCountedFiles = 500
	maxCountedBytes = 1 << 20
)

// Status reads the git status of the repository dir is in. Outside a
// repository it answers Repo: false.
func Status(ctx context.Context, dir string) (*GitStatus, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	top, err := git(ctx, dir, "rev-parse", "--show-toplevel")
	if err != nil {
		var ge *gitError
		if errors.As(err, &ge) && strings.Contains(ge.stderr, "not a git repository") {
			return &GitStatus{Merge: []Change{}, Staged: []Change{}, Changes: []Change{}}, nil
		}
		return nil, err
	}
	root := strings.TrimRight(string(top), "\r\n")
	out, err := git(ctx, root, "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all")
	if err != nil {
		return nil, err
	}
	st := parseStatus(out)
	st.Root = root
	staged, err := git(ctx, root, "diff", "--cached", "--numstat", "-z", "--no-ext-diff")
	if err != nil {
		return nil, err
	}
	unstaged, err := git(ctx, root, "diff", "--numstat", "-z", "--no-ext-diff")
	if err != nil {
		return nil, err
	}
	applyNumstat(st.Staged, parseNumstat(staged))
	applyNumstat(st.Changes, parseNumstat(unstaged))
	countUntracked(root, st.Changes)
	return st, nil
}

type gitError struct {
	args   []string
	stderr string
	err    error
}

func (e *gitError) Error() string {
	msg := strings.TrimSpace(e.stderr)
	if msg == "" {
		msg = e.err.Error()
	}
	return fmt.Sprintf("git %s: %s", e.args[0], msg)
}

// git runs a read-only git command in dir. Optional locks are off, so it
// never takes the index lock from an agent committing at the same time.
func git(ctx context.Context, dir string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"--no-optional-locks", "-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0", "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return nil, errors.New("git is not installed")
		}
		return nil, &gitError{args: args, stderr: stderr.String(), err: err}
	}
	return out, nil
}

// parseStatus reads `git status --porcelain=v2 -z --branch`.
func parseStatus(out []byte) *GitStatus {
	st := &GitStatus{Repo: true, Merge: []Change{}, Staged: []Change{}, Changes: []Change{}}
	fields := strings.Split(string(out), "\x00")
	for i := 0; i < len(fields); i++ {
		line := fields[i]
		if line == "" {
			continue
		}
		switch line[0] {
		case '#':
			readHeader(st, line)
		case '1':
			f := strings.SplitN(line, " ", 9)
			if len(f) == 9 {
				addChange(st, f[1], f[8], "")
			}
		case '2':
			f := strings.SplitN(line, " ", 10)
			from := ""
			if i+1 < len(fields) {
				i++
				from = fields[i]
			}
			if len(f) == 10 {
				addChange(st, f[1], f[9], from)
			}
		case 'u':
			f := strings.SplitN(line, " ", 11)
			if len(f) == 11 {
				st.Merge = append(st.Merge, Change{Path: f[10], Status: "!"})
			}
		case '?':
			if len(line) > 2 {
				st.Changes = append(st.Changes, Change{Path: line[2:], Status: "U"})
			}
		}
	}
	return st
}

func readHeader(st *GitStatus, line string) {
	key, value, _ := strings.Cut(strings.TrimPrefix(line, "# "), " ")
	switch key {
	case "branch.oid":
		if value != "(initial)" && len(value) >= 7 {
			st.Commit = value[:7]
		}
	case "branch.head":
		if value != "(detached)" {
			st.Branch = value
		}
	case "branch.upstream":
		st.Upstream = value
	case "branch.ab":
		for _, part := range strings.Fields(value) {
			n, _ := strconv.Atoi(part[1:])
			if part[0] == '+' {
				st.Ahead = n
			} else {
				st.Behind = n
			}
		}
	}
}

// addChange files an ordinary or renamed entry under staged (X) and/or changes (Y).
func addChange(st *GitStatus, xy, path, from string) {
	if len(xy) != 2 {
		return
	}
	if x := letter(xy[0]); x != "" {
		st.Staged = append(st.Staged, Change{Path: path, From: from, Status: x})
	}
	if y := letter(xy[1]); y != "" {
		// Only the index holds a rename: the worktree side of it is a plain change of the new path.
		st.Changes = append(st.Changes, Change{Path: path, Status: y})
	}
}

func letter(c byte) string {
	switch c {
	case 'M', 'A', 'D', 'R', 'C', 'T':
		return string(c)
	}
	return ""
}

type lineCount struct {
	added, deleted int
	binary         bool
}

// parseNumstat reads `git diff --numstat -z`, by the (new) path.
func parseNumstat(out []byte) map[string]lineCount {
	counts := map[string]lineCount{}
	fields := strings.Split(string(out), "\x00")
	for i := 0; i < len(fields); i++ {
		f := strings.SplitN(fields[i], "\t", 3)
		if len(f) != 3 {
			continue
		}
		path := f[2]
		if path == "" && i+2 < len(fields) {
			// A rename: the source and destination follow.
			path = fields[i+2]
			i += 2
		}
		var c lineCount
		if f[0] == "-" {
			c.binary = true
		} else {
			c.added, _ = strconv.Atoi(f[0])
			c.deleted, _ = strconv.Atoi(f[1])
		}
		counts[path] = c
	}
	return counts
}

func applyNumstat(changes []Change, counts map[string]lineCount) {
	for i := range changes {
		if c, ok := counts[changes[i].Path]; ok {
			changes[i].Added, changes[i].Deleted, changes[i].Binary = c.added, c.deleted, c.binary
		}
	}
}

// countUntracked counts the lines of untracked files (every line is added).
func countUntracked(root string, changes []Change) {
	counted := 0
	for i := range changes {
		if changes[i].Status != "U" || counted == maxCountedFiles {
			continue
		}
		counted++
		n, binary, ok := countLines(filepath.Join(root, filepath.FromSlash(changes[i].Path)))
		if ok {
			changes[i].Added, changes[i].Binary = n, binary
		}
	}
}

// countLines counts a regular file's lines; a NUL byte makes it binary.
func countLines(path string) (n int, binary, ok bool) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxCountedBytes {
		return 0, false, false
	}
	f, err := os.Open(path)
	if err != nil {
		return 0, false, false
	}
	defer f.Close()
	b, err := io.ReadAll(f)
	if err != nil {
		return 0, false, false
	}
	if bytes.IndexByte(b, 0) >= 0 {
		return 0, true, true
	}
	n = bytes.Count(b, []byte{'\n'})
	if len(b) > 0 && b[len(b)-1] != '\n' {
		n++
	}
	return n, false, true
}
