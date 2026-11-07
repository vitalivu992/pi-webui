package workspace

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestList(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "b.txt"), "hello")
	writeFile(t, filepath.Join(root, "A.md"), "x")
	writeFile(t, filepath.Join(root, "src", "main.go"), "package main\n")
	writeFile(t, filepath.Join(root, ".git", "HEAD"), "ref: refs/heads/main\n")
	writeFile(t, filepath.Join(root, ".env"), "")
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "out")); err != nil {
		t.Fatal(err)
	}

	got, truncated, err := List(root, "")
	if err != nil || truncated {
		t.Fatalf("List: %v %v", err, truncated)
	}
	want := []Entry{{Name: "src", Kind: "dir"}, {Name: ".env", Kind: "file"}, {Name: "A.md", Kind: "file", Size: 1}, {Name: "b.txt", Kind: "file", Size: 5}, {Name: "out", Kind: "link"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("List = %+v, want %+v", got, want)
	}
	if got, _, err := List(root, "/src/"); err != nil || len(got) != 1 || got[0].Name != "main.go" {
		t.Fatalf("List src = %+v %v", got, err)
	}
	for _, bad := range []string{"..", "../x", "src/../..", "out", "b.txt", "missing"} {
		if _, _, err := List(root, bad); err == nil {
			t.Errorf("List(%q) succeeded", bad)
		} else if !errors.Is(err, ErrBadPath) {
			t.Errorf("List(%q) = %v, want ErrBadPath", bad, err)
		}
	}
}

func TestParseStatus(t *testing.T) {
	out := strings.Join([]string{
		"# branch.oid 0123456789abcdef",
		"# branch.head main",
		"# branch.upstream origin/main",
		"# branch.ab +2 -1",
		"1 MM N... 100644 100644 100644 aaa bbb src/app.js",
		"1 .D N... 100644 100644 000000 aaa aaa gone.txt",
		"2 R. N... 100644 100644 100644 aaa aaa R100 new name.txt", "old name.txt",
		"u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.go",
		"? notes/todo.md",
		"",
	}, "\x00")
	got := parseStatus([]byte(out))
	want := &GitStatus{
		Repo: true, Branch: "main", Commit: "0123456", Upstream: "origin/main", Ahead: 2, Behind: 1,
		Merge:   []Change{{Path: "conflict.go", Status: "!", XY: "UU"}},
		Staged:  []Change{{Path: "src/app.js", Status: "M"}, {Path: "new name.txt", From: "old name.txt", Status: "R"}},
		Changes: []Change{{Path: "src/app.js", Status: "M"}, {Path: "gone.txt", Status: "D"}, {Path: "notes/todo.md", Status: "U"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseStatus =\n%+v\nwant\n%+v", got, want)
	}
}

func TestParseNumstat(t *testing.T) {
	out := "3\t1\tsrc/app.js\x00-\t-\tlogo.png\x000\t0\t\x00old name.txt\x00new name.txt\x00"
	got := parseNumstat([]byte(out))
	want := map[string]lineCount{
		"src/app.js":   {added: 3, deleted: 1},
		"logo.png":     {binary: true},
		"new name.txt": {},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseNumstat = %+v, want %+v", got, want)
	}
}

func run(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func TestStatus(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	ctx := context.Background()

	plain := t.TempDir()
	if st, err := Status(ctx, plain); err != nil || st.Repo {
		t.Fatalf("Status outside a repo = %+v %v", st, err)
	}

	root := t.TempDir()
	run(t, root, "init", "-q", "-b", "main")
	writeFile(t, filepath.Join(root, "app.js"), "a\nb\nc\n")
	writeFile(t, filepath.Join(root, "old.txt"), "keep\n")
	writeFile(t, filepath.Join(root, "gone.txt"), "x\ny\n")
	run(t, root, "add", ".")
	run(t, root, "commit", "-q", "-m", "init")

	writeFile(t, filepath.Join(root, "app.js"), "a\nB\nc\nd\n") // staged: 1 changed + 1 added
	run(t, root, "add", "app.js")
	writeFile(t, filepath.Join(root, "app.js"), "a\nB\nc\nd\ne\n") // then one more line, unstaged
	run(t, root, "mv", "old.txt", "new.txt")
	os.Remove(filepath.Join(root, "gone.txt"))
	writeFile(t, filepath.Join(root, "sub", "todo.md"), "one\ntwo") // untracked, no final newline

	// From a subfolder: the whole repository, paths from its root.
	st, err := Status(ctx, filepath.Join(root, "sub"))
	if err != nil {
		t.Fatal(err)
	}
	if !st.Repo || st.Branch != "main" || len(st.Commit) != 7 {
		t.Fatalf("Status header = %+v", st)
	}
	wantStaged := []Change{{Path: "app.js", Status: "M", Added: 2, Deleted: 1}, {Path: "new.txt", From: "old.txt", Status: "R"}}
	wantChanges := []Change{{Path: "app.js", Status: "M", Added: 1}, {Path: "gone.txt", Status: "D", Deleted: 2}, {Path: "sub/todo.md", Status: "U", Added: 2}}
	if !reflect.DeepEqual(st.Staged, wantStaged) {
		t.Errorf("Staged = %+v, want %+v", st.Staged, wantStaged)
	}
	if !reflect.DeepEqual(st.Changes, wantChanges) {
		t.Errorf("Changes = %+v, want %+v", st.Changes, wantChanges)
	}
	if len(st.Merge) != 0 {
		t.Errorf("Merge = %+v", st.Merge)
	}
}
