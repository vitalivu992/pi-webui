package setup

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func write(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o755); err != nil {
		t.Fatal(err)
	}
}

// fakePi writes a pi-coding-agent package at dir whose API answers like pi's.
func fakePi(t *testing.T, dir string) {
	write(t, filepath.Join(dir, "package.json"), `{"name":"@earendil-works/pi-coding-agent","version":"9.9.9"}`)
	write(t, filepath.Join(dir, "dist", "index.js"), `
export const SettingsManager = { create: (cwd, agentDir) => ({ cwd, agentDir }) }
export class DefaultPackageManager {
  constructor(o) { this.o = o }
  async resolve(onMissing) {
    if ((await onMissing("npm:missing")) !== "skip") throw new Error("would install")
    const a = this.o.agentDir, pkg = a + "/npm/node_modules/tools"
    const p = { source: "npm:tools", scope: "user", origin: "package", packageRoot: pkg, baseDir: pkg }
    return {
      extensions: [
        { path: pkg + "/index.ts", enabled: true, metadata: p },
        { path: a + "/extensions/guard.ts", enabled: false, metadata: { source: "auto", scope: "user", origin: "top-level" } },
        ...this.o.builtinExtensions.map((n) => ({ path: "builtin:" + n, enabled: true, metadata: { source: "builtin", scope: "user", origin: "top-level" } })),
      ],
      skills: [{ path: pkg + "/skills", enabled: true, metadata: p }],
      prompts: [{ path: this.o.cwd + "/.pi/prompts/ship.md", enabled: true, metadata: { source: "auto", scope: "project", origin: "top-level" } }],
      themes: [],
      installFailures: [{ source: "npm:missing", scope: "user", message: "offline" }],
    }
  }
  listConfiguredPackages() {
    return [{ source: "npm:tools", scope: "user", filtered: false, installedPath: this.o.agentDir + "/npm/node_modules/tools" }]
  }
}
export function loadSkills(o) {
  return { skills: o.skillPaths.map((p) => ({ name: "plan", description: "Plan it", filePath: p + "/plan/SKILL.md", disableModelInvocation: true })) }
}
`)
	write(t, filepath.Join(dir, "dist", "core", "prompt-templates.js"), `
export function loadPromptTemplates(o) {
  return { templates: o.promptPaths.map((p) => ({ name: "ship", description: "", filePath: p })) }
}
`)
	write(t, filepath.Join(dir, "dist", "extensions", "index.js"), `export const builtInExtensions = [{ name: "mcp" }]`)
}

func TestPiPackage(t *testing.T) {
	root := t.TempDir()
	// pi's installer: a launcher script picking the current release.
	agent := filepath.Join(root, ".pi", "agent")
	write(t, filepath.Join(agent, "bin", "pi"), "#!/bin/sh\n")
	write(t, filepath.Join(agent, "install", "current-version"), "1.5.0\n")
	managed := filepath.Join(agent, "install", "releases", "1.5.0", "node_modules", "@earendil-works", "pi-coding-agent")
	fakePi(t, managed)
	if got := PiPackage(filepath.Join(agent, "bin", "pi")); got != managed {
		t.Errorf("managed: %q", got)
	}
	// npm: bin/pi links into the package.
	npm := filepath.Join(root, "lib", "node_modules", "@earendil-works", "pi-coding-agent")
	fakePi(t, npm)
	write(t, filepath.Join(npm, "dist", "bundle", "cli.js"), "#!/usr/bin/env node\n")
	link := filepath.Join(root, "bin", "pi")
	os.MkdirAll(filepath.Dir(link), 0o755)
	if err := os.Symlink(filepath.Join(npm, "dist", "bundle", "cli.js"), link); err != nil {
		t.Fatal(err)
	}
	if got := PiPackage(link); got != npm {
		t.Errorf("npm: %q", got)
	}
	// A plain script (the e2e fake).
	write(t, filepath.Join(root, "other", "pi"), "#!/bin/sh\n")
	if got := PiPackage(filepath.Join(root, "other", "pi")); got != "" {
		t.Errorf("script: %q", got)
	}
}

func TestResolve(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node isn't installed")
	}
	home := t.TempDir()
	piDir := filepath.Join(home, ".pi")
	pkg := filepath.Join(home, "lib", "pi-coding-agent")
	fakePi(t, pkg)
	write(t, filepath.Join(pkg, "dist", "bundle", "cli.js"), "")
	tools := filepath.Join(piDir, "agent", "npm", "node_modules", "tools")
	write(t, filepath.Join(tools, "package.json"), `{"name":"tools","version":"1.2.0","description":"Handy tools","repository":{"url":"git+https://example.com/tools.git"}}`)
	write(t, filepath.Join(tools, "README.md"), "# Tools\n")
	proj := filepath.Join(home, "app")

	r := &Resolver{PiDir: piDir, Home: home, Find: func(name string) (string, []string, error) {
		if name == "node" {
			return node, os.Environ(), nil
		}
		return filepath.Join(pkg, "dist", "bundle", "cli.js"), os.Environ(), nil
	}}
	s := r.Resolve(context.Background(), proj, false)
	if s.Error != "" || s.Pi != "9.9.9" {
		t.Fatalf("setup %q %q", s.Error, s.Pi)
	}
	var got []string
	for _, it := range s.Items {
		got = append(got, strings.Join([]string{it.ID, it.Source, it.Scope, it.Package, it.Description}, "|"))
	}
	want := []string{
		"package:tools|npm:tools|user||Handy tools",
		"extension:guard|auto|user||",
		"extension:mcp|builtin|user||Built into pi",
		"extension:tools|npm:tools|user|npm:tools|Handy tools",
		"skill:plan|npm:tools|user|npm:tools|Plan it",
		"prompt:ship|auto|project||",
	}
	if !slices.Equal(got, want) {
		t.Errorf("items\n%s", strings.Join(got, "\n"))
	}
	byID := map[string]Item{}
	for _, it := range s.Items {
		byID[it.ID] = it
	}
	if p := byID["package:tools"]; p.Version != "1.2.0" || p.Homepage != "https://example.com/tools" || !p.Enabled {
		t.Errorf("package %+v", p)
	}
	if byID["extension:guard"].Enabled || !byID["skill:plan"].Manual {
		t.Errorf("flags %+v %+v", byID["extension:guard"], byID["skill:plan"])
	}
	if len(s.Failures) != 1 || s.Failures[0].Source != "npm:missing" {
		t.Errorf("failures %+v", s.Failures)
	}
	if b := Body(byID["extension:tools"]); b != "# Tools\n" {
		t.Errorf("readme %q", b)
	}
}

func TestResolveWithoutPi(t *testing.T) {
	home := t.TempDir()
	piDir := filepath.Join(home, ".pi")
	write(t, filepath.Join(piDir, "agent", "skills", "wiki", "SKILL.md"), "---\nname: wiki\n---\n")
	r := &Resolver{PiDir: piDir, Home: home}
	s := r.Resolve(context.Background(), "", false)
	if !strings.Contains(s.Error, "not found") || len(s.Items) != 1 || s.Items[0].ID != "skill:wiki" {
		t.Errorf("setup %+v", s)
	}
}

func TestFinishIDs(t *testing.T) {
	items := finish([]Item{{Kind: "prompt", Name: "a"}, {Kind: "extension", Name: "x"}, {Kind: "extension", Name: "x"}})
	var ids []string
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	if !slices.Equal(ids, []string{"extension:x", "extension:x~2", "prompt:a"}) {
		t.Errorf("ids %v", ids)
	}
}
