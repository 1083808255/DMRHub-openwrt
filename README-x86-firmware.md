# DMRHub x86_64 OpenWrt 固件（汉化版）

本仓库用于自动构建预装 **DMRHub 汉化版**的 x86_64 OpenWrt 固件，并支持应用/固件 OTA 更新。

## 产物

GitHub Actions（`.github/workflows/build-firmware.yml`）每次运行产出：

| 文件 | 说明 |
|---|---|
| `openwrt-24.10.8-x86-64-dmrhub-*-squashfs-combined.img.gz` | 整机固件，预装 DMRHub，sysupgrade 直接刷 |
| `dmrhub_1.3.31-zh1_x86_64.ipk` | DMRHub 应用包，可单独 opkg 更新 |
| `version.json` | OTA 清单 |
| `checksums.sha256` | 校验和 |

全部发布到本仓库的 GitHub Release。

## 构建链

1. **前端**：Node 26.13.0，`npm ci && npm run i18n:check && npm run build`，把 940 条中英词条编译进 `dist/`
2. **WASM 插件**：TinyGo 0.43.0，`go generate ./internal/plugins/builtin/...` 生成 `builtin.wasm.zst`
3. **后端**：Go 1.27.3，`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build`，静态二进制
4. **ipk**：手工打包 `debian-binary + control.tar.gz + data.tar.gz` 为 ar 归档
5. **固件**：OpenWrt 24.10.8 x86/64 ImageBuilder，`make image` 集成 ipk + LuCI 中文

## 汉化如何跟随上游

- 汉化以词条形式集中在 `internal/http/frontend/src/i18n/locales/zh-CN.json`（key 为英文原文）
- 上游更新后，重新构建时 `i18n:check` 校验 940 条词条对齐；新增词条会以英文占位并提示补翻
- 补翻只需编辑 `zh-CN.json`，无需改组件代码

## 使用

```sh
# 刷整机固件（保留配置）
sysupgrade -k <firmware.img.gz>

# 首次启动后配置路径
/opt/dmrhub/config.yaml

# Web 管理端口
3005

# OTA 检查更新
dmrhub-ota check
```

## 手动触发

在 GitHub 仓库 Actions 页面运行 `Build DMRHub x86_64 OpenWrt Firmware`，可指定上游 ref。
