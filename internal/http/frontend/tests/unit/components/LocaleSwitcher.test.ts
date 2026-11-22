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

import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import LocaleSwitcher from '@/components/LocaleSwitcher.vue';
import { i18n, setLocale } from '@/i18n';

describe('LocaleSwitcher', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('switches to Chinese and persists the choice', async () => {
    const wrapper = mount(LocaleSwitcher);
    const select = wrapper.get('select');
    expect(select.element.value).toBe('en');

    await select.setValue('zh-CN');

    expect(i18n.global.locale.value).toBe('zh-CN');
    expect(localStorage.getItem('locale')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('translates its own label', async () => {
    setLocale('zh-CN');
    const wrapper = mount(LocaleSwitcher);
    expect(wrapper.text()).toContain('语言');
  });
});
