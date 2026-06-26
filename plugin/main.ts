import { Plugin, Notice, addIcon, TFolder, TAbstractFile, Menu } from "obsidian";
import { AuthManager } from "./auth";
import { SyncEngine, SyncStatus } from "./sync";
import { FileWatcher, FileChange } from "./fileWatcher";
import { LoginModal } from "./ui/LoginModal";
import { RemoteFileTree, REMOTE_TREE_VIEW_TYPE } from "./ui/RemoteFileTree";
import { SettingsTab } from "./settings";

interface CloudObsidianSettings {
	serverUrl: string;
	vaultName: string;
	token?: string;
	username?: string;
	userId?: number;
}

const DEFAULT_SETTINGS: CloudObsidianSettings = {
	serverUrl: "http://127.0.0.1:9090",
	vaultName: "",
};

export default class CloudObsidianPlugin extends Plugin {
	settings!: CloudObsidianSettings;
	auth!: AuthManager;
	syncEngine!: SyncEngine | null;
	private fileWatcher!: FileWatcher | null;
	private statusBarEl!: HTMLElement;
	private treeView: RemoteFileTree | null = null;
	private ignoredDirs: Set<string> = new Set();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.auth = new AuthManager(this.settings.serverUrl);

		if (this.settings.token && this.settings.username && this.settings.userId) {
			(this.auth as any).token = this.settings.token;
			(this.auth as any).username = this.settings.username;
			(this.auth as any).userId = this.settings.userId;
		}

		// ---- Status bar ----
		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("cloud-obsidian-status");
		this.updateStatusBar("offline");

		// ---- Register sidebar view ----
		this.registerView(
			REMOTE_TREE_VIEW_TYPE,
			(leaf) => {
				this.treeView = new RemoteFileTree(leaf, this.auth, this.settings.vaultName || "default", () => {
					if (this.auth.isLoggedIn) this.syncEngine?.fullSync();
				}, () => {
					if (this.auth.isLoggedIn) this.syncEngine?.pullAll();
				});
				return this.treeView;
			}
		);

		// ---- Ribbon: toggle remote tree ----
		addIcon("cloud-obsidian-sync", `<path fill="currentColor" d="M68 50c0-12-9-22-20-24-2-14-14-25-28-25-10 0-19 5-24 13-11 1-20 10-20 22 0 2 1 4 2 6-2 0-4 0-5 1-9 3-15 12-15 21 0 13 10 24 22 24h88c12 0 22-9 22-22 0-11-8-20-18-22-1-2-2-4-4-6z M45 55v-20l-10 10-4-4 16-16 16 16-4 4-10-10v20z"/>`);
		this.addRibbonIcon("cloud-obsidian-sync", "Cloud Obsidian Sync", () => {
			if (!this.auth.isLoggedIn) { this.openLoginModal(); return; }
			this.ensureVaultName();
			this.toggleRemoteTree();
		});

		// ---- File explorer context menu (ignore / resume sync) ----
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				if (!this.auth.isLoggedIn) return;
				if (!(file instanceof TFolder)) return;
				const dirPath = file.path;
				const ignored = this.ignoredDirs.has(dirPath);

				menu.addSeparator();
				menu.addItem((item) => item
					.setTitle(ignored ? "🔄 恢复远程同步此文件夹" : "🚫 不再远程同步此文件夹")
					.setSection("cloud-obsidian")
					.onClick(() => this.toggleDirectorySync(dirPath, !ignored))
				);
			})
		);

		// ---- Commands ----
		this.addCommand({ id: "cloud-obsidian-login", name: "Login / Register", callback: () => this.openLoginModal() });
		this.addCommand({ id: "cloud-obsidian-tree", name: "Toggle Remote File Tree", callback: () => {
			if (!this.auth.isLoggedIn) { new Notice("Please login first"); return; }
			this.toggleRemoteTree();
		}});
		this.addCommand({ id: "cloud-obsidian-sync", name: "Push All to Cloud", callback: () => {
			if (this.auth.isLoggedIn) { this.syncEngine?.fullSync(); } else { new Notice("Please login first"); }
		}});
		this.addCommand({ id: "cloud-obsidian-pull", name: "Pull All from Cloud", callback: () => {
			if (this.auth.isLoggedIn) { this.syncEngine?.pullAll(); } else { new Notice("Please login first"); }
		}});

		this.addSettingTab(new SettingsTab(this.app, this));

		if (this.auth.isLoggedIn) {
			this.ensureVaultName();
			this.loadIgnoreList();
			this.startSyncEngine();
		}
		console.log("[Cloud-Obsidian] Plugin loaded");
	}

	onunload(): void {
		this.stopSyncEngine();
		this.app.workspace.detachLeavesOfType(REMOTE_TREE_VIEW_TYPE);
	}

	// ---- Remote Tree View ----

	private async toggleRemoteTree(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(REMOTE_TREE_VIEW_TYPE);
		if (existing.length > 0) {
			existing[0].detach();
			return;
		}
		await this.app.workspace.getRightLeaf(false)?.setViewState({
			type: REMOTE_TREE_VIEW_TYPE,
			active: true,
		});
		this.app.workspace.revealLeaf(
			this.app.workspace.getLeavesOfType(REMOTE_TREE_VIEW_TYPE)[0]
		);
		// Refresh the tree after opening
		setTimeout(() => this.treeView?.refresh(), 300);
	}

	// ---- Login ----

	openLoginModal(): void {
		const modal = new LoginModal(this.app, this.settings.serverUrl, async (username, password, serverUrl, isRegister) => {
			this.settings.serverUrl = serverUrl;
			this.auth = new AuthManager(serverUrl);
			const result = isRegister
				? await this.auth.register(username, password)
				: await this.auth.login(username, password);
			if (result.success) {
				this.settings.token = this.auth.getToken()!;
				this.settings.username = this.auth.getUsername()!;
				this.settings.userId = this.auth.getUserId()!;
				this.ensureVaultName();
				this.loadIgnoreList();
				await this.saveSettings();
				new Notice(`✅ Connected as ${username} [${this.settings.vaultName}]`);
				this.startSyncEngine();
			} else {
				new Notice(`❌ ${result.error || "Authentication failed"}`);
			}
		});
		modal.open();
	}

	logout(): void {
		this.stopSyncEngine();
		this.app.workspace.detachLeavesOfType(REMOTE_TREE_VIEW_TYPE);
		this.auth.logout();
		this.settings.token = undefined;
		this.settings.username = undefined;
		this.settings.userId = undefined;
		this.saveSettings();
		this.updateStatusBar("offline");
		new Notice("Logged out");
	}

	async manualPush(): Promise<void> {
		if (!this.auth.isLoggedIn) { new Notice("Please login first"); return; }
		const files = this.app.vault.getMarkdownFiles();
		const changes: FileChange[] = [];
		for (const f of files) changes.push({ path: f.path, action: "update", content: await this.app.vault.read(f), clientMtime: f.stat.mtime });
		if (changes.length > 0) { await this.syncEngine?.push(changes); new Notice(`Pushed ${changes.length} files`); }
	}

	async manualPull(): Promise<void> {
		if (!this.auth.isLoggedIn) { new Notice("Please login first"); return; }
		await this.syncEngine?.pullAll();
	}

	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }

	private ensureVaultName(): void {
		if (!this.settings.vaultName) {
			this.settings.vaultName = this.app.vault.getName().replace(/\s+/g, "_") || "default";
		}
	}

	// ---- Sync Ignore ----

	private async loadIgnoreList(): Promise<void> {
		try {
			const resp = await this.auth.request("GET", `/api/sync/ignores?vault=${encodeURIComponent(this.settings.vaultName || "default")}`);
			const patterns: string[] = resp.patterns || [];
			this.ignoredDirs = new Set(patterns.map((p: string) => p.replace(/\/$/, "")));
		} catch { /* silently ignore if server unreachable */ }
	}

	private async toggleDirectorySync(dirPath: string, ignore: boolean): Promise<void> {
		const vaultName = this.settings.vaultName || "default";
		try {
			await this.loadIgnoreList();
			const prefix = dirPath + "/";
			let updated: string[];
			if (ignore) {
				const all = Array.from(this.ignoredDirs).map((p) => p + "/");
				all.push(prefix);
				updated = [...new Set(all)];
			} else {
				updated = Array.from(this.ignoredDirs)
					.map((p) => p + "/")
					.filter((p) => p !== prefix);
			}
			await this.auth.request("POST", "/api/sync/ignores", { vault: vaultName, patterns: updated });
			await this.loadIgnoreList();
			new Notice(ignore ? `🚫 已停止同步文件夹: ${dirPath}` : `🔄 已恢复同步文件夹: ${dirPath}`);
		} catch (e: any) {
			new Notice(`❌ 操作失败: ${e.message}`);
		}
	}

	// ---- Sync Engine ----

	private startSyncEngine(): void {
		this.stopSyncEngine();
		this.ensureVaultName();
		this.syncEngine = new SyncEngine(this.app.vault, this.auth, this.settings.vaultName, (s: SyncStatus) => this.updateStatusBar(s));
		this.fileWatcher = new FileWatcher(this.app.vault, (c: FileChange[]) => { if (this.syncEngine) this.syncEngine.queueChanges(c); });
		this.fileWatcher.start();
		this.syncEngine.setFileWatcher(this.fileWatcher);
		this.syncEngine.start();
		// No auto fullSync — local is source of truth, cloud follows local.
	}

	private stopSyncEngine(): void {
		if (this.fileWatcher) { this.fileWatcher.stop(); this.fileWatcher = null; }
		if (this.syncEngine) { this.syncEngine.stop(); this.syncEngine = null; }
	}

	private updateStatusBar(status: SyncStatus): void {
		const icons: Record<SyncStatus, string> = { online: "🟢", offline: "⚫", pushing: "🔼", pulling: "🔽", syncing: "🔄", error: "🔴" };
		const labels: Record<SyncStatus, string> = { online: "Synced", offline: "Offline", pushing: "Pushing...", pulling: "Pulling...", syncing: "Syncing...", error: "Error" };
		this.statusBarEl.setText(`${icons[status]} Cloud Sync: ${labels[status]}`);
	}
}
