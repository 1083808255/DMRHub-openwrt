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

import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { createSSRApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { lastHeardColumns } from '@/lib/lastHeardColumns';
import type { CallRow } from '@/lib/transmissions';

// The repeater cell renders a RouterLink, so the app needs a router.
const router = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { render: () => null } }],
  });

const call = (over: Partial<CallRow> = {}): CallRow => ({
  id: 1, active: false, start_time: '2026-11-25T01:20:10Z', time_slot: true,
  group_call: true, repeater_id: 1, repeater: { id: 1, callsign: 'RPT' },
  user: { id: 4612441, callsign: 'BH8GLN' }, is_to_talkgroup: true, to_talkgroup: { id: 100 },
  is_to_repeater: false, to_repeater: { id: 0, callsign: '' }, is_to_user: false,
  to_user: { id: 0, callsign: '' }, destination_id: 100, duration: 3,
  ber: 0, loss: 0, jitter: 0, rssi: 0, ...over,
});

const cell = (column: string, over: Partial<CallRow>): Promise<string> => {
  const cols = lastHeardColumns({ repeater: true }) as unknown as {
    accessorKey?: string;
    cell?: (ctx: unknown) => unknown;
  }[];
  const col = cols.find((c) => c.accessorKey === column)!;
  const content = col.cell!({ row: { original: call(over) } });
  const app = createSSRApp({ render: () => h('div', [content as never]) });
  app.use(router());
  return renderToString(app);
};

describe('lastHeard upstream network badges', () => {
  it('names the upstream network in the repeater column', async () => {
    const html = await cell('repeater', { transport: 'upstream:CQDMR' });
    expect(html).toContain('CQDMR');
    expect(html).toContain('data-test="call-source-upstream"');
  });

  it('shows each network by its own name', async () => {
    expect(await cell('repeater', { transport: 'upstream:CDN860' })).toContain('CDN860');
  });

  it('shows the network alone when the call has no local repeater', async () => {
    const html = await cell('repeater', { transport: 'upstream:CDN860', repeater: undefined });
    expect(html).toContain('CDN860');
    expect(html).not.toContain('>-<');
  });

  it('replaces an unresolvable user ID with the network name', async () => {
    const html = await cell('user', {
      transport: 'upstream:CDN860',
      user: { id: 860999900, callsign: '' },
    });
    expect(html).toContain('CDN860');
    expect(html).toContain('title="860999900"');
  });

  it('keeps the ID of an unresolvable user on a local call', async () => {
    const html = await cell('user', { user: { id: 860999900, callsign: '' } });
    expect(html).toContain('860999900');
    expect(html).not.toContain('call-source-upstream');
  });

  it('no longer renders a separate source column', () => {
    const cols = lastHeardColumns({}) as unknown as { accessorKey?: string }[];
    expect(cols.some((c) => c.accessorKey === 'source')).toBe(false);
  });
});
