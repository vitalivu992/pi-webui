// Package setup lists what pi loads in a folder: its packages and the
// extensions, skills, prompt templates and themes they and pi's own folders
// and settings bring. pi's package manager answers (resolve.mjs, run with the
// node next to pi; nothing is installed, no extension runs); when that can't
// run, the skills and prompts in pi's folders are scanned instead.
package setup

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"pi-webui/internal/launch"
)

//go:embed resolve.mjs
var script string

// Item is one thing in pi's setup.
type Item struct {
	ID          string `json:"id"`   // kind:name, unique in a Setup
	Kind        string `json:"kind"` // package, extension, skill, prompt, theme
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	// Source is where pi found it: "auto" (pi's folders), "local" (a path in
	// the settings), "builtin", a package source ("npm:agents-cron"), "memory"
	// (saved by pi-hermes-memory).
	Source  string `json:"source"`
	Scope   string `json:"scope"`             // user or project
	Package string `json:"package,omitempty"` // the package source it ships in
	Path    string `json:"path,omitempty"`
	// Root is the folder holding the extension's package.json (its README).
	Root    string `json:"root,omitempty"`
	Enabled bool   `json:"enabled"` // packages: installed
	// Manual: a skill with disable-model-invocation, used only as /skill:name.
	Manual   bool   `json:"manual,omitempty"`
	Version  string `json:"version,omitempty"`
	Homepage string `json:"homepage,omitempty"`
	Filtered bool   `json:"filtered,omitempty"` // a package with resource filters in the settings
}

// Failure is a configured package pi couldn't install.
type Failure struct {
	Source  string `json:"source"`
	Scope   string `json:"scope"`
	Message string `json:"message"`
}

// Setup is the answer for one folder.
type Setup struct {
	Pi string `json:"pi,omitempty"` // pi's version, when its package manager answered
	// Error says why pi's package manager didn't answer (Items are then a scan).
	Error    string    `json:"error,omitempty"`
	Items    []Item    `json:"items"`
	Failures []Failure `json:"failures,omitempty"`
}

// Resolver answers, caching each folder's answer for a little while (node
// takes about a second).
type Resolver struct {
	PiDir string // ~/.pi
	Home  string
	// Find looks up a CLI like the prompt runs do: its absolute path and the environment to run it in.
	Find func(name string) (exe string, env []string, err error)

	mu    sync.Mutex
	cache map[string]cached
}

type cached struct {
	at    time.Time
	setup Setup
}

const ttl = 30 * time.Second

// Resolve lists the setup for cwd ("" = home); fresh skips the cache.
func (r *Resolver) Resolve(ctx context.Context, cwd string, fresh bool) Setup {
	if cwd == "" {
		cwd = r.Home
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.cache[cwd]; ok && !fresh && time.Since(c.at) < ttl {
		return c.setup
	}
	s, err := r.ask(ctx, cwd)
	if err != nil {
		s = Setup{Error: err.Error(), Items: r.scan(cwd)}
	}
	s.Items = finish(s.Items)
	if r.cache == nil {
		r.cache = map[string]cached{}
	}
	r.cache[cwd] = cached{time.Now(), s}
	return s
}

// ask runs resolve.mjs with pi's package.
func (r *Resolver) ask(ctx context.Context, cwd string) (Setup, error) {
	if r.Find == nil {
		return Setup{}, fmt.Errorf("pi isn't installed (not found on PATH)")
	}
	pi, env, err := r.Find("pi")
	if err != nil {
		return Setup{}, fmt.Errorf("pi isn't installed (not found on PATH)")
	}
	pkg := PiPackage(pi)
	if pkg == "" {
		return Setup{}, fmt.Errorf("pi's package wasn't found from %s", pi)
	}
	node := r.node()
	if node == "" {
		return Setup{}, fmt.Errorf("node wasn't found on PATH")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	// Absolute: PI_DIR may be relative, and node runs in it.
	piDir, _ := filepath.Abs(r.PiDir)
	node, _ = filepath.Abs(node)
	cmd := exec.CommandContext(ctx, node, "--input-type=module", "-e", script, pkg, filepath.Join(piDir, "agent"), cwd)
	// Offline: a package that isn't installed is skipped, not fetched.
	cmd.Env = append(env, "PI_OFFLINE=1")
	cmd.Dir = piDir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if msg := errorLine(stderr.String()); msg != "" {
			return Setup{}, fmt.Errorf("pi's package manager failed: %s", msg)
		}
		return Setup{}, fmt.Errorf("pi's package manager failed: %v", err)
	}
	var res struct {
		Version  string    `json:"version"`
		Packages []Item    `json:"packages"`
		Items    []Item    `json:"items"`
		Failures []Failure `json:"failures"`
	}
	if err := json.Unmarshal(out, &res); err != nil {
		return Setup{}, fmt.Errorf("pi's package manager answered %v", err)
	}
	for i := range res.Packages {
		res.Packages[i].Kind = "package"
	}
	return Setup{Pi: res.Version, Items: append(res.Packages, res.Items...), Failures: res.Failures}, nil
}

// node: the one pi's installer keeps for pi, else the one on PATH.
func (r *Resolver) node() string {
	data := os.Getenv("XDG_DATA_HOME")
	if data == "" {
		data = filepath.Join(r.Home, ".local", "share")
	}
	if exe := filepath.Join(data, "pi-node", "current", "bin", "node"); isFile(exe) {
		return exe
	}
	exe, _, err := r.Find("node")
	if err != nil {
		return ""
	}
	return exe
}

// PiPackage is the folder of pi's npm package (@earendil-works/pi-coding-agent)
// behind the pi executable, "" when it isn't one.
func PiPackage(exe string) string {
	real, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return ""
	}
	// pi's installer: <agent>/bin/pi is a launcher for install/releases/<current-version>.
	agent := filepath.Dir(filepath.Dir(real))
	if b, err := os.ReadFile(filepath.Join(agent, "install", "current-version")); err == nil {
		v := strings.TrimSpace(string(b))
		dir := filepath.Join(agent, "install", "releases", v, "node_modules", "@earendil-works", "pi-coding-agent")
		if v != "" && v == filepath.Base(v) && v != ".." && isPiPackage(dir) {
			return dir
		}
	}
	// npm, pnpm: bin/pi links to <package>/dist/bundle/cli.js.
	dir := filepath.Dir(real)
	for range 5 {
		if isPiPackage(dir) {
			return dir
		}
		dir = filepath.Dir(dir)
	}
	return ""
}

func isPiPackage(dir string) bool {
	b, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return false
	}
	var pkg struct{ Name string }
	return json.Unmarshal(b, &pkg) == nil && strings.HasSuffix(pkg.Name, "/pi-coding-agent") &&
		isFile(filepath.Join(dir, "dist", "index.js"))
}

// scan: the skills and prompt templates in pi's folders.
func (r *Resolver) scan(cwd string) []Item {
	dirs := launch.Dirs{Home: r.Home, Pi: r.PiDir}
	var out []Item
	for _, s := range launch.Skills(cwd, dirs) {
		out = append(out, Item{Kind: "skill", Name: s.Name, Description: s.Description, Source: "auto", Scope: s.Source, Path: s.Path, Enabled: true})
	}
	for _, c := range launch.Commands(cwd, dirs) {
		if c.Kind == "command" {
			out = append(out, Item{Kind: "prompt", Name: c.Name, Description: c.Description, Source: "auto", Scope: c.Source, Path: c.Path, Enabled: true})
		}
	}
	return out
}

var kinds = map[string]int{"package": 0, "extension": 1, "skill": 2, "prompt": 3, "theme": 4}

// finish sorts by kind, then name, and sets unique ids.
func finish(items []Item) []Item {
	if items == nil {
		items = []Item{}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if kinds[items[i].Kind] != kinds[items[j].Kind] {
			return kinds[items[i].Kind] < kinds[items[j].Kind]
		}
		return items[i].Name < items[j].Name
	})
	seen := map[string]int{}
	for i := range items {
		id := items[i].Kind + ":" + items[i].Name
		if n := seen[id]; n > 0 {
			items[i].ID = fmt.Sprintf("%s~%d", id, n+1)
		} else {
			items[i].ID = id
		}
		seen[id]++
	}
	return items
}

// Add appends skills to a setup's items, skipping names it already has.
func (s *Setup) Add(skills []launch.Skill, source, pkg string) {
	// A copy: the cached setup shares the slice.
	s.Items = append([]Item(nil), s.Items...)
	have := map[string]bool{}
	for _, it := range s.Items {
		if it.Kind == "skill" {
			have[it.Name] = true
		}
	}
	for _, sk := range skills {
		if !have[sk.Name] {
			have[sk.Name] = true
			s.Items = append(s.Items, Item{Kind: "skill", Name: sk.Name, Description: sk.Description, Source: source, Scope: sk.Source,
				Package: pkg, Path: sk.Path, Enabled: true})
		}
	}
	s.Items = finish(s.Items)
}

// Body is what the item's view shows: a skill's or prompt's markdown after its
// frontmatter, a package's or extension's README ("" when there is none).
func Body(it Item) string {
	switch it.Kind {
	case "skill", "prompt":
		body, _ := launch.SkillBody(it.Path)
		return body
	case "package":
		return readme(it.Path)
	case "extension":
		return readme(it.Root)
	}
	return ""
}

const maxReadme = 256 << 10

func readme(dir string) string {
	if dir == "" {
		return ""
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if !e.IsDir() && strings.EqualFold(e.Name(), "README.md") {
			f, err := os.Open(filepath.Join(dir, e.Name()))
			if err != nil {
				return ""
			}
			defer f.Close()
			b, _ := io.ReadAll(io.LimitReader(f, maxReadme))
			return string(b)
		}
	}
	return ""
}

func isFile(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

// errorLine: node's last "…Error: …" line, else its last line.
func errorLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.Contains(lines[i], "Error:") {
			return strings.TrimSpace(lines[i])
		}
	}
	return strings.TrimSpace(lines[len(lines)-1])
}
