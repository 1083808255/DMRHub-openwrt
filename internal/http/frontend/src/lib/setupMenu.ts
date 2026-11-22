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

import { ambeServersPayload, type AmbeServerRow } from '@/lib/codec';
import { ipListCount, ipListError } from '@/lib/ipList';
import { PROMPT_VOICES } from '@/lib/prompts';
import { formatValue, type Setting, type SetupState } from '@/lib/setupState';
import { i18n, t } from '@/i18n';

export type Values = Record<string, unknown>;

/** Reads the value of the setting at path from the values on the page. */
export type Read = (path: string) => unknown;

export type FieldKind =
  | 'text'
  | 'number'
  | 'bool'
  | 'select'
  | 'choice'
  | 'list'
  | 'textarea'
  | 'secret'
  | 'seconds'
  | 'minutes'
  | 'hours'
  | 'mhz'
  | 'mode'
  | 'port'
  | 'segment'
  | 'duration';

export type Option = { value: string | number; label: string; description?: string };

/** One setting on a tab of the Setup page. */
export type FieldDef = {
  path: string;
  label: string;
  kind: FieldKind;
  help?: string | ((read: Read) => string);
  /** Links shown after the help, each one a sentence. */
  links?: { text: string; href: string }[];
  options?: Option[];
  show?: (read: Read) => boolean;
  off?: (read: Read) => boolean;
  also?: (value: unknown, read: Read) => [string, unknown][];
  placeholder?: string;
  step?: string;
  uppercase?: boolean;
  required?: boolean;
  /** Lines of a list or a textarea. */
  rows?: number;
  /** Makes a list a list of whole numbers. */
  numbers?: boolean;
  /** Shows the number of entries of a list next to its label. */
  count?: boolean;
  /** Why the value cannot be saved, checked while it is typed. */
  check?: (value: unknown) => string | undefined;
  /** A warning about a value that can be saved. */
  warn?: (read: Read) => string | undefined;
  /** Shows a bool setting on when it is false, for a setting that turns a feature off. */
  invert?: boolean;
  /**
   * A switch in front of a number setting whose 0 is off: off saves 0 and
   * hides the input, on saves value.
   */
  toggle?: { label: string; value: number };
};

export type GridRow = { grid: FieldDef[] };
export type DetailsRow = { details: string; rows: Row[] };
export type TextRow = { text: string | ((read: Read) => string) };
export type Row = FieldDef | GridRow | DetailsRow | TextRow;

export type CardDef = {
  title: string;
  rows: Row[];
  cards?: CardDef[];
  showCards?: (read: Read) => boolean;
  pill?: 'modem';
  custom?: 'modem-test' | 'prompts';
};

export type IntroPart = string | { text: string; to: string };

export type TabGroup = 'Server' | 'Users' | 'DMR' | 'Features';

/** One tab of the Setup page, at /admin/setup#id. */
export type TabDef = {
  id: string;
  group: TabGroup;
  name: string;
  intro: IntroPart[];
  cards: CardDef[];
  custom?: 'transcoding';
  saveNote?: string;
  optional?: boolean;
};

/** A dot on a tab of the Setup menu: unsaved changes, or a setting to fix. */
export type TabMark = 'dirty' | 'error';

export const isGrid = (r: Row): r is GridRow => 'grid' in r;
export const isDetails = (r: Row): r is DetailsRow => 'details' in r;
export const isText = (r: Row): r is TextRow => 'text' in r;
export const isField = (r: Row): r is FieldDef => 'path' in r;

const on = (path: string) => (read: Read) => read(path) === true;

/** Why a list of local talkgroups cannot be saved, or undefined. */
export const localTalkgroupsError = (v: unknown): string | undefined => {
  const lines = (Array.isArray(v) ? v : []).map((e) => String(e).trim()).filter((e) => e !== '');
  const seen = new Set<string>();
  for (const line of lines) {
    const n = Number(line);
    if (!/^\d+$/.test(line) || n < 1 || n > 16777215 || n === 4000) {
      return i18n.global.t('{number} is not a talkgroup number from 1 to 16777215, other than 4000.', { number: line });
    }
    if (seen.has(line)) {
      return i18n.global.t('{number} is in the list twice.', { number: line });
    }
    seen.add(line);
  }
  return undefined;
};

const hangHelp = (kind: string) =>
  i18n.global.t('How long data and CSBK calls to a slot wait after a {kind} call on it ends. 0 is off, at most 10 seconds.', { kind });

const reach: Option[] = [
  {
    value: 'hybrid',
    label: t('Hybrid'),
    description: t(
      'Any radio heard on a repeater of this network. A radio ID that a user owns counts only on the repeaters of that user or the ones that an admin trusts.',
    ),
  },
  {
    value: 'members',
    label: t('Members only'),
    description: t('Only the radio IDs that users own, on the repeaters of their owner or the ones that an admin trusts.'),
  },
  { value: 'anyone', label: t('Anyone'), description: t('Any radio, wherever DMRHub last heard it, with no owner check.') },
];

const unknown: Option[] = [
  { value: 'drop', label: t('Drop the call and log it'), description: t('DMRHub logs the call and sends it nowhere.') },
  { value: 'flood', label: t('Send it to every repeater'), description: t('Every repeater and hotspot of the network gets the call.') },
];

const sameAsVoice: Option = { value: '', label: t('The same as voice calls') };

const transmit: Option[] = [
  { value: 'any', label: t('Any radio') },
  { value: 'radioid', label: t('Radio IDs on RadioID') },
  { value: 'members', label: t('Accounts and their radio IDs') },
];

const contention: Option[] = [
  { value: 'mix', label: t('Send both') },
  { value: 'first', label: t('First talker holds it') },
];

const ipModes: Option[] = [
  { value: 'off', label: t('Off') },
  { value: 'block', label: t('Block listed') },
  { value: 'allow', label: t('Allow only listed') },
];

const ipListCard = (key: string, title: string, refused: string): CardDef => {
  const base = `dmr.ip-lists.${key}`;
  const mode = (read: Read) => read(`${base}.mode`);
  return {
    title,
    rows: [
      { path: `${base}.mode`, label: t('Mode'), kind: 'segment', options: ipModes },
      {
        path: `${base}.block`, label: t('Blocked addresses'), kind: 'list', rows: 6, count: true, placeholder: '203.0.113.7',
        show: (read) => mode(read) === 'block', check: ipListError,
      },
      {
        path: `${base}.allow`, label: t('Allowed addresses'), kind: 'list', rows: 6, count: true, placeholder: '192.0.2.0/24',
        show: (read) => mode(read) === 'allow', check: ipListError,
        warn: (read) => (ipListCount(read(`${base}.allow`)) === 0
          ? i18n.global.t('With no address listed, every {refused} is refused.', { refused })
          : undefined),
      },
    ],
  };
};

/** The tabs of the Setup page, in the order of the menu. */
const registration: Option[] = [
  { value: 'open', label: t('Anyone') },
  { value: 'invite', label: t('Invite only') },
  { value: 'closed', label: t('Nobody') },
];

const visibility: Option[] = [
  { value: 'public', label: t('Everything') },
  { value: 'hide-names', label: t('No names or positions') },
  { value: 'login', label: t('Nothing') },
];

const serverDatabase = (read: Read) => read('database.driver') !== 'sqlite';

const checksOn = (read: Read) => read('dmr.disable-radio-id-validation') !== true;

/** Nanoseconds in an hour and in a day, the units of a duration field. */
export const HOUR = 3.6e12;
export const DAY = 24 * HOUR;

/** The unit that shows a duration of n nanoseconds as a whole number. */
export const durationUnit = (n: number): number => (n !== 0 && n % DAY === 0 ? DAY : HOUR);

export const TABS: TabDef[] = [
  {
    id: 'general',
    group: 'Server',
    name: t('General'),
    intro: [t('The name of the network, the log, new users and the secrets.')],
    cards: [
      {
        title: t('General'),
        rows: [
          { path: 'network-name', label: t('Network name'), kind: 'text', help: t('The name of the network, shown at the top of every page.') },
          {
            path: 'log-level', label: t('Log level'), kind: 'select', help: t('How much DMRHub writes to its log.'),
            options: ['debug', 'info', 'warn', 'error'].map((v) => ({ value: v, label: v })),
          },
          {
            path: 'auto-approve-users', label: t('Approve new users at once'), kind: 'bool',
            help: t('New users can log in as soon as they register, with no wait for an admin.'),
          },
        ],
      },
      {
        title: t('Secrets'),
        rows: [
          { path: 'secret', label: t('Secret'), kind: 'secret', help: t('At least 15 random characters.') },
          { path: 'password-salt', label: t('Password salt'), kind: 'secret', help: t('Salt for the password hashes of the users. Different from the secret.') },
          { path: 'hibp-api-key', label: t('Have I Been Pwned API key'), kind: 'secret', help: t('Checks new passwords against known leaks. Empty turns the check off.') },
        ],
      },
    ],
  },
  {
    id: 'accounts',
    group: 'Users',
    name: t('Accounts'),
    intro: [],
    cards: [
      {
        title: t('Registration'),
        rows: [{ path: 'registration', label: t('Who can register'), kind: 'segment', options: registration }],
      },
      {
        title: t('RadioID checks'),
        rows: [
          { path: 'dmr.disable-radio-id-validation', label: t('Turn off all checks'), kind: 'bool' },
          {
            grid: [
              { path: 'dmr.radio-id-checks.user-id', label: t('DMR ID has 7 digits'), kind: 'bool', show: checksOn },
              { path: 'dmr.radio-id-checks.callsign', label: t('Callsign matches DMR ID'), kind: 'bool', show: checksOn },
              { path: 'dmr.radio-id-checks.radio-ids', label: t('Added radio IDs'), kind: 'bool', show: checksOn },
              { path: 'dmr.radio-id-checks.repeater-ids', label: t('Repeater IDs'), kind: 'bool', show: checksOn },
              { path: 'dmr.radio-id-checks.hotspot-ids', label: t('Hotspot IDs start with owner ID'), kind: 'bool', show: checksOn },
            ],
          },
        ],
      },
      {
        title: t('Logins'),
        rows: [
          { path: 'login-backoff', label: t('Pause an account after 10 failed logins'), kind: 'bool' },
          { path: 'http.session-length', label: t('Login lasts'), kind: 'duration' },
        ],
      },
      {
        title: t('Visibility'),
        rows: [{ path: 'visibility', label: t('Visitors who are not logged in see'), kind: 'segment', options: visibility }],
      },
      {
        title: t('Listen-only monitor'),
        rows: [
          {
            path: 'listen.listeners', label: t('Listeners at once'), kind: 'number',
            toggle: { label: t('Let visitors listen in DMRHub Radio'), value: 200 },
            help: t('Visitors with no account hear one talkgroup at a time and cannot talk. The limit is for each server.'),
            warn: (read) => (read('visibility') === 'login' && Number(read('listen.listeners')) > 0
              ? t('Visitors see nothing, so nobody can listen.')
              : undefined),
          },
          {
            path: 'listen.per-address', label: t('Listeners from one address'), kind: 'number', show: (read) => Number(read('listen.listeners')) > 0,
            help: t('For each server. 0 is no limit.'),
          },
        ],
      },
    ],
  },
  {
    id: 'http',
    group: 'Server',
    name: t('HTTP'),
    intro: [t('The URL of the site, robots.txt and the web server.')],
    cards: [
      {
        title: t('Site'),
        rows: [
          {
            path: 'http.canonical-host', label: t('Site URL'), kind: 'text', placeholder: 'https://dmrhub.example.org',
            help: t('The URL that people use to reach this site.'),
            check: (v) => (String(v ?? '').trim() === '' ? t('Required.') : undefined),
          },
          {
            path: 'http.robots-txt.mode', label: t('robots.txt'), kind: 'select',
            options: [
              { value: 'disabled', label: t('Ask search engines not to index the site') },
              { value: 'allow', label: t('Let search engines index the site') },
              { value: 'custom', label: t('Use my own robots.txt') },
            ],
          },
          { path: 'http.robots-txt.content', label: t('robots.txt content'), kind: 'textarea', show: (read) => read('http.robots-txt.mode') === 'custom' },
        ],
      },
      {
        title: t('Web server'),
        rows: [
          { path: 'http.bind', label: t('Bind address'), kind: 'text', help: t('The address that the web server listens on.') },
          { path: 'http.port', label: t('Port'), kind: 'number', help: t('The TCP port of the web server.') },
          { path: 'http.trusted-proxies', label: t('Trusted proxies'), kind: 'list', help: t('Addresses of the reverse proxies in front of DMRHub, one for each line.') },
          { path: 'http.cors.enabled', label: t('Allow other sites to call the API (CORS)'), kind: 'bool' },
          {
            path: 'http.cors.extra-hosts', label: t('Other allowed origins'), kind: 'list',
            help: t('One for each line, such as https://radio.example.org.'), show: on('http.cors.enabled'),
          },
        ],
      },
    ],
  },
  {
    id: 'database',
    group: 'Server',
    name: t('Database'),
    intro: [t('Where DMRHub keeps its data, the Setup settings among them.')],
    cards: [
      {
        title: t('Database'),
        rows: [
          {
            path: 'database.driver', label: t('Driver'), kind: 'select',
            help: t('SQLite for small networks and tests. PostgreSQL or MySQL for more than one replica.'),
            options: [
              { value: 'sqlite', label: t('SQLite') },
              { value: 'postgres', label: t('PostgreSQL') },
              { value: 'mysql', label: t('MySQL or MariaDB') },
            ],
          },
          { path: 'database.database', label: t('Database'), kind: 'text', help: t('The name of the database, or the path of the SQLite file.') },
          {
            grid: [
              { path: 'database.host', label: t('Host'), kind: 'text', show: serverDatabase },
              { path: 'database.port', label: t('Port'), kind: 'number', show: serverDatabase },
              { path: 'database.username', label: t('Username'), kind: 'text', show: serverDatabase },
              { path: 'database.password', label: t('Password'), kind: 'secret', show: serverDatabase },
            ],
          },
          { path: 'database.extra-parameters', label: t('Extra parameters'), kind: 'list', help: t('Added to the connection, one for each line.') },
        ],
      },
    ],
  },
  {
    id: 'redis',
    group: 'Server',
    name: t('Redis'),
    intro: [t('Redis shares calls and state between replicas.')],
    cards: [
      {
        title: t('Redis'),
        rows: [
          { path: 'redis.enabled', label: t('Use Redis'), kind: 'bool', help: t('Redis is needed for more than one replica.') },
          { path: 'redis.host', label: t('Host'), kind: 'text' },
          { path: 'redis.port', label: t('Port'), kind: 'number' },
          { path: 'redis.password', label: t('Password'), kind: 'secret' },
        ],
      },
    ],
  },
  {
    id: 'smtp',
    group: 'Server',
    name: t('SMTP'),
    intro: [t('The mail server that DMRHub sends email through.')],
    cards: [
      {
        title: t('Email'),
        rows: [
          { path: 'smtp.enabled', label: t('Send email'), kind: 'bool', help: t('For password resets and notices to users.') },
          { path: 'smtp.host', label: t('SMTP host'), kind: 'text' },
          { path: 'smtp.port', label: t('SMTP port'), kind: 'number' },
          {
            path: 'smtp.tls', label: t('TLS'), kind: 'select',
            options: [
              { value: 'none', label: t('None') },
              { value: 'starttls', label: t('STARTTLS') },
              { value: 'implicit', label: t('Implicit TLS') },
            ],
          },
          {
            path: 'smtp.auth-method', label: t('Authentication'), kind: 'select',
            options: [
              { value: 'none', label: t('None') },
              { value: 'plain', label: t('Plain') },
              { value: 'login', label: t('Login') },
            ],
          },
          { path: 'smtp.username', label: t('Username'), kind: 'text' },
          { path: 'smtp.password', label: t('Password'), kind: 'secret' },
          { path: 'smtp.from', label: t('From address'), kind: 'text' },
        ],
      },
    ],
  },
  {
    id: 'metrics',
    group: 'Server',
    name: t('Metrics and PProf'),
    intro: [t('Monitoring and debugging listeners.')],
    cards: [
      {
        title: t('Metrics'),
        rows: [
          { path: 'metrics.enabled', label: t('Serve metrics'), kind: 'bool', help: t('Prometheus metrics on their own port.') },
          { path: 'metrics.bind', label: t('Bind address'), kind: 'text' },
          { path: 'metrics.port', label: t('Port'), kind: 'number' },
          { path: 'metrics.trusted-proxies', label: t('Trusted proxies'), kind: 'list' },
          { path: 'metrics.otlp-endpoint', label: t('OTLP endpoint'), kind: 'text', help: t('Where DMRHub sends its traces. Empty sends none.') },
        ],
      },
      {
        title: t('PProf'),
        rows: [
          { path: 'pprof.enabled', label: t('Serve PProf'), kind: 'bool', help: t('Profiles for debugging. Leave off unless a DMRHub developer asks for them.') },
          { path: 'pprof.bind', label: t('Bind address'), kind: 'text', show: on('pprof.enabled') },
          { path: 'pprof.port', label: t('Port'), kind: 'number', show: on('pprof.enabled') },
          { path: 'pprof.trusted-proxies', label: t('Trusted proxies'), kind: 'list', show: on('pprof.enabled') },
        ],
      },
    ],
  },
  {
    id: 'dmr',
    group: 'DMR',
    name: t('DMR and MMDVM'),
    intro: [t('Hotspots, MMDVMHost, DMRGateway, DroidStar and HBlink connect to the MMDVM server.')],
    cards: [
      {
        title: t('MMDVM server'),
        rows: [
          { path: 'dmr.mmdvm.bind', label: t('Bind address'), kind: 'text', help: t('The address that the MMDVM server listens on.') },
          { path: 'dmr.mmdvm.port', label: t('Port'), kind: 'number', help: t('The UDP port that hotspots connect to.') },
          {
            path: 'dmr.public-address', label: t('Public server address'), kind: 'text', placeholder: 'dmr.example.org',
            help: t('The host name or IP address that hotspots and repeaters connect to. Empty uses the host name of the site URL.'),
          },
        ],
      },
      {
        title: t('Radio IDs'),
        rows: [
          { path: 'dmr.radio-id-url', label: t('Radio ID list'), kind: 'text', help: t('In the format of RadioID.net.') },
          { path: 'dmr.repeater-id-url', label: t('Repeater ID list'), kind: 'text', help: t('In the format of RadioID.net.') },
        ],
      },
      {
        title: t('Records'),
        rows: [
          { path: 'dmr.retention.transmissions', label: t('Keep last heard (days)'), kind: 'number', help: t('0 keeps them forever.') },
          { path: 'dmr.retention.bursts', label: t('Keep raw bursts (days)'), kind: 'number', help: t('0 keeps them forever.') },
        ],
      },
      {
        title: t('Replicas'),
        rows: [
          {
            path: 'dmr.drain-timeout', label: t('Hand-over time (seconds)'), kind: 'number',
            help: t('How long a replica that stops keeps serving while other replicas take over. Shorter than the stop time of the orchestrator. 0 stops at once.'),
          },
        ],
      },
    ],
  },
  {
    id: 'ipsc',
    group: 'DMR',
    name: t('IPSC'),
    intro: [t('Motorola repeaters, such as the XPR 8400 and SLR 5500, connect over IPSC. Users enroll them as Motorola IPSC.')],
    cards: [
      {
        title: t('IPSC server'),
        rows: [
          { path: 'dmr.ipsc.enabled', label: t('Accept Motorola repeaters (IPSC)'), kind: 'bool' },
          { path: 'dmr.ipsc.bind', label: t('Bind address'), kind: 'text', show: on('dmr.ipsc.enabled') },
          { path: 'dmr.ipsc.port', label: t('Port'), kind: 'number', help: t('The UDP port that Motorola repeaters connect to.'), show: on('dmr.ipsc.enabled') },
          {
            path: 'dmr.ipsc.network-id', label: t('Network ID'), kind: 'number', required: true,
            help: t('The DMR ID that this server uses toward IPSC repeaters. Required.'), show: on('dmr.ipsc.enabled'),
          },
          { path: 'dmr.ipsc.call-hang-hold', label: t('Hang time after voice (seconds)'), kind: 'seconds', step: '0.1', help: hangHelp('voice'), show: on('dmr.ipsc.enabled') },
          { path: 'dmr.ipsc.data-hang-hold', label: t('Hang time after data (seconds)'), kind: 'seconds', step: '0.1', help: hangHelp('data'), show: on('dmr.ipsc.enabled') },
        ],
      },
    ],
  },
  {
    id: 'openbridge',
    group: 'DMR',
    name: t('OpenBridge'),
    intro: [
      t('Other servers, such as FreeDMR and HBlink, link with OpenBridge. Add each one on the '),
      { text: t('Peers'), to: '/admin/peers' },
      t(' page, with its rules.'),
    ],
    cards: [
      {
        title: t('OpenBridge server'),
        rows: [
          { path: 'dmr.openbridge.enabled', label: t('Accept OpenBridge peers'), kind: 'bool' },
          { path: 'dmr.openbridge.bind', label: t('Bind address'), kind: 'text', show: on('dmr.openbridge.enabled') },
          { path: 'dmr.openbridge.port', label: t('Port'), kind: 'number', help: t('The UDP port of OpenBridge links.'), show: on('dmr.openbridge.enabled') },
          {
            path: 'dmr.openbridge.server-id', label: t('Server ID'), kind: 'number', show: on('dmr.openbridge.enabled'),
            help: t('The server ID of 4 to 7 digits that DMRHub sends to FreeDMR peers. 0 sends the network ID of each peer.'),
          },
        ],
      },
    ],
  },
  {
    id: 'webtransport',
    group: 'DMR',
    name: t('WebTransport'),
    intro: [t('Hotspots and radios that run in a web browser connect over WebTransport. It uses the bind address of the MMDVM server.')],
    cards: [
      {
        title: t('Browser radios'),
        rows: [
          {
            path: 'dmr.mmdvm.webtransport.enabled', label: t('Accept browser hotspots and radios'), kind: 'bool',
            help: t('Such as DMRHub Radio. They log in with a hotspot ID and password, like any other hotspot.'),
            links: [{ text: t('Open DMRHub Radio.'), href: 'https://radio.dmrhub.net' }],
          },
          {
            path: 'dmr.mmdvm.webtransport.port', label: t('Port'), kind: 'number', show: on('dmr.mmdvm.webtransport.enabled'),
            help: t('The UDP port that browsers connect to. It must differ from the MMDVM port.'),
          },
          {
            path: 'dmr.mmdvm.webtransport.cert-file', label: t('Certificate file'), kind: 'text', placeholder: '/tls/tls.crt',
            show: on('dmr.mmdvm.webtransport.enabled'),
            help: t('Empty makes DMRHub use short-lived certificates of its own, which browsers accept with no setup.'),
          },
          {
            path: 'dmr.mmdvm.webtransport.key-file', label: t('Key file'), kind: 'text', placeholder: '/tls/tls.key',
            show: on('dmr.mmdvm.webtransport.enabled'), help: t('The key of the certificate file.'),
          },
          {
            path: 'dmr.mmdvm.webtransport.allowed-origins', label: t('Allowed web pages'), kind: 'list', show: on('dmr.mmdvm.webtransport.enabled'),
            help: t('Origins of the pages that may connect, one for each line, such as https://radio.example.org. Empty allows every page.'),
          },
        ],
      },
    ],
  },
  {
    id: 'modem',
    group: 'DMR',
    name: t('Modem'),
    intro: [
      t('DMRHub can drive an MMDVM modem board, such as an MMDVM_HS hat, an MMDVM repeater board or a DVMega, on a serial port.'),
    ],
    saveNote: t('Saving restarts the modem. Calls on it stop for a few seconds.'),
    cards: [
      {
        title: t('Modem'),
        pill: 'modem',
        rows: [
          { path: 'dmr.modem.enabled', label: t('Enabled'), kind: 'bool', help: t('Turn this on in one server only, the one that the board is plugged into.') },
        ],
        showCards: on('dmr.modem.enabled'),
        cards: [
          {
            title: t('Connection'),
            rows: [
              {
                grid: [
                  { path: 'dmr.modem.port', label: t('Serial port'), kind: 'port', placeholder: '/dev/ttyAMA0' },
                  {
                    path: 'dmr.modem.baud', label: t('Port speed'), kind: 'select', help: t('115200 for almost every board.'),
                    options: [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map((b) => ({ value: b, label: String(b) })),
                  },
                ],
              },
              {
                path: 'dmr.modem.repeater-id', label: t('Repeater ID'), kind: 'number', required: true,
                help: t('The ID of this hotspot or repeater on the network. If no repeater has this ID, DMRHub makes one, and an admin assigns its owner.'),
              },
              {
                path: 'dmr.modem.duplex', label: t('Mode'), kind: 'mode',
                also: (v, read) => (v === true ? [] : [
                  ['dmr.modem.tx-frequency', read('dmr.modem.rx-frequency')],
                  ['dmr.modem.beacons.enabled', false],
                ]),
              },
            ],
          },
          {
            title: t('Radio'),
            rows: [
              {
                grid: [
                  {
                    path: 'dmr.modem.rx-frequency', label: t('Receive frequency (MHz)'), kind: 'mhz', required: true,
                    also: (v, read) => (read('dmr.modem.duplex') === true ? [] : [['dmr.modem.tx-frequency', v]]),
                  },
                  { path: 'dmr.modem.tx-frequency', label: t('Transmit frequency (MHz)'), kind: 'mhz', required: true, show: on('dmr.modem.duplex') },
                ],
              },
              {
                grid: [
                  {
                    path: 'dmr.modem.color-code', label: t('Color code'), kind: 'select', help: t('Radios must use the same color code.'),
                    options: Array.from({ length: 16 }, (_, i) => ({ value: i, label: String(i) })),
                  },
                  { path: 'dmr.modem.rf-level', label: t('Transmit power (%)'), kind: 'number', step: 'any', help: t('On boards that set their power, such as MMDVM_HS hats.') },
                ],
              },
              {
                grid: [
                  { path: 'dmr.modem.rx-offset', label: t('Receive offset (Hz)'), kind: 'number', help: t('Correction for the frequency error of the board.') },
                  { path: 'dmr.modem.tx-offset', label: t('Transmit offset (Hz)'), kind: 'number', help: t('Correction for the frequency error of the board.') },
                ],
              },
              {
                details: t('Advanced radio settings'),
                rows: [
                  {
                    grid: [
                      { path: 'dmr.modem.rx-level', label: t('Receive level (%)'), kind: 'number', step: 'any' },
                      { path: 'dmr.modem.tx-level', label: t('Transmit level (%)'), kind: 'number', step: 'any' },
                      { path: 'dmr.modem.rx-dc-offset', label: t('Receive DC offset'), kind: 'number' },
                      { path: 'dmr.modem.tx-dc-offset', label: t('Transmit DC offset'), kind: 'number' },
                      { path: 'dmr.modem.tx-delay', label: t('Transmit delay (ms)'), kind: 'number' },
                      { path: 'dmr.modem.dmr-delay', label: t('Receive delay of a repeater (symbols)'), kind: 'number', show: on('dmr.modem.duplex') },
                    ],
                  },
                  { path: 'dmr.modem.rx-invert', label: t('Invert the receive audio'), kind: 'bool' },
                  { path: 'dmr.modem.tx-invert', label: t('Invert the transmit audio (most boards need this)'), kind: 'bool' },
                  { path: 'dmr.modem.ptt-invert', label: t('Invert the PTT output'), kind: 'bool' },
                  {
                    path: 'dmr.modem.rssi-mapping-file', label: t('RSSI mapping file'), kind: 'text', placeholder: '/etc/dmrhub/RSSI.dat',
                    help: t('An RSSI.dat file in the MMDVMHost format, which turns the signal reading of the board into dBm. Without it the signal strength of calls is not shown.'),
                    links: [
                      { text: t('Get the RSSI.dat of MMDVMHost.'), href: 'https://github.com/g4klx/MMDVM-Host/blob/master/RSSI.dat' },
                      { text: t('How to fill it in.'), href: 'https://github.com/USA-RedDragon/DMRHub/blob/main/doc/admin/modem.md#signal-strength-rssi' },
                    ],
                  },
                  { path: 'dmr.modem.debug', label: t('Log the debug messages of the board'), kind: 'bool' },
                ],
              },
            ],
          },
          {
            title: t('Station ID'),
            rows: [
              {
                path: 'dmr.modem.cw-id.enabled', label: t('Send a morse station ID'), kind: 'bool',
                help: t('The ID goes out only while the channel is idle. The first goes out a quarter of the time after the board connects or a call ends.'),
              },
              {
                grid: [
                  {
                    path: 'dmr.modem.cw-id.callsign', label: t('Callsign'), kind: 'text', uppercase: true, required: true,
                    help: t('Letters, digits, spaces and / ? , - = .'), show: on('dmr.modem.cw-id.enabled'),
                  },
                  { path: 'dmr.modem.cw-id.time', label: t('Minutes between IDs'), kind: 'number', help: t('1 to 1440.'), show: on('dmr.modem.cw-id.enabled') },
                ],
              },
            ],
          },
          {
            title: t('Beacons'),
            rows: [
              {
                path: 'dmr.modem.beacons.enabled', label: t('Key up the transmitter at intervals while the channel is idle'), kind: 'bool',
                off: (read) => read('dmr.modem.duplex') !== true,
                help: (read) => (read('dmr.modem.duplex') === true
                  ? t('Beacons let radios that roam find the repeater.')
                  : t('Beacons let radios that roam find the repeater. Only a repeater sends them; choose Repeater mode to turn them on.')),
              },
              {
                grid: [
                  {
                    path: 'dmr.modem.beacons.interval', label: t('Seconds between beacons'), kind: 'number',
                    show: (read) => read('dmr.modem.duplex') === true && read('dmr.modem.beacons.enabled') === true,
                  },
                  {
                    path: 'dmr.modem.beacons.duration', label: t('Seconds per beacon'), kind: 'number',
                    show: (read) => read('dmr.modem.duplex') === true && read('dmr.modem.beacons.enabled') === true,
                  },
                ],
              },
            ],
          },
          { title: t('Test the modem'), rows: [], custom: 'modem-test' },
        ],
      },
    ],
  },
  {
    id: 'transcoding',
    group: 'DMR',
    name: t('Transcoding'),
    intro: [t('AMBE servers convert calls between Codec2 and AMBE. With no server, calls pass through in their own codec.')],
    custom: 'transcoding',
    cards: [],
  },
  {
    id: 'iplists',
    group: 'DMR',
    name: t('IP lists'),
    intro: [],
    cards: [
      ipListCard('mmdvm', t('MMDVM hotspots and repeaters'), t('hotspot and repeater')),
      ipListCard('webtransport', t('Browser radios'), t('browser radio')),
      ipListCard('ipsc', t('Motorola IPSC repeaters'), t('IPSC repeater')),
      ipListCard('openbridge', t('OpenBridge peers'), t('peer')),
    ],
  },
  {
    id: 'routing',
    group: 'DMR',
    name: t('Routing'),
    intro: [],
    cards: [
      {
        title: t('Dynamic talkgroups'),
        rows: [
          { path: 'dmr.routing.disable-dynamic-links', label: t('Dynamic links'), kind: 'bool', invert: true },
          {
            path: 'dmr.routing.dynamic-timeout', label: t('Timeout (minutes)'), kind: 'minutes', help: t('0 never.'),
            show: (read) => read('dmr.routing.disable-dynamic-links') !== true,
          },
        ],
      },
      {
        title: t('Transmissions'),
        rows: [
          { path: 'dmr.routing.transmit', label: t('Who may transmit'), kind: 'segment', options: transmit },
          {
            path: 'dmr.routing.max-transmission', label: t('Longest transmission (seconds)'), kind: 'seconds',
            toggle: { label: t('Limit transmission length'), value: 180e9 },
          },
          { path: 'dmr.routing.contention', label: t('Two talkers at once'), kind: 'segment', options: contention },
          {
            path: 'dmr.routing.on-air-unlock', label: t('On-air unlock (hours)'), kind: 'hours', step: 'any',
            help: t('How long a right code unlocks a radio ID on its timeslot.'),
          },
        ],
      },
      {
        title: t('Spoken refusals'),
        custom: 'prompts',
        rows: [
          { path: 'dmr.routing.spoken-refusals', label: t('Tell the radio why its call was refused'), kind: 'bool' },
          {
            path: 'dmr.routing.prompt-voice', label: t('Voice'), kind: 'select', options: PROMPT_VOICES,
            help: t('Users can pick their own voice in Settings.'), show: on('dmr.routing.spoken-refusals'),
          },
          {
            path: 'dmr.routing.prompt-service-id', label: t('Service ID'), kind: 'number',
            help: t('The ID that the prompts come from, as a private call.'), show: on('dmr.routing.spoken-refusals'),
          },
        ],
      },
      {
        title: t('Talkgroups'),
        rows: [
          { path: 'dmr.routing.auto-create-talkgroups', label: t('Create unknown talkgroups'), kind: 'bool' },
          { path: 'dmr.routing.ephemeral-talkgroups', label: t('Ephemeral'), kind: 'bool', show: on('dmr.routing.auto-create-talkgroups') },
          {
            path: 'dmr.routing.ephemeral-ttl', label: t('Lifetime (hours after the last call)'), kind: 'hours', step: 'any',
            show: (read) => read('dmr.routing.auto-create-talkgroups') === true && read('dmr.routing.ephemeral-talkgroups') === true,
          },
          {
            path: 'dmr.routing.local-talkgroups', label: t('Local talkgroups'), kind: 'list', numbers: true, rows: 3, count: true,
            placeholder: '9',
            help: t('One for each line. A call to one of them stays in the local group of its repeater.'),
            check: localTalkgroupsError,
          },
        ],
      },
      {
        title: t('Repeaters'),
        rows: [{ path: 'dmr.repeater-quota', label: t('Repeaters for each user'), kind: 'number', help: t('0 no limit.') }],
      },
    ],
  },
  {
    id: 'positions',
    group: 'Features',
    name: t('Positions and APRS'),
    intro: [t('Owners turn on position tracking for each radio. These are the limits, and the APRS-IS login that sends the positions on.')],
    cards: [
      {
        title: t('Limits for owners'),
        rows: [
          {
            path: 'dmr.positions.min-interval', label: t('Shortest report interval'), kind: 'select',
            help: t('The shortest interval that an owner can pick for a radio.'),
            options: [5, 10, 15, 30, 60].map((m) => ({ value: m, label: `${m} minutes` })),
          },
          {
            path: 'dmr.positions.max-retention', label: t('Longest retention (days)'), kind: 'number',
            help: t('The longest time that an owner can keep the positions of a radio, 1 to 365.'),
          },
        ],
      },
      {
        title: t('APRS-IS'),
        rows: [
          {
            path: 'dmr.positions.aprs-is.callsign', label: t('APRS-IS callsign'), kind: 'text',
            help: t('The callsign with SSID that the hub logs in to APRS-IS as. Empty sends nothing to APRS-IS.'),
          },
          { path: 'dmr.positions.aprs-is.server', label: t('APRS-IS server'), kind: 'text', help: t('As host:port.') },
        ],
      },
    ],
  },
  {
    id: 'messages',
    group: 'Features',
    name: t('Messages'),
    intro: [t('Text and data messages between radios.')],
    cards: [
      {
        title: t('Messages'),
        rows: [
          {
            path: 'dmr.retention.messages', label: t('Keep messages (days)'), kind: 'number',
            help: t('Text and data messages, with their raw bytes. 0 keeps them forever.'),
          },
        ],
      },
      {
        title: t('Store and forward'),
        rows: [
          {
            path: 'dmr.messages.hold-days', label: t('Hold messages for (days)'), kind: 'number',
            help: t('How long DMRHub keeps a text for a radio that is off the air, 1 to 365.'),
          },
          {
            path: 'dmr.messages.hold-max', label: t('Most messages held for one user'), kind: 'number',
            help: t('DMRHub holds no more texts for a user who has this many waiting, 1 to 1000.'),
          },
        ],
      },
    ],
  },
  {
    id: 'plugins',
    group: 'Features',
    name: t('Plugins'),
    intro: [
      t('Plugins answer the calls to the IDs that an admin gives them. Add and assign them on the '),
      { text: t('Plugins'), to: '/admin/plugins' },
      t(' page.'),
    ],
    cards: [
      {
        title: t('Where plugins run'),
        rows: [
          {
            path: 'dmr.plugins.in-process', label: t('Run plugins inside DMRHub'), kind: 'bool',
            help: t('The parrot, the location server and the uploaded plugins. Turn it off only when every plugin runs as its own program.'),
          },
        ],
      },
      {
        title: t('Plugin listener'),
        rows: [
          { path: 'dmr.plugins.enabled', label: t('Accept plugins that run as their own programs'), kind: 'bool' },
          { path: 'dmr.plugins.bind', label: t('Bind address'), kind: 'text' },
          { path: 'dmr.plugins.port', label: t('Port'), kind: 'number', help: t('The TCP port that plugins connect to.') },
          {
            path: 'dmr.plugins.cert-file', label: t('Certificate file'), kind: 'text',
            help: t('Empty uses a certificate that DMRHub makes; plugins check it by its fingerprint.'),
          },
          { path: 'dmr.plugins.key-file', label: t('Key file'), kind: 'text' },
        ],
      },
    ],
  },
  {
    id: 'pcroute',
    group: 'Features',
    name: t('Private call routing'),
    optional: true,
    intro: [t('Where DMRHub sends a call or message to one radio. It goes to the repeater or hotspot where DMRHub last heard that radio.')],
    cards: [
      {
        title: t('Voice calls'),
        rows: [
          { path: 'dmr.private-calls.voice.reach', label: t('Who a private call can reach'), kind: 'choice', options: reach },
          { path: 'dmr.private-calls.voice.unknown', label: t('When DMRHub does not know where the radio is'), kind: 'choice', options: unknown },
          {
            path: 'dmr.private-calls.voice.max-age', label: t('Last heard age limit (minutes)'), kind: 'minutes',
            help: t('Calls go to where DMRHub last heard the radio. With a limit, a radio not heard for longer counts as unknown. 0 is no limit.'),
          },
        ],
      },
      {
        title: t('Text messages and data'),
        rows: [
          { path: 'dmr.private-calls.data.reach', label: t('Who a text message can reach'), kind: 'choice', options: [sameAsVoice, ...reach] },
          { path: 'dmr.private-calls.data.unknown', label: t('When DMRHub does not know where the radio is'), kind: 'choice', options: [sameAsVoice, ...unknown] },
          {
            path: 'dmr.private-calls.data.max-age', label: t('Last heard age limit (minutes)'), kind: 'minutes',
            help: t('0 uses the limit of voice calls. A negative number is no limit.'),
          },
        ],
      },
    ],
  },
];

/** The paths under obj, read one part of path at a time. */
export const getAt = (obj: unknown, path: string): unknown => {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
};

/** Sets the value at path in obj, with the objects on the way. */
export const setAt = (obj: Values, path: string, value: unknown): void => {
  const parts = path.split('.');
  let cur: Values = obj;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      cur[part] = {};
    }
    cur = cur[part] as Values;
  }
  cur[parts[parts.length - 1] as string] = value;
};

export const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)) as T);

const rowFields = (rows: Row[]): FieldDef[] => rows.flatMap((r) => {
  if (isGrid(r)) {
    return r.grid;
  }
  if (isDetails(r)) {
    return rowFields(r.rows);
  }
  if (isField(r)) {
    return [r];
  }
  return [];
});

const cardFields = (cards: CardDef[]): FieldDef[] =>
  cards.flatMap((c) => [...rowFields(c.rows), ...cardFields(c.cards ?? [])]);

/** The settings of a tab. */
export const tabFields = (tab: TabDef): FieldDef[] => cardFields(tab.cards);

export const AMBE_SERVERS = 'dmr.transcoding.ambe-servers';

/** The paths of the settings that the Save of a tab saves. */
export const tabPaths = (tab: TabDef): string[] =>
  tab.custom === 'transcoding' ? [AMBE_SERVERS] : tabFields(tab).map((f) => f.path);

/**
 * The errors of the shown settings of tab that their checks find, by
 * path.
 */
export const tabCheckErrors = (tab: TabDef, read: Read): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const f of tabFields(tab)) {
    if (!f.check || (f.show && !f.show(read))) {
      continue;
    }
    const e = f.check(normalize(f, read(f.path)));
    if (e) {
      out[f.path] = e;
    }
  }
  return out;
};

/** The tabs that the menu shows: an optional tab needs its settings. */
export const visibleTabs = (state: SetupState): TabDef[] =>
  TABS.filter((t) => !t.optional || tabPaths(t).some((p) => p in state.settings));

/** The tabs of the setup wizard: Database first, then the menu. */
export const wizardTabs = (state: SetupState): TabDef[] => {
  const tabs = visibleTabs(state);
  return [...tabs.filter((t) => t.id === 'database'), ...tabs.filter((t) => t.id !== 'database')];
};

/** The tab that holds the setting at path. */
export const tabOfPath = (path: string): TabDef | undefined => TABS.find((t) => tabPaths(t).includes(path));

/** The tab of a URL hash, such as #ipsc; the first tab for any other. */
export const tabOfHash = (hash: string, tabs: TabDef[]): TabDef => {
  const id = hash.replace(/^#/, '');
  return tabs.find((t) => t.id === id) ?? (tabs[0] as TabDef);
};

const numeric = (f: FieldDef) => f.options !== undefined && typeof f.options[0]?.value === 'number';

const toNumber = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The value of a field as the config API takes it. */
export const normalize = (f: FieldDef, v: unknown): unknown => {
  switch (f.kind) {
    case 'bool':
    case 'mode':
      return v === true;
    case 'number':
    case 'seconds':
    case 'minutes':
    case 'hours':
    case 'mhz':
    case 'duration':
      return toNumber(v);
    case 'list': {
      const lines = Array.isArray(v) ? v.map((e) => String(e).trim()).filter((e) => e !== '') : [];
      return f.numbers ? lines.map(Number) : lines;
    }
    case 'select':
    case 'choice':
      if (numeric(f)) {
        return toNumber(v);
      }
      return v === undefined || v === null ? '' : String(v);
    default:
      return v === undefined || v === null ? '' : String(v);
  }
};

type AmbeServerValue = { address: string; calls: number };

const ambeServersOf = (v: unknown): AmbeServerValue[] =>
  Array.isArray(v)
    ? ambeServersPayload(v.map((r) => {
      const row = (typeof r === 'object' && r !== null ? r : {}) as Partial<AmbeServerRow>;
      return { address: String(row.address ?? ''), calls: row.calls ?? 0 };
    }))
    : [];

const fieldOf = (tab: TabDef, path: string): FieldDef | undefined => tabFields(tab).find((f) => f.path === path);

const valueFor = (tab: TabDef, path: string, values: Values): unknown => {
  if (path === AMBE_SERVERS) {
    return ambeServersOf(getAt(values, path));
  }
  const f = fieldOf(tab, path);
  return f ? normalize(f, getAt(values, path)) : getAt(values, path);
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether the page holds changes to the settings of tab that are not saved. */
export const tabDirty = (tab: TabDef, original: Values, edited: Values): boolean =>
  tabPaths(tab).some((p) => !same(valueFor(tab, p, original), valueFor(tab, p, edited)));

/**
 * The config to save for tab: the saved config, with the values of the page
 * for the settings of tab only. The hub never sends a secret, so a secret
 * goes out only when the page changed it: the hub keeps a secret that the
 * payload lacks, and clears one that it sets to empty.
 */
export const tabPayload = (tab: TabDef, original: Values, edited: Values): Values => {
  const out = clone(original);
  for (const p of tabPaths(tab)) {
    if (fieldOf(tab, p)?.kind === 'secret' && same(getAt(edited, p), getAt(original, p))) {
      continue;
    }
    setAt(out, p, valueFor(tab, p, edited));
  }
  return out;
};

/**
 * The config to save for every tab at once: the saved config, with the
 * values of the page for the settings of each tab that has changes.
 */
export const allPayload = (original: Values, edited: Values): Values => {
  let out = clone(original);
  for (const t of TABS) {
    if (tabDirty(t, original, edited)) {
      out = tabPayload(t, out, edited);
    }
  }
  return out;
};

/**
 * The values of fresh, with the values of edited for the settings of the
 * dirty tabs other than saved, so that a Save keeps the changes on the
 * other tabs.
 */
export const keepEdits = (fresh: Values, original: Values, edited: Values, saved: TabDef | null): Values => {
  const out = clone(fresh);
  for (const t of TABS) {
    if (t === saved || !tabDirty(t, original, edited)) {
      continue;
    }
    for (const p of tabPaths(t)) {
      setAt(out, p, clone(getAt(edited, p)));
    }
  }
  return out;
};

export type ChipKind = 'default' | 'setup' | 'lock' | 'boot' | 'generated' | 'wizard' | 'differ' | 'not-in-effect';
export type Chip = { kind: ChipKind; text: string; code?: string };

/** The chips that say where the value of a setting comes from. */
export const sourceChips = (s: Setting | undefined): Chip[] => {
  if (!s) {
    return [];
  }
  const out: Chip[] = [];
  switch (s.source) {
    case 'env':
      out.push({ kind: 'lock', text: t('Environment'), code: s.origin });
      break;
    case 'flag':
      out.push({ kind: 'lock', text: t('Command line'), code: s.origin });
      break;
    case 'file':
      out.push({ kind: 'lock', text: t('Config file') });
      break;
    case 'setup':
      out.push({ kind: 'setup', text: t('Saved in Setup') });
      break;
    case 'generated':
      out.push({ kind: 'generated', text: t('Made by DMRHub') });
      break;
    case 'wizard':
      out.push({ kind: 'wizard', text: t('Set by the setup wizard') });
      break;
    default:
      out.push({ kind: 'default', text: t('Default') });
  }
  if (s.start_only && !s.editable && !s.locked && s.source !== 'generated' && s.source !== 'wizard') {
    out.push({ kind: 'boot', text: t('Read at start') });
  }
  if (s.disagree) {
    out.push({ kind: 'differ', text: t('Replicas differ') });
  }
  if (s.not_in_effect) {
    out.push({ kind: 'not-in-effect', text: t('Not in effect') });
  }
  return out;
};

/** Whether Setup cannot change the setting; one it does not know it can. */
export const fieldLocked = (s: Setting | undefined): boolean => s !== undefined && !s.editable;

/** Whether nothing on tab can change while DMRHub runs. */
export const tabReadOnly = (tab: TabDef, state: SetupState): boolean => {
  const paths = tabPaths(tab).filter((p) => p in state.settings);
  return paths.length > 0 && paths.every((p) => fieldLocked(state.settings[p]));
};

/** Whether every setting of tab takes effect at start only. */
export const tabStartOnly = (tab: TabDef, state: SetupState): boolean => {
  const paths = tabPaths(tab).filter((p) => p in state.settings);
  return paths.length > 0 && paths.every((p) => state.settings[p]?.start_only === true);
};

/** A value of a field, as the notes of the Setup page show it. */
export const shownValue = (f: FieldDef, v: unknown): string => {
  const n = normalize(f, v);
  switch (f.kind) {
    case 'seconds':
      return i18n.global.t('{value} seconds', { value: (n as number) / 1e9 });
    case 'minutes':
      return i18n.global.t('{value} minutes', { value: (n as number) / 6e10 });
    case 'hours':
      return i18n.global.t('{value} hours', { value: (n as number) / 3.6e12 });
    case 'mhz':
      return i18n.global.t('{value} MHz', { value: ((n as number) / 1e6).toFixed(4) });
    case 'duration': {
      const unit = durationUnit(n as number);
      const count = (n as number) / unit;
      return unit === DAY
        ? i18n.global.t('{value} days', { value: count })
        : i18n.global.t('{value} hours', { value: count });
    }
    case 'mode':
      return n ? t('Repeater (duplex)') : t('Hotspot (simplex)');
    case 'select':
    case 'choice':
      return f.options?.find((o) => o.value === n)?.label ?? formatValue(n);
    default:
      return formatValue(n);
  }
};

/**
 * The default of a setting saved in Setup, as the "Use the default" note
 * shows it, while the value on the page differs from it; undefined when
 * the note does not show.
 */
export const defaultNote = (f: FieldDef, s: Setting | undefined, value: unknown): string | undefined => {
  if (f.required || !s || !s.editable || s.source !== 'setup' || s.default === undefined) {
    return undefined;
  }
  if (same(normalize(f, value), normalize(f, s.default))) {
    return undefined;
  }
  return shownValue(f, s.default);
};

/** The value of an input for the value of a field. */
export const inputValue = (f: FieldDef, v: unknown): string => {
  switch (f.kind) {
    case 'seconds':
      return String(toNumber(v) / 1e9);
    case 'minutes':
      return String(toNumber(v) / 6e10);
    case 'hours':
      return String(toNumber(v) / 3.6e12);
    case 'mhz':
      return toNumber(v) === 0 ? '' : (toNumber(v) / 1e6).toFixed(4);
    case 'list':
      return Array.isArray(v) ? v.join('\n') : '';
    case 'number':
      return v === undefined || v === null || v === '' ? '0' : String(v);
    default:
      return v === undefined || v === null ? '' : String(v);
  }
};

/** The value of a field for the text of its input. */
export const fromInput = (f: FieldDef, text: string): unknown => {
  switch (f.kind) {
    case 'seconds':
      return Math.round(Number(text) * 1e9) || 0;
    case 'minutes':
      return Math.round(Number(text) * 6e10) || 0;
    case 'hours':
      return Math.round(Number(text) * 3.6e12) || 0;
    case 'mhz':
      return Math.round(Number(text) * 1e6) || 0;
    case 'list':
      return text.split('\n');
    case 'number':
      return text === '' ? '' : Number(text);
    case 'select':
    case 'choice':
      return numeric(f) ? Number(text) : text;
    default:
      return f.uppercase ? text.toUpperCase() : text;
  }
};
