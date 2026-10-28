package catalog

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

const piSession = `{"type":"session","id":%q,"timestamp":"2026-10-20T10:00:00Z","cwd":%q}
{"type":"message","id":"u1","parentId":null,"timestamp":"2026-10-20T10:00:01Z","message":{"role":"user","content":[{"type":"text","text":"hello pi"}]}}
{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-10-20T10:00:02Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"}],"stopReason":"stop"}}
`

// A home with one project (my_app) holding two sessions plus an empty one, a
// session whose folder was deleted, one without a cwd, and a file that isn't
// a session.
func setup(t *testing.T) (*Catalog, string) {
	t.Helper()
	root := t.TempDir()
	project := filepath.Join(root, "work", "my_app")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	piDir := filepath.Join(root, ".pi")
	sessions := filepath.Join(piDir, "agent", "sessions")
	write(t, filepath.Join(sessions, "--app--", "2026_p1.jsonl"), fmt.Sprintf(piSession, "p1", project))
	write(t, filepath.Join(sessions, "--app--", "2026_p2.jsonl"), fmt.Sprintf(piSession, "p2", project))
	write(t, filepath.Join(sessions, "--app--", "2026_empty.jsonl"),
		fmt.Sprintf(`{"type":"session","id":"empty","timestamp":"2026-10-20T10:00:00Z","cwd":%q}`+"\n", project))
	write(t, filepath.Join(sessions, "--gone--", "2026_p3.jsonl"), fmt.Sprintf(piSession, "p3", filepath.Join(root, "work", "old-repo")))
	write(t, filepath.Join(sessions, "--none--", "2026_p4.jsonl"), fmt.Sprintf(piSession, "p4", ""))
	write(t, filepath.Join(sessions, "--app--", "notes.jsonl"), `{"type":"note"}`+"\n")
	return New(Config{PiDir: piDir, ActiveWindow: time.Minute}), project
}

func sessionPath(project, id string) string {
	return filepath.Join(filepath.Dir(filepath.Dir(project)), ".pi", "agent", "sessions", "--app--", "2026_"+id+".jsonl")
}

func TestProjects(t *testing.T) {
	c, project := setup(t)
	projects := c.Projects()
	if len(projects) != 3 {
		t.Fatalf("projects = %+v", projects)
	}
	byKey := map[string]Project{}
	for _, p := range projects {
		byKey[p.Key] = p
	}
	// The empty session counts here (listing doesn't parse); the list hides it.
	if mine := byKey[project]; mine.Name != "my_app" || !mine.Exists || mine.Count != 3 {
		t.Fatalf("my_app = %+v", mine)
	}
	gone := filepath.Join(filepath.Dir(project), "old-repo")
	if p := byKey[gone]; p.Exists || p.Name != "old-repo" || p.Count != 1 {
		t.Fatalf("deleted project = %+v", p)
	}
	if p := byKey[NoWorkspaceKey]; p.Name != "No workspace" || p.Path != "" || p.Count != 1 {
		t.Fatalf("no workspace = %+v", p)
	}
}

func TestProjectsRunning(t *testing.T) {
	c, project := setup(t)
	counts := func() (running, finished int) {
		for _, p := range c.Projects() {
			if p.Key == project {
				return p.Running, p.Finished
			}
		}
		t.Fatal("project not listed")
		return 0, 0
	}
	before, finished := counts()
	if finished == 0 {
		t.Fatal("finished = 0, want the freshly written conversations counted as just finished")
	}

	// A prompt the agent hasn't answered yet: p1 is now running.
	f, err := os.OpenFile(sessionPath(project, "p1"), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Fprintln(f, `{"type":"message","id":"u2","parentId":"a1","timestamp":"2026-10-20T10:01:00Z","message":{"role":"user","content":[{"type":"text","text":"more"}]}}`)
	f.Close()
	if r, f := counts(); r != before+1 || f != finished-1 {
		t.Fatalf("running, finished = %d, %d after an unanswered prompt, want %d, %d", r, f, before+1, finished-1)
	}

	// Once the active window passes nothing counts as running or finished.
	c.now = func() time.Time { return time.Now().Add(time.Hour) }
	if r, f := counts(); r != 0 || f != 0 {
		t.Fatalf("running, finished = %d, %d after the active window, want 0, 0", r, f)
	}
}

func TestConversations(t *testing.T) {
	c, project := setup(t)
	sums, err := c.Conversations(project)
	if err != nil {
		t.Fatal(err)
	}
	if len(sums) != 2 {
		t.Fatalf("conversations = %d, want 2 (the empty session is hidden)", len(sums))
	}
	for _, s := range sums {
		if s.Cwd != project || s.ProjectPath != project || s.Title != "hello pi" || !s.Active {
			t.Errorf("%s = %+v", s.ID, s)
		}
	}
	none, err := c.Conversations(NoWorkspaceKey)
	if err != nil || len(none) != 1 || none[0].Cwd != "" || none[0].ProjectPath != "" {
		t.Fatalf("no-workspace = %+v, %v", none, err)
	}
	if _, err := c.Conversations("/nope"); err != ErrNotFound {
		t.Fatalf("unknown project err = %v", err)
	}
}

func TestConversation(t *testing.T) {
	c, project := setup(t)
	full, err := c.Conversation("p1")
	if err != nil {
		t.Fatal(err)
	}
	if full.ProjectPath != project || len(full.Entries) != 1 || full.Entries[0].Final != "hi" {
		t.Fatalf("p1 = %+v", full)
	}
	for _, id := range []string{"../p1", "..", "missing", "", "notes"} {
		if _, err := c.Conversation(id); err != ErrNotFound {
			t.Errorf("Conversation(%q) err = %v", id, err)
		}
	}
}

func TestConversationIfChanged(t *testing.T) {
	c, project := setup(t)
	full, v1, err := c.ConversationIfChanged("p1", "")
	if err != nil || full == nil || v1 == "" {
		t.Fatalf("first read = %v, %q, %v", full, v1, err)
	}
	if full, v, err := c.ConversationIfChanged("p1", v1); err != nil || full != nil || v != v1 {
		t.Fatalf("unchanged = %v, %q, %v; want nil, %q", full, v, err, v1)
	}

	// A live session appends a turn: a new version and the new entry.
	f, err := os.OpenFile(sessionPath(project, "p1"), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Fprintln(f, `{"type":"message","id":"u2","parentId":"a1","timestamp":"2026-10-20T10:01:00Z","message":{"role":"user","content":[{"type":"text","text":"more"}]}}`)
	f.Close()
	full, v2, err := c.ConversationIfChanged("p1", v1)
	if err != nil || full == nil || v2 == v1 || full.Turns != 2 || !full.Active {
		t.Fatalf("after append = %+v, %q, %v", full, v2, err)
	}

	// The active window passing changes the version too, so a poller sees active go false.
	c.now = func() time.Time { return time.Now().Add(time.Hour) }
	full, v3, err := c.ConversationIfChanged("p1", v2)
	if err != nil || full == nil || v3 == v2 || full.Active {
		t.Fatalf("after the active window = %+v, %q, %v", full, v3, err)
	}
}
