/*
 * DMRHub OTA helpers for the LuCI "Backup / Flash Firmware" page.
 *
 * This code is appended to a copy of luci-mod-system's system/flash view at
 * build time. It adds a DMRHub section that talks to /usr/sbin/dmrhub-ota,
 * which reads the release manifest, installs the application package and
 * flashes the firmware.
 *
 * The strings are written in Chinese because this is the zh-CN build; the
 * LuCI translation catalogue ships no entry for our own section.
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
	button.textContent = '处理中…';
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
				text = 'DMRHub 已是最新版本：' + info.remote;
			} else {
				text = '发现新版本：' + info.remote + '（当前：' + info.local + '）';
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
			? 'DMRHub 已更新，服务已重启。'
			: '应用更新失败。\n' + res.text, res.ok ? 'info' : 'error');
	});
}

/* handleDmrhubOtaFirmware flashes the whole firmware image. */
function handleDmrhubOtaFirmware(ev) {
	if (!confirm('刷写固件会重启设备，是否继续？')) {
		return Promise.resolve();
	}
	var button = ev.target;
	button.disabled = true;
	button.textContent = '下载中…';
	dmrhubOtaNotify('正在下载固件镜像，可能需要几分钟。', 'info');
	fs.exec(DMRHUB_OTA_SCRIPT, ['firmware', '--yes']).then(function () {
		ui.showModal('正在刷写…', [
			E('p', { 'class': 'spinning' },
				'系统正在刷写固件，请勿断电！请等待几分钟后再尝试重新连接。')
		]);
		ui.awaitReconnect(window.location.host);
	}).catch(function (e) {
		button.disabled = false;
		button.textContent = '刷写固件…';
		dmrhubOtaNotify('固件更新失败。\n' + String(e.message || e), 'error');
	});
}

/*
 * dmrhubOtaSection adds the DMRHub block to the page. The patched render()
 * of the system/flash view calls it with its JSONMap.
 */
function dmrhubOtaSection(m, form) {
	var s = m.section(form.NamedSection, 'dmrhub_ota', 'dmrhub_ota',
		'DMRHub 固件升级',
		'检查 DMRHub 新版本、更新应用程序，或刷写包含 DMRHub 的新固件。');
	var o = s.option(form.Button, 'dmrhub_ota_check', '检查更新');
	o.inputstyle = 'action';
	o.inputtitle = '检查更新';
	o.onclick = handleDmrhubOtaCheck;
	o = s.option(form.Button, 'dmrhub_ota_app', '更新 DMRHub 应用程序');
	o.inputstyle = 'action important';
	o.inputtitle = '更新应用…';
	o.onclick = handleDmrhubOtaApp;
	o = s.option(form.Button, 'dmrhub_ota_firmware', '刷写新的 DMRHub 固件');
	o.inputstyle = 'action important';
	o.inputtitle = '刷写固件…';
	o.onclick = handleDmrhubOtaFirmware;
	return m;
}
