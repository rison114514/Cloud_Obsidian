import { App, Modal, Setting } from "obsidian";

/**
 * LoginModal provides a modal dialog for server authentication.
 */
export class LoginModal extends Modal {
	private serverUrl: string;
	private onSubmit: (username: string, password: string, serverUrl: string, isRegister: boolean) => void;

	constructor(
		app: App,
		defaultServerUrl: string,
		onSubmit: (username: string, password: string, serverUrl: string, isRegister: boolean) => void
	) {
		super(app);
		this.serverUrl = defaultServerUrl;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;

		contentEl.empty();
		contentEl.addClass("cloud-obsidian-login-modal");

		contentEl.createEl("h2", { text: "Cloud Obsidian Sync" });
		contentEl.createEl("p", {
			text: "Connect to your self-hosted sync server.",
			cls: "cloud-obsidian-subtitle",
		});

		// Server URL
		let serverUrlInput: HTMLInputElement;
		new Setting(contentEl)
			.setName("Server URL")
			.setDesc("Your Cloud-Obsidian server address")
			.addText((text) => {
				text.setPlaceholder("http://your-server:9090")
					.setValue(this.serverUrl)
					.onChange((value) => {
						this.serverUrl = value;
					});
				serverUrlInput = text.inputEl;
			});

		// Username
		let usernameInput: HTMLInputElement;
		new Setting(contentEl)
			.setName("Username")
			.setDesc("Your sync account username")
			.addText((text) => {
				text.setPlaceholder("username");
				usernameInput = text.inputEl;
			});

		// Password
		let passwordInput!: HTMLInputElement;
		new Setting(contentEl)
			.setName("Password")
			.setDesc("Your sync account password")
			.addText((text) => {
				text.setPlaceholder("password");
				text.inputEl.type = "password";
				passwordInput = text.inputEl;
			});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "cloud-obsidian-button-row" });

		const loginBtn = buttonContainer.createEl("button", {
			text: "Login",
			cls: "mod-cta",
		});
		loginBtn.addEventListener("click", () => {
			this.onSubmit(usernameInput.value, passwordInput.value, this.serverUrl, false);
			this.close();
		});

		const registerBtn = buttonContainer.createEl("button", {
			text: "Register",
		});
		registerBtn.addEventListener("click", () => {
			this.onSubmit(usernameInput.value, passwordInput.value, this.serverUrl, true);
			this.close();
		});

		// Enter key submits login.
		passwordInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.onSubmit(usernameInput.value, passwordInput.value, this.serverUrl, false);
				this.close();
			}
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
