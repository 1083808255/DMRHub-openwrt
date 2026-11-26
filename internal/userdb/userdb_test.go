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

package userdb

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/USA-RedDragon/DMRHub/internal/dmrdb"
	"github.com/USA-RedDragon/DMRHub/internal/testutils/dbtest"
	"github.com/USA-RedDragon/DMRHub/internal/testutils/retry"
	"github.com/puzpuzpuz/xsync/v4"
)

func TestUserdb(t *testing.T) {
	t.Parallel()
	if Len() == 0 {
		t.Error("dmrUsers is empty")
	}
	// Check for an obviously wrong number of IDs.
	// As of writing this test, there are 232,772 IDs in the database
	if Len() < 231290 {
		t.Errorf("dmrUsers is missing users, found %d users", Len())
	}
}

func firstEmbeddedUser(t testing.TB) DMRUser {
	t.Helper()
	user, err := decodeUser(dbtest.FirstEntry(t, compressedDMRUsersDB, "users"))
	if err != nil || user.ID == 0 || user.Callsign == "" {
		t.Fatalf("cannot decode the first embedded user: %+v %v", user, err)
	}
	return user
}

func TestUserdbValidUser(t *testing.T) {
	t.Parallel()
	first := firstEmbeddedUser(t)
	if !ValidUserCallsign(first.ID, first.Callsign) {
		t.Errorf("%s is not in the database", first.Callsign)
	}
	if !ValidUserCallsign(first.ID, strings.ToLower(first.Callsign)) {
		t.Errorf("%s in lower case is not in the database", first.Callsign)
	}
	got, ok := Get(first.ID)
	if !ok {
		t.Fatalf("%d is not in the database", first.ID)
	}
	if got.ID != first.ID {
		t.Errorf("%s has the wrong ID. Expected %d, got %d", first.Callsign, first.ID, got.ID)
	}
	if !strings.EqualFold(got.Callsign, first.Callsign) {
		t.Errorf("%d has the wrong callsign. Expected %q, got %q", first.ID, first.Callsign, got.Callsign)
	}
}

func TestUserdbInvalidUser(t *testing.T) {
	t.Parallel()
	// DMR User IDs are 7 digits.
	if IsValidUserID(10000000) {
		t.Error("10000000 is not a valid user ID")
	}
	// 6 digits
	if IsValidUserID(999999) {
		t.Error("999999 is not a valid user ID")
	}
	// 5 digits
	if IsValidUserID(99999) {
		t.Error("99999 is not a valid user ID")
	}
	// 4 digits
	if IsValidUserID(9999) {
		t.Error("9999 is not a valid user ID")
	}
	// 3 digits
	if IsValidUserID(999) {
		t.Error("999 is not a valid user ID")
	}
	// 2 digits
	if IsValidUserID(99) {
		t.Error("99 is not a valid user ID")
	}
	// 1 digit
	if IsValidUserID(9) {
		t.Error("9 is not a valid user ID")
	}
	// 0 digits
	if IsValidUserID(0) {
		t.Error("0 is not a valid user ID")
	}
	if !IsValidUserID(3002068) {
		t.Error("Valid user ID marked invalid")
	}
}

// newFixtureDB returns a user database, separate from the package one, seeded with the old-format fixture.
func newFixtureDB(t *testing.T) *dmrdb.DB[DMRUser] {
	t.Helper()
	db := newDB(dbtest.Compress(t, readFixture(t, "users-old.json")), builtInDateStr)
	if err := db.UnpackDB(); err != nil {
		t.Fatalf("UnpackDB failed: %v", err)
	}
	return db
}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}
	return data
}

func TestUpdateFromEmbeddedDB(t *testing.T) {
	t.Parallel()
	srv := dbtest.NewServer(t, 0, dbtest.Decompress(t, compressedDMRUsersDB))
	db := newFixtureDB(t)
	if err := db.Update(srv.URL); err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if db.Len() != Len() {
		t.Errorf("Update loaded %d users, UnpackDB loaded %d", db.Len(), Len())
	}
	first := firstEmbeddedUser(t)
	user, ok := db.Get(first.ID)
	if !ok || !strings.EqualFold(user.Callsign, first.Callsign) {
		t.Errorf("unexpected user %d: %+v", first.ID, user)
	}
}

func TestUpdateFixtures(t *testing.T) {
	t.Parallel()
	for _, fixture := range []string{"users-current.json", "users-old.json"} {
		t.Run(fixture, func(t *testing.T) {
			t.Parallel()
			srv := dbtest.NewServer(t, 0, readFixture(t, fixture))
			db := newFixtureDB(t)
			if err := db.Update(srv.URL); err != nil {
				t.Fatalf("Update failed: %v", err)
			}
			if db.Len() != 2 {
				t.Errorf("expected 2 users, got %d", db.Len())
			}
			want := DMRUser{
				ID:       3002207,
				RadioID:  3002207,
				Name:     "Pat Example",
				FName:    "Pat Example",
				Callsign: "K9CALL",
				City:     "Anytown",
				State:    "Ontario",
				Country:  "Canada",
			}
			if user, _ := db.Get(3002207); user != want {
				t.Errorf("expected %+v, got %+v", want, user)
			}
			date, err := db.GetDate()
			if err != nil || date.Equal(db.GetBuiltInDate()) {
				t.Errorf("Update did not move the database date: %v %v", date, err)
			}
		})
	}
}

func TestUpdateFailures(t *testing.T) {
	t.Parallel()
	current := string(readFixture(t, "users-current.json"))
	tests := []struct {
		name string
		url  func(t *testing.T) string
	}{
		{"server error", func(t *testing.T) string { return dbtest.NewServer(t, 1, []byte(current)).URL }},
		{"truncated body", func(t *testing.T) string { return dbtest.NewTruncatedServer(t, []byte(current)) }},
		{"id becomes a string", func(t *testing.T) string {
			return dbtest.NewServer(t, 0, []byte(strings.Replace(current, `"id": 3002207`, `"id": "3002207"`, 1))).URL
		}},
		{"id renamed", func(t *testing.T) string {
			return dbtest.NewServer(t, 0, []byte(strings.ReplaceAll(current, `"id": `, `"user_id": `))).URL
		}},
		{"callsign becomes an array", func(t *testing.T) string {
			return dbtest.NewServer(t, 0, []byte(strings.Replace(current, `"callsign": "K9CALL"`, `"callsign": ["K9CALL"]`, 1))).URL
		}},
		{"users becomes an object", func(t *testing.T) string {
			return dbtest.NewServer(t, 0, []byte(`{"users": {"3002207": {"id": 3002207}}}`)).URL
		}},
		{"no users", func(t *testing.T) string { return dbtest.NewServer(t, 0, []byte(`{"users": []}`)).URL }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			db := newFixtureDB(t)
			err := db.Update(tt.url(t))
			if !errors.Is(err, dmrdb.ErrUpdateFailed) {
				t.Fatalf("expected ErrUpdateFailed, got %v", err)
			}
			if db.Len() != 2 {
				t.Errorf("failed update replaced the database, it now has %d users", db.Len())
			}
			if _, ok := db.Get(3002068); !ok {
				t.Error("failed update dropped user 3002068")
			}
		})
	}
}

func TestUpdateIgnoresNewFields(t *testing.T) {
	t.Parallel()
	data := `{"users": [{"id": 3002068, "callsign": "N0CALL", "flags": {"validated": [1, 2]}, "radio_id": 3002068}]}`
	srv := dbtest.NewServer(t, 0, []byte(data))
	db := newFixtureDB(t)
	if err := db.Update(srv.URL); err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if user, ok := db.Get(3002068); !ok || user.Callsign != "N0CALL" || user.RadioID != 3002068 {
		t.Errorf("unexpected user 3002068: %+v", user)
	}
}

func TestUpdateMergedSecondary(t *testing.T) {
	t.Parallel()
	primary := dbtest.NewServer(t, 0, readFixture(t, "users-current.json"))
	secondary := dbtest.NewServer(t, 0, []byte("1002010;BH8GDV;BH8GDV;???;???;China;????;\n3002207;N0EXTRA;Extra;X;Y;Z;\n"))
	db := newFixtureDB(t)
	if err := db.Update(primary.URL); err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if err := db.UpdateMerge(secondary.URL); err != nil {
		t.Fatalf("UpdateMerge failed: %v", err)
	}
	if db.Len() != 3 {
		t.Errorf("expected 3 users, got %d", db.Len())
	}
	// The primary source wins for IDs it already contains.
	if user, ok := db.Get(3002207); !ok || user.Callsign != "K9CALL" {
		t.Errorf("primary source did not win for 3002207: %+v", user)
	}
	want := DMRUser{
		ID:       1002010,
		RadioID:  1002010,
		Callsign: "BH8GDV",
		Name:     "BH8GDV",
		FName:    "BH8GDV",
		City:     "???",
		State:    "???",
		Country:  "China",
	}
	if user, ok := db.Get(1002010); !ok || user != want {
		t.Errorf("expected %+v, got %+v", want, user)
	}
}

func TestUpdateMergedSecondaryFailure(t *testing.T) {
	t.Parallel()
	primary := dbtest.NewServer(t, 0, readFixture(t, "users-current.json"))
	secondary := dbtest.NewServer(t, 1, nil)
	db := newFixtureDB(t)
	if err := db.Update(primary.URL); err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if err := db.UpdateMerge(secondary.URL); err == nil {
		t.Fatal("expected UpdateMerge to fail on a broken supplement server")
	}
	if db.Len() != 2 {
		t.Errorf("expected 2 users, got %d", db.Len())
	}
}

func TestUpdateRetriesWithBackoff(t *testing.T) {
	t.Parallel()
	srv := dbtest.NewServer(t, 2, readFixture(t, "users-current.json"))
	db := newFixtureDB(t)
	var delays []time.Duration
	backoff := retry.Backoff{
		Attempts: 5,
		Initial:  time.Second,
		Max:      4 * time.Second,
		Sleep:    func(d time.Duration) { delays = append(delays, d) },
	}
	ok := backoff.Run(t, func(r *retry.R) {
		if err := db.Update(srv.URL); err != nil {
			r.Errorf("Update failed: %v", err)
		}
	})
	if !ok {
		t.Fatal("Update never succeeded")
	}
	if srv.Hits() != 3 {
		t.Errorf("expected 3 requests, got %d", srv.Hits())
	}
	if want := []time.Duration{time.Second, 2 * time.Second}; !slices.Equal(delays, want) {
		t.Errorf("expected delays %v, got %v", want, delays)
	}
}

func BenchmarkUserDB(b *testing.B) {
	for i := 0; i < b.N; i++ {
		err := UnpackDB()
		if err != nil {
			b.Errorf("Error unpacking database: %v", err)
			b.Fail()
		}
		userDB.ResetForBenchmark()
	}
}

func BenchmarkUserSearch(b *testing.B) {
	// The first run will decompress the database, so we'll do that first
	b.StopTimer()
	err := UnpackDB()
	if err != nil {
		b.Errorf("Error unpacking database: %v", err)
		b.Fail()
	}
	first := firstEmbeddedUser(b)
	b.StartTimer()
	for i := 0; i < b.N; i++ {
		ValidUserCallsign(first.ID, first.Callsign)
	}
}

func TestDecodeUsersDat(t *testing.T) {
	t.Parallel()
	data := []byte("460999;BG8BRG;BG8BRG;;重庆市;China;;\n" +
		"4612447;BH8GLN;BH8GLN;市辖区;重庆市;China;渝北区;\n" +
		"\n" +
		"8666666;Mastra;MASTRA;市辖区;重庆市;China;渝中区;\n")
	m := xsync.NewMap[uint, DMRUser]()
	count, err := decodeUsersDat(data, m)
	if err != nil {
		t.Fatalf("decodeUsersDat failed: %v", err)
	}
	if count != 3 {
		t.Fatalf("expected 3 users, got %d", count)
	}
	user, ok := m.Load(4612447)
	if !ok {
		t.Fatal("user 4612447 not found")
	}
	if user.Callsign != "BH8GLN" {
		t.Errorf("unexpected callsign %q", user.Callsign)
	}
	if user.Country != "China" || user.State != "重庆市" || user.City != "市辖区" {
		t.Errorf("unexpected location fields: %+v", user)
	}
	if user.Name != "BH8GLN" {
		t.Errorf("unexpected name %q", user.Name)
	}
}

func TestDecodeUsersDatErrors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		data string
	}{
		{"too few fields", "460999;BG8BRG;BG8BRG\n"},
		{"id not a number", "abc;BG8BRG;BG8BRG;;city;China;\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			m := xsync.NewMap[uint, DMRUser]()
			if _, err := decodeUsersDat([]byte(tt.data), m); err == nil {
				t.Errorf("expected an error for %q", tt.data)
			}
		})
	}
}

func TestUpdateAcceptsDatFormat(t *testing.T) {
	t.Parallel()
	db := newDB(dbtest.Compress(t, readFixture(t, "users-old.json")), builtInDateStr)
	if err := db.UnpackDB(); err != nil {
		t.Fatalf("UnpackDB failed: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("460999;BG8BRG;BG8BRG;;重庆市;China;;\n4612447;BH8GLN;BH8GLN;市辖区;重庆市;China;渝北区;\n"))
	}))
	defer srv.Close()
	if err := db.Update(srv.URL); err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	user, ok := db.Get(4612447)
	if !ok {
		t.Fatal("user 4612447 not loaded from the dat dump")
	}
	if user.Callsign != "BH8GLN" {
		t.Errorf("unexpected callsign %q", user.Callsign)
	}
	if db.Len() != 2 {
		t.Errorf("expected 2 users after the update, got %d", db.Len())
	}
}

func TestUpdateMergeFillsGaps(t *testing.T) {
	t.Parallel()
	db := newDB(dbtest.Compress(t, readFixture(t, "users-old.json")), builtInDateStr)
	if err := db.UnpackDB(); err != nil {
		t.Fatalf("UnpackDB failed: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("460999;BG8BRG;BG8BRG;;重庆市;China;;\n3002207;WRONG;WRONG;;city;China;\n"))
	}))
	defer srv.Close()
	if err := db.UpdateMerge(srv.URL); err != nil {
		t.Fatalf("UpdateMerge failed: %v", err)
	}
	user, ok := db.Get(460999)
	if !ok {
		t.Fatal("the merge did not add the new id 460999")
	}
	if user.Callsign != "BG8BRG" {
		t.Errorf("unexpected callsign %q", user.Callsign)
	}
	kept, ok := db.Get(3002207)
	if !ok {
		t.Fatal("the merge lost the existing id 3002207")
	}
	if kept.Callsign == "WRONG" {
		t.Error("the merge overwrote an existing entry, it must only fill gaps")
	}
}
