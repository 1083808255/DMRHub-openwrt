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
    <div
      v-if="error"
      role="alert"
      class="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground"
      data-test="upstreams-error"
    >{{ error }}</div>
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
        <ShadButton type="button" variant="outline" size="sm" :disabled="locked || atLimit" data-test="upstream-network-add" @click="addNetwork">
          {{ $t('Add a network') }}
        </ShadButton>
      </CardHeader>
      <CardContent>
        <p v-if="atLimit" class="mb-3 text-sm text-muted-foreground" data-test="upstream-network-limit">
          {{ $t('A hub links to at most {n} upstream networks.', { n: MAX_NETWORKS }) }}
        </p>
        <p v-if="value.networks.length === 0" class="mb-3 text-sm text-muted-foreground">
          {{ $t('No network yet. Add one to link this hub to a master.') }}
        </p>
        <div
          v-for="(n, i) in value.networks"
          :key="i"
          class="mb-4 rounded-[10px] border p-3.5"
          :data-test="`upstream-network-${i}`"
        >
          <div class="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <Switch
              :id="`upstream-enabled-${i}`"
              :model-value="n.enabled"
              :disabled="locked"
              :aria-label="$t('Enable network {n}', { n: i + 1 })"
              :data-test="`upstream-network-enabled-${i}`"
              @update:model-value="(v: boolean) => setNetwork(i, 'enabled', v)"
            />
            <label
              :for="`upstream-enabled-${i}`"
              class="text-sm font-semibold"
              :class="locked ? 'cursor-not-allowed' : 'cursor-pointer'"
            >{{ n.enabled ? $t('On') : $t('Off') }}</label>
            <b class="text-sm">{{ n.name || $t('Unnamed network') }}</b>
            <span
              class="rounded-full border px-2 text-xs leading-5"
              :class="n.enabled ? 'border-green-600/50 text-green-700 dark:text-green-400' : 'text-muted-foreground'"
            >{{ n.enabled ? $t('Enabled') : $t('Disabled') }}</span>
            <ShadButton type="button" variant="outline" size="sm" class="ml-auto" :disabled="locked" :data-test="`upstream-network-remove-${i}`" @click="removeNetwork(i)">
              {{ $t('Remove') }}
            </ShadButton>
          </div>
          <p v-if="!n.enabled" class="mb-3 text-sm text-muted-foreground">
            {{ $t('This network is off. Nothing is sent to it or received from it until this is on.') }}
          </p>
          <div class="space-y-2">
            <!-- Row 1: the network name alone, so it reads as the title. -->
            <div class="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Name') }}</span>
                <ShadInput class="w-1/2" :model-value="n.name" :disabled="locked" :placeholder="$t('Network name')" :aria-label="$t('Name of network {n}', { n: i + 1 })" :data-test="`upstream-network-name-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'name', String(v))" />
              </label>
            </div>
            <!-- Row 2: who logs in. The boxes keep their own width and sit next
                 to each other; the password is half again as wide. -->
            <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Callsign') }}</span>
                <ShadInput class="w-44" :model-value="n.callsign" :disabled="locked" :aria-label="$t('Callsign of network {n}', { n: i + 1 })" :data-test="`upstream-network-callsign-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'callsign', String(v))" />
              </label>
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Repeater ID') }}</span>
                <ShadInput class="w-44" :model-value="String(n.id)" :disabled="locked" inputmode="numeric" :aria-label="$t('Repeater ID of network {n}', { n: i + 1 })" :data-test="`upstream-network-id-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'id', v)" />
              </label>
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Password') }}</span>
                <div class="relative w-64">
                  <ShadInput
                    :type="shown.has(i) ? 'text' : 'password'"
                    class="pr-10"
                    :model-value="fieldText(i)"
                    :disabled="locked"
                    :placeholder="passwordsSet[i] ? $t('Already saved') : $t('Required by most networks')"
                    :aria-label="$t('Password of network {n}', { n: i + 1 })"
                    :data-test="`upstream-network-password-${i}`"
                    @update:model-value="(v: string | number) => onPassword(i, v)"
                  />
                  <button
                    type="button"
                    class="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                    :aria-label="shown.has(i) ? $t('Hide the password') : $t('Show the password')"
                    :title="shown.has(i) ? $t('Hide the password') : $t('Show the password')"
                    :data-test="`upstream-network-password-toggle-${i}`"
                    @click="toggleShown(i, n.password)"
                  >
                    <EyeOff v-if="shown.has(i)" class="size-4" />
                    <Eye v-else class="size-4" />
                  </button>
                </div>
              </label>
            </div>
            <!-- Row 3: where it logs in. The address box is twice as wide, and
                 the port and protocol sit next to it. -->
            <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Master address') }}</span>
                <ShadInput class="w-[22rem]" :model-value="n.address" :disabled="locked" placeholder="master.brandmeister.network" :aria-label="$t('Address of network {n}', { n: i + 1 })" :data-test="`upstream-network-address-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'address', String(v))" />
              </label>
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Port') }}</span>
                <ShadInput class="w-44" :model-value="String(n.port)" :disabled="locked" inputmode="numeric" :aria-label="$t('Port of network {n}', { n: i + 1 })" :data-test="`upstream-network-port-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'port', v)" />
              </label>
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Protocol') }}</span>
                <div class="w-44">
                  <select :class="boxClass" :value="n.dialect" :disabled="locked" :aria-label="$t('Protocol of network {n}', { n: i + 1 })" :data-test="`upstream-network-dialect-${i}`" @change="(e: Event) => setNetwork(i, 'dialect', (e.target as HTMLSelectElement).value)">
                    <option value="mmdvm">{{ $t('MMDVM') }}</option>
                    <option value="hbrp">{{ $t('HBRP') }}</option>
                  </select>
                </div>
              </label>
            </div>
            <!-- Row 4: radio settings. The slots list is half again as wide as
                 the color code, and the frequencies follow it. -->
            <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Color code') }}</span>
                <div class="w-44">
                  <select :class="boxClass" :value="String(n.colorCode)" :disabled="locked" :aria-label="$t('Color code of network {n}', { n: i + 1 })" :data-test="`upstream-network-color-${i}`" @change="(e: Event) => setNetwork(i, 'colorCode', (e.target as HTMLSelectElement).value)">
                    <option v-for="cc in 16" :key="cc" :value="String(cc - 1)">{{ cc - 1 }}</option>
                  </select>
                </div>
              </label>
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Slots') }}</span>
                <div class="w-64">
                  <select :class="boxClass" :value="String(n.slots)" :disabled="locked" :aria-label="$t('Slots of network {n}', { n: i + 1 })" :data-test="`upstream-network-slots-${i}`" @change="(e: Event) => setNetwork(i, 'slots', (e.target as HTMLSelectElement).value)">
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3 ({{ $t('both') }})</option>
                    <option value="4">4 ({{ $t('simplex') }})</option>
                  </select>
                </div>
              </label>
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Receive frequency (Hz)') }}</span>
                <ShadInput class="w-44" :model-value="String(n.rxFrequency)" :disabled="locked" inputmode="numeric" :aria-label="$t('Receive frequency of network {n}', { n: i + 1 })" :data-test="`upstream-network-rx-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'rxFrequency', v)" />
              </label>
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Transmit frequency (Hz)') }}</span>
                <ShadInput class="w-44" :model-value="String(n.txFrequency)" :disabled="locked" inputmode="numeric" :aria-label="$t('Transmit frequency of network {n}', { n: i + 1 })" :data-test="`upstream-network-tx-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'txFrequency', v)" />
              </label>
            </div>
            <!-- Row 5: where the repeater is. Longitude and latitude sit
                 together, with the location next to them. -->
            <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Longitude') }}</span>
                <ShadInput class="w-44" :model-value="n.longitude" :disabled="locked" placeholder="+106.5900" :aria-label="$t('Longitude of network {n}', { n: i + 1 })" :data-test="`upstream-network-longitude-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'longitude', String(v))" />
              </label>
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Latitude') }}</span>
                <ShadInput class="w-44" :model-value="n.latitude" :disabled="locked" placeholder="+29.6800" :aria-label="$t('Latitude of network {n}', { n: i + 1 })" :data-test="`upstream-network-latitude-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'latitude', String(v))" />
              </label>
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Location') }}</span>
                <ShadInput class="w-44" :model-value="n.location" :disabled="locked" :placeholder="$t('Nowhere')" :aria-label="$t('Location of network {n}', { n: i + 1 })" :data-test="`upstream-network-location-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'location', String(v))" />
              </label>
            </div>
            <!-- Row 6: free text. Both boxes carry a title, so they line up. -->
            <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Description') }}</span>
                <ShadInput class="w-80" :model-value="n.description" :disabled="locked" :placeholder="$t('MMDVM Hotspot')" :aria-label="$t('Description of network {n}', { n: i + 1 })" :data-test="`upstream-network-description-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'description', String(v))" />
              </label>
              <label class="block text-sm">
                <span class="mb-1 block font-medium">{{ $t('Options') }}</span>
                <ShadInput class="w-80" :model-value="n.options" :disabled="locked" placeholder="TS2=91" :aria-label="$t('Options of network {n}', { n: i + 1 })" :data-test="`upstream-network-options-${i}`" @update:model-value="(v: string | number) => setNetwork(i, 'options', String(v))" />
              </label>
            </div>
          </div>
        </div>
        <SettingNote path="dmr.upstreams.networks" menu class="mt-2" />
        <div v-if="status.links.length > 0" class="mt-4 border-t pt-3" data-test="upstream-links">
          <p class="mb-2 text-sm font-semibold">{{ $t('Link state') }}</p>
          <div
            v-for="(link, li) in status.links"
            :key="`link-${li}`"
            class="mb-2 rounded-[10px] border px-3.5 py-2.5 text-sm"
            :class="link.up ? 'border-green-600/40 bg-green-500/5' : 'border-amber-500/45 bg-amber-500/5'"
            :data-test="`upstream-link-${li}`"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="size-2 rounded-full" :class="link.up ? 'bg-green-600 dark:bg-green-400' : 'bg-amber-500'" />
              <b>{{ link.name }}</b>
              <span class="text-muted-foreground">
                {{ link.up ? $t('Logged in') : $t('Not logged in') }}
              </span>
              <span v-if="link.up && link.since" class="text-xs text-muted-foreground" :title="timeAgo(link.since)">
                {{ $t('since {time}', { time: clockTime(link.since) }) }}
              </span>
              <span v-else class="text-xs text-muted-foreground" :data-test="`upstream-link-why-${li}`">
                {{ linkDownText(link.reason, link.stage) }}
              </span>
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              {{ $t('From upstream: {n} bursts. To upstream: {m} bursts.', { n: link.rxBursts, m: link.txBursts }) }}
              <span v-if="link.lastHeard" :title="timeAgo(link.lastHeard)"> · {{ $t('Last call at {time}', { time: clockTime(link.lastHeard) }) }}</span>
            </div>
            <table v-if="link.talkgroups.length > 0" class="mt-1.5 w-full text-xs" :data-test="`upstream-link-tgs-${li}`">
              <thead class="text-muted-foreground">
                <tr>
                  <th class="text-left font-medium">{{ $t('Talkgroup') }}</th>
                  <th class="text-right font-medium">{{ $t('From upstream') }}</th>
                  <th class="text-right font-medium">{{ $t('To upstream') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tg in link.talkgroups" :key="tg.tg">
                  <td>TG {{ tg.tg }}</td>
                  <td class="text-right">{{ tg.rx }}</td>
                  <td class="text-right">{{ tg.tx }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
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
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import SettingNote from '@/components/setup/SettingNote.vue';
import SourceChips from '@/components/setup/menu/SourceChips.vue';
import { Button as ShadButton } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input as ShadInput } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  MAX_NETWORKS, emptyUpstreamNetwork, emptyUpstreamRewrite, linkDownText, upstreamOf,
  type UpstreamNetworkRow, type UpstreamRewriteRow, type UpstreamValue,
} from '@/lib/upstream';
import { fieldLocked } from '@/lib/setupMenu';
import type { Setting } from '@/lib/setupState';
import { formatDateTime, formatDistanceToNowStrictLocal } from '@/lib/dateFormat';
import API from '@/services/API';

type LinkStatus = {
  name: string;
  up: boolean;
  since?: string;
  lastHeard?: string;
  reason?: string;
  stage?: string;
  rxBursts: number;
  txBursts: number;
  talkgroups: { tg: number; rx: number; tx: number }[];
};

type UpstreamStatus = { enabled: boolean; running: boolean; links: LinkStatus[] };

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
const atLimit = computed(() => value.value.networks.length >= MAX_NETWORKS);

// shown holds the indexes of the passwords the admin revealed, so a typed
// password can be checked against the one the network expects.
const shown = ref(new Set<number>());

// saved holds the password the hub has on disk, read only when the eye is
// pressed on a field the admin has not typed into. The config API keeps the
// secrets back, so an empty field would otherwise reveal nothing at all and
// the admin could not tell a mistyped password from one the master refuses.
const saved = ref<Record<number, string>>({});
const reading = ref(new Set<number>());

// fieldText is what the password box shows: what the admin typed, or, while
// the eye is open on an untouched field, the password the hub will send.
// The saved text is display only and never enters the rows, so pressing the
// eye cannot turn into a save of a password the admin did not type.
const fieldText = (i: number): string => {
  const typed = value.value.networks[i]?.password ?? '';
  if (typed || !shown.value.has(i)) return typed;
  return saved.value[i] ?? '';
};

// onPassword keeps the rows holding only what the admin typed. Clearing the
// box while the saved password is on show means "keep the saved one", which
// is an empty row, not an empty password sent to the master.
const onPassword = (i: number, v: string | number) => {
  const typed = String(v);
  const showingSaved = shown.value.has(i) && !value.value.networks[i]?.password;
  if (showingSaved && (typed === '' || typed === (saved.value[i] ?? ''))) {
    setNetwork(i, 'password', '');
    return;
  }
  setNetwork(i, 'password', typed);
  // What was read back is now out of date: the next look must ask again.
  if (saved.value[i] !== undefined) {
    const next = { ...saved.value };
    delete next[i];
    saved.value = next;
  }
};

const readSaved = async (i: number) => {
  if (saved.value[i] !== undefined || reading.value.has(i)) return;
  reading.value = new Set(reading.value).add(i);
  try {
    const res = await API.get(`/config/upstream/password/${i}`);
    const pw = (res.data as { password?: string }).password ?? '';
    saved.value = { ...saved.value, [i]: pw };
  } catch {
    // A hub that will not hand the password back leaves the field empty;
    // the note still says one is saved, so nothing looks lost.
  } finally {
    const next = new Set(reading.value);
    next.delete(i);
    reading.value = next;
  }
};

const toggleShown = (i: number, typed: string) => {
  const next = new Set(shown.value);
  if (next.has(i)) {
    next.delete(i);
  } else {
    next.add(i);
    if (!typed && passwordsSet.value[i]) void readSaved(i);
  }
  shown.value = next;
};
const addNetwork = () => {
  if (value.value.networks.length >= MAX_NETWORKS) {
    return;
  }
  commit({ ...value.value, networks: [...value.value.networks, emptyUpstreamNetwork()] });
};
const removeNetwork = (i: number) => {
  // The revealed passwords are held by row number, so every row after the
  // one that goes must move with it, or the eye would show the password of
  // a different network.
  const move = <T,>(m: Record<number, T>): Record<number, T> => {
    const out: Record<number, T> = {};
    for (const [k, v] of Object.entries(m)) {
      const at = Number(k);
      if (at < i) out[at] = v;
      else if (at > i) out[at - 1] = v;
    }
    return out;
  };
  saved.value = move(saved.value);
  const shift = (s: Set<number>): Set<number> => {
    const out = new Set<number>();
    for (const at of s) {
      if (at < i) out.add(at);
      else if (at > i) out.add(at - 1);
    }
    return out;
  };
  shown.value = shift(shown.value);
  reading.value = shift(reading.value);
  commit({ ...value.value, networks: value.value.networks.filter((_, j) => j !== i) });
};
const setRewrite = (i: number, key: keyof UpstreamRewriteRow, v: unknown) =>
  commit({ ...value.value, rewrites: value.value.rewrites.map((r, j) => (j === i ? { ...r, [key]: v } : r)) });
const addRewrite = () => commit({ ...value.value, rewrites: [...value.value.rewrites, emptyUpstreamRewrite()] });
const removeRewrite = (i: number) =>
  commit({ ...value.value, rewrites: value.value.rewrites.filter((_, j) => j !== i) });

// The state of the links comes from the running gateway, not from the
// settings on the page, so it is polled while the tab is open. A login
// takes a few seconds to settle, so the state is read every three.
const statusPollMs = 3000;
const status = ref<UpstreamStatus>({ enabled: false, running: false, links: [] });
let timer: ReturnType<typeof setInterval> | undefined;

const loadStatus = async () => {
  try {
    const res = await API.get('/config/upstream');
    const data = res.data as Partial<UpstreamStatus>;
    status.value = {
      enabled: data.enabled === true,
      running: data.running === true,
      // The gateway sends null for a list that is empty, so guard every
      // field the template reads: one null must not blank the whole tab.
      links: (Array.isArray(data.links) ? data.links : []).map((l) => ({
        ...l,
        rxBursts: l.rxBursts ?? 0,
        txBursts: l.txBursts ?? 0,
        talkgroups: Array.isArray(l.talkgroups) ? l.talkgroups : [],
      })),
    };
  } catch {
    // A gateway that is off has no state to show; keep the last one.
  }
};

// The times come from the gateway as instants. The page shows the clock
// time of each one, and how long ago it was on hover.
const clockTime = (at?: string): string => {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : formatDateTime(d, 'yyyy-MM-dd HH:mm:ss');
};

const timeAgo = (at?: string): string => {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNowStrictLocal(d, { addSuffix: true });
};

onMounted(() => {
  void loadStatus();
  timer = setInterval(() => void loadStatus(), statusPollMs);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>
