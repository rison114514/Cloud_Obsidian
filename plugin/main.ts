import { Plugin, Notice, addIcon, TFile } from "obsidian";
import { AuthManager } from "./auth";
import { SyncEngine, SyncStatus } from "./sync";
import { FileWatcher, FileChange } from "./fileWatcher";
import { LoginModal } from "./ui/LoginModal";
import { SettingsTab } from "./settings";

/**
 * Plugin settings persisted to data.json in the vault's .obsidian/plugins/... directory.
 */
interface CloudObsidianSettings {
	serverUrl: string;
	token?: string;       // JWT token saved across restarts
	username?: string;    // cached username
	userId?: number;      // cached user id
}

const DEFAULT_SETTINGS: CloudObsidianSettings = {
	serverUrl: "http://127.0.0.1:9090",
};

/**
 * CloudObsidianPlugin — main plugin class.
 *
 * Architecture:
 *   AuthManager  → handles login / token lifecycle
 *   SyncEngine   → push / pull / full sync
 *   FileWatcher  → watches local file changes → auto-push
 *   WSClient     → real-time push notifications from server → auto-pull
 *   LoginModal   → login / register UI
 *   SettingsTab  → plugin settings UI
 */
export default class CloudObsidianPlugin extends Plugin {
	settings!: CloudObsidianSettings;
	auth!: AuthManager;
	syncEngine!: SyncEngine | null;
	private fileWatcher!: FileWatcher | null;
	private statusBarEl!: HTMLElement;
	private ribbonIconEl!: HTMLElement;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Initialize auth manager.
		this.auth = new AuthManager(this.settings.serverUrl);

		// Restore session if token exists in saved settings.
		if (this.settings.token && this.settings.username && this.settings.userId) {
			// Re-inject saved credentials.
			(this.auth as any).token = this.settings.token;
			(this.auth as any).username = this.settings.username;
			(this.auth as any).userId = this.settings.userId;
		}

		// Register custom sync icon for ribbon.
		addIcon("cloud-obsidian-sync", `
			<circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-width="8"/>
			<path d="M30 50 L50 30 L70 50" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
			<path d="M50 70 L50 30" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
		`);

		// Status bar indicator.
		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("cloud-obsidian-status");
		this.updateStatusBar("offline");

		// Ribbon icon — click to open login or trigger sync.
		this.ribbonIconEl = this.addRibbonIcon(
			"cloud-obsidian-sync",
			"Cloud Obsidian Sync",
			() => {
				if (this.auth.isLoggedIn) {
					this.syncEngine?.fullSync();
				} else {
					this.openLoginModal();
				}
			}
		);

		// Command: Login
		this.addCommand({
			id: "cloud-obsidian-login",
			name: "Login / Register",
			callback: () => this.openLoginModal(),
		});

		// Command: Full Sync
		this.addCommand({
			id: "cloud-obsidian-full-sync",
			name: "Full Sync",
			callback: () => {
				if (this.auth.isLoggedIn) {
					this.syncEngine?.fullSync();
				} else {
					new Notice("Please login first");
				}
			},
		});

		// Command: Push Now
		this.addCommand({
			id: "cloud-obsidian-push",
			name: "Push Now",
			callback: () => this.manualPush(),
		});

		// Add settings tab.
		this.addSettingTab(new SettingsTab(this.app, this));

		// If logged in, start the sync engine.
		if (this.auth.isLoggedIn) {
			this.startSyncEngine();
		}

		console.log("[Cloud-Obsidian] Plugin loaded");
	}

	onunload(): void {
		this.stopSyncEngine();
		console.log("[Cloud-Obsidian] Plugin unloaded");
	}

	// ---- Public API ----

	openLoginModal(): void {
		const modal = new LoginModal(
			this.app,
			this.settings.serverUrl,
			async (username, password, serverUrl, isRegister) => {
				// Update server URL setting.
				this.settings.serverUrl = serverUrl;
				this.auth = new AuthManager(serverUrl);

				let result: { success: boolean; error?: string };
				if (isRegister) {
					result = await this.auth.register(username, password);
				} else {
					result = await this.auth.login(username, password);
				}

				if (result.success) {
					// Persist credentials.
					this.settings.token = this.auth.getToken()!;
					this.settings.username = this.auth.getUsername()!;
					this.settings.userId = this.auth.getUserId()!;
					await this.saveSettings();

					new Notice(`✅ Connected as ${username}`);
					this.startSyncEngine();
				} else {
					new Notice(`❌ ${result.error || "Authentication failed"}`);
				}
			}
		);
		modal.open();
	}

	logout(): void {
		this.stopSyncEngine();
		this.auth.logout();
		this.settings.token = undefined;
		this.settings.username = undefined;
		this.settings.userId = undefined;
		this.saveSettings();
		this.updateStatusBar("offline");
		new Notice("Logged out from Cloud Obsidian Sync");
	}

	async manualPush(): Promise<void> {
		if (!this.auth.isLoggedIn) {
			new Notice("Please login first");
			return;
		}
		// Collect all markdown files and push them.
		const files = this.app.vault.getMarkdownFiles();
		const changes: FileChange[] = [];
		for (const file of files) {
			const content = await this.app.vault.read(file);
			changes.push({
				path: file.path,
				action: "update",
				content,
				clientMtime: file.stat.mtime,
			});
		}
		if (changes.length > 0) {
			await this.syncEngine?.push(changes);
			new Notice(`Pushed ${changes.length} files`);
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	// ---- Internal ----

	private startSyncEngine(): void {
		this.stopSyncEngine();

		this.syncEngine = new SyncEngine(
			this.app.vault,
			this.auth,
			(status: SyncStatus) => this.updateStatusBar(status)
		);

		// Start file watcher for auto-push.
		this.fileWatcher = new FileWatcher(
			this.app.vault,
			(changes: FileChange[]) => {
				if (this.syncEngine) {
					this.syncEngine.push(changes);
				}
			}
		);
		this.fileWatcher.start();

		// Start sync engine (WS + periodic pull).
		this.syncEngine.start();

		// Initial full sync.
		this.syncEngine.fullSync();

		console.log("[Cloud-Obsidian] Sync engine started");
	}

	private stopSyncEngine(): void {
		if (this.fileWatcher) {
			this.fileWatcher.stop();
			this.fileWatcher = null;
		}
		if (this.syncEngine) {
			this.syncEngine.stop();
			this.syncEngine = null;
		}
	}

	private updateStatusBar(status: SyncStatus): void {
		const icons: Record<SyncStatus, string> = {
			online: "🟢",
			offline: "⚫",
			pushing: "🔼",
			pulling: "🔽",
			syncing: "🔄",
			error: "🔴",
		};
		const labels: Record<SyncStatus, string> = {
			online: "Synced",
			offline: "Offline",
			pushing: "Pushing...",
			pulling: "Pulling...",
			syncing: "Syncing...",
			error: "Error",
		};
		this.statusBarEl.setText(`${icons[status]} Cloud Sync: ${labels[status]}`);
	}
}
