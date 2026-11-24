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
  <div data-test="upstreams-tab">
    <Card class="mb-5" data-test="upstreams-general">
      <CardHeader class="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{{ $t('Upstream networks') }}</CardTitle>
        <span class="flex flex-wrap gap-1.5"><SourceChips :setting="setting" /></span>
      </CardHeader>
      <CardContent>
        <p class="mb-3 text-sm text-muted-foreground">
          {{ $t('Each network is a separate login to its master. Calls to a local talkgroup in the rewrite table go out to its upstream talkgroup, and calls from the upstream talkgroup arrive on the local one.') }}
        </p>
        <label class="flex items-center gap-2 text-sm font-medium">
          <Switch :model-value="value.enabled" :disabled="locked" data-test="upstreams-enabled" @update:model-value="setEnabled" />
          {{ $t('Link to upstream networks') }}
        </label>
        <p v-if="!value.enabled" class="mt-1.5 text-sm text-muted-foreground">
          {{ $t('Nothing is sent to or received from the upstreams until this is on.') }}
        </p>
        <SettingNote path="dmr.upstreams.enabled" menu class="mt-2" />
      </CardContent>
    </Card>

    <Card class="mb-5" data-test="upstreams-networks">
      <CardHeader class="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{{ $t('Networks') }}</CardTitle>
        <ShadButton type="button" variant="outline" size="sm" :disabled="locked" data-test="upstream-network-add" @click="addNetwork">
          {{ $t('Add a network') }}
        </ShadButton>
      </CardHeader>
      <CardContent>
        <p v-if="value.networks.length === 0" class="mb-3 text-sm text-muted-foreground">
          {{ $t('No network yet. Add one to link this hub to a master.') }}
        </p>
        <div
          v-for="(n, i) in value.networks"
          :key="i"
          class="mb-4 rounded-[10px] border p-3.5"
          :data-test="`upstream-network-${i}`"
        >
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <Switch :model-value="n.enabled" :disabled="locked" :aria-label="$t('Enable network {n}', { n: i + 1 })" :data-test="`upstream-network-enabled-${i}`" @update:model-value="(v: boolean) => setNetwork(i, 'enabled', v)" />
            <b class="text-sm">{{ n.name || $t('Unnamed network') }}</b>
            <ShadButton type="button" variant="outline" size="sm" class="ml-auto" :disabled="locked" :data-test="`upstream-network-remove-${i}`" @click="removeNetwork(i)">
              {{ $t('Remove') }}
            </ShadButton>
          </div>
          <div class="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            <label class="block text-sm">
              <span class="mb-1 block font-medium">{{ $t('Name') }}</span>
              <ShadInput :model-value="n.name" :disabled="locked" :placeholder="$t('Network name')" :aria-label="$t('Name of network {n}', { n: i + 1 })" :data-test="`upstream-network-name-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'name', String(v))" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium">{{ $t('Protocol') }}</span>
              <select :class="boxClass" :value="n.dialect" :disabled="locked" :aria-label="$t('Protocol of network {n}', { n: i + 1 })" :data-test="`upstream-network-dialect-${i}`" @change="(e: Event) => setNetwork(i, 'dialect', (e.target as HTMLSelectElement).value)">
                <option value="mmdvm">{{ $t('MMDVM') }}</option>
                <option value="hbrp">{{ $t('HBRP') }}</option>
              </select>
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium">{{ $t('Repeater ID') }}</span>
              <ShadInput :model-value="String(n.id)" :disabled="locked" inputmode="numeric" :aria-label="$t('Repeater ID of network {n}', { n: i + 1 })" :data-test="`upstream-network-id-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'id', v)" />
            </label>
            <label class="block text-sm md:col-span-2">
              <span class="mb-1 block font-medium">{{ $t('Master address') }}</span>
              <ShadInput :model-value="n.address" :disabled="locked" placeholder="master.brandmeister.network" :aria-label="$t('Address of network {n}', { n: i + 1 })" :data-test="`upstream-network-address-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'address', String(v))" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium">{{ $t('Port') }}</span>
              <ShadInput :model-value="String(n.port)" :disabled="locked" inputmode="numeric" :aria-label="$t('Port of network {n}', { n: i + 1 })" :data-test="`upstream-network-port-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'port', v)" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium">{{ $t('Password') }}</span>
              <ShadInput
                type="password"
                :model-value="n.password"
                :disabled="locked"
                :placeholder="passwordsSet[i] ? $t('Already saved') : $t('Required by most networks')"
                :aria-label="$t('Password of network {n}', { n: i + 1 })"
                :data-test="`upstream-network-password-${i}`"
                @update:model-value="(v: string | number) => setNetwork(i, 'password', String(v))"
              />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium">{{ $t('Callsign') }}</span>
              <ShadInput :model-value="n.callsign" :disabled="locked" :aria-label="$t('Callsign of network {n}', { n: i + 1 })" :data-test="`upstream-network-callsign-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'callsign', String(v))" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium">{{ $t('Color code') }}</span>
              <ShadInput :model-value="String(n.colorCode)" :disabled="locked" inputmode="numeric" :aria-label="$t('Color code of network {n}', { n: i + 1 })" :data-test="`upstream-network-color-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'colorCode', v)" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium">{{ $t('Slots') }}</span>
              <select :class="boxClass" :value="String(n.slots)" :disabled="locked" :aria-label="$t('Slots of network {n}', { n: i + 1 })" :data-test="`upstream-network-slots-${i}`" @change="(e: Event) => setNetwork(i, 'slots', (e.target as HTMLSelectElement).value)">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3 ({{ $t('both') }})</option>
                <option value="4">4 ({{ $t('simplex') }})</option>
              </select>
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium">{{ $t('Receive frequency (Hz)') }}</span>
              <ShadInput :model-value="String(n.rxFrequency)" :disabled="locked" inputmode="numeric" :aria-label="$t('Receive frequency of network {n}', { n: i + 1 })" :data-test="`upstream-network-rx-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'rxFrequency', v)" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium">{{ $t('Transmit frequency (Hz)') }}</span>
              <ShadInput :model-value="String(n.txFrequency)" :disabled="locked" inputmode="numeric" :aria-label="$t('Transmit frequency of network {n}', { n: i + 1 })" :data-test="`upstream-network-tx-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'txFrequency', v)" />
            </label>
            <label class="block text-sm md:col-span-2 lg:col-span-3">
              <span class="mb-1 block font-medium">{{ $t('Login options') }}</span>
              <ShadInput :model-value="n.options" :disabled="locked" placeholder="TS2=91" :aria-label="$t('Options of network {n}', { n: i + 1 })" :data-test="`upstream-network-options-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'options', String(v))" />
              <span class="mt-1 block text-xs text-muted-foreground">{{ $t('Sent to the master after login, such as TS2=91 for a static talkgroup on slot 2.') }}</span>
            </label>
          </div>
        </div>
        <SettingNote path="dmr.upstreams.networks" menu class="mt-2" />
      </CardContent>
    </Card>

    <Card class="mb-5" data-test="upstreams-rewrites">
      <CardHeader class="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{{ $t('Talkgroup rewrites') }}</CardTitle>
        <ShadButton type="button" variant="outline" size="sm" :disabled="locked" data-test="upstream-rewrite-add" @click="addRewrite">
          {{ $t('Add a rule') }}
        </ShadButton>
      </CardHeader>
      <CardContent>
        <p class="mb-3 text-sm text-muted-foreground">
          {{ $t('A call to the local talkgroup is sent to the upstream talkgroup, and a call from it arrives on the local one. Leave the network empty to apply the rule to every network.') }}
        </p>
        <p v-if="value.rewrites.length === 0" class="mb-3 text-sm text-muted-foreground">
          {{ $t('No rewrite yet. Add one to carry calls between a local and an upstream talkgroup.') }}
        </p>
        <div
          v-for="(r, i) in value.rewrites"
          :key="i"
          class="mb-2 grid items-center gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,120px)_minmax(0,120px)_auto]"
          :data-test="`upstream-rewrite-${i}`"
        >
          <select :class="boxClass" :value="r.network" :disabled="locked" :aria-label="$t('Network of rule {n}', { n: i + 1 })" :data-test="`upstream-rewrite-network-${i}`" @change="(e: Event) => setRewrite(i, 'network', (e.target as HTMLSelectElement).value)">
            <option value="">{{ $t('All networks') }}</option>
            <option v-for="n in value.networks" :key="n.name" :value="n.name">{{ n.name }}</option>
          </select>
          <ShadInput :model-value="String(r.localTg)" :disabled="locked" inputmode="numeric" :placeholder="$t('Local TG')" :aria-label="$t('Local talkgroup of rule {n}', { n: i + 1 })" :data-test="`upstream-rewrite-local-${i}`" @update:model-value="(v: string | number) => setRewrite(i, 'localTg', v)" />
          <ShadInput :model-value="String(r.upstreamTg)" :disabled="locked" inputmode="numeric" :placeholder="$t('Upstream TG')" :aria-label="$t('Upstream talkgroup of rule {n}', { n: i + 1 })" :data-test="`upstream-rewrite-upstream-${i}`" @update:model-value="(v: string | number) => setRewrite(i, 'upstreamTg', v)" />
          <ShadButton type="button" variant="outline" size="sm" :disabled="locked" :data-test="`upstream-rewrite-remove-${i}`" @click="removeRewrite(i)">
            {{ $t('Remove') }}
          </ShadButton>
        </div>
        <SettingNote path="dmr.upstreams.rewrites" menu class="mt-2" />
        <p v-if="error" class="mt-1 text-sm text-destructive-foreground" data-test="field-error">{{ error }}</p>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import SettingNote from '@/components/setup/SettingNote.vue';
import SourceChips from '@/components/setup/menu/SourceChips.vue';
import { Button as ShadButton } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input as ShadInput } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  emptyUpstreamNetwork, emptyUpstreamRewrite, upstreamOf,
  type UpstreamNetworkRow, type UpstreamRewriteRow, type UpstreamValue,
} from '@/lib/upstream';
import { fieldLocked } from '@/lib/setupMenu';
import type { Setting } from '@/lib/setupState';

const props = defineProps<{
  value: unknown;
  setting?: Setting;
  error?: string;
  saves: number;
  wizard?: boolean;
  passwordsSet?: boolean[];
}>();
const emit = defineEmits<{ (e: 'set', path: string, value: unknown): void }>();

const boxClass = 'w-full rounded-md border border-input bg-background px-3 py-1.5 h-9 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100';
const locked = computed(() => fieldLocked(props.setting));
const passwordsSet = computed(() => props.passwordsSet ?? []);

const value = computed<UpstreamValue>(() => upstreamOf(props.value));
const commit = (next: UpstreamValue) => emit('set', 'dmr.upstreams', next);

const setEnabled = (v: boolean) => commit({ ...value.value, enabled: v });
const setNetwork = (i: number, key: keyof UpstreamNetworkRow, v: unknown) =>
  commit({ ...value.value, networks: value.value.networks.map((n, j) => (j === i ? { ...n, [key]: v } : n)) });
const addNetwork = () => commit({ ...value.value, networks: [...value.value.networks, emptyUpstreamNetwork()] });
const removeNetwork = (i: number) =>
  commit({ ...value.value, networks: value.value.networks.filter((_, j) => j !== i) });
const setRewrite = (i: number, key: keyof UpstreamRewriteRow, v: unknown) =>
  commit({ ...value.value, rewrites: value.value.rewrites.map((r, j) => (j === i ? { ...r, [key]: v } : r)) });
const addRewrite = () => commit({ ...value.value, rewrites: [...value.value.rewrites, emptyUpstreamRewrite()] });
const removeRewrite = (i: number) =>
  commit({ ...value.value, rewrites: value.value.rewrites.filter((_, j) => j !== i) });
</script>
