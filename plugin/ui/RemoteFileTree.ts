import { ItemView, WorkspaceLeaf } from "obsidian";
import { AuthManager } from "../auth";

export const REMOTE_TREE_VIEW_TYPE = "cloud-obsidian-remote-tree";

interface FileEntry { path: string; size: number; mod_time: string; }

export class RemoteFileTree extends ItemView {
	private auth: AuthManager;
	private vaultName: string;
	private onSyncRequest: () => void;

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
		await this.render();
	}

	refresh(): void { this.render(); }

	private async render(): Promise<void> {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass("cloud-obsidian-tree-panel");

		// Header
		const header = root.createDiv({ cls: "cots-header" });
		header.createSpan({ text: `📁 ${this.vaultName}`, cls: "cots-title" });
		const btns = header.createDiv({ cls: "cots-actions" });
		btns.createEl("button", { text: "🔼 Push All", cls: "mod-cta" }).addEventListener("click", () => this.onSyncRequest());
		btns.createEl("button", { text: "↻ Refresh" }).addEventListener("click", () => this.render());

		// Body
		const body = root.createDiv({ cls: "cots-body" });
		body.createEl("p", { text: "Loading..." });

		try {
			const resp = await this.auth.request("GET", `/api/files?vault=${encodeURIComponent(this.vaultName)}`);
			const files: FileEntry[] = resp.files || [];
			body.empty();

			if (files.length === 0) {
				body.createEl("p", { text: "📭 Remote vault is empty", cls: "cots-empty" });
				return;
			}

			const tree = buildTree(files);
			body.createDiv({ cls: "cots-tree" });
			renderTree(body, tree, 0);

			const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
			body.createDiv({ text: `${files.length} files · ${fmtSize(totalSize)}`, cls: "cots-summary" });
		} catch (e: any) {
			body.empty();
			body.createEl("p", { text: `❌ ${e.message}`, cls: "cots-error" });
		}
	}
}

// ---- Tree helpers (standalone functions, no `this` issues) ----

interface TreeNode { name: string; children: Record<string, TreeNode>; files: { name: string; size: number }[]; }

function buildTree(files: FileEntry[]): TreeNode {
	const root: TreeNode = { name: "/", children: {}, files: [] };
	for (const f of files) {
		const parts = f.path.split("/");
		let node = root;
		for (let i = 0; i < parts.length - 1; i++) {
			if (!node.children[parts[i]]) node.children[parts[i]] = { name: parts[i], children: {}, files: [] };
			node = node.children[parts[i]];
		}
		const fn = parts[parts.length - 1];
		if (fn) node.files.push({ name: fn, size: f.size });
	}
	return root;
}

function renderTree(container: HTMLElement, node: TreeNode, depth: number): void {
	const dirs = Object.keys(node.children).sort();
	for (const dir of dirs) {
		const row = container.createDiv({ cls: "cots-row" });
		row.style.paddingLeft = `${depth * 16}px`;
		row.createSpan({ text: `📁 ${dir}/`, cls: "cots-dir" });
		renderTree(container, node.children[dir], depth + 1);
	}
	const fileList = node.files.sort((a, b) => a.name.localeCompare(b.name));
	for (const f of fileList) {
		const row = container.createDiv({ cls: "cots-row" });
		row.style.paddingLeft = `${depth * 16}px`;
		row.createSpan({ text: `${fileIcon(f.name)} ${f.name}`, cls: "cots-file" });
		if (f.size > 0) row.createSpan({ text: fmtSize(f.size), cls: "cots-size" });
	}
}

function fileIcon(name: string): string {
	if (name.endsWith(".md")) return "📝";
	if (name.match(/\.(png|jpg|gif|svg|webp)$/i)) return "🖼️";
	if (name.endsWith(".pdf")) return "📄";
	if (name.endsWith(".canvas")) return "🎨";
	return "📎";
}

function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
