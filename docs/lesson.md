# Cloud-Obsidian 部署踩坑全记录

## 时间线

2026-06-19，将 Go 编写的 Obsidian 同步服务部署到远程服务器 (<SERVER_IP>, Ubuntu 22.04, Docker 容器环境)。

---

## 问题 1：SSH 密码认证

**现象**：`Permission denied (publickey,password)`  
**根因**：密码错误。用户先给了 `<USERNAME>`，后更正为 `<CORRECT_PASSWORD>`。  
**修复**：确认正确密码。

---

## 问题 2：Bash expect `-c` 字符串转义地狱

**现象**：Step 2 报 `invalid command name "echo"`（Tcl 把 shell 的 `echo` 当成 Tcl 命令执行），Step 3 报 `No such file or directory`（文件已上传但路径错误）。

**根因**：
```
expect -c "spawn ssh ... '$cmd'"
```
当 `$cmd` 中包含 `|`, `;`, `>` 等 shell 元字符时，经过三层解析（bash → expect -c → Tcl → sh -c），引号层层剥离，元字符在错误的层级被解释。

例如 `echo ---` 中的 `---` 在 Tcl 中变成了命令名。单引号在 Tcl 双引号内只是普通字符，不会保护 shell 管道符。

**教训**：**绝不要用 `expect -c "..."` 传递含 shell 元字符的命令。**  
**修复**：改用纯 expect 脚本文件（`deploy.exp`），使用 Tcl 变量 `$cmd` 配合 `spawn bash -c "ssh ... '$cmd'"`，单引号在 bash 层面保护了特殊字符。

---

## 问题 3：SCP 路径嵌套

**现象**：`remote-install.sh: No such file or directory`

**根因**：
```bash
scp -r ./server user@host:~/cloud-obsidian-server
```
`scp -r dir host:dst` 会把 `dir` **本身**复制到 `dst`，结果是 `~/cloud-obsidian-server/server/...`。而 SSH 执行时用的是 `~/cloud-obsidian-server/deploy/remote-install.sh`，少了一层。

修复尝试：
- `scp -r server/ user@host:~/cloud-obsidian-server/`（加尾斜杠，复制**内容**而非目录）— 但由于第一次上传遗留了 `server/` 子目录，两者混在一起。
- 最终方案：先 `rm -rf cloud-obsidian-server` 清理，再上传。

**教训**：`scp -r src dst` 和 `scp -r src/ dst/` 行为不同。清旧再传新最可靠。

---

## 问题 4：`remote-install.sh` 工作目录错误

**现象**：`no Go files in /home/ubuntu/cloud-obsidian-server/deploy`

**根因**：
```bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"  # = ~/cloud-obsidian-server/deploy/
cd "$SCRIPT_DIR"
go build .
```
`go build .` 在 `deploy/` 目录执行，但这个目录里没有 `.go` 文件，源码在父目录。

**修复**：`SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"`

**教训**：脚本所在目录 ≠ 项目根目录。永远确认 `go build` 的 `-C` 或 `cd` 目标目录是否正确。

---

## 问题 5：Go 依赖缺失 — `missing go.sum entry`

**现象**：
```
missing go.sum entry for module providing package github.com/go-git/go-git/v5
missing go.sum entry for module providing package github.com/golang-jwt/jwt/v5
... (所有外部依赖)
```

**根因**：
1. `go.mod` 是手工编写的，只声明了 `require` 指令
2. **没有 `go.sum`** 文件（校验和文件，由 `go mod tidy` 生成）
3. **没有运行 `go mod tidy` 或 `go mod download`** 来下载依赖和生成 `go.sum`
4. `go build` 在网络受限或无网络时会直接失败

**根本原因**：本地没有 Go 环境，无法预生成 `go.sum`。服务器需要联网下载依赖。

**修复**：在 `go build` 之前执行 `go mod tidy`。

---

## 问题 6：Go 版本过低

**现象**：服务器安装的 Go 版本为 `1.18.1`（来自 Ubuntu 22.04 apt 源），而 `go.mod` 声明 `go 1.21`。

**影响**：
- `go-git/v5` 需要 Go ≥1.19
- `golang.org/x/crypto` 最新版需要 Go ≥1.20
- Go 1.18 无法编译某些依赖

**修复方案**：从官方下载 Go 1.21+ 二进制包安装，替换 apt 的旧版本。

---

## 经验总结

| # | 教训 | 原则 |
|---|------|------|
| 1 | bash 字符串传 expect `-c` 必然出错 | 纯 expect 脚本文件，不混合 |
| 2 | `scp -r` 有/无尾斜杠语义不同 | 先 rm 清空目标再传 |
| 3 | 脚本内 `$0` 路径 ≠ 项目根目录 | 显式指定 `SCRIPT_DIR/..` 或用绝对路径 |
| 4 | `go.mod` 需要 `go.sum` | `go mod tidy` 是编译前的必要步骤 |
| 5 | apt 的 Go 版本偏旧 | 服务器编译用官方 Go 二进制包 |
| 6 | 先检查再假设 | 每次部署前确认 Go 版本、目录结构、网络可达性 |

---

## 问题 7：Go 模块代理被墙 — `i/o timeout`

**现象**：
```
go: github.com/gorilla/mux@v1.8.1: Get "https://proxy.golang.org/...": dial tcp 142.251.33.209:443: i/o timeout
```

**根因**：服务器在国内，Go 默认模块代理 `proxy.golang.org`（Google IP `142.251.x.x`）被 GFW 阻断。`go mod tidy` 无法下载任何外部依赖。

**修复**：
```bash
export GOPROXY="https://goproxy.cn,https://goproxy.io,direct"
```
- `goproxy.cn`：七牛 CDN，国内极快
- `goproxy.io`：备用
- `direct`：如果前两个都失败，直连源站

**教训**：国内服务器编译 Go 项目，`GOPROXY` 是必设项。

---

## 问题 8：`go-sqlite3` 需要 C 编译环境

**现象**：`go-sqlite3` 是 CGO 驱动的 SQLite 绑定，需要 `libsqlite3-dev`（C 头文件）和 `gcc`（C 编译器）。缺少时 `go build` 会报头文件缺失。

**修复**：`apt-get install -y libsqlite3-dev gcc`

**替代方案**：可换成纯 Go 的 `modernc.org/sqlite`，不需要 CGO。但 `go-sqlite3` 更成熟稳定。

---

## 最终结果 ✅

2026-06-19 ~ 2026-06-20，历经 10 个问题的排查和修复，Cloud-Obsidian 成功部署并验证双向同步。

```
✅ 健康检查：{"status":"ok"}
✅ 二进制：/usr/local/bin/cloud-obsidian-server (8.5MB)
✅ 守护：screen + crontab @reboot
✅ Go：1.22.10（官方二进制）
✅ 数据：/var/lib/cloud-obsidian/
✅ 管理：cloud-obsidian-ctl {status|restart|log|stop}
```

## 最终技术栈

| 层 | 技术 | 备注 |
|---|---|---|
| 语言 | Go 1.22.10 | go.dev 官方二进制，非 apt |
| HTTP | gorilla/mux | REST API |
| WebSocket | gorilla/websocket | 实时推送 |
| 认证 | JWT (golang-jwt/v5) | HMAC-SHA256 |
| 数据库 | SQLite (go-sqlite3 + CGO) | 用户 + 同步日志 |
| Git | go-git/v5 | 每次同步自动 commit |
| 守护 | GNU screen + crontab | 无 systemd 环境 |
| 代理 | goproxy.cn | 国内 Go 模块镜像 |

---

## 问题 9：防火墙未放行端口

**现象**：`curl localhost:9090/api/health` 正常，外部 `curl http://IP:9090` 超时。

**根因**：云服务器防火墙未放行 9090 端口。容器内监听正常，但宿主机层面拦截了流量。

**修复**：在云服务器控制台 / ufw 放行 `9090/tcp`。

**教训**：部署完成必须从**外部**验证端口可达性。

---

## 问题 10：npm 缓存权限 + esbuild ESM

**现象**：
- `npm install` 报 `cache folder contains root-owned files`
- `node esbuild.config.mjs` 报 `require is not defined in ES module scope`（Node v24）

**修复**：`npm install --cache /tmp/npm-cache`；esbuild 配置改用 `import` + top-level `await`。

---

## 最终验证 ✅

```
✅ 服务端: http://<SERVER_IP>:9090  {"status":"ok"}
✅ Push:   本地创建文件 → 自动上传 → Git commit [device: obsidian-mac]
✅ Pull:   远端文件 → 自动下载到本地 vault
✅ Git:    每次同步一条 commit，标注来源设备
```

**核心踩坑速查**：

| # | 类型 | 一句话 |
|---|------|--------|
| 1 | 密码 | 确认 SSH 密码正确 |
| 2 | 转义 | 不用 `expect -c`，纯 expect 脚本 |
| 3 | SCP | `scp -r` 尾斜杠语义不同，先清旧再传 |
| 4 | 目录 | 脚本 `$0` 路径 ≠ 项目根目录 |
| 5 | go.sum | 手工 go.mod 必须 `go mod tidy` |
| 6 | Go 版 | apt 的 Go 太旧，用 go.dev 官方二进制 |
| 7 | 代理 | 国内服务器设 `GOPROXY=goproxy.cn` |
| 8 | CGO | go-sqlite3 需要 `libsqlite3-dev` + `gcc` |
| 9 | 防火墙 | 外部验证端口可达性 |
| 10 | npm | Node v24 ESM 兼容 + npm 缓存权限 |
