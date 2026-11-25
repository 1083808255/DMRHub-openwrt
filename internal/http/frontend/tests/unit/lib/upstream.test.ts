// SPDX-License-Identifier: AGPL-3.0-or-later
// DMRHub - Run a DMR network server in a single binary
// Copyright (C) 2023-2026 Jacob McSwain

import { describe, expect, it } from 'vitest';
import {
  upstreamOf, upstreamPasswordsOf, upstreamPayload, upstreamsError, hostOf,
  emptyUpstreamNetwork, emptyUpstreamRewrite,
} from '@/lib/upstream';
import { TABS, tabPayload } from '@/lib/setupMenu';

describe('upstream config', () => {
  it('reads a config value and writes it back with kebab-case keys', () => {
    const source = {
      enabled: true,
      networks: [{
        name: 'BM', enabled: true, dialect: 'mmdvm', address: 'master.example.org',
        port: 62031, id: 1234567, callsign: 'DMRHUB',
        'rx-frequency': 438800000, 'tx-frequency': 438800000,
        'color-code': 1, slots: 3, options: 'TS2=91',
      }],
      rewrites: [{ network: 'BM', 'local-tg': 91, 'upstream-tg': 3100 }],
    };
    const rows = upstreamOf(source);
    expect(rows.enabled).toBe(true);
    expect(rows.networks[0]?.id).toBe(1234567);
    expect(rows.networks[0]?.password).toBe('');
    expect(rows.rewrites[0]?.localTg).toBe(91);

    const payload = upstreamPayload(rows) as Record<string, unknown>;
    const network = (payload.networks as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(network['rx-frequency']).toBe(438800000);
    expect(network.id).toBe(1234567);
    const rewrite = (payload.rewrites as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(rewrite['upstream-tg']).toBe(3100);
  });

  it('refuses more than five networks', () => {
    const net = (i: number) => ({
      name: `N${i}`, address: `n${i}.example.org`, id: i + 1,
      'rx-frequency': 1, 'tx-frequency': 1, 'color-code': 1, slots: 3, port: 1,
    });
    const five = upstreamOf({ enabled: true, networks: [1, 2, 3, 4, 5].map(net), rewrites: [] });
    expect(upstreamsError(five, [true, true, true, true, true])).toBeUndefined();

    const six = upstreamOf({ enabled: true, networks: [1, 2, 3, 4, 5, 6].map(net), rewrites: [] });
    expect(upstreamsError(six, [true, true, true, true, true, true])).toMatch(/at most/i);
  });

  it('keeps typed passwords out of the config and into the secrets payload', () => {
    const rows = upstreamOf({ networks: [{ name: 'BM' }] });
    rows.networks[0]!.password = 'typed';
    const payload = upstreamPayload(rows) as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain('typed');
    expect(upstreamPasswordsOf(rows)).toEqual({ BM: 'typed' });
  });

  // The hub reads the passwords of the networks at secrets.upstreams.passwords.
  // At the top level the payload is an unknown setting, so the hub dropped
  // them and the password of a network added after the first save was never
  // stored, which made the save fail.
  it('sends the passwords where the hub reads them', () => {
    const tab = TABS.find((t) => t.custom === 'upstream')!;
    const rows = upstreamOf({
      enabled: true,
      networks: [
        { name: 'A', address: 'a.example.org', id: 1, 'rx-frequency': 1, 'tx-frequency': 1, 'color-code': 1, slots: 3, port: 1 },
        { name: 'B', address: 'b.example.org', id: 2, 'rx-frequency': 1, 'tx-frequency': 1, 'color-code': 1, slots: 3, port: 1 },
        { name: 'C', address: 'c.example.org', id: 3, 'rx-frequency': 1, 'tx-frequency': 1, 'color-code': 1, slots: 3, port: 1 },
      ],
      rewrites: [],
    });
    rows.networks[0]!.password = 'one';
    rows.networks[1]!.password = 'two';
    rows.networks[2]!.password = 'three';
    const edited = { dmr: { upstreams: rows }, secrets: { upstreams: { passwords: upstreamPasswordsOf(rows) } } };
    const payload = tabPayload(tab, { dmr: { upstreams: { enabled: true, networks: [], rewrites: [] } } }, edited) as Record<string, unknown>;
    const secrets = payload.secrets as { upstreams?: { passwords?: Record<string, string> } } | undefined;
    // Keyed by name, so the order of the networks cannot move a password.
    expect(secrets?.upstreams?.passwords).toEqual({ A: 'one', B: 'two', C: 'three' });
    expect(payload).not.toHaveProperty('upstreams');
  });

  it('keeps typed values when the editor re-derives rows from the committed value', () => {
    const rows = upstreamOf({
      enabled: true,
      networks: [{
        name: 'BM', enabled: true, dialect: 'mmdvm', address: 'master.example.org',
        port: 62031, id: 1234567, callsign: 'DMRHUB',
        'rx-frequency': 439000000, 'tx-frequency': 439000000,
        'color-code': 2, slots: 2, options: 'TS2=91',
      }],
      rewrites: [{ network: 'BM', 'local-tg': 91, 'upstream-tg': 3100 }],
    });
    rows.networks[0]!.password = 'typed';

    // UpstreamTab commits its rows to the config path, then recomputes rows
    // with upstreamOf on every keystroke. Nothing the user typed may be lost.
    const again = upstreamOf(rows);
    expect(again.networks[0]!.password).toBe('typed');
    expect(again.networks[0]!.rxFrequency).toBe(439000000);
    expect(again.networks[0]!.colorCode).toBe(2);
    expect(again.rewrites[0]!.localTg).toBe(91);
    expect(upstreamsError(again, [false])).toBeUndefined();
    expect(upstreamPasswordsOf(again)).toEqual({ BM: 'typed' });
  });

  it('lets the user clear the callsign without the default coming back', () => {
    const rows = upstreamOf({
      networks: [{
        name: 'BM', address: 'master.example.org', id: 1234567,
        port: 62031, callsign: 'DMRHUB',
        'rx-frequency': 438800000, 'tx-frequency': 438800000,
        'color-code': 1, slots: 3,
      }],
    });
    expect(rows.networks[0]!.callsign).toBe('DMRHUB');

    rows.networks[0]!.callsign = '';
    const again = upstreamOf(rows);
    expect(again.networks[0]!.callsign).toBe('');

    const payload = upstreamPayload(again) as Record<string, unknown>;
    const network = (payload.networks as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(network.callsign).toBe('');

    // Loading the saved value back must not reinsert the default either.
    const reloaded = upstreamOf(payload);
    expect(reloaded.networks[0]!.callsign).toBe('');
  });

  it('keeps cleared numeric fields empty through editor recompute', () => {
    const rows = upstreamOf({ networks: [{ name: 'BM', address: 'a', id: 1 }] });
    rows.networks[0]!.port = '';
    rows.networks[0]!.rxFrequency = '';
    rows.networks[0]!.colorCode = '';
    rows.networks[0]!.slots = '';
    rows.rewrites.push({ network: 'BM', localTg: 91, upstreamTg: 3100 });
    rows.rewrites[0]!.localTg = '';

    const again = upstreamOf(rows);
    expect(again.networks[0]!.port).toBe('');
    expect(again.networks[0]!.rxFrequency).toBe('');
    expect(again.networks[0]!.colorCode).toBe('');
    expect(again.networks[0]!.slots).toBe('');
    expect(again.rewrites[0]!.localTg).toBe('');
    expect(upstreamsError(again, [true])).toContain('port');
  });

  it('accepts a pasted URL and saves only its host', () => {
    const rows = upstreamOf({
      networks: [{ name: 'CQDMR', address: 'https://dmr.wakepc.cn/', id: 461244711 }],
    });
    expect(upstreamsError(rows, [true])).toBeUndefined();

    const payload = upstreamPayload(rows) as Record<string, unknown>;
    const network = (payload.networks as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(network.address).toBe('dmr.wakepc.cn');
  });

  it('drops a scheme, path, user and port from the address', () => {
    for (const [input, want] of [
      ['dmr.wakepc.cn', 'dmr.wakepc.cn'],
      ['https://dmr.wakepc.cn', 'dmr.wakepc.cn'],
      ['http://dmr.wakepc.cn:62031', 'dmr.wakepc.cn'],
      ['https://user:pw@dmr.wakepc.cn/path?q=1', 'dmr.wakepc.cn'],
      ['[2001:db8::1]:62031', '2001:db8::1'],
      ['  10.0.0.5  ', '10.0.0.5'],
    ] as const) {
      expect(hostOf(input)).toBe(want);
    }
  });

  it('validates networks and rewrites', () => {
    const rows = upstreamOf({ networks: [], rewrites: [] });
    expect(upstreamsError(rows, [])).toBeUndefined();
    rows.networks.push(emptyUpstreamNetwork());
    expect(upstreamsError(rows, [])).toContain('name is required');
    rows.networks[0]!.name = 'BM';
    expect(upstreamsError(rows, [false])).toContain('address is required');
    rows.networks[0]!.address = 'master.example.org';
    expect(upstreamsError(rows, [false])).toContain('repeater ID');
    rows.networks[0]!.id = 1234567;
    expect(upstreamsError(rows, [false])).toContain('a password is required');
    expect(upstreamsError(rows, [true])).toBeUndefined();

    rows.rewrites.push(emptyUpstreamRewrite());
    expect(upstreamsError(rows, [true])).toContain('local talkgroup');
    rows.rewrites[0]!.localTg = 91;
    rows.rewrites[0]!.upstreamTg = 91;
    expect(upstreamsError(rows, [true])).toBeUndefined();
  });

  it('rejects duplicate network names and unknown rewrite networks', () => {
    const rows = upstreamOf({
      networks: [{ name: 'BM', address: 'a', id: 1 }, { name: 'BM', address: 'b', id: 2 }],
      rewrites: [{ network: 'Other', 'local-tg': 91, 'upstream-tg': 91 }],
    });
    expect(upstreamsError(rows, [true, true])).toContain('used twice');
    rows.networks[1]!.name = 'DMRPlus';
    expect(upstreamsError(rows, [true, true])).toContain('not in the list');
  });

  // The hub saves the password of a network and sends it back, so the
  // presence of a password says nothing about where the value came from.
  // The kebab-case keys say it, and they must be read as such.
  it('reads the API shape even when it carries a password', () => {
    const rows = upstreamOf({
      enabled: true,
      networks: [{
        name: 'CQDMR', enabled: true, dialect: 'mmdvm', address: 'dmr.wakepc.cn',
        port: 62031, id: 461244711, password: 'a-secret', callsign: 'BH8GLN',
        'rx-frequency': 434500000, 'tx-frequency': 439500000, 'color-code': 1,
        slots: 3, options: 'TS2=86023',
      }],
      rewrites: [{ network: 'CQDMR', 'local-tg': 100, 'upstream-tg': 86023 }],
    });
    const n = rows.networks[0]!;
    expect(n.rxFrequency).toBe(434500000);
    expect(n.txFrequency).toBe(439500000);
    expect(n.colorCode).toBe(1);
    expect(n.slots).toBe(3);
    expect(n.port).toBe(62031);
    expect(n.id).toBe(461244711);
    expect(rows.rewrites[0]!.localTg).toBe(100);
    expect(rows.rewrites[0]!.upstreamTg).toBe(86023);
    expect(upstreamsError(rows, [true])).toBeUndefined();
  });

  it('keeps a cleared field cleared in the editor shape', () => {
    const rows = upstreamOf({
      networks: [{
        name: 'BM', enabled: true, dialect: 'mmdvm', address: 'a', port: '', id: '',
        password: '', callsign: '', rxFrequency: '', txFrequency: '', colorCode: '',
        slots: '', options: '',
      }],
      rewrites: [],
    });
    const n = rows.networks[0]!;
    // A cleared callsign stays empty, so the field can be cleared.
    expect(n.callsign).toBe('');
    expect(n.rxFrequency).toBe('');
    expect(n.slots).toBe('');
  });
});
