include $(TOPDIR)/rules.mk

PKG_NAME:=dmrhub
PKG_VERSION:=1.3.31
PKG_RELEASE:=zh1

PKG_MAINTAINER:=1083808255
PKG_LICENSE:=AGPL-3.0-or-later
PKG_LICENSE_FILES:=LICENSE

# Prebuilt static binary (built by GitHub Actions, shipped in ./files)
include $(INCLUDE_DIR)/package.mk

define Package/dmrhub
  SECTION:=net
  CATEGORY:=Network
  TITLE:=DMRHub DMR network server (Chinese localization build)
  DEPENDS:=+ca-certificates
  PKGARCH:=all
endef

define Package/dmrhub/description
  DMRHub is a single-binary DMR network server. This package carries a
  prebuilt amd64 static binary with Simplified Chinese (zh-CN) localization.
  Data and config live under /opt/dmrhub (persistent storage).
endef

define Package/dmrhub/conffiles
/etc/config/dmrhub
endef

define Build/Compile
	# nothing to compile: binary is prebuilt and placed in files/usr/bin
endef

define Package/dmrhub/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/usr/bin/dmrhub $(1)/usr/bin/dmrhub
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/dmrhub $(1)/etc/init.d/dmrhub
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/dmrhub $(1)/etc/config/dmrhub
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/99-dmrhub $(1)/etc/uci-defaults/99-dmrhub
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/dmrhub-ota $(1)/usr/sbin/dmrhub-ota
	# The signing key that lets opkg verify our feed. The image keeps
	# "option check_signature" on, so the official feeds stay verified too.
	$(INSTALL_DIR) $(1)/etc/opkg/keys
	$(INSTALL_CONF) ./files/etc/opkg/keys/21874afde7248b53 $(1)/etc/opkg/keys/21874afde7248b53
endef

$(eval $(call BuildPackage,dmrhub))
