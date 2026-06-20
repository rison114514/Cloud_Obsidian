# Cloud-Obsidian

自托管 Obsidian 多端同步方案。在自己的服务器上搭建同步中枢，配合 Obsidian 插件实现笔记实时双向同步，每次变更自动 Git 提交，完整版本历史可追溯。

## 架构

```
┌──────────────────────┐         HTTPS          ┌─────────────────────────┐
│  Obsidian 插件 (macOS) │ ◄──────────────────► │  云服务器 (Ubuntu)        │
│                      │                        │                          │
│  • 登录认证           │   REST API (push/pull) │  • Go 同步服务 (:9090)    │
│  • 文件变更监视       │   WebSocket (实时通知)  │  • Git 版本管理 (go-git)  │
│  • 自动双向同步       │   JWT Token            │  • SQLite 用户管理        │
└──────────────────────┘                        └─────────────────────────┘
```

**每次同步 = 一次 Git commit**，commit message 标注来源设备。随时可以 `git log` 回溯任何笔记的修改历史。

## 目录结构

```
cloud-obsidian/
├── README.md
├── .env                          # 服务器连接信息（不提交）
├── deploy.sh                     # 一键部署入口
├── deploy.exp                    # 部署自动化（Expect 脚本）
├── build-plugin.sh               # 插件构建脚本
├── docs/
│   └── lesson.md                 # 部署踩坑全记录
├── server/                       # Go 服务端
│   ├── main.go                   # 入口
│   ├── go.mod
│   ├── config/config.go          # 配置
│   ├── auth/{jwt,middleware}.go   # JWT + 中间件
│   ├── db/{models,sqlite}.go     # SQLite 数据层
│   ├── git/repo.go               # Git 版本管理
│   ├── vault/manager.go          # Vault 文件管理
│   ├── handler/                  # HTTP/WS 处理器
│   │   ├── auth.go               # 注册/登录
│   │   ├── sync.go               # push/pull/status
│   │   ├── file.go               # 文件列表/内容/历史
│   │   └── ws.go                 # WebSocket 推送
│   └── deploy/
│       ├── remote-install.sh     # 服务端安装脚本
│       ├── nginx.conf            # Nginx 配置（可选）
│       └── cloud-obsidian.service # systemd（可选）
└── plugin/                       # Obsidian 客户端插件
    ├── main.ts                   # 插件入口
    ├── manifest.json
    ├── auth.ts                   # 登录认证
    ├── sync.ts                   # 同步引擎
    ├── ws.ts                     # WebSocket 客户端
    ├── fileWatcher.ts            # 本地文件监视
    ├── settings.ts               # 设置面板
    ├── ui/LoginModal.ts          # 登录弹窗
    └── styles.css
```

## API 一览

| 端点 | 方法 | 认证 | 说明 |
|---|---|---|---|
| `/api/auth/register` | POST | ❌ | 注册新用户 |
| `/api/auth/login` | POST | ❌ | 登录获取 JWT |
| `/api/sync/push` | POST | ✅ | 推送本地变更 |
| `/api/sync/pull` | POST | ✅ | 拉取远端变更 |
| `/api/sync/status` | GET | ✅ | 同步状态 |
| `/api/files?prefix=` | GET | ✅ | 文件列表 |
| `/api/files/content?path=` | GET | ✅ | 获取文件内容 |
| `/api/files/history?path=` | GET | ✅ | 文件版本历史 |
| `/api/files/version?path=&commit=` | GET | ✅ | 获取历史版本 |
| `/ws?token=` | WebSocket | ✅ | 实时变更推送 |

## 技术栈

| 层 | 技术 |
|---|---|
| 服务端 | Go 1.22+, gorilla/mux, gorilla/websocket |
| 版本管理 | go-git (纯 Go 实现) |
| 数据库 | SQLite (go-sqlite3) |
| 认证 | JWT (golang-jwt/v5) |
| 密码加密 | bcrypt |
| 守护进程 | GNU screen + crontab @reboot |
| 客户端 | Obsidian Plugin API (TypeScript) |
| 构建 | esbuild |

---

## 部署服务端

### 前置要求

- Ubuntu 22.04+ 服务器（公网可达）
- 端口 `9090` 防火墙放行
- SSH 访问权限

### 快速部署

```bash
# 1. 克隆项目
git clone <your-repo-url> cloud-obsidian
cd cloud-obsidian

# 2. 编辑 .env 填入服务器信息
#    SERVER_HOST=你的服务器IP
#    SERVER_USER=ssh用户名
#    SERVER_PASSWORD=ssh密码

# 3. 一键部署
bash deploy.sh
```

部署脚本自动完成：
1. 安装 Go 1.22（从官方二进制，非 apt 旧版）
2. 安装系统依赖（sqlite3, git, screen, gcc）
3. 下载 Go 模块（使用国内镜像 `goproxy.cn`）
4. 编译服务端二进制（~8.5MB）
5. 启动服务（screen 后台守护）
6. 配置 `@reboot cron`（容器重启自动拉起）

### 国内服务器特别注意

- Go 模块代理默认被墙，脚本已自动设置 `GOPROXY=https://goproxy.cn`
- 若你部署在海外服务器，可删除该行恢复默认代理

### 管理命令

```bash
cloud-obsidian-ctl status   # 查看运行状态
cloud-obsidian-ctl restart  # 重启服务
cloud-obsidian-ctl log      # 实时日志
cloud-obsidian-ctl stop     # 停止服务
```

### 手动测试

```bash
# 健康检查
curl http://你的IP:9090/api/health
# → {"status":"ok"}

# 注册用户
curl -X POST http://你的IP:9090/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"myname","password":"mypass"}'

# 登录
curl -X POST http://你的IP:9090/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"myname","password":"mypass"}'
# → {"token":"eyJ...","user_id":1,"username":"myname"}
```

### 查看 Git 历史

```bash
ssh 你的服务器
cd /var/lib/cloud-obsidian/vaults/<用户名>
git log --oneline

# 输出示例:
# d6886af sync: update notes/idea.md [device: obsidian-mac]
# 14d243b sync: create remote-test.md [device: server-cli]
```

---

## 安装 Obsidian 插件

### 构建

```bash
cd plugin
npm install
npm run build
# 产出: main.js, manifest.json, styles.css
```

### 安装到 Obsidian

```bash
# 方法 A：使用脚本
bash build-plugin.sh "/path/to/your/vault"

# 方法 B：手动复制
cp main.js manifest.json styles.css \
  "/你的Vault路径/.obsidian/plugins/cloud-obsidian-sync/"
```

### 启用插件

1. 打开 Obsidian → **Settings → Community Plugins**
2. 找到 **Cloud Obsidian Sync** → 开启
3. 点击左侧 Ribbon 栏的云朵图标
4. 输入服务器地址、用户名、密码 → 点击 **Login**
5. 首次登录自动 Full Sync，状态栏显示 `🟢 Synced`

### 插件功能

- **自动 Push**：本地编辑笔记后自动推送到服务器
- **自动 Pull**：其他设备有变更时（WebSocket 通知）自动拉取
- **Full Sync**：首次登录或手动触发，全量同步
- **冲突检测**：多设备同时编辑同一文件时生成 `.conflict` 副本
- **状态栏**：实时显示同步状态（🟢 Synced / 🔼 Pushing / 🔽 Pulling / 🔴 Error）

---

## 同步协议

采用「最后修改时间 + 内容哈希」冲突检测：

1. **Push**：客户端上报本地变更，服务端逐文件比较
   - 服务端文件未变 → 直接写入 + Git commit
   - 服务端有更新 → 标记冲突，保留两个版本
2. **Pull**：客户端携带 `lastSync` 时间戳，拉取之后所有变更
3. **WebSocket 推送**：任意设备 push 后通知其他在线设备主动 pull

---

## 常见问题

### Q: 服务器在国内，Go 依赖下载超时？
已在 `remote-install.sh` 中配置 `GOPROXY=https://goproxy.cn`，七牛 CDN 加速。

### Q: 服务重启后笔记还在吗？
数据存储在 `/var/lib/cloud-obsidian/`，配有 `@reboot cron` 自动拉起。

### Q: 如何备份？
```bash
# 整个数据目录打包
tar -czf obsidian-backup.tar.gz /var/lib/cloud-obsidian/

# 或利用 Git 推送到远程仓库
cd /var/lib/cloud-obsidian/vaults/<用户名>
git remote add backup git@github.com:you/notes-backup.git
git push backup main
```

### Q: 能同步图片和附件吗？
可以。插件监视所有文件类型（`.md`, `.png`, `.pdf` 等），但注意大文件会占用带宽和 Git 仓库空间。

---

## License

MIT
