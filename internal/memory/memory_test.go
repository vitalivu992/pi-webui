package memory

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func write(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestParseEntry(t *testing.T) {
	got := parseEntry("[correction] Use pnpm. <!-- created=2026-11-04, last=2026-11-05, project64=ZGVtbw -->")
	want := Entry{Text: "Use pnpm.", Category: "correction", Created: "2026-11-04", Last: "2026-11-05", Project: "demo"}
	if got != want {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
	if got := parseEntry("plain fact"); got != (Entry{Text: "plain fact"}) {
		t.Errorf("plain: %+v", got)
	}
}

func TestStores(t *testing.T) {
	pi := t.TempDir()
	root := Root(pi)
	write(t, filepath.Join(root, "MEMORY.md"), "one\n§\ntwo <!-- created=2026-11-01, last=2026-11-02 -->")
	write(t, filepath.Join(root, "failures.md"), "[failure] a <!-- created=x, last=y, project64=ZGVtbw -->\n§\n[failure] b <!-- created=x, last=y -->")
	write(t, filepath.Join(root, "STANDING.md"), "# pins\n- never run find /\n\n* ask first\n")
	write(t, filepath.Join(ProjectsRoot(pi), "demo", "MEMORY.md"), "uses make")

	stores := Stores(pi, "demo")
	var ids []string
	count := map[string]int{}
	for _, s := range stores {
		ids = append(ids, s.ID)
		count[s.ID] = len(s.Entries)
	}
	if want := []string{"project", "project-failures", "memory", "user", "failures", "standing"}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("ids %v, want %v", ids, want)
	}
	want := map[string]int{"project": 1, "project-failures": 1, "memory": 2, "user": 0, "failures": 2, "standing": 2}
	if !reflect.DeepEqual(count, want) {
		t.Errorf("entries %v, want %v", count, want)
	}
	if stores[5].Entries[0].Text != "never run find /" {
		t.Errorf("standing: %+v", stores[5].Entries)
	}
	if len(Stores(pi, "")) != 4 || len(Stores(pi, "../x")) != 4 {
		t.Error("no or a bad project should list only the global stores")
	}
}

func TestProjectName(t *testing.T) {
	pi, home := t.TempDir(), t.TempDir()
	repo := filepath.Join(home, "src", "repo")
	write(t, filepath.Join(repo, ".git", "HEAD"), "ref")
	sub := filepath.Join(repo, "web")
	os.MkdirAll(sub, 0o755)
	// A linked worktree shares the main checkout's name.
	wt := filepath.Join(home, "wt")
	write(t, filepath.Join(repo, ".git", "worktrees", "wt", "commondir"), "../..\n")
	write(t, filepath.Join(wt, ".git"), "gitdir: "+filepath.Join(repo, ".git", "worktrees", "wt")+"\n")

	cases := map[string]string{
		home:                          "",
		"":                            "",
		repo:                          "repo",
		sub:                           "repo",
		wt:                            "repo",
		filepath.Join(home, "notgit"): "notgit",
	}
	for cwd, want := range cases {
		if got := ProjectName(pi, home, cwd); got != want {
			t.Errorf("ProjectName(%q) = %q, want %q", cwd, got, want)
		}
	}
	// A store under the folder's own name, from before, still wins.
	os.MkdirAll(filepath.Join(ProjectsRoot(pi), "web"), 0o755)
	if got := ProjectName(pi, home, sub); got != "web" {
		t.Errorf("legacy store: %q", got)
	}
}
