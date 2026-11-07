package workspace

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// gitEnv isolates the tests from the user's git config and gives commits an author.
func gitEnv(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	for _, k := range []string{"GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"} {
		t.Setenv(k, "t")
	}
	for _, k := range []string{"GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"} {
		t.Setenv(k, "t@example.com")
	}
}

func newRepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	run(t, root, "init", "-q", "-b", "main")
	writeFile(t, filepath.Join(root, "app.js"), "a\nb\n")
	writeFile(t, filepath.Join(root, "keep.txt"), "keep\n")
	run(t, root, "add", ".")
	run(t, root, "commit", "-q", "-m", "init")
	return root
}

func apply(t *testing.T, dir string, req Request) Result {
	t.Helper()
	res, err := Apply(context.Background(), dir, req)
	if err != nil {
		t.Fatalf("Apply(%s): %v", req.Op, err)
	}
	return res
}

func status(t *testing.T, dir string) *GitStatus {
	t.Helper()
	st, err := Status(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func paths(cs []Change) string {
	var p []string
	for _, c := range cs {
		p = append(p, c.Status+" "+c.Path)
	}
	return strings.Join(p, ", ")
}

func TestStageUnstageDiscardCommit(t *testing.T) {
	gitEnv(t)
	root := newRepo(t)
	writeFile(t, filepath.Join(root, "app.js"), "a\nB\n")
	writeFile(t, filepath.Join(root, "new *.txt"), "new\n")
	writeFile(t, filepath.Join(root, "x.txt"), "x\n") // a name the glob above would match

	res := apply(t, root, Request{Op: OpStage, Files: []FileRef{{Path: "app.js", Group: GroupChanges}, {Path: "new *.txt", Group: GroupChanges, Status: "U"}}})
	if !res.OK || len(res.Steps) != 1 || !strings.HasPrefix(res.Steps[0].Cmd, "git --literal-pathspecs add -A -- ") {
		t.Fatalf("stage = %+v", res)
	}
	st := status(t, root)
	if got := paths(st.Staged); got != "M app.js, A new *.txt" {
		t.Fatalf("staged = %s", got)
	}
	if got := paths(st.Changes); got != "U x.txt" {
		t.Fatalf("changes = %s (the pathspec was a glob)", got)
	}

	apply(t, root, Request{Op: OpUnstage, Files: []FileRef{{Path: "new *.txt", Group: GroupStaged}}})
	if got := paths(status(t, root).Staged); got != "M app.js" {
		t.Fatalf("staged after unstage = %s", got)
	}

	// Discard: back to the staged version; an untracked file is deleted.
	writeFile(t, filepath.Join(root, "app.js"), "a\nB\nmore\n")
	apply(t, root, Request{Op: OpDiscard, Files: []FileRef{{Path: "app.js", Group: GroupChanges, Status: "M"}, {Path: "x.txt", Group: GroupChanges, Status: "U"}}})
	if b, _ := os.ReadFile(filepath.Join(root, "app.js")); string(b) != "a\nB\n" {
		t.Fatalf("app.js after discard = %q", b)
	}
	if _, err := os.Stat(filepath.Join(root, "x.txt")); !os.IsNotExist(err) {
		t.Fatalf("x.txt still there: %v", err)
	}

	if _, err := Apply(context.Background(), root, Request{Op: OpCommit, Message: "  "}); err == nil {
		t.Fatal("empty message accepted")
	}
	res = apply(t, root, Request{Op: OpCommit, Message: "change b"})
	if !res.OK {
		t.Fatalf("commit = %+v", res)
	}
	st = status(t, root)
	if len(st.Staged) != 0 || paths(st.Changes) != "U new *.txt" {
		t.Fatalf("after commit: staged %s, changes %s", paths(st.Staged), paths(st.Changes))
	}
	// Amend without a message keeps it.
	apply(t, root, Request{Op: OpStage, Files: []FileRef{{Path: "new *.txt", Group: GroupChanges}}})
	if res := apply(t, root, Request{Op: OpCommit, Amend: true}); !res.OK || !strings.Contains(res.Steps[0].Cmd, "--amend --no-edit") {
		t.Fatalf("amend = %+v", res)
	}
	out, _ := exec.Command("git", "-C", root, "log", "--format=%s").Output()
	if string(out) != "change b\ninit\n" {
		t.Fatalf("log = %q", out)
	}

	// A failing command is a result, not an error.
	if res := apply(t, root, Request{Op: OpCommit, Message: "nothing"}); res.OK || res.Steps[0].ExitCode == 0 {
		t.Fatalf("empty commit = %+v", res)
	}
}

func TestRefusedRequests(t *testing.T) {
	gitEnv(t)
	root := newRepo(t)
	for name, req := range map[string]Request{
		"discard staged":   {Op: OpDiscard, Files: []FileRef{{Path: "app.js", Group: GroupStaged}}},
		"take outside":     {Op: OpOurs, Files: []FileRef{{Path: "app.js", Group: GroupChanges}}},
		"leave the repo":   {Op: OpStage, Files: []FileRef{{Path: "../x", Group: GroupChanges}}},
		"absolute":         {Op: OpStage, Files: []FileRef{{Path: "/etc/passwd", Group: GroupChanges}}},
		"no files":         {Op: OpStage},
		"unknown":          {Op: "gc"},
		"abort nothing":    {Op: OpAbort},
		"write no content": {Op: OpWrite, Path: "app.js"},
	} {
		_, err := Apply(context.Background(), root, req)
		var bad *InvalidError
		if !errors.As(err, &bad) {
			t.Errorf("%s: err = %v, want InvalidError", name, err)
		}
	}
	if _, err := Apply(context.Background(), t.TempDir(), Request{Op: OpFetch}); !errors.Is(err, ErrNotRepo) {
		t.Errorf("outside a repo: %v", err)
	}
}

// conflicted makes a merge conflict on app.js (main: "a\nmine\n", topic: "a\ntheirs\n").
func conflicted(t *testing.T) string {
	t.Helper()
	root := newRepo(t)
	run(t, root, "checkout", "-q", "-b", "topic")
	writeFile(t, filepath.Join(root, "app.js"), "a\ntheirs\n")
	run(t, root, "rm", "-q", "keep.txt")
	run(t, root, "commit", "-q", "-am", "topic")
	run(t, root, "checkout", "-q", "main")
	writeFile(t, filepath.Join(root, "app.js"), "a\nmine\n")
	writeFile(t, filepath.Join(root, "keep.txt"), "kept and changed\n")
	run(t, root, "commit", "-q", "-am", "main")
	cmd := exec.Command("git", "merge", "topic")
	cmd.Dir = root
	if err := cmd.Run(); err == nil {
		t.Fatal("merge did not conflict")
	}
	return root
}

func TestConflicts(t *testing.T) {
	gitEnv(t)
	root := conflicted(t)
	st := status(t, root)
	if st.State != "merge" || paths(st.Merge) != "! app.js, ! keep.txt" || st.Merge[0].XY != "UU" || st.Merge[1].XY != "UD" {
		t.Fatalf("status = %s %+v", st.State, st.Merge)
	}
	text, _, err := Diff(context.Background(), root, FileRef{Path: "app.js", Group: GroupMerge})
	if err != nil || !strings.HasPrefix(text, "diff --cc app.js") || !strings.Contains(text, "++<<<<<<< HEAD") {
		t.Fatalf("combined diff = %q %v", text, err)
	}

	apply(t, root, Request{Op: OpTheirs, Files: []FileRef{{Path: "app.js", Group: GroupMerge}}})
	if b, _ := os.ReadFile(filepath.Join(root, "app.js")); string(b) != "a\ntheirs\n" {
		t.Fatalf("app.js = %q", b)
	}
	apply(t, root, Request{Op: OpRemove, Files: []FileRef{{Path: "keep.txt", Group: GroupMerge}}})
	st = status(t, root)
	if len(st.Merge) != 0 || paths(st.Staged) != "M app.js, D keep.txt" {
		t.Fatalf("after resolving: merge %s, staged %s", paths(st.Merge), paths(st.Staged))
	}
	if res := apply(t, root, Request{Op: OpContinue}); !res.OK || res.Steps[0].Cmd != "git merge --continue" {
		t.Fatalf("continue = %+v", res)
	}
	if st := status(t, root); st.State != "" {
		t.Fatalf("still %s", st.State)
	}

	// Abort; skip is only for rebases and cherry-picks.
	root = conflicted(t)
	if _, err := Apply(context.Background(), root, Request{Op: OpSkip}); err == nil {
		t.Fatal("merge --skip accepted")
	}
	if res := apply(t, root, Request{Op: OpAbort}); !res.OK {
		t.Fatalf("abort = %+v", res)
	}
	if st := status(t, root); st.State != "" || len(st.Merge) != 0 {
		t.Fatalf("after abort: %+v", st)
	}
}

func TestResolveByWriting(t *testing.T) {
	gitEnv(t)
	root := conflicted(t)
	f, err := ReadFile(root, "app.js")
	if err != nil || !strings.Contains(f.Text, "<<<<<<< HEAD") || f.Hash == "" {
		t.Fatalf("ReadFile = %+v %v", f, err)
	}
	content := "a\nmine\ntheirs\n"
	if err := WriteFile(root, "app.js", content, "stale"); !errors.Is(err, ErrChanged) {
		t.Fatalf("stale write: %v", err)
	}
	res := apply(t, root, Request{Op: OpWrite, Path: "app.js", Content: &content, Base: f.Hash})
	if !res.OK {
		t.Fatalf("write = %+v", res)
	}
	if b, _ := os.ReadFile(filepath.Join(root, "app.js")); string(b) != content {
		t.Fatalf("app.js = %q", b)
	}
	apply(t, root, Request{Op: OpStage, Files: []FileRef{{Path: "app.js", Group: GroupMerge}}})
	if got := paths(status(t, root).Merge); got != "! keep.txt" {
		t.Fatalf("merge = %s", got)
	}
}

func TestDiffGroups(t *testing.T) {
	gitEnv(t)
	root := newRepo(t)
	writeFile(t, filepath.Join(root, "app.js"), "a\nB\n")
	run(t, root, "add", "app.js")
	writeFile(t, filepath.Join(root, "app.js"), "a\nB\nc\n")
	run(t, root, "mv", "keep.txt", "kept.txt")
	writeFile(t, filepath.Join(root, "sub", "new.md"), "hi\n")
	ctx := context.Background()
	for _, tc := range []struct {
		ref  FileRef
		want string
	}{
		{FileRef{Path: "app.js", Group: GroupStaged}, "-b\n+B\n"},
		{FileRef{Path: "app.js", Group: GroupChanges, Status: "M"}, " B\n+c\n"},
		{FileRef{Path: "kept.txt", From: "keep.txt", Group: GroupStaged}, "rename to kept.txt"},
		{FileRef{Path: "sub/new.md", Group: GroupChanges, Status: "U"}, "+hi\n"},
	} {
		text, truncated, err := Diff(ctx, filepath.Join(root, "sub"), tc.ref)
		if err != nil || truncated || !strings.Contains(text, tc.want) {
			t.Errorf("Diff(%+v) = %q %v %v, want %q", tc.ref, text, truncated, err, tc.want)
		}
	}
	if _, _, err := Diff(ctx, root, FileRef{Path: "../x", Group: GroupChanges}); err == nil {
		t.Error("Diff outside the repo succeeded")
	}
}

func TestReadFile(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "a.txt"), "hello\n")
	writeFile(t, filepath.Join(root, "b.bin"), "x\x00y")
	outside := filepath.Join(t.TempDir(), "secret")
	writeFile(t, outside, "s")
	if err := os.Symlink(outside, filepath.Join(root, "out")); err != nil {
		t.Fatal(err)
	}
	if f, err := ReadFile(root, "a.txt"); err != nil || f.Text != "hello\n" || f.Size != 6 || f.Binary {
		t.Fatalf("a.txt = %+v %v", f, err)
	}
	if f, err := ReadFile(root, "b.bin"); err != nil || !f.Binary || f.Text != "" {
		t.Fatalf("b.bin = %+v %v", f, err)
	}
	for _, bad := range []string{"out", "../a.txt", "", ".", "missing"} {
		if _, err := ReadFile(root, bad); !errors.Is(err, ErrBadPath) {
			t.Errorf("ReadFile(%q) = %v", bad, err)
		}
	}
	if err := WriteFile(root, "out", "x", ""); err == nil {
		t.Error("WriteFile through a symlink out succeeded")
	}
}

func TestPushPublishesTheBranch(t *testing.T) {
	gitEnv(t)
	root := newRepo(t)
	if res := apply(t, root, Request{Op: OpPush}); res.OK || !strings.Contains(res.Steps[0].Output, "no remote") {
		t.Fatalf("push without a remote = %+v", res)
	}
	bare := t.TempDir()
	run(t, bare, "init", "-q", "--bare")
	run(t, root, "remote", "add", "origin", bare)
	if st := status(t, root); st.Remote != "origin" || st.Upstream != "" {
		t.Fatalf("status = %+v", st)
	}
	res := apply(t, root, Request{Op: OpPush})
	if !res.OK || res.Steps[0].Cmd != "git push --set-upstream origin main" {
		t.Fatalf("push = %+v", res)
	}
	writeFile(t, filepath.Join(root, "app.js"), "z\n")
	apply(t, root, Request{Op: OpStage, Files: []FileRef{{Path: "app.js", Group: GroupChanges}}})
	res = apply(t, root, Request{Op: OpCommit, Message: "z", Push: true})
	if !res.OK || len(res.Steps) != 2 || res.Steps[1].Cmd != "git push" {
		t.Fatalf("commit & push = %+v", res)
	}
	if st := status(t, root); st.Upstream != "origin/main" || st.Ahead != 0 {
		t.Fatalf("after push: %+v", st)
	}
	if res := apply(t, root, Request{Op: OpFetch}); !res.OK {
		t.Fatalf("fetch = %+v", res)
	}
}
