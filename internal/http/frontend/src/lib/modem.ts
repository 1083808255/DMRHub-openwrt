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

import { ref } from 'vue';
import { i18n, t } from '@/i18n';
import { replicaName } from '@/lib/setupState';

/** A serial port of a replica. */
export type SerialPort = { path: string; device?: string };

/** The serial ports of one replica, from /config/modem/ports. */
export type ReplicaPorts = { replica: string; self: boolean; ports: SerialPort[] };

/** The replica of the port that the admin chose; empty for none. */
export const portReplica = ref('');

/** The live state of the modem of a replica. */
export type ModemStatus = {
  replica?: string;
  port: string;
  baud: number;
  linked: boolean;
  firmware?: string;
  protocol?: number;
  modes?: string[];
  since?: string;
  error?: string;
};

/** The answer of /config/modem. */
export type ModemState = { status: ModemStatus | null; self: boolean };

export type ProbeStep = { taken: boolean; error?: string };

/** What a test of the modem found. */
export type ProbeResult = {
  port: string;
  baud: number;
  opened: boolean;
  tries: number;
  answered: boolean;
  firmware?: string;
  protocol?: number;
  modes?: string[];
  frequencies?: ProbeStep;
  settings?: ProbeStep;
  error?: string;
};

/** The answer of /config/modem/test. */
export type ModemTest = {
  replica?: string;
  self?: boolean;
  unanswered?: boolean;
  live: boolean;
  state?: ModemState;
  result?: ProbeResult;
};

export type Tone = 'ok' | 'bad' | 'idle';

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const portList = (ports: unknown): SerialPort[] =>
  Array.isArray(ports) ? ports.filter((p): p is SerialPort => typeof asRecord(p)?.path === 'string') : [];

/** The ports of each replica in an answer of /config/modem/ports; none for anything else. */
export const portsOf = (data: unknown): ReplicaPorts[] => {
  const replicas = asRecord(data)?.replicas;
  if (!Array.isArray(replicas)) {
    return [];
  }
  return replicas
    .map((r) => asRecord(r))
    .filter((r): r is Record<string, unknown> => typeof r?.replica === 'string')
    .map((r) => ({ replica: r.replica as string, self: r.self === true, ports: portList(r.ports) }));
};

/** The replica to list first for a port that several replicas have: this one. */
export const replicaOfPort = (groups: ReplicaPorts[], path: string): string =>
  groups.find((g) => g.self && g.ports.some((p) => p.path === path))?.replica
  ?? groups.find((g) => g.ports.some((p) => p.path === path))?.replica
  ?? '';

/** The state of an answer of /config/modem; null for anything else. */
export const modemStateOf = (data: unknown): ModemState | null => {
  const d = asRecord(data);
  if (!d || !('status' in d)) {
    return null;
  }
  const st = asRecord(d.status);
  return { status: st && typeof st.port === 'string' ? (st as ModemStatus) : null, self: d.self === true };
};

/** The label of a port in the list: the device follows a link. */
export const portLabel = (p: SerialPort): string => (p.device ? `${p.path} (${p.device})` : p.path);

/** Whether the port select shows the box for a path that is not listed. */
export const otherPort = (groups: ReplicaPorts[], value: string): boolean => {
  const ports = groups.flatMap((g) => g.ports);
  return ports.length === 0 || (value !== '' && !ports.some((p) => p.path === value));
};

const on = (s: ModemState) => (s.self ? '' : replicaName(s.status?.replica ?? ''));

export type Pill = { tone: Tone; text: string; title?: string };

/** The status pill of the Modem card. */
export const modemPill = (s: ModemState | null): Pill => {
  if (!s?.status) {
    return { tone: 'idle', text: t('Modem not running') };
  }
  const replica = on(s);
  if (s.status.linked) {
    return {
      tone: 'ok',
      text: replica ? i18n.global.t('Modem connected on replica {replica}', { replica }) : t('Modem connected'),
    };
  }
  return {
    tone: 'bad',
    text: replica ? i18n.global.t('Modem not connected on replica {replica}', { replica }) : t('Modem not connected'),
    title: s.status.error,
  };
};

export type ResultView = { tone: Tone; title: string; rows: [string, string][]; text?: string };

const stepText = (s: ProbeStep | undefined): string | undefined => {
  if (!s) {
    return undefined;
  }
  return s.taken ? t('Taken') : i18n.global.t('Refused: {error}', { error: s.error ?? t('no answer') });
};

const boardRows = (b: { firmware?: string; protocol?: number; modes?: string[] }): [string, string][] => {
  const rows: [string, string][] = [];
  if (b.firmware) {
    rows.push([t('Firmware'), b.firmware]);
  }
  if (b.protocol) {
    rows.push([t('Protocol'), String(b.protocol)]);
  }
  if (b.modes && b.modes.length > 0) {
    rows.push([t('Modes'), b.modes.join(', ')]);
  }
  return rows;
};

const checkPort = t('Check the port and its speed, and that no other program, such as MMDVMHost, uses the port.');

/** How the Modem tab shows the answer of a test. */
export const testView = (test: ModemTest): ResultView => {
  if (test.unanswered) {
    return {
      tone: 'bad', title: i18n.global.t('Replica {replica} did not answer', { replica: replicaName(test.replica ?? '') }), rows: [],
      text: t('Try again.'),
    };
  }
  const view = resultView(test);
  if (test.replica && test.self === false && !test.live) {
    view.rows.unshift([t('Replica'), replicaName(test.replica)]);
  }
  return view;
};

const resultView = (test: ModemTest): ResultView => {
  if (test.live && test.state?.status) {
    const st = test.state.status;
    const where = test.state.self
      ? t('The modem runs on this port.')
      : i18n.global.t('The modem runs on this port on replica {replica}.', { replica: replicaName(st.replica ?? '') });
    if (st.linked) {
      return { tone: 'ok', title: t('The modem is connected'), rows: boardRows(st), text: `${where} ${t('DMRHub did not open the port again.')}` };
    }
    return {
      tone: 'bad', title: t('The modem is not connected'), rows: [],
      text: `${where} ${t('DMRHub keeps trying to open it')}${st.error ? `: ${st.error}` : ''}. ${checkPort}`,
    };
  }
  const r = test.result;
  if (!r) {
    return { tone: 'bad', title: t('The test did not run'), rows: [] };
  }
  if (!r.opened) {
    return {
      tone: 'bad', title: t('The port did not open'), rows: [],
      text: i18n.global.t('DMRHub could not open {port}: {error}.', { port: r.port, error: r.error ?? t('unknown error') }),
    };
  }
  if (!r.answered) {
    return {
      tone: 'bad', title: t('No answer from the board'), rows: [],
      text: `${i18n.global.t('DMRHub opened {port} at {baud} but the board did not answer after {count} try | DMRHub opened {port} at {baud} but the board did not answer after {count} tries.', {
        port: r.port,
        baud: r.baud,
        count: r.tries,
      })} ${checkPort}`,
    };
  }
  const rows = boardRows(r);
  for (const [label, s] of [[t('Frequencies'), r.frequencies], [t('Settings'), r.settings]] as const) {
    const text = stepText(s);
    if (text) {
      rows.push([label, text]);
    }
  }
  if (!r.error) {
    return { tone: 'ok', title: t('The board answered'), rows };
  }
  if (!r.frequencies) {
    return { tone: 'bad', title: t('DMRHub cannot drive this board'), rows, text: `${r.error}.` };
  }
  return { tone: 'bad', title: t('The board did not take the settings'), rows };
};
