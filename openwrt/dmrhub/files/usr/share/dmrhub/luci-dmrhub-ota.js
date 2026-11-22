/*
 * DMRHub OTA helpers for the LuCI "Backup / Flash Firmware" page.
 *
 * This code is appended to a copy of luci-mod-system's system/flash view at
 * build time. It adds a DMRHub section that talks to /usr/sbin/dmrhub-ota,
 * which reads the release manifest, installs the application package and
 * flashes the firmware.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

var DMRHUB_OTA_SCRIPT = '/usr/sbin/dmrhub-ota';

function dmrhubOtaNotify(text, kind) {
	ui.addNotification(null, E('p', { 'class': kind === 'error' ? 'alert-message danger' : '' }, text));
}

function dmrhubOtaExec(button, args) {
	button.disabled = true;
	var label = button.textContent;
	button.textContent = _('Working...');
	return fs.exec(DMRHUB_OTA_SCRIPT, args).then(function (res) {
		var out = [];
		if (res.stdout) out.push(res.stdout);
		if (res.stderr) out.push(res.stderr);
		return { ok: res.code === 0, text: out.join('\n').trim(), code: res.code };
	}).catch(function (e) {
		return { ok: false, text: String(e.message || e), code: -1 };
	}).finally(function () {
		button.disabled = false;
		button.textContent = label;
	});
}

/* handleDmrhubOtaCheck reads the release manifest and reports what it found. */
function handleDmrhubOtaCheck(ev) {
	return dmrhubOtaExec(ev.target, ['status']).then(function (res) {
		var text = res.text;
		try {
			var info = JSON.parse(res.text);
			if (info.state === 'current') {
				text = _('DMRHub is up to date: ') + info.remote;
			} else {
				text = _('A newer DMRHub is available: ') + info.remote + _(' (installed: ') + info.local + _(')');
			}
		} catch (e) {
			/* Keep the raw output when it is not JSON. */
		}
		dmrhubOtaNotify(text, res.ok ? 'info' : 'error');
	});
}

/* handleDmrhubOtaApp installs the application package only. */
function handleDmrhubOtaApp(ev) {
	return dmrhubOtaExec(ev.target, ['app']).then(function (res) {
		dmrhubOtaNotify(res.ok
			? _('DMRHub was updated and the service has been restarted.')
			: _('The application update failed.') + '\n' + res.text, res.ok ? 'info' : 'error');
	});
}

/* handleDmrhubOtaFirmware flashes the whole firmware image. */
function handleDmrhubOtaFirmware(ev) {
	if (!confirm(_('Flashing the firmware reboots the device. Continue?'))) {
		return Promise.resolve();
	}
	var button = ev.target;
	button.disabled = true;
	button.textContent = _('Downloading...');
	dmrhubOtaNotify(_('Downloading the firmware image. This can take a few minutes.'), 'info');
	fs.exec(DMRHUB_OTA_SCRIPT, ['firmware', '--yes']).then(function () {
		ui.showModal(_('Flashing...'), [
			E('p', { 'class': 'spinning' },
				_('The system is flashing now. DO NOT POWER OFF THE DEVICE! Wait a few minutes before you try to reconnect.'))
		]);
		ui.awaitReconnect(window.location.host);
	}).catch(function (e) {
		button.disabled = false;
		button.textContent = _('Flash firmware...');
		dmrhubOtaNotify(_('The firmware update failed.') + '\n' + String(e.message || e), 'error');
	});
}

/*
 * dmrhubOtaSection adds the DMRHub block to the page. The patched render()
 * of the system/flash view calls it with its JSONMap.
 */
function dmrhubOtaSection(m, form) {
	var s = m.section(form.NamedSection, 'dmrhub_ota', 'dmrhub_ota',
		_('DMRHub OTA'),
		_('Check for a newer DMRHub release, update the application, or flash a new firmware image that includes DMRHub.'));
	var o = s.option(form.Button, 'dmrhub_ota_check', _('Check for updates'));
	o.inputstyle = 'action';
	o.inputtitle = _('Check...');
	o.onclick = handleDmrhubOtaCheck;
	o = s.option(form.Button, 'dmrhub_ota_app', _('Update the DMRHub application'));
	o.inputstyle = 'action important';
	o.inputtitle = _('Update application...');
	o.onclick = handleDmrhubOtaApp;
	o = s.option(form.Button, 'dmrhub_ota_firmware', _('Flash a new DMRHub firmware'));
	o.inputstyle = 'action important';
	o.inputtitle = _('Flash firmware...');
	o.onclick = handleDmrhubOtaFirmware;
	return m;
}
