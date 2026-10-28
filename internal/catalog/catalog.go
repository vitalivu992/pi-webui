// Package catalog finds the pi sessions under ~/.pi/agent/sessions, groups
// them by project (the directory pi ran in) and caches parsed summaries by
// file size + modification time. Everything is read-only.
package catalog

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"pi-webui/internal/conv"
	"pi-webui/internal/pi"
)

// Config says where pi keeps its data. An empty or missing location just
// means there are no conversations.
type Config struct {
	PiDir string // ~/.pi
	// ActiveWindow: a conversation updated this recently is marked active.
	ActiveWindow time.Duration
}

// DefaultConfig uses pi's standard location.
func DefaultConfig() Config {
	home, _ := os.UserHomeDir()
	return Config{
		PiDir:        filepath.Join(home, ".pi"),
		ActiveWindow: 2 * time.Minute,
	}
}

// Project is one working directory with pi sessions.
type Project struct {
	// Key identifies the project in URLs: its path, or NoWorkspaceKey.
	Key    string `json:"key"`
	Path   string `json:"path"`
	Name   string `json:"name"`
	Exists bool   `json:"exists"`
	// Count: the project's conversations.
	Count int `json:"count"`
	// Running: conversations the agent is still working on (active, last turn incomplete).
	Running int `json:"running,omitempty"`
	// Finished: active conversations whose last turn has ended (the agent just finished).
	Finished  int    `json:"finished,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// ErrNotFound is returned for an unknown project or conversation.
var ErrNotFound = errors.New("not found")

// NoWorkspaceKey is the project of sessions whose header has no cwd.
const NoWorkspaceKey = "no-workspace"

// item is one session file as found on disk, before parsing.
type item struct {
	id    string
	path  string
	key   string // project key
	size  int64
	mtime time.Time
}

type cached struct {
	size  int64
	mtime time.Time
	sum   conv.Summary
}

// header is what a session file's first line says: its id and cwd.
type header struct {
	id   string
	cwd  string
	skip bool // unreadable
}

// Catalog is safe for concurrent use.
type Catalog struct {
	cfg Config

	mu        sync.Mutex
	summaries map[string]cached // file path → summary
	heads     map[string]header // file path → id + cwd from its first line
	now       func() time.Time
}

// New returns a catalog over cfg's locations.
func New(cfg Config) *Catalog {
	if cfg.ActiveWindow == 0 {
		cfg.ActiveWindow = 2 * time.Minute
	}
	return &Catalog{
		cfg:       cfg,
		summaries: map[string]cached{},
		heads:     map[string]header{},
		now:       time.Now,
	}
}

func statFile(path string) (os.FileInfo, bool) {
	st, err := os.Stat(path)
	if err != nil || st.Size() == 0 {
		return nil, false
	}
	return st, true
}

// headerOf memoizes a file's first-line header (it never changes).
func (c *Catalog) headerOf(path string) header {
	c.mu.Lock()
	h, ok := c.heads[path]
	c.mu.Unlock()
	if ok {
		return h
	}
	hd, err := pi.ReadHeader(path)
	if err != nil {
		h = header{skip: true}
	} else {
		h = header{id: hd.ID, cwd: hd.Cwd, skip: hd.ID == ""}
	}
	c.mu.Lock()
	c.heads[path] = h
	c.mu.Unlock()
	return h
}

// items lists every session: ~/.pi/agent/sessions/--<slug>--/<time>_<id>.jsonl;
// the header line names the id and cwd.
func (c *Catalog) items() []item {
	if c.cfg.PiDir == "" {
		return nil
	}
	root := filepath.Join(c.cfg.PiDir, "agent", "sessions")
	dirs, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []item
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		files, _ := os.ReadDir(filepath.Join(root, d.Name()))
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
				continue
			}
			path := filepath.Join(root, d.Name(), f.Name())
			st, ok := statFile(path)
			if !ok {
				continue
			}
			if h := c.headerOf(path); !h.skip {
				out = append(out, item{id: h.id, path: path, key: keyForPath(h.cwd), size: st.Size(), mtime: st.ModTime()})
			}
		}
	}
	return out
}

func keyForPath(path string) string {
	if path == "" {
		return NoWorkspaceKey
	}
	return filepath.Clean(path)
}

func projectPathOf(key string) string {
	if key == NoWorkspaceKey {
		return ""
	}
	return key
}

// Projects lists every project, most recently active first.
func (c *Catalog) Projects() []Project {
	byKey := map[string]*Project{}
	latest := map[string]time.Time{}
	for _, it := range c.items() {
		p := byKey[it.key]
		if p == nil {
			p = &Project{Key: it.key}
			if it.key == NoWorkspaceKey {
				p.Name = "No workspace"
			} else {
				p.Path = it.key
				p.Name = filepath.Base(it.key)
				if st, err := os.Stat(it.key); err == nil && st.IsDir() {
					p.Exists = true
				}
			}
			byKey[it.key] = p
		}
		p.Count++
		switch c.liveState(it) {
		case liveRunning:
			p.Running++
		case liveFinished:
			p.Finished++
		}
		if it.mtime.After(latest[it.key]) {
			latest[it.key] = it.mtime
		}
	}
	projects := make([]Project, 0, len(byKey))
	for key, p := range byKey {
		if t := latest[key]; !t.IsZero() {
			p.UpdatedAt = t.UTC().Format(time.RFC3339)
		}
		projects = append(projects, *p)
	}
	sort.Slice(projects, func(i, j int) bool {
		if projects[i].UpdatedAt != projects[j].UpdatedAt {
			return projects[i].UpdatedAt > projects[j].UpdatedAt
		}
		return projects[i].Key < projects[j].Key
	})
	return projects
}

// Conversations lists a project's conversations, most recently updated first.
func (c *Catalog) Conversations(key string) ([]conv.Summary, error) {
	var items []item
	for _, it := range c.items() {
		if it.key == key {
			items = append(items, it)
		}
	}
	if len(items) == 0 {
		return nil, ErrNotFound
	}
	out := make([]conv.Summary, len(items))
	ok := make([]bool, len(items))
	var wg sync.WaitGroup
	jobs := make(chan int)
	for w := 0; w < runtime.NumCPU(); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				if sum, err := c.summary(items[i]); err == nil {
					out[i], ok[i] = sum, true
				}
			}
		}()
	}
	for i := range items {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	sums := make([]conv.Summary, 0, len(items))
	for i, s := range out {
		// Sessions with no prompt (opened and closed) are noise.
		if !ok[i] || s.Turns == 0 {
			continue
		}
		s.ProjectPath = projectPathOf(key)
		c.enrich(&s, items[i])
		sums = append(sums, s)
	}
	sort.Slice(sums, func(i, j int) bool { return sums[i].UpdatedAt > sums[j].UpdatedAt })
	return sums, nil
}

func (c *Catalog) summary(it item) (conv.Summary, error) {
	c.mu.Lock()
	hit, ok := c.summaries[it.path]
	c.mu.Unlock()
	if ok && hit.size == it.size && hit.mtime.Equal(it.mtime) {
		return hit.sum, nil
	}
	full, err := c.parse(it)
	if err != nil {
		return conv.Summary{}, err
	}
	c.mu.Lock()
	c.summaries[it.path] = cached{it.size, it.mtime, full.Summary}
	c.mu.Unlock()
	return full.Summary, nil
}

func (c *Catalog) parse(it item) (*conv.Conversation, error) {
	full, err := pi.ParseFile(it.path)
	if err != nil {
		return nil, err
	}
	full.ID = it.id
	return full, nil
}

var idRe = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

// Conversation reads one conversation in full.
func (c *Catalog) Conversation(id string) (*conv.Conversation, error) {
	full, _, err := c.ConversationIfChanged(id, "")
	return full, err
}

// ConversationIfChanged is Conversation for a view that polls a live session.
// It also returns the conversation's version, which changes when the
// session file changes or the active flag flips; when that version is still
// `known`, the conversation is nil and nothing is parsed.
func (c *Catalog) ConversationIfChanged(id, known string) (*conv.Conversation, string, error) {
	if !idRe.MatchString(id) || strings.Contains(id, "..") {
		return nil, "", ErrNotFound
	}
	for _, it := range c.items() {
		if it.id != id {
			continue
		}
		version := fmt.Sprintf("%d-%d-%t", it.size, it.mtime.UnixNano(), c.active(it))
		if version == known {
			return nil, version, nil
		}
		full, err := c.parse(it)
		if err != nil {
			return nil, "", err
		}
		full.ProjectPath = projectPathOf(it.key)
		c.enrich(&full.Summary, it)
		return full, version, nil
	}
	return nil, "", ErrNotFound
}

func (c *Catalog) active(it item) bool { return c.now().Sub(it.mtime) < c.cfg.ActiveWindow }

type liveStatus int

const (
	liveNone     liveStatus = iota
	liveRunning             // the agent is still on the conversation's last turn
	liveFinished            // active, but the last turn has ended
)

// liveState: whether the agent is working on an active conversation or has
// just finished. Only active items are summarized, so listing projects parses
// at most the few live ones.
func (c *Catalog) liveState(it item) liveStatus {
	if !c.active(it) {
		return liveNone
	}
	sum, err := c.summary(it)
	switch {
	case err != nil || sum.Turns == 0:
		return liveNone
	case sum.Status == conv.StatusIncomplete:
		return liveRunning
	default:
		return liveFinished
	}
}

// enrich adds what isn't in the session itself: the active flag, and the
// project directory as cwd when the header has none.
func (c *Catalog) enrich(s *conv.Summary, it item) {
	s.Active = c.active(it)
	if s.Cwd == "" {
		s.Cwd = s.ProjectPath
	}
}
