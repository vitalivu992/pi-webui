package pi

import (
	"testing"

	"pi-webui/internal/conv"
)

func TestParseFile(t *testing.T) {
	c, err := ParseFile("testdata/session.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if c.ID != "pi-1" || c.Cwd != "/work/app" || c.Title != "Readme check" {
		t.Fatalf("summary = %+v", c.Summary)
	}
	// Only the branch ending at the last entry: u1/a1 were rewound.
	if len(c.Entries) != 3 {
		for _, e := range c.Entries {
			t.Logf("%s %q %q", e.Kind, e.Prompt, e.Text)
		}
		t.Fatalf("entries = %d, want 3", len(c.Entries))
	}
	first := c.Entries[0]
	if first.Prompt != "read the readme" || first.Status != conv.StatusDone || first.Final != "It's called **App**." || first.Model != "gpt-5.6-luna" {
		t.Fatalf("first = %+v", first)
	}
	if len(first.Steps) != 2 || first.Steps[1].Tool != "read" || first.Steps[1].Output != "# App" || first.Steps[1].OutputAt != "2026-10-20T10:01:03.000Z" {
		t.Fatalf("steps = %+v", first.Steps)
	}
	if first.Effort != "high" || first.Tokens == nil || first.Tokens.Input != 2800 || first.Tokens.Output != 650 ||
		first.Tokens.CacheRead != 25000 || first.Tokens.CacheWrite != 100 || first.Tokens.Reasoning != 70 ||
		first.Tokens.Total != 28620 || first.Tokens.Cost != 0.003 {
		t.Fatalf("first tokens = %+v, effort = %q", first.Tokens, first.Effort)
	}
	if ev := c.Entries[1]; ev.Kind != conv.EntryEvent || ev.Text != "! ls" || ev.Detail != "README.md" {
		t.Fatalf("bash event = %+v", ev)
	}
	if last := c.Entries[2]; last.Status != conv.StatusError || last.Error != "Invalid API key" || last.Tokens != nil {
		t.Fatalf("error turn = %+v", last)
	}
	if c.Tokens == nil || c.Tokens.Total != 28620 || c.Tokens.Cost != 0.003 {
		t.Fatalf("summary tokens = %+v", c.Tokens)
	}
	if c.StartedAt != "2026-10-20T10:00:00.000Z" || c.UpdatedAt != "2026-10-20T10:03:02.000Z" {
		t.Fatalf("started/updated = %s/%s", c.StartedAt, c.UpdatedAt)
	}
}

func TestReadHeader(t *testing.T) {
	h, err := ReadHeader("testdata/session.jsonl")
	if err != nil || h.ID != "pi-1" || h.Cwd != "/work/app" {
		t.Fatalf("header = %+v, %v", h, err)
	}
}
