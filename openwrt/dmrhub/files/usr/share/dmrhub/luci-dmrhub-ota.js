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
 * Updates run as a detached background job (dmrhub-ota job start/job status).
 * Every synchronous layer between the browser and the script (LuCI RPC, cgi-io
 * ubus) caps a call at ~20-30s, but a proxy download of the image takes a
 * minute or more. Starting a job returns instantly and a short status call is
 * polled for progress, so the page never hits those caps.
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

/* dmrhubOtaCall - short synchronous call (status check / job control). */
function dmrhubOtaCall(args) {
	return fs.exec(DMRHUB_OTA_SCRIPT, args).then(function (res) {
		var out = [];
		if (res.stdout) out.push(res.stdout);
		if (res.stderr) out.push(res.stderr);
		return { ok: res.code === 0, text: out.join('\n').trim(), code: res.code };
	}).catch(function (e) {
		return { ok: false, text: String(e.message || e), code: -1 };
	});
}

/* dmrhubOtaPoll - follow a background job until it finishes, updating a
 * notification with the last log line. Firmware flashes reboot the box, so a
 * lost connection during polling is treated as success. */
function dmrhubOtaPoll(kind) {
	var notice = ui.addNotification(null, E('p', {}, '正在启动更新…'));
	var ticks = 0;

	function step() {
		return dmrhubOtaCall(['job', 'status']).then(function (res) {
			var info = {};
			try {
				var start = res.text.indexOf('{');
				var end = res.text.lastIndexOf('}');
				info = JSON.parse(start >= 0 && end > start
					? res.text.slice(start, end + 1)
					: res.text);
			} catch (e) {
				info = { state: 'unknown', log: res.text };
			}

			var state = info.state || 'unknown';
			var lines = (info.log || '').split('\n').filter(function (l) { return l.trim(); });
			var last = lines.length ? lines[lines.length - 1] : '';
			var label = (kind === 'firmware' ? '固件' : '应用') + '更新：' + last;
			if (notice.firstChild) notice.firstChild.data = label;

			if (state === 'done') {
				if (notice.firstChild) notice.firstChild.data =
					(kind === 'firmware' ? '固件' : '应用') + '更新完成，设备即将重启或服务已重启。';
				if (kind === 'firmware') {
					ui.showModal('正在刷写…', [
						E('p', { 'class': 'spinning' },
							'系统正在重启，请勿断电！请等待几分钟后再尝试重新连接。')
					]);
					ui.awaitReconnect(window.location.host);
				}
				return;
			}
			if (state === 'failed') {
				if (notice.firstChild) notice.firstChild.data = '更新失败：\n' + (info.log || '');
				notice.className = 'alert-message danger';
				return;
			}
			if (!res.ok && state === 'unknown') {
				// Likely the box rebooted mid-flash (connection dropped).
				if (kind === 'firmware') {
					ui.showModal('正在刷写…', [
						E('p', { 'class': 'spinning' },
							'系统正在重启，请勿断电！请等待几分钟后再尝试重新连接。')
					]);
					ui.awaitReconnect(window.location.host);
					return;
				}
			}
			ticks++;
			if (ticks > 180) { // ~6 minutes at 2s, give up polling
				if (notice.firstChild) notice.firstChild.data = '更新仍在进行中，请稍后手动刷新页面查看结果。';
				return;
			}
			return new Promise(function (resolve) { setTimeout(resolve, 2000); }).then(step);
		});
	}
	return step();
}

/* handleDmrhubOtaCheck reads the release manifest and reports what it found. */
function handleDmrhubOtaCheck(ev) {
	return dmrhubOtaCall(['status']).then(function (res) {
		var text = res.text;
		try {
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

/* handleDmrhubOtaApp starts the application update in the background. */
function handleDmrhubOtaApp(ev) {
	return dmrhubOtaCall(['job', 'start', 'app']).then(function (res) {
		if (!res.ok) {
			dmrhubOtaNotify('无法启动应用更新：\n' + res.text, 'error');
			return;
		}
		dmrhubOtaNotify('应用更新已在后台启动。', 'info');
		return dmrhubOtaPoll('app');
	});
}

/* handleDmrhubOtaFirmware flashes the whole firmware image in the background. */
function handleDmrhubOtaFirmware(ev) {
	if (!confirm('刷写固件会重启设备，是否继续？')) {
		return Promise.resolve();
	}
	return dmrhubOtaCall(['job', 'start', 'firmware']).then(function (res) {
		if (!res.ok) {
			dmrhubOtaNotify('无法启动固件更新：\n' + res.text, 'error');
			return;
		}
		dmrhubOtaNotify('固件下载与刷写已在后台启动。', 'info');
		return dmrhubOtaPoll('firmware');
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
