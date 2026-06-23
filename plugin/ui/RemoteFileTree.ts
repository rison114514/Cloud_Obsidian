import { Modal, App } from "obsidian";
import { AuthManager } from "../auth";

interface FileEntry {
	path: string;
	size: number;
	mod_time: string;
}

/**
 * RemoteFileTree shows the server-side vault file structure in a modal.
 */
export class RemoteFileTree extends Modal {
	private auth: AuthManager;
	private vaultName: string;

	constructor(app: App, auth: AuthManager, vaultName: string) {
		super(app);
		this.auth = auth;
		this.vaultName = vaultName;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("cloud-obsidian-tree-modal");
		contentEl.createEl("h2", { text: `📁 Remote Vault: ${this.vaultName}` });

		// Loading
		const loadingEl = contentEl.createEl("p", { text: "Loading..." });

		try {
			const resp = await this.auth.request("GET", `/api/files?vault=${encodeURIComponent(this.vaultName)}`);
			const files: FileEntry[] = resp.files || [];

			loadingEl.remove();

			if (files.length === 0) {
				contentEl.createEl("p", { text: "📭 远程仓库为空", cls: "cloud-obsidian-empty" });
				return;
			}

			// Build tree
			const tree = this.buildTree(files);
			const treeEl = contentEl.createDiv({ cls: "cloud-obsidian-tree" });
			this.renderTree(treeEl, tree, "");

			// Summary
			const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
			contentEl.createEl("p", {
				text: `${files.length} files · ${this.formatSize(totalSize)}`,
				cls: "cloud-obsidian-tree-summary",
			});
		} catch (e: any) {
			loadingEl.textContent = `❌ 加载失败: ${e.message}`;
		}
	}

	onClose(): void {
		this.contentEl.empty();
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
			if (fileName) {
				node.files.push({ name: fileName, size: f.size });
			}
		}
		return root;
	}

	private renderTree(container: HTMLElement, node: TreeNode, indent: string): void {
		// Render subdirectories
		const dirs = Object.keys(node.children).sort();
		for (const dir of dirs) {
			const dirRow = container.createDiv({ cls: "cloud-obsidian-tree-row" });
			dirRow.createSpan({ text: `${indent}📁 ${dir}/`, cls: "cloud-obsidian-tree-dir" });
			this.renderTree(container, node.children[dir], indent + "    ");
		}
		// Render files
		const sorted = node.files.sort((a, b) => a.name.localeCompare(b.name));
		for (const f of sorted) {
			const fileRow = container.createDiv({ cls: "cloud-obsidian-tree-row" });
			const icon = this.fileIcon(f.name);
			fileRow.createSpan({ text: `${indent}${icon} ${f.name}`, cls: "cloud-obsidian-tree-file" });
			if (f.size > 0) {
				fileRow.createSpan({ text: this.formatSize(f.size), cls: "cloud-obsidian-tree-size" });
			}
		}
	}

	private fileIcon(name: string): string {
		if (name.endsWith(".md")) return "📝";
		if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".gif")) return "🖼️";
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
