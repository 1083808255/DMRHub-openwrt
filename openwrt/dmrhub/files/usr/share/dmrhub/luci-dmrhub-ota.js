/*
 * DMRHub OTA helpers for the LuCI "Backup / Flash Firmware" page.
 *
 * This code is appended to a copy of luci-mod-system's system/flash view at
 * build time. It adds a DMRHub block that talks to /usr/sbin/dmrhub-ota, which
 * reads the release manifest, installs the application package and flashes the
 * firmware.
 *
 * The block is plain HTML rather than a form section: this LuCI release builds
 * the flash view on JSONMap, and a section added to it renders its title while
 * its options never reach the DOM. Buttons built here need nothing from the
 * form machinery, so they behave the same across LuCI versions.
 *
 * The strings are written in Chinese because this is the zh-CN build; the
 * LuCI translation catalogue ships no entry for our own block.
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
			/* Take the JSON object, in case the script says something first. */
			var start = res.text.indexOf('{');
			var end = res.text.lastIndexOf('}');
			var info = JSON.parse(start >= 0 && end > start
				? res.text.slice(start, end + 1)
				: res.text);
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
 * dmrhubOtaPanel builds the block. The patched render() appends it to the
 * nodes the page returns.
 */
function dmrhubOtaPanel() {
	function action(label, style, handler) {
		return E('button', {
			'class': 'cbi-button cbi-button-' + style,
			'click': handler
		}, [label]);
	}

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, ['DMRHub 固件升级']),
		E('div', { 'class': 'cbi-section-descr' }, [
			'检查 DMRHub 新版本、更新应用程序，或刷写包含 DMRHub 的新固件。'
		]),
		E('div', { 'class': 'cbi-page-actions' }, [
			action('检查更新', 'action', handleDmrhubOtaCheck),
			' ',
			action('更新应用…', 'action important', handleDmrhubOtaApp),
			' ',
			action('刷写固件…', 'action important', handleDmrhubOtaFirmware)
		])
	]);
}
