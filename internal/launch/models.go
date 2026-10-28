package launch

import (
	"bufio"
	"bytes"
	"context"
	"strings"
)

// Model is a model pi offers, as a suggestion for the settings.
type Model struct {
	ID string `json:"id"`
	// Efforts: what this model supports; nil: every thinking level.
	Efforts []string `json:"efforts"`
}

// Runner runs a CLI and returns its standard output.
type Runner func(ctx context.Context, argv ...string) ([]byte, error)

// Models lists the models pi offers (pi --list-models).
func Models(ctx context.Context, run Runner) ([]Model, error) {
	out, err := run(ctx, CLI, "--list-models")
	if err != nil {
		return nil, err
	}
	return parseModels(out), nil
}

// pi --list-models: a table "provider model context max-out thinking images".
func parseModels(out []byte) []Model {
	var models []Model
	sc := bufio.NewScanner(bytes.NewReader(out))
	header := true
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if header {
			header = len(f) == 0 || f[0] != "provider"
			continue
		}
		if len(f) < 5 {
			continue
		}
		m := Model{ID: f[0] + "/" + f[1]}
		if f[4] != "yes" {
			m.Efforts = []string{}
		}
		models = append(models, m)
	}
	return models
}
