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

import { formatDateTime } from '@/lib/dateFormat';
import { i18n, t } from '@/i18n';

export type RepeaterEvent = {
  id: number;
  first_at: string;
  last_at: string;
  count: number;
  kind: string;
  address: string;
  detail: string;
};

export type LogLine = {
  id: number;
  at: string;
  problem: boolean;
  tone: 'good' | 'bad' | 'plain';
  title: string;
  note: string;
  fix: string;
};

/** PROBLEMS are the kinds that need a change by the sysop or show a fault. */
export const PROBLEMS = new Set([
  'wrong_password', 'ip_blocked', 'bad_config', 'pushed_off', 'timeout', 'bad_options', 'unknown_talkgroup', 'options_busy',
]);

const when = (iso: string) => formatDateTime(new Date(iso), 'MMM d, HH:mm');

/**
 * logLine returns the plain sentence of a connection log entry and, for a
 * problem, what to change. device names the device: hotspot or repeater.
 */
export function logLine(ev: RepeaterEvent, repeaterID: number, device: string): LogLine {
  const from = ev.address ? i18n.global.t('From {address}', { address: ev.address }) : '';
  const times = ev.count > 1
    ? i18n.global.t('{count} times since {time}', {
      count: ev.count,
      time: formatDateTime(new Date(ev.first_at), 'HH:mm'),
    })
    : '';
  const join = (...parts: string[]) => parts.filter((p) => p !== '').join(', ');
  let title = '';
  let note = join(from, times);
  let fix = '';
  switch (ev.kind) {
  case 'connected':
    title = t('Connected.');
    note = join(from, ev.detail, times);
    break;
  case 'wrong_password':
    title = t('Login refused: wrong password.');
    fix = i18n.global.t('The password in the {device} does not match. Rotate the password on the Connect page and enter the new one in the {device}.', { device });
    break;
  case 'ip_blocked':
    title = t('Login refused: the address is blocked.');
    fix = t('An IP list of this network refuses the address. Ask an admin of the network.');
    break;
  case 'bad_config':
    title = t('Login refused: bad configuration packet.');
    note = join(from, ev.detail, times);
    fix = i18n.global.t('Check the callsign, frequencies and location in the settings of the {device}.', { device });
    break;
  case 'pushed_off':
    title = t('Pushed off by another login with the same ID.');
    fix = i18n.global.t('Two devices use ID {id}. Give each one its own ID: your DMR ID and two more digits.', { id: repeaterID });
    break;
  case 'timeout':
    title = ev.detail
      ? i18n.global.t('Connection lost: no ping for {seconds} seconds.', { seconds: ev.detail })
      : t('Connection lost: no keepalive.');
    fix = i18n.global.t('Check the internet connection of the {device}. It logs in again by itself.', { device });
    break;
  case 'closed':
    title = i18n.global.t('Logged out by the {device}.', { device });
    break;
  case 'password_rotated':
    title = t('Logged out.');
    note = join(t('The password was rotated'), times);
    break;
  case 'reset':
    title = t('Logged out.');
    note = join(ev.detail ? i18n.global.t('{who} reset the connection', { who: ev.detail }) : t('A sysop reset the connection'), times);
    break;
  case 'bad_options':
    title = i18n.global.t('The options of the {device} have a value that is not valid.', { device });
    note = join(ev.detail, times);
    fix = i18n.global.t('Check the Options line of the {device}.', { device });
    break;
  case 'unknown_talkgroup': {
    const list = ev.detail.split(',').map((s) => s.trim()).filter((s) => s !== '');
    const many = list.length > 1;
    title = i18n.global.t('Talkgroup {list} in the {device} options does not exist. | Talkgroups {list} in the {device} options do not exist.', {
      list: list.join(', '),
      device,
      count: list.length,
    });
    note = times;
    fix = many
      ? i18n.global.t('Remove them from the Options line of the {device}, or pick one from Talkgroups.', { device })
      : i18n.global.t('Remove it from the Options line of the {device}, or pick one from Talkgroups.', { device });
    break;
  }
  case 'options_busy':
    title = t('The options waited: the network was busy.');
    note = times;
    fix = i18n.global.t('Nothing to do. The {device} sends them again.', { device });
    break;
  default:
    title = ev.kind;
  }
  const problem = PROBLEMS.has(ev.kind);
  return {
    id: ev.id,
    at: when(ev.last_at),
    problem,
    tone: problem ? 'bad' : ev.kind === 'connected' ? 'good' : 'plain',
    title,
    note,
    fix,
  };
}
