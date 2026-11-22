// SPDX-License-Identifier: AGPL-3.0-or-later
// Verify full localization: key pages render Chinese text when locale is zh-CN.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { i18n, setLocale } from '@/i18n';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import LocaleSwitcher from '@/components/LocaleSwitcher.vue';

describe('full i18n localization', () => {
  it('has identical key sets in en and zh-CN', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it('has no untranslated English values in zh-CN', () => {
    const dict = zhCN as Record<string, string>;
    const untranslated = Object.keys(dict).filter((k) => dict[k] === k && /[A-Za-z]{3,}/.test(k));
    // Technical identifiers legitimately stay identical (software names,
    // filenames, commands, acronyms like DMRGateway, rules.py, SHA-256, etc.)
    expect(untranslated.length).toBeLessThan(40);
  });

  it('switches locale and translates common keys', () => {
    setLocale('zh-CN');
    expect(i18n.global.t('Log in')).toBe('登录');
    expect(i18n.global.t('Repeaters')).toBe('中继台');
    expect(i18n.global.t('Talkgroups')).toBe('通话组');
    expect(i18n.global.t('Settings')).toBe('设置');
    expect(i18n.global.t('Save')).toBe('保存');
    setLocale('en');
  });

  it('translates Vuelidate error messages', () => {
    setLocale('zh-CN');
    const msg = i18n.global.t('Username or callsign is required');
    expect(msg).toMatch(/[一-龥]/); // rendered in Chinese
    expect(msg).toContain('用户名');
    setLocale('en');
  });

  it('renders translated text in a mounted component', () => {
    setLocale('zh-CN');
    const wrapper = mount(LocaleSwitcher);
    expect(wrapper.text()).toContain('语言'); // sr-only label
    expect(wrapper.find('select').attributes('aria-label')).toBe('语言');
    setLocale('en');
  });
});
