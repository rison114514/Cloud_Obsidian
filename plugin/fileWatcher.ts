import { Vault, TFile, TAbstractFile } from "obsidian";

export type FileChangeAction = "create" | "update" | "delete";

export interface FileChange {
	path: string;
	action: FileChangeAction;
	content?: string;
	clientMtime: number;
}

// Typed wrappers that match Obsidian's vault event signatures.
type VaultEventCallback = (...data: unknown[]) => unknown;

/**
 * FileWatcher monitors the Obsidian vault for local file changes
 * and emits them via a callback. Includes debouncing to avoid
 * redundant sync events.
 */
export class FileWatcher {
	private vault: Vault;
	private onChange: (changes: FileChange[]) => void;
	private pending: Map<string, FileChange> = new Map();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private debounceMs: number;
	private ignorePaths: Set<string> = new Set([".obsidian/", ".git/", ".trash/", ".DS_Store", ".index/", ".tmp/", "node_modules/", ".gitignore"]);
	private ignoreNext: Set<string> = new Set();

	// Store callbacks for vault.off cleanup.
	private onCreate: VaultEventCallback;
	private onModify: VaultEventCallback;
	private onDelete: VaultEventCallback;
	private onRename: VaultEventCallback;

	constructor(vault: Vault, onChange: (changes: FileChange[]) => void, debounceMs: number = 500) {
		this.vault = vault;
		this.onChange = onChange;
		this.debounceMs = debounceMs;

		// Create typed wrappers that the Obsidian vault API accepts.
		this.onCreate = (file: unknown) => {
			if (file instanceof TAbstractFile) this.handleCreate(file);
		};
		this.onModify = (file: unknown) => {
			if (file instanceof TAbstractFile) this.handleModify(file);
		};
		this.onDelete = (file: unknown) => {
			if (file instanceof TAbstractFile) this.handleDelete(file);
		};
		this.onRename = (file: unknown, oldPath: unknown) => {
			if (file instanceof TAbstractFile && typeof oldPath === "string") {
				this.handleRename(file, oldPath);
			}
		};
	}

	/**
	 * Start watching vault file changes.
	 */
	start(): void {
		this.vault.on("create", this.onCreate);
		this.vault.on("modify", this.onModify);
		this.vault.on("delete", this.onDelete);
		this.vault.on("rename", this.onRename);
	}

	/**
	 * Temporarily ignore a path (e.g. when applying remote changes locally).
	 */
	ignorePath(path: string): void {
		this.ignoreNext.add(path);
	}

	private shouldIgnore(file: TAbstractFile): boolean {
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

	private async handleCreate(file: TAbstractFile): Promise<void> {
		if (this.shouldIgnore(file)) return;
		if (!(file instanceof TFile)) return;

		const content = await this.vault.read(file);
		this.enqueue({ path: file.path, action: "create", content, clientMtime: file.stat.mtime });
	}

	private async handleModify(file: TAbstractFile): Promise<void> {
		if (this.shouldIgnore(file)) return;
		if (!(file instanceof TFile)) return;

		const content = await this.vault.read(file);
		this.enqueue({ path: file.path, action: "update", content, clientMtime: file.stat.mtime });
	}

	private handleDelete(file: TAbstractFile): void {
		if (this.shouldIgnore(file)) return;
		this.enqueue({ path: file.path, action: "delete", clientMtime: Date.now() });
	}

	private handleRename(file: TAbstractFile, oldPath: string): void {
		if (this.shouldIgnore(file)) return;
		this.enqueue({ path: oldPath, action: "delete", clientMtime: Date.now() });
		if (file instanceof TFile) {
			this.enqueue({ path: file.path, action: "create", clientMtime: file.stat.mtime });
		}
	}

	private enqueue(change: FileChange): void {
		this.pending.set(change.path, change);
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => this.flush(), this.debounceMs);
	}

	private flush(): void {
		if (this.pending.size === 0) return;
		const changes = Array.from(this.pending.values());
		this.pending.clear();
		this.onChange(changes);
	}

	/**
	 * Stop watching (cleanup).
	 */
	stop(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.vault.off("create", this.onCreate);
		this.vault.off("modify", this.onModify);
		this.vault.off("delete", this.onDelete);
		this.vault.off("rename", this.onRename);
	}
}
