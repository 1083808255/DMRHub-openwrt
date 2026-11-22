#!/usr/bin/env python3
"""Add the DMRHub OTA section to the LuCI "Backup / Flash Firmware" view.

The LuCI system/flash view is shipped as a minified JavaScript module. We do
not keep a copy of it in this repository: the build extracts the current file
from the luci-mod-system package and patches it here. That way an upstream
LuCI update cannot silently drop the section, because the patch fails loudly
when the anchor it needs is gone.

Usage: patch-luci-flash.py <flash.js> <ota.js> <output.js>
"""

import sys

BEGIN_MARK = "/* DMRHUB-OTA-BEGIN */"
END_MARK = "/* DMRHUB-OTA-END */"

# The helpers go before the view is defined, so every handler can reach them.
HELPER_ANCHOR = "var mapdata={actions:{},config:{}};"
# The section is added right before the page renders.
SECTION_ANCHOR = "return m.render();},"


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

    if HELPER_ANCHOR not in flash:
        fail(f"helper anchor not found in {flash_path}; the LuCI view changed")
    if SECTION_ANCHOR not in flash:
        fail(f"section anchor not found in {flash_path}; the LuCI view changed")

    helpers = f"{BEGIN_MARK}\n{ota}\n{END_MARK}\n"

    # 1. The helpers, before the view object is created.
    flash = flash.replace(HELPER_ANCHOR, helpers + HELPER_ANCHOR, 1)

    # 2. The section itself, just before the page renders.
    call = "m=dmrhubOtaSection(m,form);"
    flash = flash.replace(SECTION_ANCHOR, call + SECTION_ANCHOR, 1)

    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(flash)
    print(f"patch-luci-flash: patched {flash_path} -> {out_path}")


if __name__ == "__main__":
    main()
