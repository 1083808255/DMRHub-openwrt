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

package config

import (
	"net/http"
	"strconv"

	"github.com/USA-RedDragon/DMRHub/internal/dmr/servers/upstream"
	"github.com/gin-gonic/gin"
)

// UpstreamKey is the key of the upstream status reader in the gin context.
const UpstreamKey = "UpstreamStatus"

// UpstreamStatuser reports the state of the upstream gateway.
type UpstreamStatuser interface {
	UpstreamStatus() (upstream.Status, bool)
}

// GETUpstream returns the state of each upstream link and of the rewrite
// table, so that Setup can show whether the hub is logged in to each
// network and which talkgroups carry traffic.
func GETUpstream(c *gin.Context) {
	v, ok := c.Get(UpstreamKey)
	s, isStatuser := v.(UpstreamStatuser)
	if !ok || !isStatuser || s == nil {
		c.JSON(http.StatusOK, upstream.Status{Links: []upstream.LinkStatus{}, Rewrites: []upstream.RewriteStatus{}})
		return
	}
	st, running := s.UpstreamStatus()
	if !running {
		// The gateway is off: still report the rules the config holds, so
		// the page can show what would run.
		c.JSON(http.StatusOK, upstream.Status{Enabled: st.Enabled, Running: false, Links: []upstream.LinkStatus{}, Rewrites: st.Rewrites})
		return
	}
	if st.Links == nil {
		st.Links = []upstream.LinkStatus{}
	}
	if st.Rewrites == nil {
		st.Rewrites = []upstream.RewriteStatus{}
	}
	c.JSON(http.StatusOK, st)
}

// UpstreamPasswordAnswer is the saved password of one upstream network.
type UpstreamPasswordAnswer struct {
	Name     string `json:"name"`
	Password string `json:"password"`
}

// GETUpstreamPassword returns the password this replica has saved for one
// upstream network, so that an admin can read back what the hub will really
// send to the master. A master that refuses a login says only that it
// refused: without this the admin cannot tell a mistyped password from one
// the master itself no longer accepts.
//
// The route sits behind RequireAdmin, as every other config route does, and
// answers for one network at a time so that reading a password is a
// deliberate act rather than something a page load hands out in bulk.
func GETUpstreamPassword(c *gin.Context) {
	live, ok := liveOf(c)
	if !ok {
		return
	}
	i, err := strconv.Atoi(c.Param("index"))
	if err != nil || i < 0 {
		c.JSON(http.StatusBadRequest, gin.H{errorKey: "The network number must be a whole number of 0 or more"})
		return
	}
	networks := live.Current().Get().DMR.Upstreams.Networks
	if i >= len(networks) {
		c.JSON(http.StatusNotFound, gin.H{errorKey: "There is no network at that number"})
		return
	}
	n := networks[i]
	c.JSON(http.StatusOK, UpstreamPasswordAnswer{Name: n.Name, Password: n.Password})
}
