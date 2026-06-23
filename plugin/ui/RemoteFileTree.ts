import { ItemView, WorkspaceLeaf } from "obsidian";
import { AuthManager } from "../auth";

export const REMOTE_TREE_VIEW_TYPE = "cloud-obsidian-remote-tree";

interface FileEntry {
	path: string;
	size: number;
	mod_time: string;
}

/**
 * RemoteFileTree — a sidebar panel showing the server-side vault file structure.
 */
export class RemoteFileTree extends ItemView {
	private auth: AuthManager;
	private vaultName: string;
	private onSyncRequest: () => void;
	private contentEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, auth: AuthManager, vaultName: string, onSyncRequest: () => void) {
		super(leaf);
		this.auth = auth;
		this.vaultName = vaultName;
		this.onSyncRequest = onSyncRequest;
	}

	getViewType(): string { return REMOTE_TREE_VIEW_TYPE; }
	getDisplayText(): string { return `Remote: ${this.vaultName}`; }
	getIcon(): string { return "cloud-obsidian-sync"; }

	async onOpen(): Promise<void> {
		this.contentEl = this.containerEl.children[1];
		this.contentEl.empty();
		this.contentEl.addClass("cloud-obsidian-tree-panel");
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	refresh(): void { this.render(); }

	private async render(): Promise<void> {
		const root = this.contentEl;
		root.empty();

		// ---- Header ----
		const header = root.createDiv({ cls: "cloud-obsidian-tree-header" });
		header.createSpan({ text: `📁 ${this.vaultName}`, cls: "cloud-obsidian-tree-title" });

		const btnRow = header.createDiv({ cls: "cloud-obsidian-tree-actions" });
		const syncBtn = btnRow.createEl("button", { text: "🔄 Sync", cls: "mod-cta" });
		syncBtn.addEventListener("click", () => this.onSyncRequest());
		const refreshBtn = btnRow.createEl("button", { text: "↻ Refresh" });
		refreshBtn.addEventListener("click", () => this.render());

		// ---- Loading ----
		const body = root.createDiv({ cls: "cloud-obsidian-tree-body" });
		body.createEl("p", { text: "Loading...", cls: "cloud-obsidian-loading" });

		try {
			const resp = await this.auth.request("GET", `/api/files?vault=${encodeURIComponent(this.vaultName)}`);
			const files: FileEntry[] = resp.files || [];
			body.empty();

			if (files.length === 0) {
				body.createEl("p", { text: "📭 Remote vault is empty", cls: "cloud-obsidian-empty" });
				return;
			}

			const tree = this.buildTree(files);
			const treeEl = body.createDiv({ cls: "cloud-obsidian-tree" });
			this.renderTree(treeEl, tree, "");

			const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
			body.createEl("div", {
				text: `${files.length} files · ${this.formatSize(totalSize)}`,
				cls: "cloud-obsidian-tree-summary",
			});
		} catch (e: any) {
			body.empty();
			body.createEl("p", { text: `❌ ${e.message}`, cls: "cloud-obsidian-error" });
		}
	}

	// ---- Tree logic ----

	private buildTree(files: FileEntry[]): TreeNode {
		const root: TreeNode = { name: "/", children: {}, files: [] };
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
			if (fileName) node.files.push({ name: fileName, size: f.size });
		}
		return root;
	}

	private renderTree(container: HTMLElement, node: TreeNode, indent: string): void {
		const dirs = Object.keys(node.children).sort();
		for (const dir of dirs) {
			const row = container.createDiv({ cls: "cots-tree-row" });
			row.createSpan({ text: `${indent}📁 ${dir}/`, cls: "cots-tree-dir" });
			this.renderTree(container, node.children[dir], indent + "    ");
		}
		for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
			const row = container.createDiv({ cls: "cots-tree-row" });
			row.createSpan({ text: `${indent}${this.fileIcon(f.name)} ${f.name}`, cls: "cots-tree-file" });
			if (f.size > 0) row.createSpan({ text: this.formatSize(f.size), cls: "cots-tree-size" });
		}
	}

	private fileIcon(name: string): string {
		if (name.endsWith(".md")) return "📝";
		if (name.match(/\.(png|jpg|gif|svg|webp)$/i)) return "🖼️";
		if (name.endsWith(".pdf")) return "📄";
		if (name.endsWith(".canvas")) return "🎨";
		return "📎";
	}

	private formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
}

interface TreeNode {
	name: string;
	children: Record<string, TreeNode>;
	files: { name: string; size: number }[];
}
