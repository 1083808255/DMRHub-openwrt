#!/usr/bin/env python3
"""Add traffic counters to the LuCI overview network box.

The overview's network widget is a minified LuCI module. The build extracts it
from the luci-mod-status package and patches it here, so an upstream LuCI
update cannot silently drop the counters: the patch fails loudly when an
anchor it needs is gone. The added line shows the bytes received and sent on
the upstream device, below the address/gateway/DNS list.

Usage: patch-luci-overview.py <30_network.js> <output.js>
"""

import sys

BEGIN_MARK = "/* DMRHUB-OVERVIEW-BEGIN */"

# renderbox() builds one upstream box. The counters reuse the device helpers
# that the ports widget already relies on (getRXBytes/getTXBytes), so no extra
# RPC call is needed: the overview refreshes the device state before it renders.
RENDERBOX_ANCHOR = "function renderbox(ifc,ipv6){var dev=ifc.getL3Device(),active="
RENDERBOX_PATCHED = (
    BEGIN_MARK
    + "function renderbox(ifc,ipv6){var dev=ifc.getL3Device(),"
    "traffic=(dev?('\\u2193 %1024mB \\u2191 %1024mB'.format(dev.getRXBytes(),dev.getTXBytes())):null),"
    "active="
)

# The box body is [address list, device badge]. Append the counters last.
BODY_ANCHOR = "_('MAC address'),dev.getMAC()))])]);}"
BODY_PATCHED = (
    "_('MAC address'),dev.getMAC())),"
    "traffic?E('div',{'class':'ifacebox-traffic','style':'padding-bottom:.25em'},traffic):null])]);}"
)


def fail(message: str) -> None:
    print(f"patch-luci-overview: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: patch-luci-overview.py <30_network.js> <output.js>")

    src_path, out_path = sys.argv[1:3]
    with open(src_path, encoding="utf-8") as handle:
        text = handle.read()

    if BEGIN_MARK in text:
        with open(out_path, "w", encoding="utf-8") as handle:
            handle.write(text)
        print("patch-luci-overview: already patched")
        return

    for name, anchor in (
        ("renderbox", RENDERBOX_ANCHOR),
        ("box body", BODY_ANCHOR),
    ):
        if anchor not in text:
            fail(f"{name} anchor not found in {src_path}; the LuCI view changed")

    text = text.replace(RENDERBOX_ANCHOR, RENDERBOX_PATCHED, 1)
    text = text.replace(BODY_ANCHOR, BODY_PATCHED, 1)

    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(text)
    print(f"patch-luci-overview: patched {src_path} -> {out_path}")


if __name__ == "__main__":
    main()