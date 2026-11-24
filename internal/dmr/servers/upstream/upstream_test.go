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

package upstream

import (
	"testing"
	"time"

	"github.com/USA-RedDragon/DMRHub/internal/config"
	"github.com/USA-RedDragon/DMRHub/internal/db/models"
	"github.com/USA-RedDragon/dmrgo/v2/enums"
	"github.com/USA-RedDragon/dmrgo/v2/transport/dmrd"
	dmrdsession "github.com/USA-RedDragon/dmrgo/v2/transport/dmrd/dmrdsession"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHostOf(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{
		"master.brandmeister.network":         "master.brandmeister.network",
		"https://dmr.wakepc.cn":               "dmr.wakepc.cn",
		"http://dmr.wakepc.cn/":               "dmr.wakepc.cn",
		"https://dmr.wakepc.cn:62031":         "dmr.wakepc.cn",
		"  master.brandmeister.network  ":     "master.brandmeister.network",
		"dmr.example.org:62031":               "dmr.example.org",
		"[2001:db8::1]:62031":                 "2001:db8::1",
		"https://user:pw@dmr.example.org/path": "dmr.example.org",
	} {
		got, err := hostOf(in)
		require.NoError(t, err, in)
		assert.Equal(t, want, got, in)
	}
	for _, bad := range []string{"", "   ", "https://"} {
		_, err := hostOf(bad)
		assert.Error(t, err, bad)
	}
}

func TestBuildRewriteTable(t *testing.T) {
	cfg := &config.Upstreams{
		Enabled: true,
		Rewrites: []config.UpstreamRewrite{
			{Network: "BM", LocalTG: 91, UpstreamTG: 91},
			{Network: "BM", LocalTG: 310, UpstreamTG: 3101},
			{Network: "DMRPlus", LocalTG: 91, UpstreamTG: 91},
			{Network: "Off", LocalTG: 8, UpstreamTG: 8},
			{Network: "", LocalTG: 9, UpstreamTG: 9},
			{Network: "BM", LocalTG: 0, UpstreamTG: 7},
		},
	}
	active := map[string]struct{}{"BM": {}, "DMRPlus": {}}
	table := buildRewriteTable(cfg, active)

	bm := table.outboundTargets(91)
	require.Len(t, bm, 2, "local TG 91 goes to two networks")
	assert.Equal(t, rewriteTarget{network: "BM", tg: 91}, bm[0])
	assert.Equal(t, rewriteTarget{network: "DMRPlus", tg: 91}, bm[1])
	assert.Equal(t, []rewriteTarget{{network: "BM", tg: 3101}}, table.outboundTargets(310))
	assert.Equal(t, []rewriteTarget{{network: "", tg: 9}}, table.outboundTargets(9))
	assert.Empty(t, table.outboundTargets(8), "a rule for a disabled network is ignored")
	assert.Empty(t, table.outboundTargets(7), "a rule with a zero local TG is ignored")

	tg, ok := table.inboundLocal("BM", 3101)
	require.True(t, ok)
	assert.Equal(t, uint(310), tg)
	tg, ok = table.inboundLocal("DMRPlus", 3101)
	require.False(t, ok, "the BM rewrite does not apply to DMRPlus")
	assert.Equal(t, uint(0), tg)
	tg, ok = table.inboundLocal("BM", 9)
	require.True(t, ok, "a rule with no network applies to every network")
	assert.Equal(t, uint(9), tg)

	subs := table.subscribedLocal()
	assert.ElementsMatch(t, []uint{91, 310, 9}, subs)
}

func TestBuildRewriteTableNil(t *testing.T) {
	table := buildRewriteTable(nil, nil)
	assert.Empty(t, table.outboundTargets(1))
	_, ok := table.inboundLocal("BM", 1)
	assert.False(t, ok)
	assert.False(t, table.private, "no network takes private calls")
}

// TestPrivateCallsFollowTheEnabledNetworks checks that a private call goes
// to the networks that are on, even when no rewrite rule exists: a private
// call names a radio, not a talkgroup.
func TestPrivateCallsFollowTheEnabledNetworks(t *testing.T) {
	t.Parallel()
	cfg := &config.Upstreams{Enabled: true, Networks: []config.UpstreamNetwork{{Name: "BM", Enabled: true}}}
	assert.True(t, buildRewriteTable(cfg, map[string]struct{}{"BM": {}}).private)
	assert.False(t, buildRewriteTable(cfg, nil).private, "a gateway with no network carries no private call")
	assert.False(t, buildRewriteTable(nil, nil).private)
}

func TestLoopbackGuard(t *testing.T) {
	now := time.Unix(1000, 0)
	g := newLoopbackGuard(func() time.Time { return now })
	p := models.Packet{Src: 1234567, StreamID: 42, Slot: true, Dst: 91}

	assert.False(t, g.holds("BM", p))
	g.note("BM", p)
	assert.True(t, g.holds("BM", p), "the stream is remembered for its source network")
	assert.False(t, g.holds("DMRPlus", p), "it may still go to another network")

	other := p
	other.Dst = 92
	assert.False(t, g.holds("BM", other), "a different talkgroup is a different stream")

	now = now.Add(guardTTL - time.Second)
	assert.True(t, g.holds("BM", p))
	now = now.Add(2 * time.Second)
	assert.False(t, g.holds("BM", p), "the guard forgets streams after its TTL")
}

func TestLoopbackGuardPrune(t *testing.T) {
	now := time.Unix(1000, 0)
	g := newLoopbackGuard(func() time.Time { return now })
	for i := range guardMaxStreams + 2 {
		g.note("BM", models.Packet{Src: uint(i + 1), StreamID: 42, Dst: 91})
	}
	now = now.Add(guardTTL + time.Second)
	g.note("BM", models.Packet{Src: 99999, StreamID: 42, Dst: 91})
	g.mu.Lock()
	defer g.mu.Unlock()
	assert.LessOrEqual(t, len(g.streams), guardMaxStreams, "old streams are pruned")
}

func TestBuildRPTCAndNewPeer(t *testing.T) {
	n := &config.UpstreamNetwork{
		Name:        "BM",
		ID:          1234567,
		Password:    "secret",
		Callsign:    "DMRHUB",
		RXFrequency: 438800000,
		TXFrequency: 438800000,
		ColorCode:   1,
		Slots:       3,
		Options:     "TS2=91",
	}
	raw, err := buildRPTC(dmrd.DialectMMDVM, n)
	require.NoError(t, err)
	require.Len(t, raw, 302)

	c, err := dmrd.MMDVMConfigOf(raw)
	require.NoError(t, err)
	assert.Equal(t, n.ID, c.ID())
	assert.Equal(t, []byte("DMRHUB"), c.Callsign())
	rx, err := c.RXFrequency()
	require.NoError(t, err)
	assert.Equal(t, n.RXFrequency, rx)
	cc, err := c.ColorCode()
	require.NoError(t, err)
	assert.Equal(t, enums.ColorCode(1), cc)
	slots, err := c.Slots()
	require.NoError(t, err)
	assert.Equal(t, uint8(3), slots)

	peer, err := dmrdsession.NewPeer(&dmrdsession.PeerConfig{
		Dialect:  dmrd.DialectMMDVM,
		ID:       n.ID,
		Password: []byte(n.Password),
		Config:   raw,
		Options:  []byte(n.Options),
	})
	require.NoError(t, err, "the generated RPTC must be accepted by the peer state machine")
	assert.NotNil(t, peer)

	hbrp, err := buildRPTC(dmrd.DialectHBRP, n)
	require.NoError(t, err)
	require.Len(t, hbrp, 306)
	_, err = dmrdsession.NewPeer(&dmrdsession.PeerConfig{
		Dialect: dmrd.DialectHBRP,
		ID:      n.ID,
		Config:  hbrp,
	})
	require.NoError(t, err, "the generated HBRP config must be accepted too")
}
