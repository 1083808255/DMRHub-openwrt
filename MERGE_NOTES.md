# DMRHub 同步说明

## 最终状态

本目录当前基于远端 `origin/main` 的提交：

- `bc95ceb Keep the locale module usable in the map worker and sync the keys`
- 远端：`https://github.com/1083808255/DMRHub-openwrt.git`
- 分支：`main`

## 为什么重置到远端

合并树原先基于 `_build_staging/` 的本地历史（`2cb1d8d`），本地领先远端 39 个提交；fetch 后发现远端已有 31 个整理后的提交，双方分叉。逐项比较后确认：远端已经包含原合并树中几乎全部较新改动，包括：

- worker 环境安全的 i18n
- GET 后再 POST 的 secret 合并修复
- 未注册通话者呼号回退与标识
- 额外 RadioID URL 配置
- 优雅关停超时
- upstream 网络、OpenWrt/OTA、固件工作流

因此没有推送重复的 39 个本地提交，而是采用干净同步策略。

## 备份

旧本地历史完整保存在分支：

- `backup/local-39-before-sync`

该分支指向原 `2cb1d8d` 及其 39 个提交，未删除。

## 本次相对 origin/main 补入的内容

远端前端已经调用 `/config/upstream/password/:index`，但后端缺少对应路由和处理器。补入：

1. `internal/http/api/routes.go`
   - 注册 `GET /config/upstream/password/:index`

2. `internal/http/api/controllers/v1/config/upstream.go`
   - 新增 `GETUpstreamPassword`
   - 按网络序号返回已保存密码，供管理员核对登录失败原因
   - 鉴权沿用现有 `RequireAdmin` 配置路由组

3. `internal/http/frontend/tests/unit/components/UpstreamTab.test.ts`
   - 补入密码显隐、逐条读取、密码保留、链接状态轮询和拒绝原因等 165 行测试

其他差异均以远端为准：

- 不恢复 `RadioIDExtraURL` 的空 `default:""` 标签（远端刻意删除）
- 删除本地遗留的 probe 脚本和截图（远端已清理）
- 采用远端恢复的 hack 脚本可执行位

## 验证

- `go build -o bin/DMRHub.exe .`：通过
- `go test ./internal/http/api ./internal/http/api/apimodels ./internal/http/api/pagination ./internal/http/api/utils`：通过
- 其他 API controller 测试在 Windows 上因 `internal/testutils/runshared.go` 依赖 Linux 专有 `syscall.Kill` / `syscall.Flock` 无法编译；属于平台限制，不是本次改动引入
- 前端测试未运行：当前系统 PATH 没有 `node` / `npm`
- `internal/http/frontend/dist/` 是既有产物，用于满足 `go:embed`；源码未改前端运行时逻辑，但后续仍建议用 Node 重建

## 旧目录

工作区中的 `../DMRHub/` 和 `../_build_staging/` 均保留为历史副本，未删除。
