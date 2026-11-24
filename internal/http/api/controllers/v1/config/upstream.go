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
