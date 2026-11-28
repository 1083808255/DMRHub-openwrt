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

import type { DataTableColumn } from '@/components/ui/data-table';
import { h } from 'vue';
import User from '@/components/User.vue';
import Talkgroup from '@/components/Talkgroup.vue';
import Repeater from '@/components/Repeater.vue';
import RelativeTimestamp from '@/components/RelativeTimestamp.vue';
import TransmissionType from '@/components/TransmissionType.vue';
import CallCodec from '@/components/CallCodec.vue';
import { t } from '@/i18n';
import {
  berText,
  durationText,
  jitterText,
  lossText,
  rssiText,
  type CallRow,
} from '@/lib/transmissions';

type Cell = { row: { original: CallRow } };

export type LastHeardColumnOptions = {
  user?: boolean;
  destination?: boolean;
  repeater?: boolean;
};

/** upstreamOf returns the network of a transport that is an upstream link. */
const upstreamOf = (transport?: string): string | undefined => {
  const prefix = 'upstream:';
  if (!transport || !transport.startsWith(prefix)) {
    return undefined;
  }
  const name = transport.slice(prefix.length);
  return name || undefined;
};

// Each upstream network gets a stable colour, so calls that arrive from
// different networks can be told apart without reading the names.
const NETWORK_BADGE_COLORS = [
  'border-sky-600/50 text-sky-700 dark:text-sky-400',
  'border-violet-600/50 text-violet-700 dark:text-violet-400',
  'border-rose-600/50 text-rose-700 dark:text-rose-400',
  'border-amber-600/50 text-amber-700 dark:text-amber-400',
  'border-emerald-600/50 text-emerald-700 dark:text-emerald-400',
  'border-cyan-600/50 text-cyan-700 dark:text-cyan-400',
  'border-fuchsia-600/50 text-fuchsia-700 dark:text-fuchsia-400',
  'border-lime-600/50 text-lime-700 dark:text-lime-400',
];

/** networkBadgeColor picks the same colour for the same network every time. */
function networkBadgeColor(network: string): string {
  let hash = 0;
  for (let i = 0; i < network.length; i++) {
    hash = (hash * 31 + network.charCodeAt(i)) >>> 0;
  }
  return NETWORK_BADGE_COLORS[hash % NETWORK_BADGE_COLORS.length] ?? NETWORK_BADGE_COLORS[0];
}

/** networkBadge marks a call that came in over an upstream link. */
function networkBadge(network: string) {
  return h(
    'span',
    {
      class: 'inline-flex items-center gap-1.5 -ml-1',
      title: t('Forwarded from the upstream network {name}', { name: network }),
      'data-test': 'call-source-upstream',
    },
    [
      h(
        'span',
        { class: `whitespace-nowrap rounded-full border px-1.5 text-sm leading-4 ${networkBadgeColor(network)}` },
        network,
      ),
    ],
  );
}

// person shows the ID when the user database cannot resolve a callsign: the
// Chinese 86xxxxxxx IDs of a partner network have no callsign anywhere. The
// upstream network is named in the repeater column instead.
function person(u: { id: number; callsign: string; registered?: boolean }) {
  if (!u.callsign) {
    return h('span', { class: 'font-medium' }, String(u.id));
  }
  const badges = [];
  if (u.registered === false) {
    badges.push(
      h(
        'span',
        {
          class: 'rounded-full border border-amber-600/50 px-1 text-[10px] leading-[11px] text-amber-700 dark:text-amber-400',
          title: t('Not registered on this server'),
          'data-test': 'user-unregistered',
        },
        t('Unregistered'),
      ),
    );
  }
  return h('span', { class: 'inline-flex items-center gap-1.5' }, [h(User, { user: u }), ...badges]);
}

function destination(call: CallRow) {
  if (call.is_to_local_group && call.to_local_group) {
    return h('span', { class: 'inline-flex flex-wrap items-baseline gap-x-1.5', 'data-test': 'local-group' }, [
      h('span', { class: 'font-medium' }, call.to_local_group.name),
      h('span', { class: 'text-xs text-muted-foreground' }, `local TG ${call.destination_id}`),
    ]);
  }
  if (call.is_to_talkgroup) {
    return h(Talkgroup, { talkgroup: call.to_talkgroup });
  }
  if (call.is_to_repeater) {
    return `${call.to_repeater.callsign} | ${call.to_repeater.id}`;
  }
  if (call.is_to_user) {
    return h(User, { user: call.to_user });
  }
  if (!call.destination_id) {
    return '-';
  }
  return h('span', { class: 'font-medium' }, call.group_call ? `TG ${call.destination_id}` : String(call.destination_id));
}

/**
 * Share of the table that every last heard column takes, keyed by accessor.
 *
 * The columns fill the table, so they keep the same proportions on every
 * screen instead of growing with the widest value in the column: without it
 * the user column (flag, callsign and the unregistered badge) took a fifth of
 * the table and left a large gap under its short header, while the gaps
 * between the other columns varied by a factor of two. The table keeps a
 * minimum width, so a narrow screen scrolls instead of squeezing a column
 * until its content runs into the next one.
 *
 * The columns before the destination carry short values, so they are kept
 * narrow: the freed width goes to the trailing measurement columns, and the
 * destination starts about 5% further left without wrapping.
 */
export const LAST_HEARD_COLUMN_WIDTHS: Record<string, string> = {
  time: 'w-[8.5%]',
  time_slot: 'w-[4.5%]',
  kind: 'w-[7.5%]',
  user: 'w-[14.5%]',
  destination: 'w-[9.5%]',
  repeater: 'w-[8%]',
  duration: 'w-[8%]',
  codec: 'w-[9%]',
  ber: 'w-[6%]',
  loss: 'w-[6.5%]',
  jitter: 'w-[8.5%]',
  rssi: 'w-[9.5%]',
};

export function lastHeardColumns(opts: LastHeardColumnOptions = {}): DataTableColumn<CallRow, unknown>[] {
  const { user = true, destination: showDestination = true, repeater = false } = opts;
  const columns: DataTableColumn<CallRow, unknown>[] = [
    {
      accessorKey: 'time',
      header: t('Time'),
      cell: ({ row }: Cell) => {
        const call = row.original;
        if (call.active) {
          return t('Active');
        }
        return h(RelativeTimestamp, { time: call.start_time, active: call.active, relative: true });
      },
    },
    {
      accessorKey: 'time_slot',
      header: t('TS'),
      cell: ({ row }: Cell) => (row.original.time_slot ? '2' : '1'),
    },
    {
      accessorKey: 'kind',
      header: t('Type'),
      cell: ({ row }: Cell) => h(TransmissionType, { call: row.original }),
    },
  ];
  if (user) {
    columns.push({
      accessorKey: 'user',
      header: t('User'),
      cell: ({ row }: Cell) => person(row.original.user),
    });
  }
  if (showDestination) {
    columns.push({
      accessorKey: 'destination',
      header: t('Destination'),
      cell: ({ row }: Cell) => destination(row.original),
    });
  }
  if (repeater) {
    columns.push({
      accessorKey: 'repeater',
      header: t('Repeater'),
      cell: ({ row }: Cell) => {
        // A call that came in over an upstream link has no local repeater to
        // name, and its 9 digit ID resolves to nothing. The network badge
        // that used to sit in a separate "From" column belongs here instead:
        // it answers the same question, where the audio entered the hub.
        const network = upstreamOf(row.original.transport);
        if (network) {
          return networkBadge(network);
        }
        const r = row.original.repeater;
        if (!r || !r.id) {
          return '-';
        }
        return h(Repeater, { repeater: r });
      },
    });
  }
  columns.push(
    {
      accessorKey: 'duration',
      header: t('Duration'),
      cell: ({ row }: Cell) => durationText(row.original),
    },
    {
      accessorKey: 'codec',
      header: t('Codec'),
      cell: ({ row }: Cell) => h(CallCodec, { call: row.original }),
    },
    {
      accessorKey: 'ber',
      header: t('BER'),
      cell: ({ row }: Cell) => berText(row.original),
    },
    {
      accessorKey: 'loss',
      header: t('Loss'),
      cell: ({ row }: Cell) => lossText(row.original),
    },
    {
      accessorKey: 'jitter',
      header: t('Jitter'),
      cell: ({ row }: Cell) => jitterText(row.original),
    },
    {
      accessorKey: 'rssi',
      header: t('RSSI'),
      cell: ({ row }: Cell) => rssiText(row.original),
    },
  );
  return columns;
}
