// SPDX-License-Identifier: AGPL-3.0-or-later
// DMRHub - Run a DMR network server in a single binary
// Copyright (C) 2023-2026 Jacob McSwain
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
//
// The source code is available at <https://github.com/USA-RedDragon/DMRHub>

package apimodels_test

import (
	"encoding/json"
	"testing"

	"github.com/USA-RedDragon/DMRHub/internal/config"
	"github.com/USA-RedDragon/DMRHub/internal/http/api/apimodels"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPOSTConfigReadsTheSecrets decodes a config request with every secret,
// as the Setup page sends a secret that an admin types. Each one replaces
// the running value, and the other settings of its section stay.
func TestPOSTConfigReadsTheSecrets(t *testing.T) {
	t.Parallel()
	body := `{"secret":"s","password-salt":"p","hibp-api-key":"h",` +
		`"smtp":{"host":"mail.example.com","password":"smtp"},` +
		`"database":{"host":"db","password":"database"},` +
		`"redis":{"host":"redis","password":"redis"}}`
	var req apimodels.POSTConfig
	require.NoError(t, json.Unmarshal([]byte(body), &req))

	running := config.Config{Secret: "old", PasswordSalt: "old", HIBPAPIKey: "old"}
	running.SMTP.Password = "old"
	running.Database.Password = "old"
	running.Redis.Password = "old"
	var got config.Config
	req.ToConfig(&got, &running)

	assert.Equal(t, "s", got.Secret)
	assert.Equal(t, "p", got.PasswordSalt)
	assert.Equal(t, "h", got.HIBPAPIKey)
	assert.Equal(t, "smtp", got.SMTP.Password)
	assert.Equal(t, "database", got.Database.Password)
	assert.Equal(t, "redis", got.Redis.Password)
	assert.Equal(t, "mail.example.com", got.SMTP.Host)
	assert.Equal(t, "db", got.Database.Host)
	assert.Equal(t, "redis", got.Redis.Host)
}

// TestPOSTConfigKeepsTheSecretsItLacks keeps each running secret that a
// request leaves out, as the Setup page does for a secret that no one
// typed.
func TestPOSTConfigKeepsTheSecretsItLacks(t *testing.T) {
	t.Parallel()
	var req apimodels.POSTConfig
	require.NoError(t, json.Unmarshal([]byte(`{"smtp":{"host":"mail.example.com"}}`), &req))
	running := config.Config{Secret: "s", PasswordSalt: "p", HIBPAPIKey: "h"}
	running.SMTP.Password = "smtp"
	running.Database.Password = "database"
	running.Redis.Password = "redis"
	var got config.Config
	req.ToConfig(&got, &running)
	assert.Equal(t, "s", got.Secret)
	assert.Equal(t, "p", got.PasswordSalt)
	assert.Equal(t, "h", got.HIBPAPIKey)
	assert.Equal(t, "smtp", got.SMTP.Password)
	assert.Equal(t, "database", got.Database.Password)
	assert.Equal(t, "redis", got.Redis.Password)
}

// TestPOSTConfigClearsTheSecretsSetToEmpty clears each running secret that
// a request sets to an empty value, as the Setup page does for a secret
// that an admin empties.
func TestPOSTConfigClearsTheSecretsSetToEmpty(t *testing.T) {
	t.Parallel()
	body := `{"hibp-api-key":"","smtp":{"host":"mail.example.com","password":""}}`
	var req apimodels.POSTConfig
	require.NoError(t, json.Unmarshal([]byte(body), &req))
	running := config.Config{Secret: "s", HIBPAPIKey: "h"}
	running.SMTP.Password = "smtp"
	var got config.Config
	req.ToConfig(&got, &running)
	assert.Empty(t, got.HIBPAPIKey)
	assert.Empty(t, got.SMTP.Password)
	assert.Equal(t, "s", got.Secret, "a secret that the request lacks stays")
}

func TestPOSTConfigSetsPasswords(t *testing.T) {
	t.Parallel()
	body := `{
		"database": {"driver": "postgres", "host": "db", "password": "dbpass"},
		"redis": {"enabled": true, "host": "kv", "password": "kvpass"},
		"smtp": {"enabled": true, "host": "mail", "password": "mailpass"}
	}`
	var req apimodels.POSTConfig
	require.NoError(t, json.Unmarshal([]byte(body), &req))
	var cfg config.Config
	req.ToConfig(&cfg, &config.Config{})
	assert.Equal(t, "postgres", string(cfg.Database.Driver))
	assert.Equal(t, "db", cfg.Database.Host)
	assert.Equal(t, "dbpass", cfg.Database.Password)
	assert.True(t, cfg.Redis.Enabled)
	assert.Equal(t, "kv", cfg.Redis.Host)
	assert.Equal(t, "kvpass", cfg.Redis.Password)
	assert.True(t, cfg.SMTP.Enabled)
	assert.Equal(t, "mail", cfg.SMTP.Host)
	assert.Equal(t, "mailpass", cfg.SMTP.Password)
}

func TestPOSTConfigKeepsPasswords(t *testing.T) {
	t.Parallel()
	body := `{"database": {"driver": "postgres", "host": "db"}, "redis": {"host": "kv"}, "smtp": {"host": "mail"}}`
	var req apimodels.POSTConfig
	require.NoError(t, json.Unmarshal([]byte(body), &req))
	current := &config.Config{}
	current.Database.Password = "olddb"
	current.Redis.Password = "oldkv"
	current.SMTP.Password = "oldmail"
	var cfg config.Config
	req.ToConfig(&cfg, current)
	assert.Equal(t, "db", cfg.Database.Host)
	assert.Equal(t, "olddb", cfg.Database.Password)
	assert.Equal(t, "oldkv", cfg.Redis.Password)
	assert.Equal(t, "oldmail", cfg.SMTP.Password)
}

func TestPOSTConfigHandlesUpstreamPasswords(t *testing.T) {
	t.Parallel()
	body := `{"dmr":{"upstreams":{"enabled":true,"networks":[{"name":"BM"},{"name":"DMR+"}]}},` +
		`"upstreams":{"passwords":["typed",""]}}`
	var req apimodels.POSTConfig
	require.NoError(t, json.Unmarshal([]byte(body), &req))

	current := &config.Config{}
	current.DMR.Upstreams.Enabled = true
	current.DMR.Upstreams.Networks = []config.UpstreamNetwork{
		{Name: "BM", Password: "saved-bm"},
		{Name: "DMR+", Password: "saved-dmr"},
	}
	var cfg config.Config
	req.ToConfig(&cfg, current)

	require.Len(t, cfg.DMR.Upstreams.Networks, 2)
	assert.Equal(t, "typed", cfg.DMR.Upstreams.Networks[0].Password, "a typed password replaces the saved one")
	assert.Equal(t, "saved-dmr", cfg.DMR.Upstreams.Networks[1].Password, "a blank password keeps the saved one")
}

func TestPOSTConfigKeepsUpstreamPasswordsItLacks(t *testing.T) {
	t.Parallel()
	body := `{"dmr":{"upstreams":{"enabled":true,"networks":[{"name":"BM"},{"name":"DMR+"}]}}}`
	var req apimodels.POSTConfig
	require.NoError(t, json.Unmarshal([]byte(body), &req))

	current := &config.Config{}
	current.DMR.Upstreams.Networks = []config.UpstreamNetwork{
		{Name: "BM", Password: "saved-bm"},
		{Name: "DMR+", Password: "saved-dmr"},
	}
	var cfg config.Config
	req.ToConfig(&cfg, current)

	require.Len(t, cfg.DMR.Upstreams.Networks, 2)
	assert.Equal(t, "saved-bm", cfg.DMR.Upstreams.Networks[0].Password)
	assert.Equal(t, "saved-dmr", cfg.DMR.Upstreams.Networks[1].Password)
}
