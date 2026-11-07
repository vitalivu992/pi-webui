package workspace

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Groups of the Git tab, as in GitStatus.
const (
	GroupMerge   = "merge"
	GroupStaged  = "staged"
	GroupChanges = "changes"
)

// Operations of the Git tab: VS Code's Source Control inline actions, the
// commit box, the sync menu and the operation-in-progress banner.
const (
	OpStage    = "stage"    // git add -A: in Merge changes it marks the conflict resolved
	OpUnstage  = "unstage"  // git reset -q: works before the first commit, unlike restore --staged
	OpDiscard  = "discard"  // Changes only: git restore (back to the staged version); untracked: git clean -f
	OpOurs     = "ours"     // a conflict: git checkout --ours, then git add
	OpTheirs   = "theirs"   // a conflict: git checkout --theirs, then git add
	OpRemove   = "remove"   // a conflict: git rm (accept the deletion)
	OpCommit   = "commit"   // git commit -m [--amend], then git push when Push is set
	OpFetch    = "fetch"    // git fetch --all --prune
	OpPull     = "pull"     // git pull
	OpPullRe   = "pull-rebase"
	OpPush     = "push"     // git push, or push -u <remote> <branch> without an upstream
	OpAbort    = "abort"    // git <operation in progress> --abort
	OpContinue = "continue" // git <operation in progress> --continue
	OpSkip     = "skip"     // git rebase|cherry-pick --skip
	OpWrite    = "write"    // a file's new content (the conflict resolver)
)

// Request is one operation of the Git tab.
type Request struct {
	Op      string    `json:"op"`
	Files   []FileRef `json:"files,omitempty"`
	Message string    `json:"message,omitempty"`
	Amend   bool      `json:"amend,omitempty"`
	Push    bool      `json:"push,omitempty"`
	// write: the file (from the repository's root), its new content and the
	// hash (File.Hash) of the content it replaces.
	Path    string  `json:"path,omitempty"`
	Content *string `json:"content,omitempty"`
	Base    string  `json:"base,omitempty"`
}

// FileRef names a file of a group. From is a staged rename's source.
type FileRef struct {
	Path   string `json:"path"`
	From   string `json:"from,omitempty"`
	Group  string `json:"group"`
	Status string `json:"status,omitempty"`
}

// Step is one git command an operation ran, with what it printed.
type Step struct {
	Cmd      string `json:"cmd"`
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
}

// Result is what an operation did. OK is false when a git command failed;
// its output is in the last step.
type Result struct {
	OK    bool   `json:"ok"`
	Steps []Step `json:"steps"`
}

// ErrBusy: another operation is running in the same repository.
var ErrBusy = errors.New("another git operation is running in this repository")

// InvalidError is a request the server refuses before running git.
type InvalidError struct{ msg string }

func (e *InvalidError) Error() string { return e.msg }

func invalid(format string, args ...any) error { return &InvalidError{fmt.Sprintf(format, args...)} }

const (
	opTimeout = 2 * time.Minute
	// pathChunk keeps each command line short when a whole group is sent.
	pathChunk = 200
	// MaxOutput caps what one command may print (a diff of a huge file).
	MaxOutput = 4 << 20
)

// One operation at a time per repository: two `git add` would fight over index.lock.
var locks sync.Map // root → *sync.Mutex

// Apply runs an operation in the repository dir is in.
func Apply(ctx context.Context, dir string, req Request) (Result, error) {
	root, gitDir, err := repoDirs(ctx, dir)
	if err != nil {
		return Result{}, err
	}
	m, _ := locks.LoadOrStore(root, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	if !mu.TryLock() {
		return Result{}, ErrBusy
	}
	defer mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, opTimeout)
	defer cancel()
	r := &runner{ctx: ctx, dir: root, res: Result{OK: true, Steps: []Step{}}}

	switch req.Op {
	case OpStage, OpUnstage, OpDiscard, OpOurs, OpTheirs, OpRemove:
		if err := r.files(req.Op, req.Files); err != nil {
			return Result{}, err
		}
	case OpCommit:
		if strings.TrimSpace(req.Message) == "" && !req.Amend {
			return Result{}, invalid("empty commit message")
		}
		args := []string{"commit"}
		if req.Amend {
			args = append(args, "--amend")
		}
		if strings.TrimSpace(req.Message) == "" {
			args = append(args, "--no-edit")
		} else {
			args = append(args, "-m", req.Message)
		}
		r.do(args...)
		if req.Push && r.res.OK {
			r.push()
		}
	case OpFetch:
		r.do("fetch", "--all", "--prune")
	case OpPull:
		r.do("pull")
	case OpPullRe:
		r.do("pull", "--rebase")
	case OpPush:
		r.push()
	case OpAbort, OpContinue, OpSkip:
		state := operation(gitDir)
		args, err := stateArgs(state, req.Op)
		if err != nil {
			return Result{}, err
		}
		r.do(args...)
	case OpWrite:
		if req.Content == nil {
			return Result{}, invalid("no content")
		}
		if err := WriteFile(root, req.Path, *req.Content, req.Base); err != nil {
			return Result{}, err
		}
		r.res.Steps = append(r.res.Steps, Step{Cmd: "write " + req.Path})
	default:
		return Result{}, invalid("unknown operation %q", req.Op)
	}
	return r.res, nil
}

// stateArgs is the git command that aborts, continues or skips the operation in progress.
func stateArgs(state, op string) ([]string, error) {
	switch state {
	case "rebase", "merge", "cherry-pick", "revert":
	case "":
		return nil, invalid("no merge, rebase, cherry-pick or revert is in progress")
	default:
		return nil, invalid("cannot %s a %s here", op, state)
	}
	if op == OpSkip && state != "rebase" && state != "cherry-pick" {
		return nil, invalid("a %s cannot be skipped", state)
	}
	return []string{state, "--" + op}, nil
}

// files runs a file operation of the Git tab over the files, 200 paths per command.
func (r *runner) files(op string, files []FileRef) error {
	if len(files) == 0 {
		return invalid("no files")
	}
	var paths, untracked []string
	for _, f := range files {
		if !validRel(f.Path) || (f.From != "" && !validRel(f.From)) {
			return invalid("bad file path %q", f.Path)
		}
		ok := false
		switch op {
		case OpStage:
			ok = f.Group == GroupChanges || f.Group == GroupMerge
		case OpUnstage:
			ok = f.Group == GroupStaged
		case OpDiscard:
			// The staged version of a file is never thrown away, as in VS Code.
			ok = f.Group == GroupChanges
		case OpOurs, OpTheirs, OpRemove:
			ok = f.Group == GroupMerge
		}
		if !ok {
			return invalid("cannot %s %s in %s", op, f.Path, f.Group)
		}
		switch {
		case op == OpDiscard && f.Status == "U":
			untracked = append(untracked, f.Path)
		case op == OpUnstage && f.From != "":
			// A staged rename: put the old path back too.
			paths = append(paths, f.Path, f.From)
		default:
			paths = append(paths, f.Path)
		}
	}
	switch op {
	case OpStage:
		r.each(paths, "add", "-A")
	case OpUnstage:
		r.each(paths, "reset", "-q")
	case OpDiscard:
		r.each(paths, "restore")
		r.each(untracked, "clean", "-f", "-q")
	case OpOurs, OpTheirs:
		r.each(paths, "checkout", "--"+op)
		r.each(paths, "add")
	case OpRemove:
		r.each(paths, "rm", "-q", "--ignore-unmatch")
	}
	return nil
}

// validRel: a slash-separated path inside the repository.
func validRel(p string) bool {
	return p != "" && !strings.Contains(p, "\\") && filepath.IsLocal(filepath.FromSlash(p))
}

type runner struct {
	ctx context.Context
	dir string
	res Result
}

// do runs one changing git command, unless an earlier one failed.
func (r *runner) do(args ...string) {
	if !r.res.OK {
		return
	}
	s := runStep(r.ctx, r.dir, args...)
	r.res.Steps = append(r.res.Steps, s)
	r.res.OK = s.ExitCode == 0
}

// each runs `git --literal-pathspecs <args> -- <paths>` in chunks ("*.txt" is a name, not a glob).
func (r *runner) each(paths []string, args ...string) {
	for i := 0; i < len(paths); i += pathChunk {
		full := append(append([]string{"--literal-pathspecs"}, args...), "--")
		r.do(append(full, paths[i:min(i+pathChunk, len(paths))]...)...)
	}
}

// push is `git push`, or `git push -u <remote> <branch>` to publish a branch
// without an upstream (origin, else the first remote).
func (r *runner) push() {
	if !r.res.OK {
		return
	}
	if _, err := git(r.ctx, r.dir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"); err == nil {
		r.do("push")
		return
	}
	out, err := git(r.ctx, r.dir, "symbolic-ref", "-q", "--short", "HEAD")
	branch := strings.TrimSpace(string(out))
	if err != nil || branch == "" {
		r.fail("git push", "HEAD is detached: check out a branch to push it.")
		return
	}
	name := remote(r.ctx, r.dir)
	if name == "" {
		r.fail("git push", "This repository has no remote to push to.")
		return
	}
	r.do("push", "--set-upstream", name, branch)
}

func (r *runner) fail(cmd, msg string) {
	r.res.Steps = append(r.res.Steps, Step{Cmd: cmd, Output: msg, ExitCode: 1})
	r.res.OK = false
}

// writeEnv makes git safe without a terminal: no credential or ssh prompts
// (they would hang), no editor for merge or rebase messages, English output.
func writeEnv() []string {
	env := append(os.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_EDITOR=true",
		"GIT_SEQUENCE_EDITOR=true",
		"GIT_MERGE_AUTOEDIT=no",
		"LC_ALL=C",
	)
	if os.Getenv("GIT_SSH_COMMAND") == "" {
		env = append(env, "GIT_SSH_COMMAND=ssh -o BatchMode=yes")
	}
	return env
}

// runStep runs a changing git command in dir and records it.
func runStep(ctx context.Context, dir string, args ...string) Step {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = writeEnv()
	var out limitedBuffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	s := Step{Cmd: "git " + strings.Join(args, " "), Output: strings.TrimRight(out.String(), "\n")}
	if err != nil {
		var exit *exec.ExitError
		switch {
		case errors.As(err, &exit) && ctx.Err() == nil:
			s.ExitCode = exit.ExitCode()
		case ctx.Err() != nil:
			s.ExitCode, s.Output = -1, strings.TrimSpace(s.Output+"\ntimed out")
		default:
			s.ExitCode, s.Output = -1, err.Error()
		}
	}
	return s
}

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if room := MaxOutput - b.Len(); room < len(p) {
		if room > 0 {
			b.Buffer.Write(p[:room])
		}
		return len(p), nil
	}
	return b.Buffer.Write(p)
}

// Diff is the unified diff of one file of a group: staged against HEAD,
// changes against the staged version (an untracked file against nothing),
// and git's combined diff for a conflict. truncated: cut at MaxOutput.
func Diff(ctx context.Context, dir string, f FileRef) (text string, truncated bool, err error) {
	if !validRel(f.Path) || (f.From != "" && !validRel(f.From)) {
		return "", false, invalid("bad file path %q", f.Path)
	}
	root, _, err := repoDirs(ctx, dir)
	if err != nil {
		return "", false, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	args := []string{"-c", "core.quotepath=off", "--no-optional-locks", "diff", "--no-color", "--no-ext-diff", "-M"}
	switch f.Group {
	case GroupStaged:
		args = append(args, "--cached", "--")
		if f.From != "" {
			args = append(args, f.From)
		}
		args = append(args, f.Path)
	case GroupMerge:
		args = append(args, "--", f.Path)
	case GroupChanges:
		if f.Status == "U" {
			args = append(args, "--no-index", "--", os.DevNull, f.Path)
		} else {
			args = append(args, "--", f.Path)
		}
	default:
		return "", false, invalid("unknown group %q", f.Group)
	}
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0", "LC_ALL=C")
	var out limitedBuffer
	var stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		// --no-index answers 1 when the files differ.
		if !(errors.As(err, &exit) && exit.ExitCode() == 1 && f.Status == "U" && f.Group == GroupChanges) {
			msg := strings.TrimSpace(stderr.String())
			if msg == "" {
				msg = err.Error()
			}
			return "", false, errors.New(msg)
		}
	}
	return out.String(), out.Len() >= MaxOutput, nil
}

// MaxFileBytes caps a file shown in the viewer.
const MaxFileBytes = 2 << 20

// File is a file's content for the viewer. Hash identifies the content, so a
// write can tell that the file changed meanwhile.
type File struct {
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	Binary    bool   `json:"binary,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	Text      string `json:"text"`
	Hash      string `json:"hash"`
}

// ReadFile reads rel (slash-separated) under root, through os.Root, so
// neither ".." nor a symlink leaves it. Binary files have no text.
func ReadFile(root, rel string) (*File, error) {
	if !validRel(rel) {
		return nil, ErrBadPath
	}
	r, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	name := filepath.FromSlash(rel)
	info, err := r.Stat(name)
	if err != nil || !info.Mode().IsRegular() {
		return nil, ErrBadPath
	}
	b, err := r.ReadFile(name)
	if err != nil {
		return nil, ErrBadPath
	}
	sum := sha256.Sum256(b)
	f := &File{Path: rel, Size: int64(len(b)), Hash: hex.EncodeToString(sum[:])}
	head := b[:min(len(b), 8000)]
	switch {
	case bytes.IndexByte(head, 0) >= 0:
		f.Binary = true
	case len(b) > MaxFileBytes:
		f.Text, f.Truncated = string(b[:MaxFileBytes]), true
	default:
		f.Text = string(b)
	}
	return f, nil
}

// ErrChanged: the file is no longer the content the write was based on.
var ErrChanged = errors.New("the file changed on disk since it was opened: reload it")

// WriteFile replaces an existing file's content when it still hashes to base.
func WriteFile(root, rel, content, base string) error {
	if !validRel(rel) {
		return invalid("bad file path %q", rel)
	}
	r, err := os.OpenRoot(root)
	if err != nil {
		return err
	}
	defer r.Close()
	name := filepath.FromSlash(rel)
	info, err := r.Stat(name)
	if err != nil || !info.Mode().IsRegular() {
		return invalid("%s is not a file", rel)
	}
	old, err := r.ReadFile(name)
	if err != nil {
		return err
	}
	if sum := sha256.Sum256(old); hex.EncodeToString(sum[:]) != base {
		return ErrChanged
	}
	return r.WriteFile(name, []byte(content), info.Mode().Perm())
}
