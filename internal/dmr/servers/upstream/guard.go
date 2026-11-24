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
	"sync"
	"time"

	"github.com/USA-RedDragon/DMRHub/internal/db/models"
)

const (
	// guardTTL is how long a stream that arrived from an upstream is
	// remembered. A voice stream lasts a few seconds; ten seconds gives
	// room for the hub to publish its bursts even on a loaded system.
	guardTTL = 10 * time.Second
	// guardMaxStreams bounds the guard's memory. When it is reached,
	// entries older than guardTTL are pruned.
	guardMaxStreams = 1024
)

// streamKey identifies one transmission on the hub's packet bus. Src,
// StreamID, Slot and Dst all survive hub routing, including codec copies.
type streamKey struct {
	src    uint
	stream uint
	slot   bool
	dst    uint
}

// loopbackGuard remembers which upstreams a stream came from. It stops the
// egress subscriber from sending a burst straight back to the network it
// just arrived from, while still letting it be forwarded to other networks
// as DMRGateway does.
type loopbackGuard struct {
	mu      sync.Mutex
	streams map[streamKey]map[string]time.Time
	now     func() time.Time
}

func newLoopbackGuard(now func() time.Time) *loopbackGuard {
	return &loopbackGuard{
		streams: make(map[streamKey]map[string]time.Time),
		now:     now,
	}
}

func keyOf(p models.Packet) streamKey {
	return streamKey{src: p.Src, stream: p.StreamID, slot: p.Slot, dst: p.Dst}
}

// note records that p reached the hub from network. It is called from the
// hub's admitted callback, so only streams the hub actually accepted are
// remembered.
func (g *loopbackGuard) note(network string, p models.Packet) {
	g.mu.Lock()
	defer g.mu.Unlock()
	k := keyOf(p)
	nets := g.streams[k]
	if nets == nil {
		nets = make(map[string]time.Time)
		g.streams[k] = nets
	}
	nets[network] = g.now()
	if len(g.streams) > guardMaxStreams {
		g.pruneLocked()
	}
}

// holds reports whether p came from network within guardTTL.
func (g *loopbackGuard) holds(network string, p models.Packet) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	nets := g.streams[keyOf(p)]
	if nets == nil {
		return false
	}
	at, ok := nets[network]
	if !ok {
		return false
	}
	return g.now().Sub(at) < guardTTL
}

// pruneLocked drops expired streams. Callers must hold g.mu.
func (g *loopbackGuard) pruneLocked() {
	cutoff := g.now().Add(-guardTTL)
	for k, nets := range g.streams {
		expired := true
		for _, at := range nets {
			if at.After(cutoff) {
				expired = false
				break
			}
		}
		if expired {
			delete(g.streams, k)
		}
	}
}
