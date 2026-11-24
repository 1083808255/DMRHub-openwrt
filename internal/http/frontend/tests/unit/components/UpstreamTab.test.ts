// SPDX-License-Identifier: AGPL-3.0-or-later
// DMRHub - Run a DMR network server in a single binary
// Copyright (C) 2023-2026 Jacob McSwain

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

vi.mock('@/services/API', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

import API from '@/services/API';
import { formatDateTime } from '@/lib/dateFormat';
import UpstreamTab from '@/components/setup/menu/UpstreamTab.vue';

const mockAPI = API as unknown as { get: Mock };

const networks = () => [
  { name: 'BM', enabled: true, dialect: 'mmdvm', address: 'master.example.org', port: 62031, id: 1, password: '', callsign: 'DMRHUB', rxFrequency: 438800000, txFrequency: 438800000, colorCode: 1, slots: 3, options: '' },
  { name: 'DMR+', enabled: false, dialect: 'mmdvm', address: 'master2.example.org', port: 62031, id: 2, password: '', callsign: 'DMRHUB', rxFrequency: 438800000, txFrequency: 438800000, colorCode: 1, slots: 3, options: '' },
];

const mountTab = async (value: unknown): Promise<VueWrapper> => {
  const wrapper = mount(UpstreamTab, {
    props: { value, saves: 0, passwordsSet: [true, true] },
    global: { mocks: { $toast: { add: vi.fn() } } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const lastSet = (wrapper: VueWrapper): { enabled: boolean; networks: { name: string; enabled: boolean }[] } => {
  const events = wrapper.emitted('set') as unknown[][];
  return events[events.length - 1]![1] as { enabled: boolean; networks: { name: string; enabled: boolean }[] };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAPI.get.mockResolvedValue({ data: { enabled: true, running: true, links: [] } });
});

describe('UpstreamTab per-network switch', () => {
  it('shows a labelled switch for each network', async () => {
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    expect(wrapper.find('[data-test="upstream-network-enabled-0"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="upstream-network-enabled-1"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Enabled');
    expect(wrapper.text()).toContain('Disabled');
    wrapper.unmount();
  });

  it('turns one network off without touching the other', async () => {
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await wrapper.find('[data-test="upstream-network-enabled-0"]').trigger('click');
    const value = lastSet(wrapper);
    expect(value.networks[0]!.enabled).toBe(false);
    expect(value.networks[1]!.enabled).toBe(false);
    expect(value.enabled).toBe(true);
    wrapper.unmount();
  });

  it('turns a network on and says that it was off', async () => {
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    expect(wrapper.text()).toContain('This network is off');
    await wrapper.find('[data-test="upstream-network-enabled-1"]').trigger('click');
    expect(lastSet(wrapper).networks[1]!.enabled).toBe(true);
    wrapper.unmount();
  });

  it('keeps the master switch separate from the network switches', async () => {
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await wrapper.find('[data-test="upstreams-enabled"]').trigger('click');
    const value = lastSet(wrapper);
    expect(value.enabled).toBe(false);
    expect(value.networks[0]!.enabled).toBe(true);
    wrapper.unmount();
  });

  it('adds a network with every input, from an empty list', async () => {
    const wrapper = await mountTab({ enabled: true, networks: [], rewrites: [] });
    await wrapper.find('[data-test="upstream-network-add"]').trigger('click');
    const value = lastSet(wrapper);
    expect(value.networks).toHaveLength(1);
    // The parent writes the emitted value back as the prop.
    await wrapper.setProps({ value: { enabled: true, networks: value.networks, rewrites: [] } });
    for (const field of ['name', 'dialect', 'id', 'address', 'port', 'password', 'callsign', 'color', 'slots', 'rx', 'tx', 'options']) {
      expect(wrapper.find(`[data-test="upstream-network-${field}-0"]`).exists()).toBe(true);
    }
    expect(wrapper.find('[data-test="upstream-network-enabled-0"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('adds a second network with its own inputs', async () => {
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await wrapper.find('[data-test="upstream-network-add"]').trigger('click');
    const value = lastSet(wrapper);
    await wrapper.setProps({ value: { enabled: true, networks: value.networks, rewrites: [] } });
    expect(value.networks).toHaveLength(3);
    expect(wrapper.find('[data-test="upstream-network-name-2"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="upstream-network-address-2"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows the clock time of the last call, not how long ago it was', async () => {
    mockAPI.get.mockResolvedValue({
      data: {
        enabled: true, running: true,
        links: [{
          name: 'BM', up: true,
          since: '2026-11-25T00:00:00Z',
          lastHeard: '2026-11-24T19:30:00Z',
          rxBursts: 5, txBursts: 4, talkgroups: [],
        }],
      },
    });
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await flushPromises();
    const text = wrapper.text();
    // The clock time of the call, formatted the way the page formats it.
    const clock = formatDateTime(new Date('2026-11-24T19:30:00Z'), 'yyyy-MM-dd HH:mm:ss');
    expect(text).toContain(clock);
    expect(text).not.toMatch(/\d+\s*(hours?|hrs?|分钟|小时)\s*(ago|前)/i);
    wrapper.unmount();
  });

  it('puts the inputs above the link state, so a new network is not pushed out of view', async () => {
    mockAPI.get.mockResolvedValue({
      data: {
        enabled: true, running: true,
        links: [{ name: 'BM', up: true, since: '2026-11-25T00:00:00Z', rxBursts: 3, txBursts: 2, talkgroups: [{ tg: 91, rx: 3, tx: 2 }] }],
      },
    });
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await flushPromises();
    const html = wrapper.html();
    const inputsAt = html.indexOf('upstream-network-name-0');
    const stateAt = html.indexOf('data-test="upstream-links"');
    expect(inputsAt).toBeGreaterThan(-1);
    expect(stateAt).toBeGreaterThan(-1);
    expect(inputsAt).toBeLessThan(stateAt);
    wrapper.unmount();
  });
});
