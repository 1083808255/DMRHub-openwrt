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

  it('stops adding networks at five', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      name: `N${i}`, enabled: true, dialect: 'mmdvm', address: `n${i}.example.org`,
      port: 62031, id: i + 1, password: '', callsign: 'DMRHUB',
      rxFrequency: 438800000, txFrequency: 438800000, colorCode: 1, slots: 3, options: '',
    }));
    const wrapper = await mountTab({ enabled: true, networks: five, rewrites: [] });
    const add = wrapper.find('[data-test="upstream-network-add"]');
    expect(add.attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-test="upstream-network-limit"]').exists()).toBe(true);

    // The handler refuses too, not only the button.
    await add.trigger('click');
    expect(wrapper.emitted('set')).toBeUndefined();
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

  // The gateway sends null for the talkgroups of a link that carried nothing
  // yet. Reading .length of that null threw, which stopped the render of the
  // whole tab: no network card and no Add button, while the settings were
  // still there to fail validation on save.
  it('shows the network inputs even when a link has no talkgroups', async () => {
    mockAPI.get.mockResolvedValue({
      data: {
        enabled: true, running: true,
        links: [
          { name: 'CDN860', up: false, reason: 'Refused', rxBursts: 0, txBursts: 0, talkgroups: null },
          { name: 'CQDMR', up: true, since: '2026-11-25T00:26:06.895755186Z', rxBursts: 0, txBursts: 0, talkgroups: null },
        ],
      },
    });
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await flushPromises();
    expect(wrapper.find('[data-test="upstream-network-add"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="upstream-network-0"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="upstream-network-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="upstream-network-name-0"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="upstream-links"]').exists()).toBe(true);
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

describe('UpstreamTab password field', () => {
  it('hides a typed password until the eye is pressed, then shows it', async () => {
    const rows = networks();
    rows[0]!.password = 'SNT7WXr9J33z';
    const wrapper = await mountTab({ enabled: true, networks: rows, rewrites: [] });
    const box = wrapper.find('[data-test="upstream-network-password-0"]');
    expect(box.attributes('type')).toBe('password');
    await wrapper.find('[data-test="upstream-network-password-toggle-0"]').trigger('click');
    expect(wrapper.find('[data-test="upstream-network-password-0"]').attributes('type')).toBe('text');
    // The value the admin typed is the one shown, not a mask.
    expect((wrapper.find('[data-test="upstream-network-password-0"]').element as HTMLInputElement).value).toBe('SNT7WXr9J33z');
    await wrapper.find('[data-test="upstream-network-password-toggle-0"]').trigger('click');
    expect(wrapper.find('[data-test="upstream-network-password-0"]').attributes('type')).toBe('password');
    wrapper.unmount();
  });

  it('reveals one password without revealing another', async () => {
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await wrapper.find('[data-test="upstream-network-password-toggle-1"]').trigger('click');
    expect(wrapper.find('[data-test="upstream-network-password-0"]').attributes('type')).toBe('password');
    expect(wrapper.find('[data-test="upstream-network-password-1"]').attributes('type')).toBe('text');
    wrapper.unmount();
  });

  it('reads back the saved password when the eye is pressed on an empty field', async () => {
    mockAPI.get.mockImplementation((path: string) => {
      if (path === '/config/upstream/password/0') {
        return Promise.resolve({ data: { name: 'BM', password: 'xy147258' } });
      }
      return Promise.resolve({ data: { enabled: true, running: true, links: [] } });
    });
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await wrapper.find('[data-test="upstream-network-password-toggle-0"]').trigger('click');
    await flushPromises();
    const box = wrapper.find('[data-test="upstream-network-password-0"]').element as HTMLInputElement;
    expect(box.value).toBe('xy147258');
    // Reading it back must not put it into the rows: nothing was typed, so
    // nothing is committed and a save keeps the password that is there.
    expect(wrapper.emitted('set')).toBeUndefined();
    wrapper.unmount();
  });

  it('does not ask for a password when none is saved', async () => {
    const wrapper = mount(UpstreamTab, {
      props: { value: { enabled: true, networks: networks(), rewrites: [] }, saves: 0, passwordsSet: [false, false] },
      global: { mocks: { $toast: { add: vi.fn() } } },
      attachTo: document.body,
    });
    await flushPromises();
    await wrapper.find('[data-test="upstream-network-password-toggle-0"]').trigger('click');
    await flushPromises();
    expect(mockAPI.get.mock.calls.some((c) => String(c[0]).includes('/password/'))).toBe(false);
    wrapper.unmount();
  });

  it('keeps the saved password when the revealed text is cleared', async () => {
    mockAPI.get.mockImplementation((path: string) => {
      if (path === '/config/upstream/password/0') {
        return Promise.resolve({ data: { name: 'BM', password: 'xy147258' } });
      }
      return Promise.resolve({ data: { enabled: true, running: true, links: [] } });
    });
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await wrapper.find('[data-test="upstream-network-password-toggle-0"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-test="upstream-network-password-0"]').setValue('');
    const events = wrapper.emitted('set') as unknown[][];
    const last = events[events.length - 1]![1] as { networks: { password: string }[] };
    expect(last.networks[0]!.password).toBe('');
    wrapper.unmount();
  });

  it('moves the revealed password with its row when one is removed', async () => {
    mockAPI.get.mockImplementation((path: string) => {
      if (path === '/config/upstream/password/1') {
        return Promise.resolve({ data: { name: 'DMR+', password: 'second-secret' } });
      }
      return Promise.resolve({ data: { enabled: true, running: true, links: [] } });
    });
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await wrapper.find('[data-test="upstream-network-password-toggle-1"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-test="upstream-network-remove-0"]').trigger('click');
    await flushPromises();
    const box = wrapper.find('[data-test="upstream-network-password-0"]').element as HTMLInputElement;
    expect(box.value).toBe('second-secret');
    wrapper.unmount();
  });
});

describe('UpstreamTab link state', () => {
  it('reads the link state every three seconds', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mount(UpstreamTab, {
        props: { value: { enabled: true, networks: networks(), rewrites: [] }, saves: 0, passwordsSet: [true, true] },
        global: { mocks: { $toast: { add: vi.fn() } } },
        attachTo: document.body,
      });
      await vi.advanceTimersByTimeAsync(0);
      const first = mockAPI.get.mock.calls.length;
      await vi.advanceTimersByTimeAsync(3000);
      expect(mockAPI.get.mock.calls.length).toBe(first + 1);
      await vi.advanceTimersByTimeAsync(3000);
      expect(mockAPI.get.mock.calls.length).toBe(first + 2);
      wrapper.unmount();
      // A closed tab stops polling.
      const after = mockAPI.get.mock.calls.length;
      await vi.advanceTimersByTimeAsync(6000);
      expect(mockAPI.get.mock.calls.length).toBe(after);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells a refused login apart from a master that never answered', async () => {
    mockAPI.get.mockResolvedValue({
      data: {
        enabled: true, running: true,
        links: [
          { name: 'CDN860', up: false, reason: 'Refused', rxBursts: 0, txBursts: 0, talkgroups: [] },
          { name: 'BM4501', up: false, rxBursts: 0, txBursts: 0, talkgroups: [] },
        ],
      },
    });
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await flushPromises();
    expect(wrapper.find('[data-test="upstream-link-why-0"]').text()).toContain('refused the login');
    expect(wrapper.find('[data-test="upstream-link-why-1"]').text()).toContain('No answer from the master yet');
    wrapper.unmount();
  });

  it('tells a refused ID apart from a refused password', async () => {
    mockAPI.get.mockResolvedValue({
      data: {
        enabled: true, running: true,
        links: [
          { name: 'CQDMR', up: false, reason: 'Refused', stage: 'Login', rxBursts: 0, txBursts: 0, talkgroups: [] },
          { name: 'BM4602', up: false, reason: 'Refused', stage: 'Auth', rxBursts: 0, txBursts: 0, talkgroups: [] },
          { name: 'CDN860', up: false, reason: 'Refused', stage: 'Running', rxBursts: 0, txBursts: 0, talkgroups: [] },
        ],
      },
    });
    const wrapper = await mountTab({ enabled: true, networks: networks(), rewrites: [] });
    await flushPromises();
    expect(wrapper.find('[data-test="upstream-link-why-0"]').text()).toContain('before asking for the password');
    expect(wrapper.find('[data-test="upstream-link-why-1"]').text()).toContain('refused the password');
    expect(wrapper.find('[data-test="upstream-link-why-2"]').text()).toContain('same ID');
    wrapper.unmount();
  });
});
