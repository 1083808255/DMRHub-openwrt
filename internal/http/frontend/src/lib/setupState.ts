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

import type { InjectionKey } from 'vue';
import { t } from '@/i18n';

export type SettingSource = 'default' | 'setup' | 'file' | 'env' | 'flag' | 'generated' | 'wizard';

export type ReplicaValue = {
  replica: string;
  self: boolean;
  value: unknown;
  source: SettingSource;
};

export type Setting = {
  editable: boolean;
  locked: boolean;
  start_only: boolean;
  source: SettingSource;
  origin?: string;
  saved?: unknown;
  default?: unknown;
  not_in_effect: boolean;
  disagree: boolean;
  replicas?: ReplicaValue[];
};

export type ApplyError = { server: string; running: boolean; error: string };
export type FieldError = { field: string; error: string };

export type ReplicaStatus = {
  id: string;
  self: boolean;
  revision: number;
  current: boolean;
  at: string;
  apply_errors: ApplyError[] | null;
  invalid: FieldError[] | null;
};

export type WizardStatus = {
  phase: 'database' | 'setup' | 'done';
  database_error?: string;
  database_locked?: boolean;
  database_saved?: boolean;
  database_file?: string;
  store_error?: string;
};

export type SetupState = {
  loaded: boolean;
  settings: Record<string, Setting>;
  replicas: ReplicaStatus[];
  disagree: boolean;
  revision: number;
  wizard: WizardStatus | null;
};

export const setupStateKey: InjectionKey<SetupState> = Symbol('setupState');

export const emptySetupState = (): SetupState => ({
  loaded: false,
  settings: {},
  replicas: [],
  disagree: false,
  revision: 0,
  wizard: null,
});

/** The keys of a config response that describe the settings, not the config. */
export const stateKeys = ['settings', 'replicas', 'disagree', 'revision', 'wizard', 'secrets'];

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** Reads the setting state out of a config response. */
export const setupStateOf = (data: unknown): SetupState => {
  const d = asRecord(data) ?? {};
  return {
    loaded: true,
    settings: (asRecord(d.settings) as Record<string, Setting> | undefined) ?? {},
    replicas: Array.isArray(d.replicas) ? (d.replicas as ReplicaStatus[]) : [],
    disagree: d.disagree === true,
    revision: typeof d.revision === 'number' ? d.revision : 0,
    wizard: (asRecord(d.wizard) as WizardStatus | undefined) ?? null,
  };
};

/** The short name of a replica, as Setup shows it. */
export const replicaName = (id: string): string => id.slice(0, 4);

const servers: Record<string, string> = { mmdvm: 'MMDVM', ipsc: 'IPSC', openbridge: 'OpenBridge', modem: 'modem' };

/** The name of a DMR server, as Setup shows it. */
export const serverName = (server: string): string => servers[server] ?? 'DMR';

const labels: Record<string, string> = {
  'log-level': t('Log Level'),
  'network-name': t('Network Name'),
  'auto-approve-users': t('Approve new users automatically'),
  'secret': t('Secret'),
  'password-salt': t('Password Salt'),
  'hibp-api-key': t('HaveIBeenPwned API Key'),
  'http.bind': t('Bind Address (HTTP)'),
  'http.port': t('Port (HTTP)'),
  'http.trusted-proxies': t('Trusted Proxies (HTTP)'),
  'http.canonical-host': t('Canonical Host'),
  'http.cors.enabled': t('CORS'),
  'http.cors.extra-hosts': t('CORS Hosts'),
  'http.robots-txt.mode': t('robots.txt Mode'),
  'http.robots-txt.content': t('robots.txt Content'),
  'database.driver': t('Database Driver'),
  'database.database': t('Database'),
  'database.host': t('Database Host'),
  'database.port': t('Database Port'),
  'database.username': t('Database Username'),
  'database.password': t('Database Password'),
  'database.extra-parameters': t('Database Parameters'),
  'redis.enabled': t('Redis'),
  'redis.host': t('Redis Host'),
  'redis.port': t('Redis Port'),
  'redis.password': t('Redis Password'),
  'smtp.enabled': t('Email'),
  'smtp.host': t('SMTP Host'),
  'smtp.port': t('SMTP Port'),
  'smtp.tls': t('SMTP TLS'),
  'smtp.username': t('SMTP Username'),
  'smtp.password': t('SMTP Password'),
  'smtp.from': t('From Address'),
  'smtp.auth-method': t('SMTP Authentication'),
  'metrics.enabled': t('Metrics'),
  'metrics.bind': t('Bind Address (metrics)'),
  'metrics.port': t('Port (metrics)'),
  'metrics.trusted-proxies': t('Trusted Proxies (metrics)'),
  'metrics.otlp-endpoint': t('OTLP Endpoint'),
  'pprof.enabled': t('PProf'),
  'pprof.bind': t('Bind Address (PProf)'),
  'pprof.port': t('Port (PProf)'),
  'pprof.trusted-proxies': t('Trusted Proxies (PProf)'),
  'dmr.mmdvm.bind': t('Bind Address (MMDVM)'),
  'dmr.mmdvm.port': t('Port (MMDVM)'),
  'dmr.mmdvm.webtransport.enabled': t('Browser radios'),
  'dmr.mmdvm.webtransport.port': t('Port (browser radios)'),
  'dmr.mmdvm.webtransport.cert-file': t('Certificate File (browser radios)'),
  'dmr.mmdvm.webtransport.key-file': t('Key File (browser radios)'),
  'dmr.ipsc.enabled': t('IPSC'),
  'dmr.ipsc.bind': t('Bind Address (IPSC)'),
  'dmr.ipsc.port': t('Port (IPSC)'),
  'dmr.ipsc.network-id': t('Network ID (IPSC)'),
  'dmr.ipsc.call-hang-hold': t('Hang time after voice (IPSC)'),
  'dmr.ipsc.data-hang-hold': t('Hang time after data (IPSC)'),
  'dmr.modem.enabled': t('Modem'),
  'dmr.modem.port': t('Serial port (modem)'),
  'dmr.modem.baud': t('Speed (modem)'),
  'dmr.modem.repeater-id': t('Repeater ID (modem)'),
  'dmr.modem.duplex': t('Duplex (modem)'),
  'dmr.modem.color-code': t('Color code (modem)'),
  'dmr.modem.rx-frequency': t('Receive frequency (modem)'),
  'dmr.modem.tx-frequency': t('Transmit frequency (modem)'),
  'dmr.modem.rx-offset': t('Receive offset (modem)'),
  'dmr.modem.tx-offset': t('Transmit offset (modem)'),
  'dmr.modem.rf-level': t('RF level (modem)'),
  'dmr.modem.rx-level': t('Receive level (modem)'),
  'dmr.modem.tx-level': t('Transmit level (modem)'),
  'dmr.modem.rx-dc-offset': t('Receive DC offset (modem)'),
  'dmr.modem.tx-dc-offset': t('Transmit DC offset (modem)'),
  'dmr.modem.rx-invert': t('Invert receive (modem)'),
  'dmr.modem.tx-invert': t('Invert transmit (modem)'),
  'dmr.modem.ptt-invert': t('Invert PTT (modem)'),
  'dmr.modem.tx-delay': t('Transmit delay (modem)'),
  'dmr.modem.dmr-delay': t('DMR delay (modem)'),
  'dmr.modem.debug': t('Debug messages (modem)'),
  'dmr.openbridge.enabled': t('OpenBridge'),
  'dmr.openbridge.bind': t('Bind Address (OpenBridge)'),
  'dmr.openbridge.port': t('Port (OpenBridge)'),
  'dmr.openbridge.server-id': t('Server ID (OpenBridge)'),
  'dmr.disable-radio-id-validation': t('Turn off all RadioID checks'),
  'dmr.radio-id-checks.user-id': t('DMR ID has 7 digits'),
  'dmr.radio-id-checks.callsign': t('Callsign matches DMR ID'),
  'dmr.radio-id-checks.radio-ids': t('Added radio IDs'),
  'dmr.radio-id-checks.repeater-ids': t('Repeater IDs'),
  'dmr.radio-id-checks.hotspot-ids': t('Hotspot IDs start with owner ID'),
  'registration': t('Who can register'),
  'login-backoff': t('Pause an account after 10 failed logins'),
  'http.session-length': t('Login lasts'),
  'visibility': t('Visitors who are not logged in see'),
  'dmr.radio-id-url': t('Radio ID URL'),
  'dmr.repeater-id-url': t('Repeater ID URL'),
  'dmr.public-address': t('Public server address'),
  'dmr.retention.messages': t('Keep messages'),
  'dmr.messages.hold-days': t('Hold messages for'),
  'dmr.messages.hold-max': t('Most messages held for one user'),
  'dmr.retention.transmissions': t('Keep last heard'),
  'dmr.retention.bursts': t('Keep raw bursts'),
  'dmr.positions.min-interval': t('Shortest report interval'),
  'dmr.positions.max-retention': t('Longest position retention'),
  'dmr.positions.aprs-is.callsign': t('APRS-IS Callsign'),
  'dmr.positions.aprs-is.server': t('APRS-IS Server'),
  'dmr.plugins.in-process': t('Plugins inside DMRHub'),
  'dmr.plugins.enabled': t('Plugins as their own programs'),
  'dmr.plugins.bind': t('Bind Address (plugins)'),
  'dmr.plugins.port': t('Port (plugins)'),
  'dmr.plugins.cert-file': t('Certificate File (plugins)'),
  'dmr.plugins.key-file': t('Key File (plugins)'),
  'dmr.transcoding.ambe-servers': t('AMBE servers'),
  'dmr.drain-timeout': t('Drain Timeout'),
};

/** The name of the setting at path, as Setup shows it; never the path. */
export const settingLabel = (path: string): string => labels[path] ?? t('a setting');

/** A value of a setting, as Setup shows it. */
export const formatValue = (v: unknown): string => {
  if (v === null || v === undefined || v === '') {
    return t('empty');
  }
  if (typeof v === 'boolean') {
    return v ? t('on') : t('off');
  }
  if (Array.isArray(v)) {
    if (v.length === 0) {
      return t('none');
    }
    return v.map((e) => {
      const r = asRecord(e);
      return r && typeof r.address === 'string' ? r.address : String(e);
    }).join(', ');
  }
  return String(v);
};

const sources: Record<SettingSource, string> = {
  default: t('the default'),
  setup: t('saved in Setup'),
  file: t('set by its config file'),
  env: t('set by its environment'),
  flag: t('set by its command line'),
  generated: t('made by DMRHub'),
  wizard: t('set by the setup wizard'),
};

/** Where the value of a replica comes from, as Setup shows it. */
export const sourceText = (s: SettingSource): string => sources[s] ?? t('the default');

const deployments: Partial<Record<SettingSource, string>> = {
  file: t('config file'),
  env: t('environment'),
  flag: t('command line'),
};

/** The part of the deployment that sets a locked setting. */
export const deploymentPart = (s: SettingSource): string => deployments[s] ?? t('deployment');

/** Whether the value of a replica is not the one it should run with. */
export const replicaNotInEffect = (setting: Setting, r: ReplicaValue): boolean => {
  if (r.source !== 'setup' && r.source !== 'default') {
    return false;
  }
  const want = setting.saved !== undefined ? setting.saved : setting.default;
  return want !== undefined && JSON.stringify(want) !== JSON.stringify(r.value);
};
