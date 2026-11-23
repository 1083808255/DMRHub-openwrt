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
  <div class="enroll-panel">
    <TestedPill tested :text="$t('DroidStar becf1de (Android)')" />
    <h3>{{ $t("1. Add DMRHub on the Hosts tab") }}</h3>
    <p>{{ $t("Open the") }} <b>{{ $t("Hosts") }}</b> {{ $t("tab and type this line in the text box:") }}</p>
    <CodeBlock :title="$t('Hosts tab')" :segments="hostLine" />
    <h3>{{ $t("2. Set the DMR fields") }}</h3>
    <StepTable
      :head="[$t('Tab'), $t('Field'), $t('Value')]"
      :rows="[
        [$t('Settings'), $t('Callsign'), val(values.callsign)],
        [$t('Settings'), $t('DMRID'), val(values.ownerId)],
        [$t('Settings'), $t('ESSID'), val(values.essid)],
        [$t('Settings'), $t('DMR+ Opts'), val('TS1=91;TS2=3100;')],
        [$t('Main'), $t('Mode'), $t('DMR')],
        [$t('Main'), $t('Host'), val('DMRHub')],
        [$t('Main'), $t('TGID'), val('3100')],
      ]"
    />
    <h3>{{ $t("3. Connect") }}</h3>
    <p>
      {{ $t("On the") }} <b>{{ $t("Main") }}</b> {{ $t("tab, tap") }} <b>{{ $t("Connect") }}</b>. {{ $t("To test, set") }} <b>TGID</b> {{ $t("to") }} <code>9990</code>{{ $t(", tap") }} <b>TX</b>{{ $t(", talk, and tap") }} <b>TX</b> {{ $t("again. The parrot plays your call back.") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { snippet, val, type ConnectValues } from '@/lib/enroll';
import CodeBlock from './CodeBlock.vue';
import StepTable from './StepTable.vue';
import TestedPill from './TestedPill.vue';

const props = defineProps<{ values: ConnectValues }>();

const hostLine = computed(() => {
  const v = props.values;
  return snippet`DMR ${'DMRHub'} ${v.host} ${v.port} ${v.password}`;
});
</script>
