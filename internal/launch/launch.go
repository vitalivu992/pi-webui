// Package launch builds the command lines that send a prompt to pi without
// its interactive UI (pi -p): in a new conversation or continuing one. The
// browser only sends structured settings (model, thinking level); the argv is
// always built here, so the preview the settings show is exactly what runs.
package launch

import (
	"crypto/rand"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// CLI is the pi executable.
const CLI = "pi"

// Efforts: the thinking levels pi accepts (--thinking). A model may support
// none (see Model.Efforts).
var Efforts = []string{"off", "minimal", "low", "medium", "high", "xhigh", "max"}

// Request is one prompt to send.
type Request struct {
	// Session: the conversation to continue; "" starts a new one.
	Session string `json:"session"`
	Cwd     string `json:"cwd"`
	Prompt  string `json:"prompt"`
	// Model, Effort: "" leaves pi's default.
	Model  string `json:"model"`
	Effort string `json:"effort"`
}

// Plan is the command for a Request.
type Plan struct {
	Argv []string `json:"argv"`
	Cwd  string   `json:"cwd"`
	// Session: the conversation id — the continued one, or the id a new one
	// is created with (--session-id).
	Session string `json:"session"`
	// Command: the argv as one POSIX shell line (cd included), for display.
	Command string `json:"command"`
}

var (
	// Model ids: "anthropic/claude-opus-5-5", "openai/gpt-6:high", "sonnet".
	modelRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@+\[\]-]{0,127}$`)
	idRe    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
)

// MaxPrompt is the longest prompt accepted (it goes on the command line).
const MaxPrompt = 100_000

// Build checks the request and returns its command. pi expands its own
// prompt templates and /skill: commands, so the prompt is passed as is.
// `newID` makes the id of a new conversation (nil: random UUIDs).
func Build(req Request, newID func() string) (Plan, error) {
	if strings.TrimSpace(req.Prompt) == "" {
		return Plan{}, errors.New("the prompt is empty")
	}
	if len(req.Prompt) > MaxPrompt {
		return Plan{}, fmt.Errorf("the prompt is longer than %d bytes", MaxPrompt)
	}
	if strings.ContainsRune(req.Prompt, 0) {
		return Plan{}, errors.New("the prompt contains a NUL byte")
	}
	if req.Model != "" && !modelRe.MatchString(req.Model) {
		return Plan{}, fmt.Errorf("invalid model %q", req.Model)
	}
	if req.Effort != "" && !slices.Contains(Efforts, req.Effort) {
		return Plan{}, fmt.Errorf("pi has no thinking level %q", req.Effort)
	}
	if req.Session != "" && (!idRe.MatchString(req.Session) || strings.Contains(req.Session, "..")) {
		return Plan{}, fmt.Errorf("invalid session id %q", req.Session)
	}
	if newID == nil {
		newID = NewUUID
	}

	p := Plan{Cwd: req.Cwd, Session: req.Session}
	a := []string{CLI, "-p"}
	if req.Session != "" {
		a = append(a, "--session", req.Session)
	} else {
		p.Session = newID()
		a = append(a, "--session-id", p.Session)
	}
	a = appendIf(a, "--model", req.Model)
	a = appendIf(a, "--thinking", req.Effort)
	a = append(a, "--", req.Prompt)
	p.Argv = a
	p.Command = ShellLine(p.Cwd, a)
	return p, nil
}

func appendIf(a []string, flag, value string) []string {
	if value == "" {
		return a
	}
	return append(a, flag, value)
}

// NewUUID is a random (version 4) UUID.
func NewUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

var safeArg = regexp.MustCompile(`^[A-Za-z0-9_./:@%+=,-]+$`)

// Quote is POSIX shell quoting: bare when safe, else single quotes.
func Quote(s string) string {
	if s != "" && safeArg.MatchString(s) {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// ShellLine is `cd <cwd> && <argv>` with every word quoted.
func ShellLine(cwd string, argv []string) string {
	words := make([]string, len(argv))
	for i, a := range argv {
		words[i] = Quote(a)
	}
	line := strings.Join(words, " ")
	if cwd != "" {
		line = "cd " + Quote(cwd) + " && " + line
	}
	return line
}
