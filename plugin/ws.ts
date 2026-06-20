/**
 * WSClient manages a WebSocket connection to the Cloud-Obsidian server
 * for receiving real-time push notifications of remote changes.
 */
export class WSClient {
	private serverUrl: string;
	private token: string;
	private onMessage: () => void;
	private onOpen: () => void;
	private onClose: () => void;
	private ws: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectDelay: number = 1000;
	private maxReconnectDelay: number = 60_000;
	private shouldReconnect: boolean = true;

	constructor(
		serverUrl: string,
		token: string,
		onMessage: () => void,
		onOpen: () => void,
		onClose: () => void
	) {
		this.serverUrl = serverUrl.replace(/\/+$/, "");
		this.token = token;
		this.onMessage = onMessage;
		this.onOpen = onOpen;
		this.onClose = onClose;
	}

	/**
	 * Open the WebSocket connection.
	 */
	connect(): void {
		this.shouldReconnect = true;

		// Convert http(s):// to ws(s)://
		const wsUrl = this.serverUrl
			.replace(/^https:\/\//, "wss://")
			.replace(/^http:\/\//, "ws://");

		try {
			this.ws = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(this.token)}`);

			this.ws.onopen = () => {
				console.log("[Cloud-Obsidian] WebSocket connected");
				this.reconnectDelay = 1000; // Reset backoff.
				this.onOpen();
			};

			this.ws.onmessage = (_event: MessageEvent) => {
				// Server sent a file_changed notification — trigger pull.
				this.onMessage();
			};

			this.ws.onclose = (event: CloseEvent) => {
				console.log(`[Cloud-Obsidian] WebSocket closed (code=${event.code})`);
				this.onClose();
				if (this.shouldReconnect) {
					this.scheduleReconnect();
				}
			};

			this.ws.onerror = (event: Event) => {
				console.error("[Cloud-Obsidian] WebSocket error:", event);
				// onclose will fire after this, triggering reconnect.
			};
		} catch (e) {
			console.error("[Cloud-Obsidian] WebSocket connection failed:", e);
			if (this.shouldReconnect) {
				this.scheduleReconnect();
			}
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}

		console.log(`[Cloud-Obsidian] Reconnecting in ${this.reconnectDelay / 1000}s...`);
		this.reconnectTimer = setTimeout(() => {
			this.connect();
		}, this.reconnectDelay);

		// Exponential backoff with max cap.
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
	}

	/**
	 * Close the WebSocket and stop reconnecting.
	 */
	close(): void {
		this.shouldReconnect = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}
}
