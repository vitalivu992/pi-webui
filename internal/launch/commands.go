package launch

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Dirs says where pi keeps its user-level prompt templates and skills.
type Dirs struct {
	Home string // ~ (for ~/.agents/skills)
	Pi   string // ~/.pi
}

// Command is a prompt template or skill the prompt box offers.
type Command struct {
	Name string `json:"name"`
	// Insert is what the prompt starts with to use it: "/review", "/skill:llm-wiki".
	Insert      string `json:"insert"`
	Kind        string `json:"kind"` // "skill" or "command"
	Description string `json:"description,omitempty"`
	Source      string `json:"source"` // "user" or "project"
	Path        string `json:"-"`
}

// Commands lists pi's prompt templates (/name) and skills (/skill:name) for a
// folder, project ones first (they win over a user one with the same name),
// then by name. pi expands both itself in -p mode.
func Commands(cwd string, d Dirs) []Command {
	var out []Command
	add := func(cmds ...Command) { out = append(out, cmds...) }
	proj := func(rel string) string {
		if cwd == "" {
			return ""
		}
		return filepath.Join(cwd, rel)
	}
	add(templates(proj(".pi/prompts"), "/", "project")...)
	add(skills(proj(".pi/skills"), "/skill:", "project")...)
	add(skills(proj(".agents/skills"), "/skill:", "project")...)
	add(templates(filepath.Join(d.Pi, "agent", "prompts"), "/", "user")...)
	add(skills(filepath.Join(d.Pi, "agent", "skills"), "/skill:", "user")...)
	if d.Home != "" {
		add(skills(filepath.Join(d.Home, ".agents", "skills"), "/skill:", "user")...)
	}

	seen := map[string]bool{}
	kept := out[:0]
	for _, c := range out {
		if !seen[c.Insert] {
			seen[c.Insert] = true
			kept = append(kept, c)
		}
	}
	sort.SliceStable(kept, func(i, j int) bool { return kept[i].Name < kept[j].Name })
	return kept
}

// templates: the markdown prompt files directly in dir. Names starting with
// "-" are skipped: they would read as flags.
func templates(dir, prefix, source string) []Command {
	if dir == "" {
		return nil
	}
	// WalkDir doesn't follow a symlinked folder.
	if real, err := filepath.EvalSymlinks(dir); err == nil {
		dir = real
	}
	var out []Command
	filepath.WalkDir(dir, func(path string, e fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if e.IsDir() {
			if path != dir {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(e.Name(), ".md") {
			return nil
		}
		name := strings.TrimSuffix(e.Name(), ".md")
		if !validName(name) {
			return nil
		}
		meta, _ := frontmatter(path)
		out = append(out, Command{Name: name, Insert: prefix + name, Kind: "command", Description: meta["description"],
			Source: source, Path: path})
		return nil
	})
	return out
}

// skills: <dir>/<name>/SKILL.md; the frontmatter name wins over the folder's.
// Skills marked `user-invocable: false` aren't offered.
func skills(dir, prefix, source string) []Command {
	if dir == "" {
		return nil
	}
	entries, _ := os.ReadDir(dir)
	var out []Command
	for _, e := range entries {
		path := filepath.Join(dir, e.Name(), "SKILL.md")
		meta, ok := frontmatter(path)
		if !ok || meta["user-invocable"] == "false" {
			continue
		}
		name := meta["name"]
		if name == "" {
			name = e.Name()
		}
		if !validName(name) {
			continue
		}
		out = append(out, Command{Name: name, Insert: prefix + name, Kind: "skill", Description: meta["description"],
			Source: source, Path: path})
	}
	return out
}

func validName(name string) bool {
	return name != "" && len(name) <= 128 && !strings.HasPrefix(name, "-") &&
		!strings.ContainsAny(name, " \t\r\n\x00")
}

// frontmatter reads the `key: value` lines of a markdown file's leading
// --- block (folded `>` / `|` values joined into one line). ok: the file exists.
func frontmatter(path string) (map[string]string, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	meta := map[string]string{}
	head, found := cutFrontmatter(string(b))
	if !found {
		return meta, true
	}
	lines := strings.Split(head, "\n")
	for i := 0; i < len(lines); i++ {
		key, value, ok := strings.Cut(lines[i], ":")
		if !ok || key == "" || key[0] == ' ' || key[0] == '\t' {
			continue
		}
		value = strings.TrimSpace(value)
		if value == ">" || value == "|" || value == ">-" || value == "|-" {
			var parts []string
			for i+1 < len(lines) && (strings.HasPrefix(lines[i+1], " ") || strings.HasPrefix(lines[i+1], "\t")) {
				i++
				parts = append(parts, strings.TrimSpace(lines[i]))
			}
			value = strings.Join(parts, " ")
		}
		meta[strings.TrimSpace(key)] = strings.Trim(value, `"'`)
	}
	return meta, true
}

// cutFrontmatter returns <head> of "---\n<head>\n---\n<body>".
func cutFrontmatter(s string) (head string, found bool) {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	if !strings.HasPrefix(s, "---\n") {
		return "", false
	}
	rest := s[4:]
	if i := strings.Index(rest, "\n---"); i >= 0 {
		return rest[:i], true
	}
	return "", false
}
