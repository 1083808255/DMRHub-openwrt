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
    <template v-if="tab === 'pistar'">
      <TestedPill tested :text="$t('Pi-Star 4.3.7')" />
      <h3>{{ $t("1. Add DMRHub to the host list") }}</h3>
      <p>
        {{ $t("In the dashboard, open") }} <b>{{ $t("Configuration") }}</b>{{ $t(", then") }} <b>{{ $t("Expert") }}</b>{{ $t(", then") }} <b>{{ $t("SSH Access") }}</b>{{ $t(", and log in as") }}
        <code>pi-star</code>. Then run:
      </p>
      <CodeBlock :title="$t('Shell')" :segments="piStarShell" />
      <h3>{{ $t("2. Turn on DMR") }}</h3>
      <p>
        {{ $t("Skip this step if the") }} <b>{{ $t("DMR Configuration") }}</b> {{ $t("section is already on the") }} <b>{{ $t("Configuration") }}</b> {{ $t("page. On a new Pi-Star, open") }} <b>{{ $t("Configuration") }}</b>. In <b>{{ $t("MMDVMHost Configuration") }}</b>{{ $t(", turn on") }} <b>{{ $t("DMR Mode") }}</b>. In
        <b>{{ $t("General Configuration") }}</b>{{ $t(", set") }} <b>Radio/Modem Type</b> {{ $t("to your modem. Click") }} <b>{{ $t("Apply Changes") }}</b>.
      </p>
      <h3>{{ $t("3. Set the DMR fields") }}</h3>
      <StepTable
        :head="['Section', 'Field', 'Value']"
        :rows="[
          ['General Configuration', 'Node Callsign', val(values.callsign)],
          ['General Configuration', 'CCS7/DMR ID', val(values.ownerId)],
          ['DMR Configuration', 'DMR Master', val('HB_DMRHub')],
          ['DMR Configuration', 'DMR ESSID', val(values.essid)],
          ['DMR Configuration', 'DMR Colour Code', 'The color code of your radio'],
        ]"
      />
      <p>{{ $t("Click") }} <b>{{ $t("Apply Changes") }}</b>.</p>
      <p>
        <b>{{ $t("Optional:") }}</b> {{ $t("after that Apply, a") }} <b>{{ $t("DMR Options") }}</b> {{ $t("row appears. Type") }} <FilledValue>TS2=3100;</FilledValue> after
        <code>Options=</code> {{ $t("and apply again.") }}
      </p>
      <h3>{{ $t("4. Put the password in MMDVMHost") }}</h3>
      <p>
        {{ $t("Open") }} <b>{{ $t("Configuration") }}</b>, <b>{{ $t("Expert") }}</b>, <b>MMDVMHost</b>. In <b>{{ $t("DMR Network") }}</b>{{ $t(", set") }} <b>{{ $t("Password") }}</b> {{ $t("to") }}
        <FilledValue>{{ values.password }}</FilledValue> {{ $t("and click") }} <b>{{ $t("Apply Changes") }}</b>. Pi-Star does not take the password from the
        host list.
      </p>
    </template>

    <template v-else-if="tab === 'wpsd'">
      <TestedPill tested :text="$t('WPSD Trixie, 2026-10-26')" />
      <h3>{{ $t("1. Turn on DMR") }}</h3>
      <p>
        {{ $t("Skip this step if the") }} <b>{{ $t("DMR Configuration") }}</b> {{ $t("section is already on the") }} <b>{{ $t("Configuration") }}</b> {{ $t("page. On a new WPSD, open") }} <b>{{ $t("Configuration") }}</b>. In <b>{{ $t("General Configuration") }}</b>{{ $t(", set") }} <b>{{ $t("Node Callsign") }}</b> {{ $t("to") }}
        <FilledValue>{{ values.callsign }}</FilledValue>, <b>DMR/CCS7 ID</b> {{ $t("to") }} <FilledValue>{{ values.ownerId }}</FilledValue>{{ $t(", and") }}
        <b>Radio/Modem Type</b> {{ $t("to your modem. In") }} <b>Radio/MMDVMHost Modem Configuration</b>{{ $t(", turn on") }} <b>{{ $t("DMR Mode") }}</b>.
        Click <b>{{ $t("Apply Changes") }}</b>.
      </p>
      <h3>{{ $t("2. Add DMRHub as the custom network") }}</h3>
      <p>{{ $t("In") }} <b>{{ $t("DMR Configuration") }}</b>{{ $t(", go to") }} <b>{{ $t("Custom DMR Network Settings") }}</b>:</p>
      <StepTable
        :head="['Field', 'Value']"
        :rows="[
          ['Custom DMR Network Enable', 'On'],
          ['Server Name', val('DMRHub')],
          ['Server Address', val(values.host)],
          ['Port', val(values.port)],
          ['ESSID', val(values.essid)],
          ['Password', val(values.password)],
          ['Network Options', val('TS2=3100;')],
          ['TG List File', 'Leave empty'],
          ['Automatic Rewrite Rules', 'On'],
        ]"
      />
      <p>{{ $t("Click") }} <b>{{ $t("Apply Changes") }}</b>.</p>
      <h3>{{ $t("3. Pick how you dial DMRHub talkgroups") }}</h3>
      <p><b>{{ $t("Primary DMR Network") }}</b>{{ $t(", next to") }} <b>{{ $t("DMR Mode") }}</b>{{ $t(", decides the prefix:") }}</p>
      <StepTable
        :head="['Primary DMR Network', 'WPSD shows', 'To reach TG 3100', 'To reach the parrot']"
        :rows="[
          ['Custom DMR Network', 'Primary Network - No talkgroup prefix', val('3100'), val('9990')],
          ['Any other network', 'Uses &quot;9&quot; talkgroup prefix', val('9003100'), val('9009990')],
        ]"
      />
    </template>

    <template v-else-if="tab === 'mmdvmhost'">
      <TestedPill tested :text="$t('MMDVMHost 9384d68')" />
      <p>
        {{ $t("The current MMDVMHost connects only to DMRGateway on the same host, and DMRGateway logs in to DMRHub. Put this in") }} <code>MMDVM-Host.ini</code> {{ $t("(older builds:") }} <code>MMDVM.ini</code>{{ $t("), and then set up the") }}
        <a href="#" data-goto="dmrgateway" @click.prevent="emit('goto', 'dmrgateway')">DMRGateway</a> tab.
      </p>
      <CodeBlock title="MMDVM-Host.ini" :segments="mmdvmHostIni" />
      <h3>{{ $t("Older MMDVMHost builds that connect directly") }}</h3>
      <TestedPill tested :text="$t('MMDVMHost 0ecf2de')" />
      <CodeBlock :title="$t('MMDVM.ini, [DMR Network]')" :segments="mmdvmDirect" />
    </template>

    <template v-else-if="tab === 'dmrgateway'">
      <TestedPill tested :text="$t('DMRGateway 20260713')" />
      <p>
        {{ $t("Add this section to") }} <code>DMRGateway.ini</code>. Use a network number that is free in your file:
        <select
          v-model="network"
          :aria-label="$t('Network number')"
          class="rounded-md border bg-background px-1 py-px text-xs text-foreground"
          data-test="dg-network"
        >
          <option v-for="n in 5" :key="n" :value="String(n)">{{ n }}</option>
        </select>
      </p>
      <CodeBlock title="DMRGateway.ini" :segments="dmrGatewayIni" />
    </template>

    <DroidStarSteps v-else-if="tab === 'droidstar'" :values="values" />

    <template v-else-if="tab === 'hblink3'">
      <TestedPill tested :text="$t('HBlink3 1db2730')" />
      <p>
        {{ $t("HBlink3 logs in to DMRHub as a repeater with a") }} <code>PEER</code> {{ $t("system. Add this system to") }}
        <code>hblink.cfg</code>{{ $t(", and bridge it to your") }} <code>MASTER</code> {{ $t("system in") }} <code>rules.py</code>.
      </p>
      <CodeBlock title="hblink.cfg" :segments="hblinkCfg" />
    </template>

    <template v-else-if="tab === 'other'">
      <p>{{ $t("Any program that speaks the MMDVM network protocol works. Give it these values:") }}</p>
      <StepTable
        :head="['Setting', 'Value']"
        :rows="[
          ['Server address', val(values.host)],
          ['Port', val(values.port)],
          ['ID', val(values.id)],
          ['Password', val(values.password)],
          ['Options text', val('TS1=91;TS2=3100;')],
        ]"
      />
    </template>

    <template v-else-if="tab === 'cps'">
      <TestedPill :tested="false" />
      <p>
        {{ $t("In the CPS of the repeater, open") }} <b>{{ $t("Network") }}</b> {{ $t("and set up an IPSC link with these values. Then write the codeplug to the repeater.") }}
      </p>
      <StepTable
        :head="['Field', 'Value']"
        :rows="[
          ['Radio ID', val(values.id)],
          ['Link Type', 'Peer'],
          ['Master IP', val(values.host)],
          ['Master UDP Port', val(values.port)],
          ['Authentication Key', val(values.password)],
        ]"
      />
    </template>

    <template v-else-if="tab === 'ipsc-other'">
      <p>{{ $t("Any program that speaks Motorola IPSC works. Give it these values:") }}</p>
      <StepTable
        :head="['Setting', 'Value']"
        :rows="[
          ['Server address', val(values.host)],
          ['Port', val(values.port)],
          ['ID', val(values.id)],
          ['Auth key', val(values.password)],
        ]"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { plain, snippet, val, type ClientTab, type ConnectValues } from '@/lib/enroll';
import CodeBlock from './CodeBlock.vue';
import DroidStarSteps from './DroidStarSteps.vue';
import StepTable from './StepTable.vue';
import TestedPill from './TestedPill.vue';
import FilledValue from './FilledValue.vue';

const props = defineProps<{ tab: ClientTab; values: ConnectValues }>();
const emit = defineEmits<{ goto: [tab: ClientTab] }>();

const network = ref('1');

const piStarShell = computed(() => {
  const v = props.values;
  return snippet`rpi-rw
echo -e "${'HB_DMRHub'}\\t0000\\t${v.host}\\t${v.password}\\t${v.port}" | sudo tee -a /root/DMR_Hosts.txt
sudo HostFilesUpdate.sh`;
});

const mmdvmHostIni = computed(() => {
  const v = props.values;
  return snippet`[General]
Callsign=${v.callsign}
Id=${v.id}
Duplex=0

[DMR]
Enable=1
ColorCode=1

[DMR Network]
Enable=1
LocalAddress=127.0.0.1
LocalPort=62032
GatewayAddress=127.0.0.1
GatewayPort=62037
Jitter=360
Slot1=1
Slot2=1
Debug=0`;
});

const mmdvmDirect = computed(() => {
  const v = props.values;
  return snippet`[DMR Network]
Enable=1
Type=Direct
Address=${v.host}
Port=${v.port}
Password="${v.password}"
Options="${'TS2=3100;'}"
Jitter=360
Slot1=1
Slot2=1
Debug=0`;
});

const dmrGatewayIni = computed(() => {
  const v = props.values;
  return snippet`[General]
Id=${v.id}

[DMR Network ${plain(network.value)}]
Enabled=1
Name=DMRHub
Address=${v.host}
Port=${v.port}
Id=${v.id}
Password="${v.password}"
PassAllTG=1
PassAllTG=2
PassAllPC=1
PassAllPC=2
Options="${'TS1=91;TS2=3100;'}"
Location=1
Debug=0`;
});

const hblinkCfg = computed(() => {
  const v = props.values;
  return snippet`[DMRHUB]
MODE: PEER
ENABLED: True
LOOSE: False
EXPORT_AMBE: False
IP:
PORT: 62052
MASTER_IP: ${v.host}
MASTER_PORT: ${v.port}
PASSPHRASE: ${v.password}
CALLSIGN: ${v.callsign}
RADIO_ID: ${v.id}
RX_FREQ: 438800000
TX_FREQ: 438800000
TX_POWER: 1
COLORCODE: 1
SLOTS: 3
LATITUDE: 38.0000
LONGITUDE: -95.0000
HEIGHT: 0
LOCATION: Anytown
DESCRIPTION: HBlink3
URL:
SOFTWARE_ID: 20170620
PACKAGE_ID: MMDVM_HBlink
GROUP_HANGTIME: 5
OPTIONS: ${'TS1=91;TS2=3100;'}
USE_ACL: True
SUB_ACL: DENY:1
TGID_TS1_ACL: PERMIT:ALL
TGID_TS2_ACL: PERMIT:ALL`;
});
</script>

<style>
.enroll-panel h3 {
  font-size: 15px;
  font-weight: 700;
  margin: 18px 0 8px;
}

.enroll-panel h3:first-child {
  margin-top: 0;
}

.enroll-panel p {
  margin: 0 0 10px;
}

.enroll-panel code {
  font-family: var(--font-mono);
  font-size: 15px;
}
</style>
