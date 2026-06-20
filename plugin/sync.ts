import { Vault, Notice, TFile, TFolder } from "obsidian";
import { AuthManager } from "./auth";
import { WSClient } from "./ws";

/**
 * SyncEngine orchestrates bidirectional sync between the local vault and the server.
 */
export class SyncEngine {
	private vault: Vault;
	private auth: AuthManager;
	private ws: WSClient | null = null;
	private lastSyncTime: number = 0; // unix milliseconds
	private syncInProgress: boolean = false;
	private pullInterval: ReturnType<typeof setInterval> | null = null;
	private onStatusChange?: (status: SyncStatus) => void;

	constructor(vault: Vault, auth: AuthManager, onStatusChange?: (status: SyncStatus) => void) {
		this.vault = vault;
		this.auth = auth;
		this.onStatusChange = onStatusChange;
	}

	/**
	 * Start background sync: WebSocket for real-time push + periodic pull.
	 */
	start(): void {
		// Connect WebSocket for real-time server push notifications.
		if (this.auth.isLoggedIn) {
			this.connectWS();
		}

		// Periodic pull every 30 seconds as fallback.
		this.pullInterval = setInterval(() => {
			if (this.auth.isLoggedIn && !this.syncInProgress) {
				this.pull();
			}
		}, 30_000);
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
				// On message: server pushed a change, pull latest.
				this.setStatus("pulling");
				this.pull();
			},
			() => {
				this.setStatus("online");
			},
			() => {
				this.setStatus("offline");
			}
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
				new Notice(`⚠️ ${conflictCount} conflict(s) detected — check .conflict files`);
			}

			const acceptedCount = resp.accepted?.length || 0;
			if (acceptedCount > 0) {
				this.lastSyncTime = Date.now();
				this.setStatus("online");
			}
		} catch (e: any) {
			console.error("[Cloud-Obsidian] Push failed:", e.message);
			this.setStatus("error", e.message);
			new Notice(`Sync push failed: ${e.message}`);
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
			this.setStatus("error", e.message);
		} finally {
			this.syncInProgress = false;
		}
	}

	/**
	 * Initial full sync: pull all remote files to an empty (or existing) vault.
	 */
	async fullSync(): Promise<void> {
		if (!this.auth.isLoggedIn) return;

		this.syncInProgress = true;
		this.setStatus("syncing");

		try {
			// Pull all changes since epoch (0).
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
			this.setStatus("error", e.message);
			new Notice(`Full sync failed: ${e.message}`);
		} finally {
			this.syncInProgress = false;
		}
	}

	/**
	 * Apply a remote change to the local vault.
	 */
	private async applyRemoteChange(change: { path: string; action: string; content?: string }): Promise<void> {
		const { path, action, content } = change;

		try {
			switch (action) {
				case "create":
				case "update": {
					// Ensure parent folder exists.
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
			console.error(`[Cloud-Obsidian] Failed to apply change "${action} ${path}":`, e.message);
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

	private setStatus(status: SyncStatus, error?: string): void {
		if (this.onStatusChange) {
			this.onStatusChange(status);
		}
	}
}

export type SyncStatus = "offline" | "online" | "pushing" | "pulling" | "syncing" | "error";
