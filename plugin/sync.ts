import { Vault, Notice, TFile } from "obsidian";
import { AuthManager } from "./auth";
import { WSClient } from "./ws";
import { FileWatcher } from "./fileWatcher";

export class SyncEngine {
	private vault: Vault;
	private auth: AuthManager;
	private vaultName: string;
	private ws: WSClient | null = null;
	private fileWatcher: FileWatcher | null = null;
	private lastSyncTime: number = 0;
	private syncInProgress: boolean = false;
	private pullInterval: ReturnType<typeof setInterval> | null = null;
	private onStatusChange?: (status: SyncStatus) => void;
	private recentPushTime: number = 0;

	constructor(
		vault: Vault,
		auth: AuthManager,
		vaultName: string,
		onStatusChange?: (status: SyncStatus) => void
	) {
		this.vault = vault;
		this.auth = auth;
		this.vaultName = vaultName || "default";
		this.onStatusChange = onStatusChange;
	}

	setFileWatcher(fw: FileWatcher): void { this.fileWatcher = fw; }

	start(): void {
		// Connect WebSocket to receive push notifications from other devices.
		// No periodic pull — local is the source of truth, cloud follows local.
		if (this.auth.isLoggedIn) this.connectWS();
	}

	connectWS(): void {
		if (this.ws) this.ws.close();
		const token = this.auth.getToken();
		if (!token) return;
		this.ws = new WSClient(
			this.auth.getServerUrl(), token,
			() => { if (Date.now() - this.recentPushTime >= 3000) { this.setStatus("pulling"); this.pull(); } },
			() => this.setStatus("online"),
			() => this.setStatus("offline")
		);
		this.ws.connect();
	}

	async push(changes: Array<{ path: string; action: string; content?: string; clientMtime: number }>): Promise<void> {
		if (!this.auth.isLoggedIn || this.syncInProgress) return;
		this.syncInProgress = true;
		this.setStatus("pushing");
		try {
			const resp = await this.auth.request("POST", "/api/sync/push", {
				vault: this.vaultName,
				changes,
				device_name: "obsidian-mac",
			});
			if (resp.conflicts?.length) new Notice(`⚠️ ${resp.conflicts.length} conflict(s)`);
			if (resp.accepted?.length) {
				this.lastSyncTime = Date.now();
				this.recentPushTime = Date.now();
				this.setStatus("online");
			}
		} catch (e: any) {
			console.error("[Cloud-Obsidian] Push failed:", e.message);
			this.setStatus("error");
		} finally { this.syncInProgress = false; }
	}

	async pull(): Promise<void> {
		if (!this.auth.isLoggedIn || this.syncInProgress) return;
		this.syncInProgress = true;
		this.setStatus("pulling");
		try {
			const resp = await this.auth.request("POST", "/api/sync/pull", {
				vault: this.vaultName,
				last_sync: this.lastSyncTime,
			});
			const changes = resp.changes || [];
			if (changes.length === 0) {
				this.setStatus("online");
				this.lastSyncTime = resp.server_time || Date.now();
				return;
			}
			for (const c of changes) await this.applyRemoteChange(c);
			this.lastSyncTime = resp.server_time || Date.now();
			this.setStatus("online");
		} catch (e: any) {
			console.error("[Cloud-Obsidian] Pull failed:", e.message);
			this.setStatus("error");
		} finally { this.syncInProgress = false; }
	}

	/** Push all local markdown files to server — ensures cloud mirrors local. */
	async fullSync(): Promise<void> {
		if (!this.auth.isLoggedIn) return;
		this.syncInProgress = true;
		this.setStatus("syncing");
		try {
			const files = this.vault.getMarkdownFiles();
			const changes: any[] = [];
			for (const f of files) {
				const content = await this.vault.read(f);
				changes.push({ path: f.path, action: "update", content, clientMtime: f.stat.mtime });
			}
			if (changes.length > 0) {
				await this.auth.request("POST", "/api/sync/push", {
					vault: this.vaultName,
					changes,
					device_name: "obsidian-mac",
				});
			}
			this.lastSyncTime = Date.now();
			this.recentPushTime = Date.now();
			this.setStatus("online");
			new Notice(`✅ Pushed ${changes.length} files to cloud`);
		} catch (e: any) {
			this.setStatus("error");
			new Notice(`Push failed: ${e.message}`);
		} finally { this.syncInProgress = false; }
	}

	/** Pull all remote files from server (use when switching devices). */
	async pullAll(): Promise<void> {
		if (!this.auth.isLoggedIn) return;
		this.syncInProgress = true;
		this.setStatus("pulling");
		try {
			const resp = await this.auth.request("POST", "/api/sync/pull", { vault: this.vaultName, last_sync: 0 });
			const changes = resp.changes || [];
			for (const c of changes) await this.applyRemoteChange(c);
			this.lastSyncTime = resp.server_time || Date.now();
			this.setStatus("online");
			new Notice(`✅ Pulled ${changes.length} files from cloud`);
		} catch (e: any) {
			this.setStatus("error");
			new Notice(`Pull failed: ${e.message}`);
		} finally { this.syncInProgress = false; }
	}

	private async applyRemoteChange(change: { path: string; action: string; content?: string }): Promise<void> {
		const { path, action, content } = change;
		if (this.fileWatcher) this.fileWatcher.ignorePath(path);
		try {
			switch (action) {
				case "create":
				case "update": {
					const dir = path.substring(0, path.lastIndexOf("/"));
					if (dir && !this.vault.getAbstractFileByPath(dir)) await this.vault.createFolder(dir);
					const existing = this.vault.getAbstractFileByPath(path);
					if (existing instanceof TFile) await this.vault.modify(existing, content || "");
					else await this.vault.create(path, content || "");
					break;
				}
				case "delete": {
					const file = this.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) await this.vault.delete(file);
					break;
				}
			}
		} catch (e: any) {
			console.error(`[Cloud-Obsidian] apply "${action} ${path}":`, e.message);
		}
	}

	stop(): void {
		if (this.ws) { this.ws.close(); this.ws = null; }
	}

	private setStatus(status: SyncStatus): void { if (this.onStatusChange) this.onStatusChange(status); }
}

export type SyncStatus = "offline" | "online" | "pushing" | "pulling" | "syncing" | "error";
