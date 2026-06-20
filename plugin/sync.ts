import { Vault, Notice, TFile, TFolder } from "obsidian";
import { AuthManager } from "./auth";
import { WSClient } from "./ws";
import { FileWatcher } from "./fileWatcher";

/**
 * SyncEngine orchestrates bidirectional sync between the local vault and the server.
 */
export class SyncEngine {
	private vault: Vault;
	private auth: AuthManager;
	private ws: WSClient | null = null;
	private fileWatcher: FileWatcher | null = null;
	private lastSyncTime: number = 0; // unix milliseconds
	private syncInProgress: boolean = false;
	private pullInterval: ReturnType<typeof setInterval> | null = null;
	private onStatusChange?: (status: SyncStatus) => void;
	private recentPushTime: number = 0; // suppress WS-triggered pull right after push

	constructor(
		vault: Vault,
		auth: AuthManager,
		onStatusChange?: (status: SyncStatus) => void
	) {
		this.vault = vault;
		this.auth = auth;
		this.onStatusChange = onStatusChange;
	}

	/** Set the FileWatcher so we can suppress self-triggered events. */
	setFileWatcher(fw: FileWatcher): void {
		this.fileWatcher = fw;
	}

	/**
	 * Start background sync: WebSocket for real-time push + periodic pull.
	 */
	start(): void {
		if (this.auth.isLoggedIn) {
			this.connectWS();
		}

		// Periodic pull every 60 seconds as fallback (was 30, longer to reduce noise).
		this.pullInterval = setInterval(() => {
			if (this.auth.isLoggedIn && !this.syncInProgress) {
				this.pull();
			}
		}, 60_000);
	}

	/**
	 * Connect WebSocket for real-time sync notifications.
	 */
	connectWS(): void {
		if (this.ws) {
			this.ws.close();
		}
		const token = this.auth.getToken();
		if (!token) return;

		this.ws = new WSClient(
			this.auth.getServerUrl(),
			token,
			() => {
				// Suppress pull if we just pushed (within 3 seconds).
				if (Date.now() - this.recentPushTime < 3000) {
					return;
				}
				this.setStatus("pulling");
				this.pull();
			},
			() => this.setStatus("online"),
			() => this.setStatus("offline")
		);
		this.ws.connect();
	}

	/**
	 * Push local changes to the server.
	 */
	async push(changes: Array<{ path: string; action: string; content?: string; clientMtime: number }>): Promise<void> {
		if (!this.auth.isLoggedIn || this.syncInProgress) return;

		this.syncInProgress = true;
		this.setStatus("pushing");

		try {
			const resp = await this.auth.request("POST", "/api/sync/push", {
				changes,
				device_name: "obsidian-mac",
			});

			const conflictCount = resp.conflicts?.length || 0;
			if (conflictCount > 0) {
				new Notice(`⚠️ ${conflictCount} conflict(s) detected`);
			}

			const acceptedCount = resp.accepted?.length || 0;
			if (acceptedCount > 0) {
				this.lastSyncTime = Date.now();
				this.recentPushTime = Date.now(); // suppress immediate WS pull
				this.setStatus("online");
			}
		} catch (e: any) {
			console.error("[Cloud-Obsidian] Push failed:", e.message);
			this.setStatus("error");
		} finally {
			this.syncInProgress = false;
		}
	}

	/**
	 * Pull remote changes from the server and apply to local vault.
	 */
	async pull(): Promise<void> {
		if (!this.auth.isLoggedIn || this.syncInProgress) return;

		this.syncInProgress = true;
		this.setStatus("pulling");

		try {
			const resp = await this.auth.request("POST", "/api/sync/pull", {
				last_sync: this.lastSyncTime,
			});

			const changes = resp.changes || [];
			if (changes.length === 0) {
				this.setStatus("online");
				this.lastSyncTime = resp.server_time || Date.now();
				return;
			}

			for (const change of changes) {
				await this.applyRemoteChange(change);
			}

			this.lastSyncTime = resp.server_time || Date.now();
			this.setStatus("online");
			console.log(`[Cloud-Obsidian] Pulled ${changes.length} changes`);
		} catch (e: any) {
			console.error("[Cloud-Obsidian] Pull failed:", e.message);
			this.setStatus("error");
		} finally {
			this.syncInProgress = false;
		}
	}

	/**
	 * Initial full sync: pull all remote files to this vault.
	 */
	async fullSync(): Promise<void> {
		if (!this.auth.isLoggedIn) return;

		this.syncInProgress = true;
		this.setStatus("syncing");

		try {
			const resp = await this.auth.request("POST", "/api/sync/pull", {
				last_sync: 0,
			});

			const changes = resp.changes || [];
			for (const change of changes) {
				await this.applyRemoteChange(change);
			}

			this.lastSyncTime = resp.server_time || Date.now();
			this.setStatus("online");
			new Notice(`✅ Full sync complete — ${changes.length} files`);
		} catch (e: any) {
			console.error("[Cloud-Obsidian] Full sync failed:", e.message);
			this.setStatus("error");
			new Notice(`Full sync failed: ${e.message}`);
		} finally {
			this.syncInProgress = false;
		}
	}

	/**
	 * Apply a remote change to the local vault.
	 * CRITICAL: tells FileWatcher to ignore this path to avoid sync loop.
	 */
	private async applyRemoteChange(change: { path: string; action: string; content?: string }): Promise<void> {
		const { path, action, content } = change;

		// Tell FileWatcher to skip this path — we wrote it, don't push it back!
		if (this.fileWatcher) {
			this.fileWatcher.ignorePath(path);
		}

		try {
			switch (action) {
				case "create":
				case "update": {
					const dir = path.substring(0, path.lastIndexOf("/"));
					if (dir) {
						const folder = this.vault.getAbstractFileByPath(dir);
						if (!folder) {
							await this.vault.createFolder(dir);
						}
					}

					const existing = this.vault.getAbstractFileByPath(path);
					if (existing instanceof TFile) {
						await this.vault.modify(existing, content || "");
					} else {
						await this.vault.create(path, content || "");
					}
					break;
				}
				case "delete": {
					const file = this.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						await this.vault.delete(file);
					}
					break;
				}
			}
		} catch (e: any) {
			console.error(`[Cloud-Obsidian] Failed to apply "${action} ${path}":`, e.message);
		}
	}

	/**
	 * Stop all sync activity.
	 */
	stop(): void {
		if (this.pullInterval) {
			clearInterval(this.pullInterval);
			this.pullInterval = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	private setStatus(status: SyncStatus): void {
		if (this.onStatusChange) {
			this.onStatusChange(status);
		}
	}
}

export type SyncStatus = "offline" | "online" | "pushing" | "pulling" | "syncing" | "error";
