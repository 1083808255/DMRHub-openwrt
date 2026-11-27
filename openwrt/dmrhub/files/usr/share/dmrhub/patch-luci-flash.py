#!/usr/bin/env python3
"""Add the DMRHub OTA section to the LuCI "Backup / Flash Firmware" view.

The LuCI system/flash view is shipped as a minified JavaScript module. We do
not keep a copy of it in this repository: the build extracts the current file
from the luci-mod-system package and patches it here. That way an upstream
LuCI update cannot silently drop the section, because the patch fails loudly
when the anchor it needs is gone. The patch also guards the native flash
handlers and erases the DMRHub data before the native factory reset.

Usage: patch-luci-flash.py <flash.js> <ota.js> <output.js>
"""

import sys

BEGIN_MARK = "/* DMRHUB-OTA-BEGIN */"
END_MARK = "/* DMRHUB-OTA-END */"

# The helpers go before the view is defined, so every handler can reach them.
HELPER_ANCHOR = "var mapdata={actions:{},config:{}};"
# The section is added right before the page renders.
SECTION_ANCHOR = "return m.render();},"

# Native flash/restore also has to stop the SQLite writer before sysupgrade
# archives /opt/dmrhub. The minified view calls sysupgrade in two places.
FLASH_CALL_ANCHOR = "args.push('/tmp/firmware.bin');fs.exec('/sbin/sysupgrade',args);"
FLASH_CALL_GUARDED = (
    "args.push('/tmp/firmware.bin');"
    "return dmrhubFlashGuard().then(function(){"
    "return fs.exec('/sbin/sysupgrade',args);}).then(function(){"
)
FLASH_END_ANCHOR = "ui.awaitReconnect('192.168.1.1','openwrt.lan');},handleBackupList"
FLASH_END_GUARDED = "ui.awaitReconnect('192.168.1.1','openwrt.lan');});},handleBackupList"
RESTORE_ANCHOR = "return fs.exec('/sbin/sysupgrade',['--restore-backup','/tmp/backup.tar.gz']).then("
RESTORE_GUARDED = (
    "return dmrhubFlashGuard().then(function(){"
    "return fs.exec('/sbin/sysupgrade',['--restore-backup','/tmp/backup.tar.gz']);}).then("
)

# The "Perform reset" button wipes the overlay only. The database and settings
# live on the data partition, which firstboot keeps, so erase them first and
# skip firstboot when that fails: resetting anyway would leave the data behind.
FIRSTBOOT_ANCHOR = "fs.exec('/sbin/firstboot',['-r','-y']);ui.awaitReconnect('192.168.1.1','openwrt.lan');"
FIRSTBOOT_GUARDED = (
    "return dmrhubFactoryReset().then(function(ok){"
    "if(!ok){ui.hideModal();return;}"
    "return fs.exec('/sbin/firstboot',['-r','-y']).then(function(){"
    "ui.awaitReconnect('192.168.1.1','openwrt.lan');});});"
)
# Tell the user that a factory reset now erases DMRHub data as well. Optional:
# the wording is a translation, and losing it does not break the behaviour.
RESET_CONFIRM_ANCHOR = "if(!confirm(_('Do you really want to erase all settings?')))"
RESET_CONFIRM = "if(!confirm('重置固件会同时清空 DMRHub 的全部数据（数据库、账号和设置），是否继续？'))"


def fail(message: str) -> None:
    print(f"patch-luci-flash: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if len(sys.argv) != 4:
        fail("usage: patch-luci-flash.py <flash.js> <ota.js> <output.js>")

    flash_path, ota_path, out_path = sys.argv[1:4]
    with open(flash_path, encoding="utf-8") as handle:
        flash = handle.read()
    with open(ota_path, encoding="utf-8") as handle:
        ota = handle.read()

    if BEGIN_MARK in flash:
        # Already patched; keep the result as it is.
        with open(out_path, "w", encoding="utf-8") as handle:
            handle.write(flash)
        print("patch-luci-flash: already patched")
        return

    for name, anchor in (
        ("helper", HELPER_ANCHOR),
        ("section", SECTION_ANCHOR),
        ("native flash call", FLASH_CALL_ANCHOR),
        ("native flash end", FLASH_END_ANCHOR),
        ("backup restore", RESTORE_ANCHOR),
        ("factory reset", FIRSTBOOT_ANCHOR),
    ):
        if anchor not in flash:
            fail(f"{name} anchor not found in {flash_path}; the LuCI view changed")

    helpers = f"{BEGIN_MARK}\n{ota}\n{END_MARK}\n"

    # 1. The helpers, before the view object is created.
    flash = flash.replace(HELPER_ANCHOR, helpers + HELPER_ANCHOR, 1)

    # 2. Guard the native "Flash image..." and "Apply backup?" handlers so a
    #    direct sysupgrade cannot archive a live SQLite writer.
    flash = flash.replace(FLASH_CALL_ANCHOR, FLASH_CALL_GUARDED, 1)
    flash = flash.replace(FLASH_END_ANCHOR, FLASH_END_GUARDED, 1)
    flash = flash.replace(RESTORE_ANCHOR, RESTORE_GUARDED, 1)

    # 3. Erase the DMRHub state before the native reset runs firstboot.
    flash = flash.replace(FIRSTBOOT_ANCHOR, FIRSTBOOT_GUARDED, 1)
    if RESET_CONFIRM_ANCHOR in flash:
        flash = flash.replace(RESET_CONFIRM_ANCHOR, RESET_CONFIRM, 1)

    # 4. The block, after the page has rendered. It cannot be a form section:
    #    this LuCI release builds the view on JSONMap, where a section added
    #    from outside renders its title but never its options.
    call = ("return Promise.resolve(m.render()).then(function(nodes){"
            "nodes.appendChild(dmrhubOtaPanel());return nodes;});},")
    flash = flash.replace(SECTION_ANCHOR, call, 1)

    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(flash)
    print(f"patch-luci-flash: patched {flash_path} -> {out_path}")


if __name__ == "__main__":
    main()
