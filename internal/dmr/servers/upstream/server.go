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

// Package upstream links DMRHub to upstream DMR networks (BrandMeister,
// DMR+, TGIF, FreeDMR, ...) the way DMRGateway does: each network is an
// outbound client connection that logs in as a repeater, and a DMRGateway
// style rewrite table maps talkgroups between this hub and the upstreams.
package upstream

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/USA-RedDragon/DMRHub/internal/clock"
	"github.com/USA-RedDragon/DMRHub/internal/config"
	"github.com/USA-RedDragon/DMRHub/internal/db/models"
	"github.com/USA-RedDragon/DMRHub/internal/dmr/dmrconst"
	"github.com/USA-RedDragon/DMRHub/internal/dmr/hub"
	"github.com/USA-RedDragon/DMRHub/internal/pubsub"
	"github.com/USA-RedDragon/dmrgo/v2/enums"
	"github.com/USA-RedDragon/dmrgo/v2/transport/dmrd"
	dmrdsession "github.com/USA-RedDragon/dmrgo/v2/transport/dmrd/dmrdsession"
)

const (
	serverName       = "upstream"
	readBufferSize   = 1000000
	packetBufferSize = dmrdsession.MaxPacket + 1
	tickInterval     = 100 * time.Millisecond
)

// Server manages the upstream network links. It implements the manager's
// DMRServer interface.
type Server struct {
	clock  clock.Clock
	hub    *hub.Hub
	pubsub pubsub.PubSub
	cfg    *config.Upstreams

	hubHandle *hub.ServerHandle
	rewrites  *rewriteTable
	uplinks   map[string]*uplink
	guard     *loopbackGuard

	done     chan struct{}
	wg       sync.WaitGroup
	stopOnce sync.Once
}

// uplink is one outbound connection to an upstream master.
type uplink struct {
	cfg     *config.UpstreamNetwork
	conn    *net.UDPConn
	remote  *net.UDPAddr
	peer    *dmrdsession.Peer
	dialect dmrd.Dialect
	// mu serializes Tick and Packet: dmrdsession.Peer is not safe for
	// concurrent use.
	mu sync.Mutex
	// epoch anchors the monotonic clock used by the dmrdsession machines.
	epoch time.Time
	// up is set when the peer has completed login. The egress loop reads it
	// from another goroutine, so it is atomic.
	up atomic.Bool
}

// MakeServer creates the upstream gateway server. It does not open sockets
// until Start, so a creation failure leaves nothing to clean up.
func MakeServer(cfg *config.Upstreams, h *hub.Hub, ps pubsub.PubSub, c clock.Clock) (Server, error) {
	if cfg == nil || !cfg.Enabled {
		return Server{}, nil
	}
	s := Server{
		clock:    clock.Or(c),
		hub:      h,
		pubsub:   ps,
		cfg:      cfg,
		uplinks:  make(map[string]*uplink),
		done:     make(chan struct{}),
		rewrites: &rewriteTable{outbound: map[uint][]rewriteTarget{}, inbound: map[inboundKey]uint{}, inboundAny: map[uint]uint{}, localTGs: map[uint]struct{}{}},
	}
	if h != nil {
		s.clock = h.Clock()
	}
	s.guard = newLoopbackGuard(s.clock.Now)
	return s, nil
}

// Addr implements the manager's Server interface. The upstream gateway is
// an outbound client and holds no listening address.
func (s *Server) Addr() net.Addr {
	return &net.UDPAddr{}
}

// Start opens the upstream sockets and starts the read/tick/egress loops.
func (s *Server) Start(ctx context.Context) error {
	if s.cfg == nil || !s.cfg.Enabled {
		return nil
	}
	if s.hub == nil {
		return errors.New("upstream gateway needs a hub")
	}

	// Build the rewrite table against the set of enabled networks.
	active := make(map[string]struct{})
	for i := range s.cfg.Networks {
		n := &s.cfg.Networks[i]
		if n.Enabled && n.Name != "" {
			active[n.Name] = struct{}{}
		}
	}
	s.rewrites = buildRewriteTable(s.cfg, active)
	if len(active) == 0 {
		slog.Info("Upstream gateway enabled but no network is enabled")
		return nil
	}

	// Open one UDP socket per enabled network.
	seen := make(map[string]struct{})
	for i := range s.cfg.Networks {
		n := &s.cfg.Networks[i]
		if !n.Enabled || n.Name == "" {
			continue
		}
		if _, dup := seen[n.Name]; dup {
			return fmt.Errorf("duplicate upstream network name %q", n.Name)
		}
		seen[n.Name] = struct{}{}
		u, err := newUplink(s.clock, n)
		if err != nil {
			s.closeUplinks()
			return fmt.Errorf("upstream %q: %w", n.Name, err)
		}
		s.uplinks[n.Name] = u
	}

	s.hubHandle = s.hub.RegisterServer(hub.ServerConfig{Name: serverName, Role: hub.RolePeer})

	// Subscribe to the local talkgroups named in the rewrite table, so that
	// hub traffic on them is available for sending upstream.
	feed := s.pubsub.Feed()
	for _, tg := range s.rewrites.subscribedLocal() {
		feed.Add("hub:packets:talkgroup:" + strconv.FormatUint(uint64(tg), 10))
	}

	s.wg.Add(3 + len(s.uplinks))
	go s.drainPeerPackets(ctx)
	go s.consumeEgress(ctx, feed)
	for name, u := range s.uplinks {
		go s.readLoop(ctx, name, u)
		go s.tickLoop(ctx, name, u)
	}

	slog.Info("Upstream gateway started", "networks", len(s.uplinks), "rewrites", len(s.cfg.Rewrites))
	return nil
}

// Addr/Stop. Stop closes the sockets and joins the loops.
func (s *Server) Stop(ctx context.Context) error {
	s.stopOnce.Do(func() {
		slog.Info("Stopping upstream gateway")
		s.hub.UnregisterServer(serverName)
		close(s.done)
		s.closeUplinks()
	})
	s.wg.Wait()
	return nil
}

func (s *Server) closeUplinks() {
	for _, u := range s.uplinks {
		if u.conn != nil {
			_ = u.conn.Close()
		}
	}
}

// drainPeerPackets keeps the hub's delivery channel for this peer server
// from filling up. Egress uses the talkgroup pubsub feed instead, because
// the upstream networks are configured here rather than as database peers
// with egress rules.
func (s *Server) drainPeerPackets(ctx context.Context) {
	defer s.wg.Done()
	if s.hubHandle == nil {
		return
	}
	for {
		select {
		case <-s.done:
			return
		case <-ctx.Done():
			return
		case _, ok := <-s.hubHandle.Packets:
			if !ok {
				return
			}
		}
	}
}

// newUplink opens a UDP socket and prepares the peer state machine for one
// upstream network.
func newUplink(c clock.Clock, n *config.UpstreamNetwork) (*uplink, error) {
	if n.Address == "" {
		return nil, errors.New("address is empty")
	}
	if n.ID == 0 {
		return nil, errors.New("repeater ID is zero")
	}
	remote, err := net.ResolveUDPAddr("udp", net.JoinHostPort(n.Address, strconv.Itoa(n.Port)))
	if err != nil {
		return nil, fmt.Errorf("resolving address: %w", err)
	}
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	if err != nil {
		return nil, fmt.Errorf("opening socket: %w", err)
	}
	_ = conn.SetReadBuffer(readBufferSize)
	_ = conn.SetWriteBuffer(readBufferSize)

	var dialect dmrd.Dialect
	switch n.Dialect {
	case "", "mmdvm":
		dialect = dmrd.DialectMMDVM
	case "hbrp":
		dialect = dmrd.DialectHBRP
	default:
		_ = conn.Close()
		return nil, fmt.Errorf("unknown dialect %q", n.Dialect)
	}

	rptc, err := buildRPTC(dialect, n)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	peer, err := dmrdsession.NewPeer(&dmrdsession.PeerConfig{
		Dialect: dialect,
		ID:      n.ID,
		Password: []byte(n.Password),
		Config:  rptc,
		Options: []byte(n.Options),
	})
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("making peer: %w", err)
	}

	return &uplink{
		cfg:     n,
		conn:    conn,
		remote:  remote,
		peer:    peer,
		dialect: dialect,
		epoch:   c.Now(),
	}, nil
}

// buildRPTC constructs the 302/306-octet login configuration message.
func buildRPTC(dialect dmrd.Dialect, n *config.UpstreamNetwork) ([]byte, error) {
	callsign := n.Callsign
	if callsign == "" {
		callsign = "DMRHUB"
	}
	color := n.ColorCode
	if color < 0 || color > 15 {
		color = 1
	}
	slots := n.Slots
	if slots < 1 || slots > 4 {
		slots = 3
	}
	rx, tx := n.RXFrequency, n.TXFrequency
	if rx == 0 {
		rx = 438800000
	}
	if tx == 0 {
		tx = 438800000
	}
	if dialect == dmrd.DialectHBRP {
		var c dmrd.HBRPConfig
		c.Reset()
		c.SetID(n.ID)
		if err := c.SetCallsign([]byte(callsign)); err != nil {
			return nil, fmt.Errorf("setting callsign: %w", err)
		}
		if err := c.SetRXFrequency(rx); err != nil {
			return nil, fmt.Errorf("setting RX frequency: %w", err)
		}
		if err := c.SetTXFrequency(tx); err != nil {
			return nil, fmt.Errorf("setting TX frequency: %w", err)
		}
		if err := c.SetColorCode(enums.ColorCode(color)); err != nil {
			return nil, fmt.Errorf("setting color code: %w", err)
		}
		return c[:], nil
	}
	var c dmrd.MMDVMConfig
	c.Reset()
	c.SetID(n.ID)
	if err := c.SetCallsign([]byte(callsign)); err != nil {
		return nil, fmt.Errorf("setting callsign: %w", err)
	}
	if err := c.SetRXFrequency(rx); err != nil {
		return nil, fmt.Errorf("setting RX frequency: %w", err)
	}
	if err := c.SetTXFrequency(tx); err != nil {
		return nil, fmt.Errorf("setting TX frequency: %w", err)
	}
	if err := c.SetColorCode(enums.ColorCode(color)); err != nil {
		return nil, fmt.Errorf("setting color code: %w", err)
	}
	if err := c.SetSlots(uint8(slots)); err != nil { //nolint:gosec // checked above
		return nil, fmt.Errorf("setting slots: %w", err)
	}
	return c[:], nil
}

// readLoop receives packets from the upstream master and feeds them to the
// peer state machine.
func (s *Server) readLoop(ctx context.Context, name string, u *uplink) {
	defer s.wg.Done()
	buf := make([]byte, packetBufferSize)
	for {
		n, err := u.conn.Read(buf)
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			slog.Warn("Upstream read error", "network", name, "error", err)
			continue
		}
		now := s.clock.Since(u.epoch)
		pkt := append([]byte(nil), buf[:n]...)
		var outs [dmrdsession.MaxOutputs]dmrdsession.Output
		// OutputSend points into the peer, so the outputs must be handled
		// before the machine is called again. Keep the lock through them.
		u.mu.Lock()
		for _, o := range u.peer.Packet(now, pkt, outs[:0]) {
			s.handlePeerOutput(ctx, name, u, now, o)
		}
		u.mu.Unlock()
	}
}

// tickLoop drives the peer's timers (login, pings, reconnects).
func (s *Server) tickLoop(ctx context.Context, name string, u *uplink) {
	defer s.wg.Done()
	ticker := s.clock.NewTicker(tickInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-ticker.C():
		}
		now := s.clock.Since(u.epoch)
		var outs [dmrdsession.MaxOutputs]dmrdsession.Output
		u.mu.Lock()
		for _, o := range u.peer.Tick(now, outs[:0]) {
			s.handlePeerOutput(ctx, name, u, now, o)
		}
		u.mu.Unlock()
	}
}

// handlePeerOutput processes the outputs of the peer state machine.
func (s *Server) handlePeerOutput(ctx context.Context, name string, u *uplink, now time.Duration, o dmrdsession.Output) {
	switch o.Kind {
	case dmrdsession.OutputSend:
		if _, err := u.conn.WriteToUDP(o.Packet, u.remote); err != nil {
			slog.Warn("Upstream write error", "network", name, "error", err)
		}
	case dmrdsession.OutputUp:
		u.up.Store(true)
		slog.Info("Upstream link up", "network", name, "id", u.cfg.ID)
	case dmrdsession.OutputDown:
		if u.up.Swap(false) {
			slog.Info("Upstream link down", "network", name, "reason", o.Reason.String())
		}
	case dmrdsession.OutputData:
		if o.Command == dmrd.CommandDMRD {
			s.handleUpstreamData(ctx, name, u, o.Packet, now)
		}
	default:
	}
}

// handleUpstreamData injects a DMRD burst from an upstream into the hub,
// rewriting its destination talkgroup from the upstream TG to the local TG.
func (s *Server) handleUpstreamData(ctx context.Context, name string, u *uplink, data []byte, now time.Duration) {
	d, err := dmrd.DecodeData(data)
	if err != nil {
		return
	}
	localTG, ok := s.rewrites.inboundLocal(name, uint(d.Destination))
	if !ok {
		return
	}
	packet := models.PacketFromData(&d, d.Size > dmrconst.MMDVMPacketLength)
	packet.Dst = localTG
	s.hub.RouteStreamAt(ctx, packet, serverName, u.epoch.Add(now), func(admitted bool) {
		if admitted {
			s.guard.note(name, packet)
		}
	})
}

// consumeEgress reads local hub traffic on the subscribed talkgroups and
// sends it to the upstream networks, rewriting the destination talkgroup.
func (s *Server) consumeEgress(ctx context.Context, feed pubsub.Feed) {
	defer s.wg.Done()
	defer func() { _ = feed.Close() }()
	ch := feed.Channel()
	for {
		select {
		case <-s.done:
			return
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			s.egressMessage(msg)
		}
	}
}

func (s *Server) egressMessage(msg pubsub.Message) {
	// Talkgroup topics carry a marshaled RawDMRPacket, not bare DMRD bytes.
	var raw models.RawDMRPacket
	if _, err := raw.UnmarshalMsg(msg.Payload); err != nil {
		return
	}
	packet, ok := models.UnpackPacket(raw.Data)
	if !ok {
		return
	}
	packet.TrackID = raw.TrackID
	packet.Codec, packet.Copy, packet.HasCopy = raw.Codec, raw.Copy, raw.HasCopy

	targets := s.rewrites.outboundTargets(packet.Dst)
	if len(targets) == 0 {
		return
	}
	for _, tgt := range targets {
		if tgt.network == "" {
			// Empty network: send to every enabled upstream except the
			// one the burst just came from.
			for name, candidate := range s.uplinks {
				if s.guard.holds(name, packet) {
					continue
				}
				s.sendUpstream(name, candidate, packet, tgt.tg)
			}
			continue
		}
		if s.guard.holds(tgt.network, packet) {
			continue
		}
		u := s.uplinks[tgt.network]
		if u == nil {
			continue
		}
		s.sendUpstream(tgt.network, u, packet, tgt.tg)
	}
}

// sendUpstream sends one rewritten burst to one upstream. The destination
// talkgroup is replaced with the upstream TG and the repeater field is set
// to the upstream's repeater ID.
func (s *Server) sendUpstream(name string, u *uplink, packet models.Packet, upstreamTG uint) {
	if !u.up.Load() {
		return
	}
	out := packet
	out.Dst = upstreamTG
	out.Repeater = uint(u.cfg.ID)
	raw := out.Encode()
	if _, err := u.conn.WriteToUDP(raw, u.remote); err != nil {
		slog.Debug("Upstream egress write error", "network", name, "error", err)
	}
}
