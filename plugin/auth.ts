import { requestUrl } from "obsidian";

/**
 * AuthManager handles server authentication and token lifecycle.
 */
export class AuthManager {
	private serverUrl: string;
	private token: string | null = null;
	private userId: number | null = null;
	private username: string | null = null;

	constructor(serverUrl: string) {
		this.serverUrl = serverUrl.replace(/\/+$/, ""); // strip trailing slash
	}

	get isLoggedIn(): boolean {
		return this.token !== null;
	}

	getServerUrl(): string {
		return this.serverUrl;
	}

	getToken(): string | null {
		return this.token;
	}

	getUsername(): string | null {
		return this.username;
	}

	getUserId(): number | null {
		return this.userId;
	}

	/**
	 * Register a new account on the server.
	 */
	async register(username: string, password: string): Promise<{ success: boolean; error?: string }> {
		try {
			const resp = await requestUrl({
				url: `${this.serverUrl}/api/auth/register`,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username, password }),
			});

			if (resp.status === 201) {
				const data = resp.json;
				this.token = data.token;
				this.userId = data.user_id;
				this.username = data.username;
				return { success: true };
			}

			return { success: false, error: resp.json?.error || `HTTP ${resp.status}` };
		} catch (e: any) {
			return { success: false, error: e.message || "Network error" };
		}
	}

	/**
	 * Login to an existing account.
	 */
	async login(username: string, password: string): Promise<{ success: boolean; error?: string }> {
		try {
			const resp = await requestUrl({
				url: `${this.serverUrl}/api/auth/login`,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username, password }),
			});

			if (resp.status === 200) {
				const data = resp.json;
				this.token = data.token;
				this.userId = data.user_id;
				this.username = data.username;
				return { success: true };
			}

			return { success: false, error: resp.json?.error || `HTTP ${resp.status}` };
		} catch (e: any) {
			return { success: false, error: e.message || "Network error" };
		}
	}

	/**
	 * Clear current session.
	 */
	logout(): void {
		this.token = null;
		this.userId = null;
		this.username = null;
	}

	/**
	 * Make an authenticated request to the server.
	 */
	async request(method: string, path: string, body?: any): Promise<any> {
		if (!this.token) {
			throw new Error("Not logged in");
		}

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.token}`,
		};

		const resp = await requestUrl({
			url: `${this.serverUrl}${path}`,
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});

		if (resp.status >= 400) {
			const err = resp.json?.error || `HTTP ${resp.status}`;
			throw new Error(err);
		}

		return resp.json;
	}
}
