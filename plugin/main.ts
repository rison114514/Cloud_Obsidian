import { Plugin, Notice, addIcon } from "obsidian";
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

	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }

	private ensureVaultName(): void {
		if (!this.settings.vaultName) {
			this.settings.vaultName = this.app.vault.getName().replace(/\s+/g, "_") || "default";
		}
	}

	// ---- Sync Engine ----

	private startSyncEngine(): void {
		this.stopSyncEngine();
		this.ensureVaultName();
		this.syncEngine = new SyncEngine(this.app.vault, this.auth, this.settings.vaultName, (s: SyncStatus) => this.updateStatusBar(s));
		this.fileWatcher = new FileWatcher(this.app.vault, (c: FileChange[]) => { if (this.syncEngine) this.syncEngine.push(c); });
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
