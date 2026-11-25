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

import { t } from '@/i18n';

/** One upstream network row while it is edited. Numbers may hold typed text. */
export type UpstreamNetworkRow = {
  name: string;
  enabled: boolean;
  dialect: 'mmdvm' | 'hbrp';
  address: string;
  port: number | string;
  id: number | string;
  password: string;
  callsign: string;
  rxFrequency: number | string;
  txFrequency: number | string;
  colorCode: number | string;
  slots: number | string;
  options: string;
};

/** One DMRGateway style talkgroup rewrite row while it is edited. */
export type UpstreamRewriteRow = {
  network: string;
  localTg: number | string;
  upstreamTg: number | string;
};

/** The whole upstream gateway config while it is edited. */
export type UpstreamValue = {
  enabled: boolean;
  networks: UpstreamNetworkRow[];
  rewrites: UpstreamRewriteRow[];
};

const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** A new, empty network with usable defaults. */
export const emptyUpstreamNetwork = (): UpstreamNetworkRow => ({
  name: '',
  enabled: true,
  dialect: 'mmdvm',
  address: '',
  port: 62031,
  id: '',
  password: '',
  callsign: 'DMRHUB',
  rxFrequency: 438800000,
  txFrequency: 438800000,
  colorCode: 1,
  slots: 3,
  options: '',
});

/** A new, empty rewrite rule. */
export const emptyUpstreamRewrite = (): UpstreamRewriteRow => ({
  network: '',
  localTg: '',
  upstreamTg: '',
});

/**
 * upstreamOf turns a config value into rows the editor can show.
 *
 * It accepts two shapes because the editor commits its rows back to the same
 * config path: the API shape (kebab-case keys) when first loaded, and the
 * editor's own row shape (camelCase keys) on every following recompute.
 *
 * Each field is read from whichever key is there, so a value of either shape
 * shows as it is. The password is no guide: the hub now saves it and sends
 * it back, so it is present in both shapes.
 *
 * A default is applied only when the field is missing, never when it is
 * empty: a user who clears a field must see it stay empty, or the default
 * comes straight back and the real validation error stays hidden.
 */
const rowValue = (v: unknown): number | string =>
  typeof v === 'number' || typeof v === 'string' ? v : '';

/** pick returns the value of the first key of raw that is present. */
const pick = (raw: Record<string, unknown>, ...keys: string[]): { v: unknown; found: boolean } => {
  for (const k of keys) {
    if (k in raw) return { v: raw[k], found: true };
  }
  return { v: undefined, found: false };
};

/** value reads a numeric field from either key, with a default when absent. */
const value = (raw: Record<string, unknown>, camel: string, kebab: string, dflt: number | string): number | string => {
  const { v, found } = pick(raw, camel, kebab);
  return found ? rowValue(v) : dflt;
};

export const upstreamOf = (v: unknown): UpstreamValue => {
  const src = typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const networks = Array.isArray(src.networks) ? src.networks : [];
  const rewrites = Array.isArray(src.rewrites) ? src.rewrites : [];
  return {
    enabled: src.enabled === true,
    networks: networks.map((raw) => {
      const n = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
      return {
        name: text(n.name),
        enabled: n.enabled !== false,
        dialect: n.dialect === 'hbrp' ? 'hbrp' : 'mmdvm',
        address: text(n.address),
        port: value(n, 'port', 'port', 62031),
        id: value(n, 'id', 'id', ''),
        password: text(n.password),
        callsign: text(n.callsign),
        rxFrequency: value(n, 'rxFrequency', 'rx-frequency', 438800000),
        txFrequency: value(n, 'txFrequency', 'tx-frequency', 438800000),
        colorCode: value(n, 'colorCode', 'color-code', 1),
        slots: value(n, 'slots', 'slots', 3),
        options: text(n.options),
      };
    }),
    rewrites: rewrites.map((raw) => {
      const r = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
      return {
        network: text(r.network),
        localTg: value(r, 'localTg', 'local-tg', ''),
        upstreamTg: value(r, 'upstreamTg', 'upstream-tg', ''),
      };
    }),
  };
};

/** upstreamPayload turns the editor rows back into the config API value. */
export const upstreamPayload = (v: UpstreamValue): Record<string, unknown> => ({
  enabled: v.enabled,
  networks: v.networks.map((n) => ({
    name: n.name.trim(),
    enabled: n.enabled,
    dialect: n.dialect,
    address: hostOf(n.address),
    port: Number(n.port) || 0,
    id: Number(n.id) || 0,
    callsign: n.callsign.trim(),
    'rx-frequency': Number(n.rxFrequency) || 0,
    'tx-frequency': Number(n.txFrequency) || 0,
    'color-code': Number(n.colorCode) || 0,
    slots: Number(n.slots) || 0,
    options: n.options.trim(),
  })),
  rewrites: v.rewrites.map((r) => ({
    network: r.network.trim(),
    'local-tg': Number(r.localTg) || 0,
    'upstream-tg': Number(r.upstreamTg) || 0,
  })),
});

/** MAX_NETWORKS is how many upstream networks one hub links to at most. */
export const MAX_NETWORKS = 5;

/**
 * upstreamPasswordsOf returns the passwords of the networks that have one,
 * keyed by network name. The hub matches them by name, so a network added,
 * renamed or removed does not move the password of another one.
 */
export const upstreamPasswordsOf = (v: UpstreamValue): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const n of v.networks) {
    const name = n.name.trim();
    const pw = text(n.password);
    if (name && pw) {
      out[name] = pw;
    }
  }
  return out;
};

const WHOLE = /^[1-9]\d*$/;
const TG = /^(0|[1-9]\d*)$/;
/** A host name or an IP address, with no scheme, path or port. */
const HOST = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

/**
 * hostOf returns the host of an address as an admin typed it, so that a
 * pasted URL such as https://master.brandmeister.network/ still saves.
 * The port belongs in its own field, so a port in the address is dropped.
 */
export const hostOf = (address: string): string => {
  let s = address.trim();
  const scheme = s.indexOf('://');
  if (scheme >= 0) s = s.slice(scheme + 3);
  const cut = s.search(/[/?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  const at = s.lastIndexOf('@');
  if (at >= 0) s = s.slice(at + 1);
  // A port after the last colon, unless the colons are those of IPv6.
  const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(s);
  if (m) s = m[1] as string;
  s = s.replace(/^\[/, '').replace(/\]$/, '');
  return s.trim();
};

/** upstreamsError is the error shown when the upstream settings cannot be saved. */
export const upstreamsError = (v: UpstreamValue, passwordsSet: boolean[]): string | undefined => {
  if (v.networks.length > MAX_NETWORKS) {
    return t('At most {n} upstream networks can be linked.', { n: MAX_NETWORKS });
  }
  const names = new Set<string>();
  for (const [i, n] of v.networks.entries()) {
    const at = i + 1;
    const name = n.name.trim();
    if (!name) {
      return t('Network {n}: a name is required.', { n: at });
    }
    if (names.has(name)) {
      return t('Network {n}: the name {name} is used twice.', { n: at, name });
    }
    names.add(name);
    if (!n.address.trim()) {
      return t('Network {n}: an address is required.', { n: at });
    }
    if (!HOST.test(hostOf(n.address))) {
      return t('Network {n}: enter a host name or IP address with no scheme or path, such as master.brandmeister.network.', { n: at });
    }
    if (!WHOLE.test(String(n.id)) || Number(n.id) < 1) {
      return t('Network {n}: the repeater ID must be a whole number of 1 or more.', { n: at });
    }
    const port = Number(n.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return t('Network {n}: the port must be a whole number from 1 to 65535.', { n: at });
    }
    const rx = Number(n.rxFrequency);
    const tx = Number(n.txFrequency);
    if (!Number.isInteger(rx) || rx < 1 || !Number.isInteger(tx) || tx < 1) {
      return t('Network {n}: the frequencies must be whole numbers of hertz.', { n: at });
    }
    const cc = Number(n.colorCode);
    if (!Number.isInteger(cc) || cc < 0 || cc > 15) {
      return t('Network {n}: the color code must be from 0 to 15.', { n: at });
    }
    const slots = Number(n.slots);
    if (!Number.isInteger(slots) || slots < 1 || slots > 4) {
      return t('Network {n}: the slots must be 1, 2, 3 or 4.', { n: at });
    }
    if (!text(n.password) && !passwordsSet[i]) {
      return t('Network {n}: a password is required unless one is already saved.', { n: at });
    }
  }
  for (const [i, r] of v.rewrites.entries()) {
    const at = i + 1;
    if (r.network && !names.has(r.network)) {
      return t('Rewrite {n}: the network {name} is not in the list.', { n: at, name: r.network });
    }
    for (const key of ['localTg', 'upstreamTg'] as const) {
      const raw = String(r[key]).trim();
      if (!TG.test(raw) || raw === '4000') {
        return t('Rewrite {n}: {field} must be a talkgroup number other than 4000.', { n: at, field: key === 'localTg' ? t('the local talkgroup') : t('the upstream talkgroup') });
      }
      const tg = Number(raw);
      if (tg < 1 || tg > 16777215) {
        return t('Rewrite {n}: {field} must be a talkgroup number from 1 to 16777215.', { n: at, field: key === 'localTg' ? t('the local talkgroup') : t('the upstream talkgroup') });
      }
    }
  }
  return undefined;
};
