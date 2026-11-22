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

import type { CallCodecFields } from '@/lib/codec';
import { i18n, t } from '@/i18n';

export type TypeKey = 'voice' | 'data' | 'sms' | 'gps' | 'alias' | 'csbk' | 'control' | 'unknown';

export const TYPES: { key: TypeKey; label: string }[] = [
  { key: 'voice', label: t('Voice') },
  { key: 'data', label: t('Data') },
  { key: 'sms', label: t('SMS') },
  { key: 'gps', label: t('GPS') },
  { key: 'alias', label: t('Talker Alias') },
  { key: 'csbk', label: t('CSBK') },
  { key: 'control', label: t('Control') },
  { key: 'unknown', label: t('Unknown') },
];

export const DEFAULT_TYPES: TypeKey[] = ['voice', 'data', 'sms', 'gps', 'alias', 'csbk', 'control'];

export type TypeFilterValue = {
  types: TypeKey[];
  idle: boolean;
};

export type CallRow = {
  id: number;
  active: boolean;
  start_time: string | Date;
  time_slot: boolean;
  group_call: boolean;
  repeater_id: number;
  repeater: { id: number; callsign: string };
  user: { id: number; callsign: string };
  is_to_talkgroup: boolean;
  to_talkgroup: { id: number };
  is_to_repeater: boolean;
  to_repeater: { id: number; callsign: string };
  is_to_user: boolean;
  to_user: { id: number; callsign: string };
  is_to_local_group?: boolean;
  to_local_group?: { id: number; name: string };
  destination_id: number;
  duration: string | number;
  ber: string | number;
  loss: string | number;
  jitter: string | number;
  rssi: string | number;
  kind?: string;
  sub_kind?: string;
  source_id?: number;
  bursts?: number;
  fid?: number | null;
  opcode?: number | null;
  sap?: number | null;
  data_format?: string;
  confirmed?: boolean;
  blocks?: number;
  octets?: number;
  response?: string;
  talker_alias?: string;
  alias_format?: string;
  grid?: string;
  position_error?: number | null;
  partial?: boolean;
  undeliverable?: UndeliverableEntry[] | null;
  undeliverable_scope?: string;
} & CallCodecFields;

/** UndeliverableEntry is a repeater that a call was not sent to, and why. */
export type UndeliverableEntry = {
  sentence: string;
  target: string;
  repeater_id: number;
  callsign: string;
  reason: string;
};

const CONTROL_KINDS = ['udt', 'mbc', 'idle', 'usbd'];
const IDLE_KINDS = ['idle', 'usbd'];

const SAP_NAMES: Record<number, string> = {
  0: 'UDT',
  2: 'TCP/IP',
  3: 'UDP/IP',
  4: 'IP',
  5: 'ARP',
  9: 'Proprietary',
  10: 'Short data',
};

const SMS_FORMATS: Record<string, string> = {
  ip: t('ETSI IP'),
  tms: t('Motorola TMS'),
  anytone: t('AnyTone'),
  hytera: t('Hytera'),
  defined_data: t('Defined Data'),
};

const DATA_SUBS: Record<string, string> = {
  lrrp: 'LRRP',
  ars: 'ARS',
  tms: 'TMS',
};

const CSBK_NAMES: Record<string, string> = {
  preamble: t('Preamble'),
  radio_check: t('Radio Check'),
  radio_check_answer: t('Radio Check Answer'),
  call_alert: t('Call Alert'),
  call_alert_ack: t('Call Alert ACK'),
};

const UNKNOWN_NAMES: Record<string, string> = {
  bad_crc: t('Bad CRC'),
  undecodable: t('Undecodable burst'),
  reserved: t('Reserved data type'),
  frame_type_3: t('Frame type 3'),
};
/** humanize turns a sub kind such as c_bcast into C bcast for display. */
export function humanize(sub: string): string {
  const text = sub.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const UNDELIVERABLE_WORDS: Record<string, string> = {
  invalid_data_type: t('invalid data type'),
  no_ipsc_form: t('could not carry this burst'),
  frame_type_3: t('unknown frame type'),
  fec_uncorrectable: t('too damaged to repair'),
  slot_type: t('could not rebuild this burst'),
  stream_id_range: t('call ID does not fit the link'),
  build_failed: t('could not build this burst'),
  encode_failed: t('could not encode this burst'),
  data_in_voice: t('data burst in a voice call'),
  undecodable: t('could not read this burst'),
  slot_busy: t('busy on that slot'),
};

const UNDELIVERABLE_TARGETS: Record<string, string> = {
  ipsc: t('IPSC repeater'),
  mmdvm: t('MMDVM repeater'),
  openbridge: t('OpenBridge peer'),
};
const LISTED_PER_REASON = 3;

/** UndeliverableView is how the type column shows the repeaters that a call was not sent to. */
export type UndeliverableView = {
  lines: string[];
  summary: string;
  details: string[];
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function reasonWords(e: UndeliverableEntry): string {
  return t(UNDELIVERABLE_WORDS[e.reason] ?? 'could not prepare this burst');
}

function repeaterName(e: UndeliverableEntry): string {
  if (!e.repeater_id) {
    const kind = UNDELIVERABLE_TARGETS[e.target];
    return kind ? i18n.global.t('an {kind}', { kind: t(kind) }) : t('a repeater');
  }
  return e.callsign ? `${e.callsign} (${e.repeater_id})` : `${e.repeater_id}`;
}

function targetName(e: UndeliverableEntry): string {
  if (!e.repeater_id) {
    return repeaterName(e);
  }
  return `${t(UNDELIVERABLE_TARGETS[e.target] ?? 'repeater')} ${repeaterName(e)}`;
}

function repeaterCount(entries: UndeliverableEntry[]): number {
  const seen = new Set<string>();
  entries.forEach((e, i) => seen.add(e.repeater_id ? `${e.target}:${e.repeater_id}` : `#${i}`));
  return seen.size;
}

/**
 * undeliverableView words the repeaters that a call was not sent to, as the
 * API shows them to the viewer. The caller and an admin get a count by
 * reason with the repeaters listed under it, the owner of a repeater a line
 * for each of their own, and one repeater shows on one line.
 */
export function undeliverableView(row: CallRow): UndeliverableView {
  const entries = row.undeliverable || [];
  const view: UndeliverableView = { lines: [], summary: '', details: [] };
  if (row.undeliverable_scope === 'own') {
    view.lines = entries.map((e) => {
      const yours = e.target === 'openbridge' ? t('your OpenBridge peer') : t('your repeater');
      return i18n.global.t('Not sent to {yours} {repeater}: {reason}', {
        yours,
        repeater: repeaterName(e),
        reason: reasonWords(e),
      });
    });
    return view;
  }
  const count = repeaterCount(entries);
  if (count <= 1) {
    view.lines = entries.map((e) => i18n.global.t('Not sent to {target}: {reason}', {
      target: targetName(e),
      reason: reasonWords(e),
    }));
    return view;
  }
  const groups = new Map<string, string[]>();
  for (const e of entries) {
    const words = reasonWords(e);
    groups.set(words, [...(groups.get(words) ?? []), repeaterName(e)]);
  }
  const sorted = [...groups].sort((a, b) => b[1].length - a[1].length);
  view.lines = [
    i18n.global.t('Not sent to {count} repeaters', { count }),
    sorted.map(([words, names]) => i18n.global.t('{count} {reason}', { count: names.length, reason: words })).join(' · '),
  ];
  view.summary = i18n.global.t('Show the {count} repeaters', { count });
  view.details = sorted.map(([words, names]) => {
    const shown = names.slice(0, LISTED_PER_REASON).join(', ');
    const more = names.length - LISTED_PER_REASON;
    return `${capitalize(words)}: ${shown}${more > 0 ? i18n.global.t(', and {count} more', { count: more }) : ''}`;
  });
  return view;
}

const POSITION_ERRORS: Record<number, string> = {
  0: '±2 m',
  1: '±20 m',
  2: '±200 m',
  3: '±2 km',
  4: '±20 km',
  5: '±200 km',
  6: '>200 km',
};

const MOTOROLA_FID = 0x10;

export function hex(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
}

export function typeOf(row: CallRow): TypeKey {
  const kind = row.kind || 'voice';
  if (kind === 'data') {
    return row.sub_kind === 'sms' ? 'sms' : 'data';
  }
  if (CONTROL_KINDS.includes(kind)) {
    return 'control';
  }
  if (kind === 'voice' || kind === 'gps' || kind === 'alias' || kind === 'csbk') {
    return kind;
  }
  return 'unknown';
}

export function typeLabel(key: TypeKey): string {
  return TYPES.find((t) => t.key === key)?.label ?? t('Unknown');
}

function sizeText(row: CallRow): string {
  const blocks = row.blocks ?? 0;
  const octets = row.octets ?? 0;
  return `${i18n.global.t('{count} block | {count} blocks', { count: blocks })}, ${octets} B`;
}

function responseName(row: CallRow): string {
  switch (row.response) {
    case 'ack':
      return 'ACK';
    case 'nack':
      return 'NACK';
    case 'sack':
      return 'SACK';
    default:
      return t('no reply');
  }
}

function hasSize(row: CallRow): boolean {
  return (row.blocks ?? 0) > 0 || (row.octets ?? 0) > 0;
}

function smsLines(row: CallRow): string[] {
  const sap = row.sap ?? null;
  const format = t(SMS_FORMATS[row.data_format || ''] || 'Text');
  const sub = sap === null ? format : `${format} · SAP ${SAP_NAMES[sap] || 'SAP'} (${sap})`;
  const resp = row.confirmed
    ? i18n.global.t('Confirmed, {response}', { response: responseName(row) })
    : t('Unconfirmed');
  return [sub, `${resp}, ${sizeText(row)}`];
}

function dataLines(row: CallRow): string[] {
  if (row.sub_kind === 'response') {
    return [t('Response'), responseName(row)];
  }
  const lines: string[] = [];
  const sap = row.sap ?? null;
  if (sap !== null) {
    let sub = `SAP ${sap} ${SAP_NAMES[sap] || ''}`.trim();
    const extra = DATA_SUBS[row.sub_kind || ''];
    if (extra) {
      sub += ` · ${extra}`;
    }
    lines.push(sub);
  }
  if (hasSize(row) || row.confirmed) {
    let subx = `${row.confirmed ? t('Confirmed') : t('Unconfirmed')}, ${sizeText(row)}`;
    if (row.confirmed) {
      subx += `, ${responseName(row)}`;
    }
    lines.push(subx);
  }
  return lines;
}

function csbkLines(row: CallRow): string[] {
  const sub = row.sub_kind || '';
  const lines = [t(CSBK_NAMES[sub] || humanize(sub))];
  if (sub === 'preamble') {
    lines.push(i18n.global.t('{count} burst | {count} bursts', { count: row.bursts ?? 1 }));
  } else if (row.fid === MOTOROLA_FID) {
    lines.push(`Motorola FID ${hex(MOTOROLA_FID)}${row.response === 'ack' ? ', ACK' : ''}`);
  }
  return lines.filter((l) => l !== '');
}

function controlLines(row: CallRow): string[] {
  switch (row.kind) {
    case 'udt':
      return ['UDT', sizeText(row)];
    case 'mbc': {
      const opcode = row.opcode ?? null;
      const detail = opcode === null ? '' : i18n.global.t('Opcode {opcode} {kind}', {
        opcode: hex(opcode),
        kind: humanize(row.sub_kind || ''),
      }).trim();
      return detail ? ['MBC', detail] : ['MBC'];
    }
    case 'idle':
      return [t('Idle'), t('PR fill')];
    case 'usbd':
      return row.sub_kind ? ['USBD', humanize(row.sub_kind)] : ['USBD'];
  }
  return [];
}

function unknownLines(row: CallRow): string[] {
  if (row.sub_kind === 'csbk') {
    const opcode = row.opcode ?? 0;
    const fid = row.fid ?? 0;
    return [
      i18n.global.t('CSBK opcode {opcode}', { opcode: hex(opcode) }),
      i18n.global.t('FID {fid}, forwarded unchanged', { fid: hex(fid) }),
    ];
  }
  return [
    t(UNKNOWN_NAMES[row.sub_kind || ''] || 'Unknown burst'),
    t('Forwarded unchanged'),
  ];
}

function gpsLines(row: CallRow): string[] {
  if (row.partial) {
    return [t('Partial position')];
  }
  const parts: string[] = [];
  if (row.grid) {
    parts.push(row.grid);
  }
  const err = row.position_error ?? null;
  if (err !== null && POSITION_ERRORS[err]) {
    parts.push(POSITION_ERRORS[err]);
  }
  return parts.length ? [parts.join(' · ')] : [];
}

function aliasLines(row: CallRow): string[] {
  if (row.partial) {
    return [t('Partial alias')];
  }
  const lines: string[] = [];
  if (row.talker_alias) {
    lines.push(row.talker_alias);
  }
  if (row.alias_format) {
    lines.push(i18n.global.t('Format {format}', { format: row.alias_format }));
  }
  return lines;
}

export function typeLines(row: CallRow): string[] {
  let lines: string[];
  switch (typeOf(row)) {
    case 'voice':
      lines = row.sub_kind === 'encrypted' ? [t('Encrypted')] : [];
      break;
    case 'sms':
      lines = smsLines(row);
      break;
    case 'data':
      lines = dataLines(row);
      break;
    case 'csbk':
      lines = csbkLines(row);
      break;
    case 'control':
      lines = controlLines(row);
      break;
    case 'gps':
      lines = gpsLines(row);
      break;
    case 'alias':
      lines = aliasLines(row);
      break;
    default:
      lines = unknownLines(row);
  }
  return lines;
}

export function isVoice(row: CallRow): boolean {
  return typeOf(row) === 'voice';
}

export function matchesFilter(row: CallRow, filter: TypeFilterValue): boolean {
  if (!filter.types.includes(typeOf(row))) {
    return false;
  }
  return filter.idle || !IDLE_KINDS.includes(row.kind || '');
}

export function filterQuery(filter: TypeFilterValue): string {
  let q = `types=${filter.types.join(',')}`;
  if (filter.idle) {
    q += '&idle=true';
  }
  return q;
}

export function defaultFilter(): TypeFilterValue {
  return { types: [...DEFAULT_TYPES], idle: false };
}

export function cleanCalls(data: Record<string, unknown>[] | null | undefined): CallRow[] {
  if (!data) {
    return [];
  }
  const rows = JSON.parse(JSON.stringify(data));
  for (const row of rows) {
    row.start_time = new Date(row.start_time);
    if (typeof row.duration == 'number') {
      row.duration = (row.duration / 1000000000).toFixed(1);
    }
    if (typeof row.loss == 'number') {
      row.loss = (row.loss * 100).toFixed(1);
    }
    if (typeof row.ber == 'number') {
      row.ber = (row.ber * 100).toFixed(1);
    }
    if (typeof row.jitter == 'number') {
      row.jitter = row.jitter.toFixed(1);
    }
    if (typeof row.rssi == 'number') {
      row.rssi = row.rssi.toFixed(0);
    }
  }
  return rows;
}

export function durationText(row: CallRow): string {
  if (isVoice(row)) {
    return `${row.duration}s`;
  }
  return Number(row.duration) > 0 ? `${row.duration}s` : '-';
}

export function berText(row: CallRow): string {
  return isVoice(row) ? `${row.ber}%` : '-';
}

export function lossText(row: CallRow): string {
  return isVoice(row) ? `${row.loss}%` : '-';
}

export function jitterText(row: CallRow): string {
  return isVoice(row) ? `${row.jitter}ms` : '-';
}

export function rssiText(row: CallRow): string {
  const rssi = Number(row.rssi);
  return isVoice(row) && rssi !== 0 ? `-${rssi}dBm` : '-';
}

export const TYPE_COLORS: Record<TypeKey, { badge: string; chip: string; dot: string }> = {
  voice: { badge: 'bg-blue-500/10 text-blue-500', chip: 'border-blue-500/45 bg-blue-500/10', dot: 'bg-blue-500' },
  data: { badge: 'bg-cyan-500/10 text-cyan-500', chip: 'border-cyan-500/45 bg-cyan-500/10', dot: 'bg-cyan-500' },
  sms: { badge: 'bg-green-500/10 text-green-500', chip: 'border-green-500/45 bg-green-500/10', dot: 'bg-green-500' },
  gps: { badge: 'bg-teal-500/10 text-teal-500', chip: 'border-teal-500/45 bg-teal-500/10', dot: 'bg-teal-500' },
  alias: { badge: 'bg-purple-500/10 text-purple-500', chip: 'border-purple-500/45 bg-purple-500/10', dot: 'bg-purple-500' },
  csbk: { badge: 'bg-orange-500/10 text-orange-500', chip: 'border-orange-500/45 bg-orange-500/10', dot: 'bg-orange-500' },
  control: { badge: 'bg-indigo-500/10 text-indigo-500', chip: 'border-indigo-500/45 bg-indigo-500/10', dot: 'bg-indigo-500' },
  unknown: { badge: 'bg-zinc-500/10 text-zinc-500', chip: 'border-zinc-500/45 bg-zinc-500/10', dot: 'bg-zinc-500' },
};
