import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type CloudObsidianPlugin from "./main";

export class SettingsTab extends PluginSettingTab {
	plugin: CloudObsidianPlugin;

	constructor(app: App, plugin: CloudObsidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Cloud Obsidian Sync" });

		const isLoggedIn = this.plugin.auth.isLoggedIn;

		if (isLoggedIn) {
			containerEl.createEl("p", { text: `✅ Connected as ${this.plugin.auth.getUsername()}` });
			containerEl.createEl("p", { text: `📦 Vault: ${this.plugin.settings.vaultName}`, cls: "setting-item-description" });

			new Setting(containerEl).setName("Server").addText(t => t.setValue(this.plugin.settings.serverUrl).setDisabled(true));
			new Setting(containerEl).setName("Vault Name")
				.setDesc("Change to isolate this vault from others. Be careful — changing this disconnects from existing data.")
				.addText(t => {
					t.setValue(this.plugin.settings.vaultName)
						.onChange(async (v) => {
							this.plugin.settings.vaultName = v || "default";
							await this.plugin.saveSettings();
						});
				});

			new Setting(containerEl).setName("Logout").addButton(btn => {
				btn.setButtonText("Logout").setWarning().onClick(() => { this.plugin.logout(); this.display(); });
			});

			containerEl.createEl("h3", { text: "Sync Controls" });
			new Setting(containerEl).setName("Full Sync").addButton(btn => {
				btn.setButtonText("Full Sync").setCta().onClick(() => this.plugin.syncEngine?.fullSync());
			});
			new Setting(containerEl).setName("Push Now").addButton(btn => {
				btn.setButtonText("Push Now").onClick(() => this.plugin.manualPush());
			});
			new Setting(containerEl).setName("Pull All from Remote").addButton(btn => {
				btn.setButtonText("Pull All").onClick(() => this.plugin.manualPull());
			});
		} else {
			new Setting(containerEl).setName("Server URL").addText(t => {
				t.setPlaceholder("http://your-server:9090")
					.setValue(this.plugin.settings.serverUrl)
					.onChange(async (v) => { this.plugin.settings.serverUrl = v; await this.plugin.saveSettings(); });
			});
			new Setting(containerEl).setName("Open Login").addButton(btn => {
				btn.setButtonText("Open Login").setCta().onClick(() => this.plugin.openLoginModal());
			});
		}
	}
}
