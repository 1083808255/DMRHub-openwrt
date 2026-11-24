// SPDX-License-Identifier: AGPL-3.0-or-later
// DMRHub - Run a DMR network server in a single binary
// Copyright (C) 2023-2026 Jacob McSwain

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

vi.mock('@/services/API', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

import API from '@/services/API';
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
});
