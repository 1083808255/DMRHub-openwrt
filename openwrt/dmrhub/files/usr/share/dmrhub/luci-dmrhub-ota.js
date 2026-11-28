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

/* dmrhubOtaDialog - a LuCI modal that stays up until the user closes it. The
 * native confirm()/alert() render as a browser dialog that is easy to dismiss
 * by reflex and cannot be scrolled, so the confirmation and the failure report
 * both use this instead. */
function dmrhubOtaDialog(title, children, kind) {
	var close = E('button', {
		'type': 'button',
		'class': 'btn cbi-button cbi-button-action',
		'click': function () { ui.hideModal(); }
	}, ['关闭']);
	ui.showModal(title, [
		E('div', { 'class': kind === 'error' ? 'alert-message danger' : '' }, children),
		E('div', { 'class': 'button-row' }, [close])
	]);
}

/* dmrhubOtaReason - the failure cause out of the job log. dmrhub-ota writes
 * its errors as "... 错误：<reason>", so the last such line is the reason; when
 * the job died without one, the last line is the closest thing to it. */
function dmrhubOtaReason(log) {
	var lines = String(log || '').split('\n').map(function (l) { return l.trim(); })
		.filter(function (l) { return l; });
	for (var i = lines.length - 1; i >= 0; i--) {
		var at = lines[i].indexOf('错误：');
		if (at >= 0) return lines[i].slice(at + 3).trim();
	}
	return lines.length ? lines[lines.length - 1] : '未知原因（任务没有留下日志）';
}

/* dmrhubOtaFail - report a failed update with its reason, and keep the whole
 * log below it so the cause is not lost when the reason line is terse. */
function dmrhubOtaFail(kind, log) {
	var label = kind === 'firmware' ? '固件' : '应用';
	dmrhubOtaDialog(label + '更新失败', [
		E('p', {}, [label + '更新未完成：' + dmrhubOtaReason(log)]),
		E('pre', {
			'style': 'max-height:16em;overflow:auto;white-space:pre-wrap;font-size:.85em'
		}, [String(log || '（无日志）')]),
		E('p', { 'class': 'cbi-section-descr' },
			['设备未被改动。修复上述原因后可以重新点击更新按钮。'])
	], 'error');
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

/* dmrhubFlashGuard - stop the SQLite writer before the native LuCI flash form
 * calls sysupgrade. The guard fails the call when DMRHub will not stop, so the
 * database can never be archived while it is still being written. */
function dmrhubFlashGuard() {
	return dmrhubOtaCall(['flash-guard']).then(function (res) {
		if (!res.ok)
			throw new Error('已取消刷机以保护数据库：' + res.text);
		return res;
	});
}

/* dmrhubFactoryReset - erase the DMRHub state on the data partition before the
 * native LuCI reset button runs firstboot. firstboot only wipes the overlay,
 * so without this call the previous owner's database, account and settings
 * would survive a factory reset. Returns false when nothing was erased, and
 * the caller then skips firstboot. */
function dmrhubFactoryReset() {
	return dmrhubOtaCall(['factory-reset']).then(function (res) {
		if (!res.ok) {
			ui.addNotification(null, E('p', { 'class': 'alert-message danger' },
				'无法清空 DMRHub 数据，已取消重置：' + res.text));
			return false;
		}
		return true;
	});
}

/* dmrhubOtaConfirm - a LuCI modal that resolves true on confirm and false on
 * cancel. The native confirm() cannot show the download size, the reboot
 * warning or the "keep the database" note, and it looks nothing like the rest
 * of the page, so the two update buttons ask through this instead. */
function dmrhubOtaConfirm(title, children) {
	return new Promise(function (resolve) {
		function finish(answer) {
			document.removeEventListener('keydown', onKey, true);
			ui.hideModal();
			resolve(answer);
		}
		/* LuCI's own Escape handler clicks the first button it finds in the
		 * dialog, which here is "继续": pressing Escape would start the update.
		 * Intercept it in the capture phase and treat it as a cancel. */
		function onKey(ev) {
			if (ev.key !== 'Escape') return;
			ev.preventDefault();
			ev.stopPropagation();
			finish(false);
		}
		document.addEventListener('keydown', onKey, true);
		ui.showModal(title, [
			E('div', {}, children),
			E('div', { 'class': 'button-row' }, [
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button cbi-button-action important',
					'click': function () { finish(true); }
				}, ['继续']),
				' ',
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					'click': function () { finish(false); }
				}, ['取消'])
			])
		]);
	});
}

/* dmrhubOtaPoll - follow a background job until it finishes, updating a
 * notification with the last log line. Firmware flashes reboot the box, so a
 * lost connection during polling is treated as success. */
function dmrhubOtaPoll(kind) {
	/* addNotification wraps the node it is given in its own container, so keep a
	 * reference to this paragraph: writing to the container's .data would be a
	 * silent no-op and the progress line would never change. */
	var line = E('p', {}, '正在启动更新…');
	ui.addNotification(null, line);
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
			line.data = label;

			if (state === 'done') {
				line.data = (kind === 'firmware' ? '固件' : '应用') + '更新完成，设备即将重启或服务已重启。';
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
				line.data = '更新失败，原因见弹窗。';
				dmrhubOtaFail(kind, info.log || '');
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
				line.data = '更新仍在进行中，请稍后手动刷新页面查看结果。';
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
		if (!res.ok) {
			dmrhubOtaDialog('检查更新失败', [
				E('p', {}, ['无法获取版本信息：' + dmrhubOtaReason(res.text)]),
				E('pre', {
					'style': 'max-height:16em;overflow:auto;white-space:pre-wrap;font-size:.85em'
				}, [res.text || '（无输出）'])
			], 'error');
			return;
		}
		dmrhubOtaNotify(text, 'info');
	});
}

/* handleDmrhubOtaApp starts the application update in the background. */
function handleDmrhubOtaApp(ev) {
	return dmrhubOtaConfirm('更新 DMRHub 应用', [
		E('p', {}, ['将下载并安装最新的 DMRHub 应用程序包。']),
		E('p', {}, ['数据库与设置保存在数据分区上，更新不会改动它们；更新完成后服务会自动重启。'])
	]).then(function (ok) {
		if (!ok) return;
		return dmrhubOtaCall(['job', 'start', 'app']).then(function (res) {
			if (!res.ok) {
				dmrhubOtaFail('app', res.text);
				return;
			}
			dmrhubOtaNotify('应用更新已在后台启动。', 'info');
			return dmrhubOtaPoll('app');
		});
	});
}

/* handleDmrhubOtaFirmware flashes the whole firmware image in the background. */
function handleDmrhubOtaFirmware(ev) {
	return dmrhubOtaConfirm('刷写 DMRHub 固件', [
		E('p', {}, ['将下载最新的固件镜像并刷写整机，完成后设备会重启。']),
		E('p', {}, ['刷写过程中请勿断电。数据库保存在数据分区上，正常刷写不会清除它。'])
	]).then(function (ok) {
		if (!ok) return;
		/* --yes is required: the detached runner has no stdin to answer
		 * cmd_firmware's interactive "type yes" prompt. The dialog above is the
		 * user's consent. */
		return dmrhubOtaCall(['job', 'start', 'firmware', '--yes']).then(function (res) {
			if (!res.ok) {
				dmrhubOtaFail('firmware', res.text);
				return;
			}
			dmrhubOtaNotify('固件下载与刷写已在后台启动。', 'info');
			return dmrhubOtaPoll('firmware');
		});
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
