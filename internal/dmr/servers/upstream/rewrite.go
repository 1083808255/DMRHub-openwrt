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
	"github.com/USA-RedDragon/DMRHub/internal/config"
)

// rewriteTable is the DMRGateway-style talkgroup map between this hub and
// the upstream networks. It is built once from the configuration and is
// read-only afterwards.
type rewriteTable struct {
	// outbound maps a local talkgroup to the destinations it is sent to.
	// A rule with an empty network matches every network.
	outbound map[uint][]rewriteTarget
	// inbound maps a network name and upstream talkgroup to the local
	// talkgroup it arrives on.
	inbound map[inboundKey]uint
	// inboundAny holds rules with an empty network, keyed by upstream TG.
	inboundAny map[uint]uint
	// localTGs is the set of local talkgroups that must be subscribed to
	// on the hub packet bus to catch outbound traffic.
	localTGs map[uint]struct{}
	// private is whether any enabled network takes private calls and text
	// messages. A rule that maps no talkgroup cannot carry them, so this
	// is set from the networks alone.
	private bool
}

type rewriteTarget struct {
	network string
	tg      uint
}

type inboundKey struct {
	network string
	tg      uint
}

// buildRewriteTable compiles the configured rewrite rules. Rules that
// reference an unknown or disabled network are ignored. Invalid rules
// (zero talkgroups) are ignored too.
func buildRewriteTable(cfg *config.Upstreams, active map[string]struct{}) *rewriteTable {
	t := &rewriteTable{
		outbound:   make(map[uint][]rewriteTarget),
		inbound:    make(map[inboundKey]uint),
		inboundAny: make(map[uint]uint),
		localTGs:   make(map[uint]struct{}),
	}
	if cfg == nil {
		return t
	}
	t.private = len(active) > 0
	for _, r := range cfg.Rewrites {
		if r.LocalTG == 0 || r.UpstreamTG == 0 {
			continue
		}
		if r.Network != "" {
			if _, ok := active[r.Network]; !ok {
				continue
			}
		}
		t.localTGs[r.LocalTG] = struct{}{}
		t.outbound[r.LocalTG] = append(t.outbound[r.LocalTG], rewriteTarget{network: r.Network, tg: r.UpstreamTG})
		if r.Network == "" {
			t.inboundAny[r.UpstreamTG] = r.LocalTG
		} else {
			t.inbound[inboundKey{network: r.Network, tg: r.UpstreamTG}] = r.LocalTG
		}
	}
	return t
}

// outboundTargets returns the upstream destinations for a local talkgroup.
func (t *rewriteTable) outboundTargets(localTG uint) []rewriteTarget {
	return t.outbound[localTG]
}

// inboundLocal returns the local talkgroup for a packet that came from
// network on upstreamTG. ok is false when no rule matches.
func (t *rewriteTable) inboundLocal(network string, upstreamTG uint) (uint, bool) {
	if tg, ok := t.inbound[inboundKey{network: network, tg: upstreamTG}]; ok {
		return tg, true
	}
	tg, ok := t.inboundAny[upstreamTG]
	return tg, ok
}

// subscribedLocal returns all local talkgroups the hub must subscribe to on
// its packet bus.
func (t *rewriteTable) subscribedLocal() []uint {
	out := make([]uint, 0, len(t.localTGs))
	for tg := range t.localTGs {
		out = append(out, tg)
	}
	return out
}
