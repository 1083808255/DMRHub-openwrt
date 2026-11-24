// SPDX-License-Identifier: AGPL-3.0-or-later
// DMRHub - Run a DMR network server in a single binary
// Copyright (C) 2023-2026 Jacob McSwain

import { describe, expect, it } from 'vitest';
import {
  upstreamOf, upstreamPasswordsOf, upstreamPayload, upstreamsError,
  emptyUpstreamNetwork, emptyUpstreamRewrite,
} from '@/lib/upstream';

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

  it('keeps typed passwords out of the config and into the secrets payload', () => {
    const rows = upstreamOf({ networks: [{ name: 'BM' }] });
    rows.networks[0]!.password = 'typed';
    const payload = upstreamPayload(rows) as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain('typed');
    expect(upstreamPasswordsOf(rows)).toEqual(['typed']);
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
    expect(upstreamPasswordsOf(again)).toEqual(['typed']);
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
});
