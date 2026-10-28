package launch

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func fixedID() string { return "new-id" }

func TestBuild(t *testing.T) {
	cases := []struct {
		name    string
		req     Request
		argv    []string
		session string
	}{
		{"new", Request{Cwd: "/w", Prompt: "hi", Model: "anthropic/claude-x", Effort: "off"},
			[]string{"pi", "-p", "--session-id", "new-id", "--model", "anthropic/claude-x", "--thinking", "off", "--", "hi"}, "new-id"},
		{"continue, defaults", Request{Session: "abc", Cwd: "/w", Prompt: "-x"},
			[]string{"pi", "-p", "--session", "abc", "--", "-x"}, "abc"},
		{"skill passed as is", Request{Session: "abc", Cwd: "/w", Prompt: "/skill:wiki go"},
			[]string{"pi", "-p", "--session", "abc", "--", "/skill:wiki go"}, "abc"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := Build(tc.req, fixedID)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(p.Argv, tc.argv) {
				t.Errorf("argv\n got %q\nwant %q", p.Argv, tc.argv)
			}
			if p.Session != tc.session {
				t.Errorf("session %q, want %q", p.Session, tc.session)
			}
		})
	}
}

func TestBuildCommandLine(t *testing.T) {
	p, err := Build(Request{Cwd: "/my work", Prompt: "it's"}, fixedID)
	if err != nil {
		t.Fatal(err)
	}
	want := `cd '/my work' && pi -p --session-id new-id -- 'it'\''s'`
	if p.Command != want {
		t.Errorf("command\n got %s\nwant %s", p.Command, want)
	}
}

func TestBuildRejects(t *testing.T) {
	for name, req := range map[string]Request{
		"empty prompt":       {Prompt: "  \n"},
		"flag as model":      {Prompt: "x", Model: "--api-key"},
		"spaces in model":    {Prompt: "x", Model: "a b"},
		"unknown effort":     {Prompt: "x", Effort: "ludicrous"},
		"flag as effort":     {Prompt: "x", Effort: "-x"},
		"path as session":    {Prompt: "x", Session: "../etc"},
		"flag as session":    {Prompt: "x", Session: "-r"},
		"NUL in the prompt":  {Prompt: "a\x00b"},
		"prompt over limits": {Prompt: strings.Repeat("x", MaxPrompt+1)},
	} {
		if _, err := Build(req, fixedID); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

func write(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func inserts(cmds []Command) []string {
	var out []string
	for _, c := range cmds {
		out = append(out, c.Insert+"|"+c.Source)
	}
	return out
}

func TestCommands(t *testing.T) {
	root := t.TempDir()
	d := Dirs{Home: root, Pi: filepath.Join(root, ".pi")}
	cwd := filepath.Join(root, "proj")
	write(t, filepath.Join(d.Pi, "agent", "prompts", "commit.md"), "---\ndescription: Create commits\n---\nbody")
	write(t, filepath.Join(d.Pi, "agent", "prompts", "nested", "deep.md"), "body")
	write(t, filepath.Join(d.Pi, "agent", "skills", "wiki", "SKILL.md"), "---\nname: llm-wiki\ndescription: >\n  Keep the\n  wiki\n---\n")
	write(t, filepath.Join(d.Pi, "agent", "skills", "hidden", "SKILL.md"), "---\nname: hidden\nuser-invocable: false\n---\n")
	write(t, filepath.Join(d.Pi, "agent", "skills", "nofile", "README.md"), "")
	write(t, filepath.Join(root, ".agents", "skills", "pdf", "SKILL.md"), "---\nname: pdf\n---\n")
	write(t, filepath.Join(cwd, ".pi", "prompts", "commit.md"), "---\ndescription: Project commit\n---\n")
	write(t, filepath.Join(cwd, ".agents", "skills", "lint", "SKILL.md"), "---\nname: lint\n---\n")
	// A symlinked prompts folder is followed.
	write(t, filepath.Join(root, "shared", "review.md"), "Review")
	if err := os.Symlink(filepath.Join(root, "shared"), filepath.Join(cwd, ".pi", "prompts-link")); err != nil {
		t.Fatal(err)
	}

	cmds := Commands(cwd, d)
	want := []string{"/commit|project", "/skill:lint|project", "/skill:llm-wiki|user", "/skill:pdf|user"}
	if got := inserts(cmds); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q\nwant %q", got, want)
	}
	if cmds[0].Description != "Project commit" || cmds[2].Description != "Keep the wiki" || cmds[2].Kind != "skill" {
		t.Errorf("descriptions/kinds: %+v", cmds)
	}
	if got := inserts(templates(filepath.Join(cwd, ".pi", "prompts-link"), "/", "project")); !reflect.DeepEqual(got, []string{"/review|project"}) {
		t.Errorf("symlinked folder: %q", got)
	}
	if got := inserts(Commands("", d)); !reflect.DeepEqual(got, []string{"/commit|user", "/skill:llm-wiki|user", "/skill:pdf|user"}) {
		t.Errorf("no folder: %q", got)
	}
}

func TestParseModels(t *testing.T) {
	models := parseModels([]byte("provider  model  context  max-out  thinking  images\nanthropic claude-x 200K 64K yes yes\nlocal tiny 8K 4K no no\n"))
	if len(models) != 2 || models[0].ID != "anthropic/claude-x" || models[0].Efforts != nil || models[1].Efforts == nil {
		t.Errorf("%+v", models)
	}
}
