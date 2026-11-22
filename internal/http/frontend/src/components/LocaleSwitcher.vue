<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  DMRHub - Run a DMR network server in a single binary
  Copyright (C) 2023-2026 Jacob McSwain

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program. If not, see <https://www.gnu.org/licenses/>.

  The source code is available at <https://github.com/USA-RedDragon/DMRHub>
-->

<template>
  <label class="inline-flex items-center gap-1 text-sm text-muted-foreground">
    <span class="sr-only">{{ $t('Language') }}</span>
    <select
      class="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
      :value="locale"
      :aria-label="$t('Language')"
      data-test="locale-switcher"
      @change="onChange"
    >
      <option
        v-for="item in SUPPORTED_LOCALES"
        :key="item.code"
        :value="item.code"
      >
        {{ item.label }}
      </option>
    </select>
  </label>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { SUPPORTED_LOCALES, setLocale, type LocaleCode } from '@/i18n';

const { locale } = useI18n();

const onChange = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value;
  if (value === 'en' || value === 'zh-CN') {
    setLocale(value as LocaleCode);
  }
};
</script>
