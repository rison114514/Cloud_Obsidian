import { App, PluginSettingTab, Setting } from "obsidian";
import type CloudObsidianPlugin from "./main";

/**
 * SettingsTab provides the plugin configuration UI in Obsidian's settings.
 */
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

		// Connection status
		const statusSection = containerEl.createDiv({ cls: "cloud-obsidian-status-section" });
		const isLoggedIn = this.plugin.auth.isLoggedIn;
		statusSection.createEl("p", {
			text: isLoggedIn
				? `✅ Connected as ${this.plugin.auth.getUsername()}`
				: "❌ Not connected",
		});

		if (isLoggedIn) {
			new Setting(containerEl)
				.setName("Server")
				.setDesc("Your sync server URL")
				.addText((text) => {
					text.setValue(this.plugin.settings.serverUrl)
						.setDisabled(true);
				});

			new Setting(containerEl)
				.setName("Username")
				.setDesc("Logged in account")
				.addText((text) => {
					text.setValue(this.plugin.auth.getUsername() || "")
						.setDisabled(true);
				});

			// Logout button
			new Setting(containerEl)
				.setName("Logout")
				.setDesc("Disconnect from the sync server")
				.addButton((btn) => {
					btn.setButtonText("Logout")
						.setWarning()
						.onClick(() => {
							this.plugin.logout();
							this.display(); // Refresh settings panel.
						});
				});

			// Sync controls
			containerEl.createEl("h3", { text: "Sync Controls" });

			new Setting(containerEl)
				.setName("Full Sync")
				.setDesc("Pull all remote files to this vault (use after first login or on a new device)")
				.addButton((btn) => {
					btn.setButtonText("Full Sync")
						.setCta()
						.onClick(() => {
							this.plugin.syncEngine?.fullSync();
						});
				});

			new Setting(containerEl)
				.setName("Push Now")
				.setDesc("Force push all local changes immediately")
				.addButton((btn) => {
					btn.setButtonText("Push Now")
						.onClick(() => {
							this.plugin.manualPush();
						});
				});
		} else {
			// Login prompt
			new Setting(containerEl)
				.setName("Server URL")
				.setDesc("Your Cloud-Obsidian server address")
				.addText((text) => {
					text.setPlaceholder("http://your-server:9090")
						.setValue(this.plugin.settings.serverUrl)
						.onChange(async (value) => {
							this.plugin.settings.serverUrl = value;
							await this.plugin.saveSettings();
						});
				});

			const loginContainer = containerEl.createDiv({ cls: "cloud-obsidian-login-area" });
			loginContainer.createEl("p", {
				text: "Click the ribbon icon or use the command palette to open the login dialog.",
				cls: "setting-item-description",
			});

			new Setting(containerEl)
				.setName("Open Login")
				.setDesc("Open the login / register dialog")
				.addButton((btn) => {
					btn.setButtonText("Open Login")
						.setCta()
						.onClick(() => {
							this.plugin.openLoginModal();
						});
				});
		}
	}
}
