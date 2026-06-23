"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => CloudObsidianPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian7 = require("obsidian");

// auth.ts
var import_obsidian = require("obsidian");
var AuthManager = class {
  constructor(serverUrl) {
    this.token = null;
    this.userId = null;
    this.username = null;
    this.serverUrl = serverUrl.replace(/\/+$/, "");
  }
  get isLoggedIn() {
    return this.token !== null;
  }
  getServerUrl() {
    return this.serverUrl;
  }
  getToken() {
    return this.token;
  }
  getUsername() {
    return this.username;
  }
  getUserId() {
    return this.userId;
  }
  /**
   * Register a new account on the server.
   */
  async register(username, password) {
    try {
      const resp = await (0, import_obsidian.requestUrl)({
        url: `${this.serverUrl}/api/auth/register`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (resp.status === 201) {
        const data = resp.json;
        this.token = data.token;
        this.userId = data.user_id;
        this.username = data.username;
        return { success: true };
      }
      return { success: false, error: resp.json?.error || `HTTP ${resp.status}` };
    } catch (e) {
      return { success: false, error: e.message || "Network error" };
    }
  }
  /**
   * Login to an existing account.
   */
  async login(username, password) {
    try {
      const resp = await (0, import_obsidian.requestUrl)({
        url: `${this.serverUrl}/api/auth/login`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (resp.status === 200) {
        const data = resp.json;
        this.token = data.token;
        this.userId = data.user_id;
        this.username = data.username;
        return { success: true };
      }
      return { success: false, error: resp.json?.error || `HTTP ${resp.status}` };
    } catch (e) {
      return { success: false, error: e.message || "Network error" };
    }
  }
  /**
   * Clear current session.
   */
  logout() {
    this.token = null;
    this.userId = null;
    this.username = null;
  }
  /**
   * Make an authenticated request to the server.
   */
  async request(method, path, body) {
    if (!this.token) {
      throw new Error("Not logged in");
    }
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`
    };
    const resp = await (0, import_obsidian.requestUrl)({
      url: `${this.serverUrl}${path}`,
      method,
      headers,
      body: body ? JSON.stringify(body) : void 0
    });
    if (resp.status >= 400) {
      const err = resp.json?.error || `HTTP ${resp.status}`;
      throw new Error(err);
    }
    return resp.json;
  }
};

// sync.ts
var import_obsidian2 = require("obsidian");

// ws.ts
var WSClient = class {
  constructor(serverUrl, token, onMessage, onOpen, onClose) {
    this.ws = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 1e3;
    this.maxReconnectDelay = 6e4;
    this.shouldReconnect = true;
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.token = token;
    this.onMessage = onMessage;
    this.onOpen = onOpen;
    this.onClose = onClose;
  }
  /**
   * Open the WebSocket connection.
   */
  connect() {
    this.shouldReconnect = true;
    const wsUrl = this.serverUrl.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
    try {
      this.ws = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(this.token)}`);
      this.ws.onopen = () => {
        console.log("[Cloud-Obsidian] WebSocket connected");
        this.reconnectDelay = 1e3;
        this.onOpen();
      };
      this.ws.onmessage = (_event) => {
        this.onMessage();
      };
      this.ws.onclose = (event) => {
        console.log(`[Cloud-Obsidian] WebSocket closed (code=${event.code})`);
        this.onClose();
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };
      this.ws.onerror = (event) => {
        console.error("[Cloud-Obsidian] WebSocket error:", event);
      };
    } catch (e) {
      console.error("[Cloud-Obsidian] WebSocket connection failed:", e);
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    }
  }
  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    console.log(`[Cloud-Obsidian] Reconnecting in ${this.reconnectDelay / 1e3}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
  /**
   * Close the WebSocket and stop reconnecting.
   */
  close() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
};

// sync.ts
var SyncEngine = class {
  constructor(vault, auth, vaultName, onStatusChange) {
    this.ws = null;
    this.fileWatcher = null;
    this.lastSyncTime = 0;
    this.syncInProgress = false;
    this.pullInterval = null;
    this.recentPushTime = 0;
    this.vault = vault;
    this.auth = auth;
    this.vaultName = vaultName || "default";
    this.onStatusChange = onStatusChange;
  }
  setFileWatcher(fw) {
    this.fileWatcher = fw;
  }
  start() {
    if (this.auth.isLoggedIn)
      this.connectWS();
    this.pullInterval = setInterval(() => {
      if (this.auth.isLoggedIn && !this.syncInProgress)
        this.pull();
    }, 6e4);
  }
  connectWS() {
    if (this.ws)
      this.ws.close();
    const token = this.auth.getToken();
    if (!token)
      return;
    this.ws = new WSClient(
      this.auth.getServerUrl(),
      token,
      () => {
        if (Date.now() - this.recentPushTime >= 3e3) {
          this.setStatus("pulling");
          this.pull();
        }
      },
      () => this.setStatus("online"),
      () => this.setStatus("offline")
    );
    this.ws.connect();
  }
  async push(changes) {
    if (!this.auth.isLoggedIn || this.syncInProgress)
      return;
    this.syncInProgress = true;
    this.setStatus("pushing");
    try {
      const resp = await this.auth.request("POST", "/api/sync/push", {
        vault: this.vaultName,
        changes,
        device_name: "obsidian-mac"
      });
      if (resp.conflicts?.length)
        new import_obsidian2.Notice(`\u26A0\uFE0F ${resp.conflicts.length} conflict(s)`);
      if (resp.accepted?.length) {
        this.lastSyncTime = Date.now();
        this.recentPushTime = Date.now();
        this.setStatus("online");
      }
    } catch (e) {
      console.error("[Cloud-Obsidian] Push failed:", e.message);
      this.setStatus("error");
    } finally {
      this.syncInProgress = false;
    }
  }
  async pull() {
    if (!this.auth.isLoggedIn || this.syncInProgress)
      return;
    this.syncInProgress = true;
    this.setStatus("pulling");
    try {
      const resp = await this.auth.request("POST", "/api/sync/pull", {
        vault: this.vaultName,
        last_sync: this.lastSyncTime
      });
      const changes = resp.changes || [];
      if (changes.length === 0) {
        this.setStatus("online");
        this.lastSyncTime = resp.server_time || Date.now();
        return;
      }
      for (const c of changes)
        await this.applyRemoteChange(c);
      this.lastSyncTime = resp.server_time || Date.now();
      this.setStatus("online");
    } catch (e) {
      console.error("[Cloud-Obsidian] Pull failed:", e.message);
      this.setStatus("error");
    } finally {
      this.syncInProgress = false;
    }
  }
  async fullSync() {
    if (!this.auth.isLoggedIn)
      return;
    this.syncInProgress = true;
    this.setStatus("syncing");
    try {
      const resp = await this.auth.request("POST", "/api/sync/pull", { vault: this.vaultName, last_sync: 0 });
      const changes = resp.changes || [];
      for (const c of changes)
        await this.applyRemoteChange(c);
      this.lastSyncTime = resp.server_time || Date.now();
      this.setStatus("online");
      new import_obsidian2.Notice(`\u2705 Full sync \u2014 ${changes.length} files`);
    } catch (e) {
      this.setStatus("error");
      new import_obsidian2.Notice(`Full sync failed: ${e.message}`);
    } finally {
      this.syncInProgress = false;
    }
  }
  async applyRemoteChange(change) {
    const { path, action, content } = change;
    if (this.fileWatcher)
      this.fileWatcher.ignorePath(path);
    try {
      switch (action) {
        case "create":
        case "update": {
          const dir = path.substring(0, path.lastIndexOf("/"));
          if (dir && !this.vault.getAbstractFileByPath(dir))
            await this.vault.createFolder(dir);
          const existing = this.vault.getAbstractFileByPath(path);
          if (existing instanceof import_obsidian2.TFile)
            await this.vault.modify(existing, content || "");
          else
            await this.vault.create(path, content || "");
          break;
        }
        case "delete": {
          const file = this.vault.getAbstractFileByPath(path);
          if (file instanceof import_obsidian2.TFile)
            await this.vault.delete(file);
          break;
        }
      }
    } catch (e) {
      console.error(`[Cloud-Obsidian] apply "${action} ${path}":`, e.message);
    }
  }
  stop() {
    if (this.pullInterval) {
      clearInterval(this.pullInterval);
      this.pullInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  setStatus(status) {
    if (this.onStatusChange)
      this.onStatusChange(status);
  }
};

// fileWatcher.ts
var import_obsidian3 = require("obsidian");
var FileWatcher = class {
  constructor(vault, onChange, debounceMs = 500) {
    this.pending = /* @__PURE__ */ new Map();
    this.debounceTimer = null;
    this.ignorePaths = /* @__PURE__ */ new Set([".obsidian/", ".git/", ".trash/", ".DS_Store", ".index/", ".tmp/", "node_modules/", ".gitignore"]);
    this.ignoreNext = /* @__PURE__ */ new Set();
    this.vault = vault;
    this.onChange = onChange;
    this.debounceMs = debounceMs;
    this.onCreate = (file) => {
      if (file instanceof import_obsidian3.TAbstractFile)
        this.handleCreate(file);
    };
    this.onModify = (file) => {
      if (file instanceof import_obsidian3.TAbstractFile)
        this.handleModify(file);
    };
    this.onDelete = (file) => {
      if (file instanceof import_obsidian3.TAbstractFile)
        this.handleDelete(file);
    };
    this.onRename = (file, oldPath) => {
      if (file instanceof import_obsidian3.TAbstractFile && typeof oldPath === "string") {
        this.handleRename(file, oldPath);
      }
    };
  }
  /**
   * Start watching vault file changes.
   */
  start() {
    this.vault.on("create", this.onCreate);
    this.vault.on("modify", this.onModify);
    this.vault.on("delete", this.onDelete);
    this.vault.on("rename", this.onRename);
  }
  /**
   * Temporarily ignore a path (e.g. when applying remote changes locally).
   */
  ignorePath(path) {
    this.ignoreNext.add(path);
  }
  shouldIgnore(file) {
    const p = file.path;
    if (this.ignoreNext.has(p)) {
      this.ignoreNext.delete(p);
      return true;
    }
    for (const prefix of this.ignorePaths) {
      if (p.startsWith(prefix) || p.includes("/" + prefix.replace("/", ""))) {
        return true;
      }
    }
    return false;
  }
  async handleCreate(file) {
    if (this.shouldIgnore(file))
      return;
    if (!(file instanceof import_obsidian3.TFile))
      return;
    const content = await this.vault.read(file);
    this.enqueue({ path: file.path, action: "create", content, clientMtime: file.stat.mtime });
  }
  async handleModify(file) {
    if (this.shouldIgnore(file))
      return;
    if (!(file instanceof import_obsidian3.TFile))
      return;
    const content = await this.vault.read(file);
    this.enqueue({ path: file.path, action: "update", content, clientMtime: file.stat.mtime });
  }
  handleDelete(file) {
    if (this.shouldIgnore(file))
      return;
    this.enqueue({ path: file.path, action: "delete", clientMtime: Date.now() });
  }
  handleRename(file, oldPath) {
    if (this.shouldIgnore(file))
      return;
    this.enqueue({ path: oldPath, action: "delete", clientMtime: Date.now() });
    if (file instanceof import_obsidian3.TFile) {
      this.enqueue({ path: file.path, action: "create", clientMtime: file.stat.mtime });
    }
  }
  enqueue(change) {
    this.pending.set(change.path, change);
    if (this.debounceTimer)
      clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flush(), this.debounceMs);
  }
  flush() {
    if (this.pending.size === 0)
      return;
    const changes = Array.from(this.pending.values());
    this.pending.clear();
    this.onChange(changes);
  }
  /**
   * Stop watching (cleanup).
   */
  stop() {
    if (this.debounceTimer)
      clearTimeout(this.debounceTimer);
    this.vault.off("create", this.onCreate);
    this.vault.off("modify", this.onModify);
    this.vault.off("delete", this.onDelete);
    this.vault.off("rename", this.onRename);
  }
};

// ui/LoginModal.ts
var import_obsidian4 = require("obsidian");
var LoginModal = class extends import_obsidian4.Modal {
  constructor(app, defaultServerUrl, onSubmit) {
    super(app);
    this.serverUrl = defaultServerUrl;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cloud-obsidian-login-modal");
    contentEl.createEl("h2", { text: "Cloud Obsidian Sync" });
    contentEl.createEl("p", {
      text: "Connect to your self-hosted sync server.",
      cls: "cloud-obsidian-subtitle"
    });
    let serverUrlInput;
    new import_obsidian4.Setting(contentEl).setName("Server URL").setDesc("Your Cloud-Obsidian server address").addText((text) => {
      text.setPlaceholder("http://your-server:9090").setValue(this.serverUrl).onChange((value) => {
        this.serverUrl = value;
      });
      serverUrlInput = text.inputEl;
    });
    let usernameInput;
    new import_obsidian4.Setting(contentEl).setName("Username").setDesc("Your sync account username").addText((text) => {
      text.setPlaceholder("username");
      usernameInput = text.inputEl;
    });
    let passwordInput;
    new import_obsidian4.Setting(contentEl).setName("Password").setDesc("Your sync account password").addText((text) => {
      text.setPlaceholder("password");
      text.inputEl.type = "password";
      passwordInput = text.inputEl;
    });
    const buttonContainer = contentEl.createDiv({ cls: "cloud-obsidian-button-row" });
    const loginBtn = buttonContainer.createEl("button", {
      text: "Login",
      cls: "mod-cta"
    });
    loginBtn.addEventListener("click", () => {
      this.onSubmit(usernameInput.value, passwordInput.value, this.serverUrl, false);
      this.close();
    });
    const registerBtn = buttonContainer.createEl("button", {
      text: "Register"
    });
    registerBtn.addEventListener("click", () => {
      this.onSubmit(usernameInput.value, passwordInput.value, this.serverUrl, true);
      this.close();
    });
    passwordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.onSubmit(usernameInput.value, passwordInput.value, this.serverUrl, false);
        this.close();
      }
    });
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};

// ui/RemoteFileTree.ts
var import_obsidian5 = require("obsidian");
var REMOTE_TREE_VIEW_TYPE = "cloud-obsidian-remote-tree";
var RemoteFileTree = class extends import_obsidian5.ItemView {
  constructor(leaf, auth, vaultName, onSyncRequest) {
    super(leaf);
    this.auth = auth;
    this.vaultName = vaultName;
    this.onSyncRequest = onSyncRequest;
  }
  getViewType() {
    return REMOTE_TREE_VIEW_TYPE;
  }
  getDisplayText() {
    return `Remote: ${this.vaultName}`;
  }
  getIcon() {
    return "cloud-obsidian-sync";
  }
  async onOpen() {
    this.contentEl = this.containerEl.children[1];
    this.contentEl.empty();
    this.contentEl.addClass("cloud-obsidian-tree-panel");
    this.render();
  }
  async onClose() {
    this.contentEl.empty();
  }
  refresh() {
    this.render();
  }
  async render() {
    const root = this.contentEl;
    root.empty();
    const header = root.createDiv({ cls: "cloud-obsidian-tree-header" });
    header.createSpan({ text: `\u{1F4C1} ${this.vaultName}`, cls: "cloud-obsidian-tree-title" });
    const btnRow = header.createDiv({ cls: "cloud-obsidian-tree-actions" });
    const syncBtn = btnRow.createEl("button", { text: "\u{1F504} Sync", cls: "mod-cta" });
    syncBtn.addEventListener("click", () => this.onSyncRequest());
    const refreshBtn = btnRow.createEl("button", { text: "\u21BB Refresh" });
    refreshBtn.addEventListener("click", () => this.render());
    const body = root.createDiv({ cls: "cloud-obsidian-tree-body" });
    body.createEl("p", { text: "Loading...", cls: "cloud-obsidian-loading" });
    try {
      const resp = await this.auth.request("GET", `/api/files?vault=${encodeURIComponent(this.vaultName)}`);
      const files = resp.files || [];
      body.empty();
      if (files.length === 0) {
        body.createEl("p", { text: "\u{1F4ED} Remote vault is empty", cls: "cloud-obsidian-empty" });
        return;
      }
      const tree = this.buildTree(files);
      const treeEl = body.createDiv({ cls: "cloud-obsidian-tree" });
      this.renderTree(treeEl, tree, "");
      const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
      body.createEl("div", {
        text: `${files.length} files \xB7 ${this.formatSize(totalSize)}`,
        cls: "cloud-obsidian-tree-summary"
      });
    } catch (e) {
      body.empty();
      body.createEl("p", { text: `\u274C ${e.message}`, cls: "cloud-obsidian-error" });
    }
  }
  // ---- Tree logic ----
  buildTree(files) {
    const root = { name: "/", children: {}, files: [] };
    for (const f of files) {
      const parts = f.path.split("/");
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node.children[parts[i]]) {
          node.children[parts[i]] = { name: parts[i], children: {}, files: [] };
        }
        node = node.children[parts[i]];
      }
      const fileName = parts[parts.length - 1];
      if (fileName)
        node.files.push({ name: fileName, size: f.size });
    }
    return root;
  }
  renderTree(container, node, indent) {
    const dirs = Object.keys(node.children).sort();
    for (const dir of dirs) {
      const row = container.createDiv({ cls: "cots-tree-row" });
      row.createSpan({ text: `${indent}\u{1F4C1} ${dir}/`, cls: "cots-tree-dir" });
      this.renderTree(container, node.children[dir], indent + "    ");
    }
    for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      const row = container.createDiv({ cls: "cots-tree-row" });
      row.createSpan({ text: `${indent}${this.icon(f.name)} ${f.name}`, cls: "cots-tree-file" });
      if (f.size > 0)
        row.createSpan({ text: this.formatSize(f.size), cls: "cots-tree-size" });
    }
  }
  icon(name) {
    if (name.endsWith(".md"))
      return "\u{1F4DD}";
    if (name.match(/\.(png|jpg|gif|svg|webp)$/i))
      return "\u{1F5BC}\uFE0F";
    if (name.endsWith(".pdf"))
      return "\u{1F4C4}";
    if (name.endsWith(".canvas"))
      return "\u{1F3A8}";
    return "\u{1F4CE}";
  }
  formatSize(bytes) {
    if (bytes < 1024)
      return `${bytes} B`;
    if (bytes < 1024 * 1024)
      return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
};

// settings.ts
var import_obsidian6 = require("obsidian");
var SettingsTab = class extends import_obsidian6.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Cloud Obsidian Sync" });
    const isLoggedIn = this.plugin.auth.isLoggedIn;
    if (isLoggedIn) {
      containerEl.createEl("p", { text: `\u2705 Connected as ${this.plugin.auth.getUsername()}` });
      containerEl.createEl("p", { text: `\u{1F4E6} Vault: ${this.plugin.settings.vaultName}`, cls: "setting-item-description" });
      new import_obsidian6.Setting(containerEl).setName("Server").addText((t) => t.setValue(this.plugin.settings.serverUrl).setDisabled(true));
      new import_obsidian6.Setting(containerEl).setName("Vault Name").setDesc("Change to isolate this vault from others. Be careful \u2014 changing this disconnects from existing data.").addText((t) => {
        t.setValue(this.plugin.settings.vaultName).onChange(async (v) => {
          this.plugin.settings.vaultName = v || "default";
          await this.plugin.saveSettings();
        });
      });
      new import_obsidian6.Setting(containerEl).setName("Logout").addButton((btn) => {
        btn.setButtonText("Logout").setWarning().onClick(() => {
          this.plugin.logout();
          this.display();
        });
      });
      containerEl.createEl("h3", { text: "Sync Controls" });
      new import_obsidian6.Setting(containerEl).setName("Full Sync").addButton((btn) => {
        btn.setButtonText("Full Sync").setCta().onClick(() => this.plugin.syncEngine?.fullSync());
      });
      new import_obsidian6.Setting(containerEl).setName("Push Now").addButton((btn) => {
        btn.setButtonText("Push Now").onClick(() => this.plugin.manualPush());
      });
    } else {
      new import_obsidian6.Setting(containerEl).setName("Server URL").addText((t) => {
        t.setPlaceholder("http://your-server:9090").setValue(this.plugin.settings.serverUrl).onChange(async (v) => {
          this.plugin.settings.serverUrl = v;
          await this.plugin.saveSettings();
        });
      });
      new import_obsidian6.Setting(containerEl).setName("Open Login").addButton((btn) => {
        btn.setButtonText("Open Login").setCta().onClick(() => this.plugin.openLoginModal());
      });
    }
  }
};

// main.ts
var DEFAULT_SETTINGS = {
  serverUrl: "http://127.0.0.1:9090",
  vaultName: ""
};
var CloudObsidianPlugin = class extends import_obsidian7.Plugin {
  constructor() {
    super(...arguments);
    this.treeView = null;
  }
  async onload() {
    await this.loadSettings();
    this.auth = new AuthManager(this.settings.serverUrl);
    if (this.settings.token && this.settings.username && this.settings.userId) {
      this.auth.token = this.settings.token;
      this.auth.username = this.settings.username;
      this.auth.userId = this.settings.userId;
    }
    (0, import_obsidian7.addIcon)("cloud-obsidian-sync", `
			<circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-width="8"/>
			<path d="M30 50 L50 30 L70 50" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
			<path d="M50 70 L50 30" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
		`);
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("cloud-obsidian-status");
    this.updateStatusBar("offline");
    this.registerView(
      REMOTE_TREE_VIEW_TYPE,
      (leaf) => {
        this.treeView = new RemoteFileTree(leaf, this.auth, this.settings.vaultName || "default", () => {
          if (this.auth.isLoggedIn)
            this.syncEngine?.fullSync();
        });
        return this.treeView;
      }
    );
    this.addRibbonIcon("cloud-obsidian-sync", "Cloud Obsidian Sync", () => {
      if (!this.auth.isLoggedIn) {
        this.openLoginModal();
        return;
      }
      this.ensureVaultName();
      this.toggleRemoteTree();
    });
    this.addCommand({ id: "cloud-obsidian-login", name: "Login / Register", callback: () => this.openLoginModal() });
    this.addCommand({ id: "cloud-obsidian-tree", name: "Toggle Remote File Tree", callback: () => {
      if (!this.auth.isLoggedIn) {
        new import_obsidian7.Notice("Please login first");
        return;
      }
      this.toggleRemoteTree();
    } });
    this.addCommand({ id: "cloud-obsidian-sync", name: "Full Sync Now", callback: () => {
      if (this.auth.isLoggedIn) {
        this.syncEngine?.fullSync();
      } else {
        new import_obsidian7.Notice("Please login first");
      }
    } });
    this.addCommand({ id: "cloud-obsidian-push", name: "Push Now", callback: () => this.manualPush() });
    this.addSettingTab(new SettingsTab(this.app, this));
    if (this.auth.isLoggedIn) {
      this.ensureVaultName();
      this.startSyncEngine();
    }
    console.log("[Cloud-Obsidian] Plugin loaded");
  }
  onunload() {
    this.stopSyncEngine();
    this.app.workspace.detachLeavesOfType(REMOTE_TREE_VIEW_TYPE);
  }
  // ---- Remote Tree View ----
  async toggleRemoteTree() {
    const existing = this.app.workspace.getLeavesOfType(REMOTE_TREE_VIEW_TYPE);
    if (existing.length > 0) {
      existing[0].detach();
      return;
    }
    await this.app.workspace.getRightLeaf(false)?.setViewState({
      type: REMOTE_TREE_VIEW_TYPE,
      active: true
    });
    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(REMOTE_TREE_VIEW_TYPE)[0]
    );
    setTimeout(() => this.treeView?.refresh(), 300);
  }
  // ---- Login ----
  openLoginModal() {
    const modal = new LoginModal(this.app, this.settings.serverUrl, async (username, password, serverUrl, isRegister) => {
      this.settings.serverUrl = serverUrl;
      this.auth = new AuthManager(serverUrl);
      const result = isRegister ? await this.auth.register(username, password) : await this.auth.login(username, password);
      if (result.success) {
        this.settings.token = this.auth.getToken();
        this.settings.username = this.auth.getUsername();
        this.settings.userId = this.auth.getUserId();
        this.ensureVaultName();
        await this.saveSettings();
        new import_obsidian7.Notice(`\u2705 Connected as ${username} [${this.settings.vaultName}]`);
        this.startSyncEngine();
      } else {
        new import_obsidian7.Notice(`\u274C ${result.error || "Authentication failed"}`);
      }
    });
    modal.open();
  }
  logout() {
    this.stopSyncEngine();
    this.app.workspace.detachLeavesOfType(REMOTE_TREE_VIEW_TYPE);
    this.auth.logout();
    this.settings.token = void 0;
    this.settings.username = void 0;
    this.settings.userId = void 0;
    this.saveSettings();
    this.updateStatusBar("offline");
    new import_obsidian7.Notice("Logged out");
  }
  async manualPush() {
    if (!this.auth.isLoggedIn) {
      new import_obsidian7.Notice("Please login first");
      return;
    }
    const files = this.app.vault.getMarkdownFiles();
    const changes = [];
    for (const f of files)
      changes.push({ path: f.path, action: "update", content: await this.app.vault.read(f), clientMtime: f.stat.mtime });
    if (changes.length > 0) {
      await this.syncEngine?.push(changes);
      new import_obsidian7.Notice(`Pushed ${changes.length} files`);
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  ensureVaultName() {
    if (!this.settings.vaultName) {
      this.settings.vaultName = this.app.vault.getName().replace(/\s+/g, "_") || "default";
    }
  }
  // ---- Sync Engine ----
  startSyncEngine() {
    this.stopSyncEngine();
    this.ensureVaultName();
    this.syncEngine = new SyncEngine(this.app.vault, this.auth, this.settings.vaultName, (s) => this.updateStatusBar(s));
    this.fileWatcher = new FileWatcher(this.app.vault, (c) => {
      if (this.syncEngine)
        this.syncEngine.push(c);
    });
    this.fileWatcher.start();
    this.syncEngine.setFileWatcher(this.fileWatcher);
    this.syncEngine.start();
    this.syncEngine.fullSync();
  }
  stopSyncEngine() {
    if (this.fileWatcher) {
      this.fileWatcher.stop();
      this.fileWatcher = null;
    }
    if (this.syncEngine) {
      this.syncEngine.stop();
      this.syncEngine = null;
    }
  }
  updateStatusBar(status) {
    const icons = { online: "\u{1F7E2}", offline: "\u26AB", pushing: "\u{1F53C}", pulling: "\u{1F53D}", syncing: "\u{1F504}", error: "\u{1F534}" };
    const labels = { online: "Synced", offline: "Offline", pushing: "Pushing...", pulling: "Pulling...", syncing: "Syncing...", error: "Error" };
    this.statusBarEl.setText(`${icons[status]} Cloud Sync: ${labels[status]}`);
  }
};
