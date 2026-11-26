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

// Package dmrdb provides a generic, shared database type for DMR entity
// databases (users, repeaters, etc.) that are distributed as embedded
// xz-compressed JSON and can be updated via HTTP.
package dmrdb

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/puzpuzpuz/xsync/v4"
	"github.com/ulikunitz/xz"
)

var (
	ErrUpdateFailed = errors.New("update failed")
	ErrUnmarshal    = errors.New("unmarshal failed")
	ErrLoading      = errors.New("error loading database")
	ErrNoEntries    = errors.New("no entries found in database")
	ErrParsingDate  = errors.New("error parsing built-in date")
	ErrXZReader     = errors.New("error creating xz reader")
	ErrReadDB       = errors.New("error reading database")
	ErrDecodingDB   = errors.New("error decoding database")
)

type dbMetadata struct {
	Count int
	Date  time.Time
}

// StreamDecoder is a function that takes a json.Decoder and an xsync.Map and
// populates the map with decoded entries, returning the count of entries decoded.
type StreamDecoder[T any] func(dec *json.Decoder, m *xsync.Map[uint, T]) (int, error)

// RawDecoder populates the map from the raw bytes of a download. It serves
// formats that are not JSON, such as the semicolon separated dump that
// radiowo.com serves. A nil RawDecoder means the database only reads JSON.
type RawDecoder[T any] func(data []byte, m *xsync.Map[uint, T]) (int, error)

// Config holds the initialization parameters for a DB instance.
type Config[T any] struct {
	// CompressedData is the xz-compressed JSON database embedded in the binary.
	CompressedData []byte
	// BuiltInDateStr is the RFC3339 date string for when the embedded DB was built.
	BuiltInDateStr string
	// Presize is the initial capacity hint for the xsync.Map.
	Presize int
	// Decode is the streaming JSON decoder that populates the map.
	Decode StreamDecoder[T]
	// DecodeRaw is the decoder for non-JSON downloads. Optional.
	DecodeRaw RawDecoder[T]
	// EntityName is a human-readable name for log messages (e.g. "users", "repeaters").
	EntityName string
}

// DB is a generic database backed by an xsync.Map with atomic metadata,
// supporting initial unpack from an embedded xz archive and live HTTP updates.
type DB[T any] struct {
	metadata    atomic.Value // stores dbMetadata
	dataMap     *xsync.Map[uint, T]
	updatingMap *xsync.Map[uint, T]

	builtInDate time.Time
	unpackMu    sync.Mutex
	unpackErr   error
	isDone      atomic.Bool

	config Config[T]
}

// NewDB creates a new DB instance with the given configuration.
func NewDB[T any](cfg Config[T]) *DB[T] {
	return &DB[T]{
		config: cfg,
	}
}

// UnpackDB decompresses the embedded database and loads it into memory.
// It is safe for concurrent use; only the first caller performs the actual
// unpack, the others wait for it and get its result.
func (db *DB[T]) UnpackDB() error {
	db.unpackMu.Lock()
	defer db.unpackMu.Unlock()
	if db.isDone.Load() {
		return nil
	}
	if db.unpackErr != nil {
		return db.unpackErr
	}
	db.unpackErr = db.unpack()
	return db.unpackErr
}

func (db *DB[T]) unpack() error {
	updating := xsync.NewMap[uint, T](xsync.WithPresize(db.config.Presize), xsync.WithGrowOnly())

	var err error
	db.builtInDate, err = time.Parse(time.RFC3339, db.config.BuiltInDateStr)
	if err != nil {
		return ErrParsingDate
	}
	dbReader, err := xz.NewReader(bytes.NewReader(db.config.CompressedData))
	if err != nil {
		return ErrXZReader
	}

	count, err := db.config.Decode(json.NewDecoder(dbReader), updating)
	if err != nil {
		return err
	}
	if count == 0 {
		slog.Error("No entries found in database", "entity", db.config.EntityName)
		return ErrNoEntries
	}

	db.metadata.Store(dbMetadata{Count: count, Date: db.builtInDate})
	db.dataMap = updating
	db.updatingMap = xsync.NewMap[uint, T]()
	db.isDone.Store(true)
	return nil
}

func (db *DB[T]) ensureLoaded() error {
	if !db.isDone.Load() {
		return db.UnpackDB()
	}
	return nil
}

// Len returns the number of entries in the database.
func (db *DB[T]) Len() int {
	if err := db.ensureLoaded(); err != nil {
		slog.Error("Error unpacking database", "entity", db.config.EntityName, "error", err)
		return 0
	}
	meta, ok := db.metadata.Load().(dbMetadata)
	if !ok {
		slog.Error("Error loading database", "entity", db.config.EntityName)
		return 0
	}
	return meta.Count
}

// Get retrieves an entry by its DMR ID.
func (db *DB[T]) Get(id uint) (T, bool) {
	if err := db.ensureLoaded(); err != nil {
		slog.Error("Error unpacking database", "entity", db.config.EntityName, "error", err)
		var zero T
		return zero, false
	}
	return db.dataMap.Load(id)
}

// Update fetches a fresh copy of the database from the given URL
// and replaces the in-memory map.
func (db *DB[T]) Update(url string) error {
	if err := db.ensureLoaded(); err != nil {
		slog.Error("Error unpacking database", "entity", db.config.EntityName, "error", err)
		return ErrUpdateFailed
	}

	const updateTimeout = 10 * time.Minute
	ctx, cancel := context.WithTimeout(context.Background(), updateTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSpace(url), nil)
	if err != nil {
		return ErrUpdateFailed
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrUpdateFailed, err)
	}
	defer func() {
		err := resp.Body.Close()
		if err != nil {
			slog.Error("Error closing response body", "error", err)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: unexpected status %s", ErrUpdateFailed, resp.Status)
	}

	db.updatingMap = xsync.NewMap[uint, T](xsync.WithPresize(db.Len()), xsync.WithGrowOnly())
	// Sniff the body: a download that starts with '{' or '[' is JSON, anything
	// else goes to the raw decoder when the database has one, such as the
	// semicolon separated dumps that mirrors of RadioID.net serve.
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		slog.Error("Error reading database", "entity", db.config.EntityName, "error", err)
		return fmt.Errorf("%w: %w", ErrUpdateFailed, err)
	}
	trimmed := bytes.TrimLeft(body, " \t\r\n")
	count := 0
	if len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[') {
		count, err = db.config.Decode(json.NewDecoder(bytes.NewReader(body)), db.updatingMap)
	} else if db.config.DecodeRaw != nil {
		count, err = db.config.DecodeRaw(body, db.updatingMap)
	} else {
		err = fmt.Errorf("unsupported format: the body does not look like JSON")
	}
	if err != nil {
		slog.Error("Error decoding database", "entity", db.config.EntityName, "error", err)
		return fmt.Errorf("%w: %w", ErrUpdateFailed, err)
	}

	if count == 0 {
		slog.Error("No entries found in database", "entity", db.config.EntityName)
		return fmt.Errorf("%w: %w", ErrUpdateFailed, ErrNoEntries)
	}

	db.metadata.Store(dbMetadata{Count: count, Date: time.Now()})
	db.dataMap = db.updatingMap
	db.updatingMap = xsync.NewMap[uint, T]()

	slog.Info("Update complete", "entity", db.config.EntityName, "loaded", db.Len())

	return nil
}

// UpdateMerge fetches the URL and adds its entries into the database,
// keeping the entries it already holds: an ID the download lists replaces
// nothing, so a primary dump such as RadioID.net keeps its shape and a
// supplement such as the regional dump of a mirror only fills gaps.
// The metadata date moves to now either way.
func (db *DB[T]) UpdateMerge(url string) error {
	if err := db.ensureLoaded(); err != nil {
		slog.Error("Error unpacking database", "entity", db.config.EntityName, "error", err)
		return ErrUpdateFailed
	}

	const updateTimeout = 10 * time.Minute
	ctx, cancel := context.WithTimeout(context.Background(), updateTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSpace(url), nil)
	if err != nil {
		return ErrUpdateFailed
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrUpdateFailed, err)
	}
	defer func() {
		err := resp.Body.Close()
		if err != nil {
			slog.Error("Error closing response body", "error", err)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: unexpected status %s", ErrUpdateFailed, resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		slog.Error("Error reading database", "entity", db.config.EntityName, "error", err)
		return fmt.Errorf("%w: %w", ErrUpdateFailed, err)
	}

	extra := xsync.NewMap[uint, T](xsync.WithPresize(db.Len()), xsync.WithGrowOnly())
	trimmed := bytes.TrimLeft(body, " \t\r\n")
	var count int
	if len(trimmed) > 0 && (trimmed[0] == '{' || trimmed[0] == '[') {
		count, err = db.config.Decode(json.NewDecoder(bytes.NewReader(body)), extra)
	} else if db.config.DecodeRaw != nil {
		count, err = db.config.DecodeRaw(body, extra)
	} else {
		err = fmt.Errorf("unsupported format: the body does not look like JSON")
	}
	if err != nil {
		slog.Error("Error decoding database", "entity", db.config.EntityName, "error", err)
		return fmt.Errorf("%w: %w", ErrUpdateFailed, err)
	}
	if count == 0 {
		slog.Error("No entries found in database", "entity", db.config.EntityName)
		return fmt.Errorf("%w: %w", ErrUpdateFailed, ErrNoEntries)
	}

	added := 0
	extra.Range(func(id uint, v T) bool {
		if _, exists := db.dataMap.LoadOrStore(id, v); !exists {
			added++
		}
		return true
	})

	total := db.dataMap.Size()
	db.metadata.Store(dbMetadata{Count: total, Date: time.Now()})
	slog.Info("Merge complete", "entity", db.config.EntityName, "entries", count, "added", added, "total", total)
	return nil
}

// GetDate returns the date of the currently loaded database.
func (db *DB[T]) GetDate() (time.Time, error) {
	if err := db.ensureLoaded(); err != nil {
		return time.Time{}, err
	}
	meta, ok := db.metadata.Load().(dbMetadata)
	if !ok {
		slog.Error("Error loading database", "entity", db.config.EntityName)
		return time.Time{}, ErrLoading
	}
	return meta.Date, nil
}

// GetBuiltInDate returns the built-in date of the embedded database.
// This is useful for testing to verify that updates changed the date.
func (db *DB[T]) GetBuiltInDate() time.Time {
	return db.builtInDate
}

// ResetForBenchmark resets internal state so UnpackDB can be called again.
// This is intended for benchmark use only.
func (db *DB[T]) ResetForBenchmark() {
	db.unpackMu.Lock()
	defer db.unpackMu.Unlock()
	db.unpackErr = nil
	db.isDone.Store(false)
	db.metadata.Store(dbMetadata{})
}
