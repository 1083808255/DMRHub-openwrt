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
	"sort"
	"strconv"
	"strings"
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
	// serverPrefix names the servers this gateway registers, one per
	// network, so that a call the hub records says which network it came
	// from. The name is serverPrefix + the name of the network.
	serverPrefix     = "upstream:"
	readBufferSize   = 1000000
	packetBufferSize = dmrdsession.MaxPacket + 1
	tickInterval     = 100 * time.Millisecond
)

// serverOf returns the name this gateway registers for network.
func serverOf(network string) string { return serverPrefix + network }

// NetworkOf returns the network of an upstream server name, and false when
// name is not one. The page shows it as where a call came from.
func NetworkOf(name string) (string, bool) {
	rest, ok := strings.CutPrefix(name, serverPrefix)
	if !ok || rest == "" {
		return "", false
	}
	return rest, true
}

// Server manages the upstream network links. It implements the manager's
// DMRServer interface.
type Server struct {
	clock  clock.Clock
	hub    *hub.Hub
	pubsub pubsub.PubSub
	cfg    *config.Upstreams

	// hubHandles are the registrations of this gateway, one per network.
	hubHandles []*hub.ServerHandle
	rewrites   *rewriteTable
	uplinks    map[string]*uplink
	guard      *loopbackGuard

	done     chan struct{}
	wg       sync.WaitGroup
	stopOnce sync.Once
}

// uplink is one outbound connection to an upstream master.
type uplink struct {
	cfg     *config.UpstreamNetwork
	conn    *net.UDPConn
	peer    *dmrdsession.Peer
	dialect dmrd.Dialect
	// remoteMu guards remote, which is resolved on first use and kept, so
	// that a name that does not resolve yet is tried again on the next
	// tick instead of stopping the gateway from starting.
	remoteMu sync.Mutex
	remote   *net.UDPAddr
	// mu serializes Tick and Packet: dmrdsession.Peer is not safe for
	// concurrent use.
	mu sync.Mutex
	// epoch anchors the monotonic clock used by the dmrdsession machines.
	epoch time.Time
	// up is set when the peer has completed login. The egress loop reads it
	// from another goroutine, so it is atomic.
	up atomic.Bool
	// stats is what the status page shows about this link. The loops of the
	// link write it, and a request of the API reads it.
	stats linkStats
}

// linkStats is what a link has done since the gateway started.
type linkStats struct {
	mu sync.Mutex
	// since is when the link last came up, zero while it is down.
	since time.Time
	// lastHeard is when the last burst came from or went to the master.
	lastHeard time.Time
	// reason is why the link last went down.
	reason string
	// rx and tx count the bursts of each direction, and rxTG and txTG
	// count them by talkgroup.
	rxBursts uint64
	txBursts uint64
	rxTG     map[uint]uint64
	txTG     map[uint]uint64
}

// LinkStatus is the state of one upstream link, as the API reports it.
type LinkStatus struct {
	Name string `json:"name"`
	// Up is whether the link has logged in to the master.
	Up bool `json:"up"`
	// Since is when it came up, as a time the page shows as it is.
	Since *time.Time `json:"since,omitempty"`
	// LastHeard is when the last burst crossed the link, as a time the
	// page shows as it is.
	LastHeard *time.Time `json:"lastHeard,omitempty"`
	// Reason is why the link last went down.
	Reason     string     `json:"reason,omitempty"`
	RxBursts   uint64     `json:"rxBursts"`
	TxBursts   uint64     `json:"txBursts"`
	Talkgroups []TGStatus `json:"talkgroups"`
}

// TGStatus counts the bursts of one talkgroup on a link.
type TGStatus struct {
	TG     uint   `json:"tg"`
	Rx     uint64 `json:"rx"`
	Tx     uint64 `json:"tx"`
}

// RewriteStatus is one rule of the rewrite table, as the API reports it.
type RewriteStatus struct {
	Network    string `json:"network"`
	LocalTG    uint   `json:"localTg"`
	UpstreamTG uint   `json:"upstreamTg"`
}

// Status is the state of the upstream gateway, as the API reports it.
type Status struct {
	Enabled  bool            `json:"enabled"`
	Running  bool            `json:"running"`
	Links    []LinkStatus    `json:"links"`
	Rewrites []RewriteStatus `json:"rewrites"`
}

// noteUp records that the link came up at now.
func (l *linkStats) noteUp(now time.Time) {
	l.mu.Lock()
	l.since = now
	l.reason = ""
	l.mu.Unlock()
}

// noteDown records that the link went down at now, and why.
func (l *linkStats) noteDown(now time.Time, reason string) {
	l.mu.Lock()
	l.since = time.Time{}
	l.reason = reason
	l.mu.Unlock()
}

// noteRx records a burst that came from the master on talkgroup tg.
func (l *linkStats) noteRx(now time.Time, tg uint) {
	l.mu.Lock()
	l.rxBursts++
	if l.rxTG == nil {
		l.rxTG = map[uint]uint64{}
	}
	l.rxTG[tg]++
	l.lastHeard = now
	l.mu.Unlock()
}

// noteTx records a burst that went to the master on talkgroup tg.
func (l *linkStats) noteTx(now time.Time, tg uint) {
	l.mu.Lock()
	l.txBursts++
	if l.txTG == nil {
		l.txTG = map[uint]uint64{}
	}
	l.txTG[tg]++
	l.lastHeard = now
	l.mu.Unlock()
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

	// Register one server per network, so that a call the hub records says
	// which network it came from.
	for name := range s.uplinks {
		s.hubHandles = append(s.hubHandles, s.hub.RegisterServer(hub.ServerConfig{Name: serverOf(name), Role: hub.RolePeer}))
	}

	// Subscribe to the local talkgroups named in the rewrite table, so that
	// hub traffic on them is available for sending upstream, and to the
	// private topic, so that private calls and text messages reach the
	// networks too.
	feed := s.pubsub.Feed()
	for _, tg := range s.rewrites.subscribedLocal() {
		feed.Add("hub:packets:talkgroup:" + strconv.FormatUint(uint64(tg), 10))
	}
	feed.Add(hub.PrivateTopic)

	// drainPeerPackets adds the goroutine it starts for each network.
	s.wg.Add(2 + 2*len(s.uplinks))
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
		for _, h := range s.hubHandles {
			s.hub.UnregisterServer(h.Name)
		}
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
	if len(s.hubHandles) == 0 {
		return
	}
	// One goroutine drains the channel of each network, so a slow network
	// cannot hold up the bursts of another.
	for _, h := range s.hubHandles {
		s.wg.Add(1)
		go func(h *hub.ServerHandle) {
			defer s.wg.Done()
			for {
				select {
				case <-s.done:
					return
				case <-ctx.Done():
					return
				case _, ok := <-h.Packets:
					if !ok {
						return
					}
				}
			}
		}(h)
	}
}

// newUplink opens a UDP socket and prepares the peer state machine for one
// upstream network. The address is resolved on the first send, so that a
// name that does not resolve yet does not stop the gateway from starting.
func newUplink(c clock.Clock, n *config.UpstreamNetwork) (*uplink, error) {
	if n.ID == 0 {
		return nil, errors.New("repeater ID is zero")
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
		peer:    peer,
		dialect: dialect,
		epoch:   c.Now(),
	}, nil
}

// remoteAddr returns where the packets of this link go, resolving the name
// the first time and keeping the answer. A name that does not resolve yet
// is not a reason to refuse the settings: the link keeps its socket and the
// next tick tries again, so a slow or missing DNS at save time no longer
// rolls the saved settings back.
func (u *uplink) remoteAddr() (*net.UDPAddr, error) {
	u.remoteMu.Lock()
	defer u.remoteMu.Unlock()
	if u.remote != nil {
		return u.remote, nil
	}
	host, err := hostOf(u.cfg.Address)
	if err != nil {
		return nil, err
	}
	addr, err := net.ResolveUDPAddr("udp", net.JoinHostPort(host, strconv.Itoa(u.cfg.Port)))
	if err != nil {
		return nil, fmt.Errorf("resolving address: %w", err)
	}
	u.remote = addr
	return addr, nil
}

// hostOf returns the host of an address that an admin typed, so that a
// pasted URL such as https://dmr.example.org/ still reaches the master.
// The port stays in the Port setting; a port in the address is dropped.
func hostOf(address string) (string, error) {
	s := config.UpstreamHost(address)
	if s == "" {
		return "", errors.New("address is empty")
	}
	return s, nil
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
		to, err := u.remoteAddr()
		if err != nil {
			slog.Warn("Upstream address unresolved", "network", name, "error", err)
			break
		}
		if _, err := u.conn.WriteToUDP(o.Packet, to); err != nil {
			slog.Warn("Upstream write error", "network", name, "error", err)
		}
	case dmrdsession.OutputUp:
		u.up.Store(true)
		u.stats.noteUp(s.clock.Now())
		slog.Info("Upstream link up", "network", name, "id", u.cfg.ID)
	case dmrdsession.OutputDown:
		if u.up.Swap(false) {
			u.stats.noteDown(s.clock.Now(), o.Reason.String())
			slog.Info("Upstream link down", "network", name, "reason", o.Reason.String())
		}
	case dmrdsession.OutputData:
		if o.Command == dmrd.CommandDMRD {
			s.handleUpstreamData(ctx, name, u, o.Packet, now)
		}
	default:
	}
}

// handleUpstreamData injects a DMRD burst from an upstream into the hub.
// A group burst has its destination talkgroup rewritten from the upstream
// TG to the local TG; a private call or a text message keeps the radio ID
// that it names, so the hub delivers it to that radio.
func (s *Server) handleUpstreamData(ctx context.Context, name string, u *uplink, data []byte, now time.Duration) {
	d, err := dmrd.DecodeData(data)
	if err != nil {
		return
	}
	packet := models.PacketFromData(&d, d.Size > dmrconst.MMDVMPacketLength)
	if packet.GroupCall {
		localTG, ok := s.rewrites.inboundLocal(name, uint(d.Destination))
		if !ok {
			return
		}
		packet.Dst = localTG
	}
	u.stats.noteRx(s.clock.Now(), uint(d.Destination))
	s.hub.RouteStreamAt(ctx, packet, serverOf(name), u.epoch.Add(now), func(admitted bool) {
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

	// A private call or a text message names a radio, not a talkgroup. It
	// goes to every network, which routes it to the radio it names.
	if !packet.GroupCall {
		s.sendPrivateUpstream(packet)
		return
	}

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
	to, err := u.remoteAddr()
	if err != nil {
		slog.Debug("Upstream address unresolved", "network", name, "error", err)
		return
	}
	if _, err := u.conn.WriteToUDP(raw, to); err != nil {
		slog.Debug("Upstream egress write error", "network", name, "error", err)
		return
	}
	u.stats.noteTx(s.clock.Now(), upstreamTG)
}

// sendPrivateUpstream sends a private call or a text message to every
// network that is logged in. The destination stays the radio ID, which the
// network routes to the radio it names.
func (s *Server) sendPrivateUpstream(packet models.Packet) {
	if !s.rewrites.private {
		return
	}
	for name, u := range s.uplinks {
		if !u.up.Load() {
			continue
		}
		if s.guard.holds(name, packet) {
			continue
		}
		out := packet
		out.Repeater = uint(u.cfg.ID)
		raw := out.Encode()
		to, err := u.remoteAddr()
		if err != nil {
			slog.Debug("Upstream address unresolved", "network", name, "error", err)
			continue
		}
		if _, err := u.conn.WriteToUDP(raw, to); err != nil {
			slog.Debug("Upstream private write error", "network", name, "error", err)
			continue
		}
		u.stats.noteTx(s.clock.Now(), packet.Dst)
	}
}

// Status returns the state of the gateway and its links, for the API.
func (s *Server) Status() Status {
	st := Status{Enabled: s.cfg != nil && s.cfg.Enabled, Running: len(s.hubHandles) > 0}
	if s.cfg != nil {
		for _, r := range s.cfg.Rewrites {
			st.Rewrites = append(st.Rewrites, RewriteStatus{Network: r.Network, LocalTG: r.LocalTG, UpstreamTG: r.UpstreamTG})
		}
	}
	names := make([]string, 0, len(s.uplinks))
	for name := range s.uplinks {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		u := s.uplinks[name]
		u.stats.mu.Lock()
		link := LinkStatus{
			Name: name, Up: u.up.Load(),
			Reason:   u.stats.reason,
			RxBursts: u.stats.rxBursts, TxBursts: u.stats.txBursts,
		}
		if !u.stats.since.IsZero() {
			at := u.stats.since
			link.Since = &at
		}
		if !u.stats.lastHeard.IsZero() {
			at := u.stats.lastHeard
			link.LastHeard = &at
		}
		tgs := make(map[uint]struct{}, len(u.stats.rxTG)+len(u.stats.txTG))
		for tg := range u.stats.rxTG {
			tgs[tg] = struct{}{}
		}
		for tg := range u.stats.txTG {
			tgs[tg] = struct{}{}
		}
		for tg := range tgs {
			link.Talkgroups = append(link.Talkgroups, TGStatus{TG: tg, Rx: u.stats.rxTG[tg], Tx: u.stats.txTG[tg]})
		}
		u.stats.mu.Unlock()
		if link.Talkgroups == nil {
			// A link that carried nothing yet sends an empty list, not a
			// null that the page would have to guard against.
			link.Talkgroups = []TGStatus{}
		}
		sort.Slice(link.Talkgroups, func(i, j int) bool { return link.Talkgroups[i].TG < link.Talkgroups[j].TG })
		st.Links = append(st.Links, link)
	}
	return st
}
