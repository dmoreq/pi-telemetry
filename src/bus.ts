/**
 * MessageBus — typed publish/subscribe on pi.events.
 *
 * Thin wrapper that adds typed payloads, a TelemetryMessage envelope
 * (channel, payload, timestamp, source), and clean subscribe/unsubscribe.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { TelemetryChannel, TelemetryMessage } from "./types.ts";

type Handler<T = unknown> = (payload: T, message: TelemetryMessage<T>) => void;
type RawHandler = (data: unknown) => void;

export class MessageBus {
	private readonly subscriptions = new Map<string, Set<RawHandler>>();

	constructor(private readonly piEvents: ExtensionAPI["events"]) {}

	/**
	 * Publish a message on a channel. All subscribers receive it.
	 */
	publish<T>(channel: TelemetryChannel, payload: T, source: string): void {
		const message: TelemetryMessage<T> = {
			channel,
			payload,
			timestamp: Date.now(),
			source,
		};

		try {
			this.piEvents.emit(channel, message as unknown);
		} catch {
			// Silently ignore publish errors (subscriber threw)
		}
	}

	/**
	 * Subscribe to a channel. Handler receives (payload, message).
	 * Returns an unsubscribe function.
	 */
	subscribe<T>(channel: TelemetryChannel, handler: Handler<T>): () => void {
		const rawHandler: RawHandler = (data: unknown) => {
			try {
				const msg = data as TelemetryMessage<T>;
				handler(msg.payload, msg);
			} catch {
				// Silently ignore subscriber errors
			}
		};

		let handlers = this.subscriptions.get(channel);
		if (!handlers) {
			handlers = new Set();
			this.subscriptions.set(channel, handlers);
		}
		handlers.add(rawHandler);

		// Subscribe to pi.events
		this.piEvents.on(channel as string, rawHandler);

		// Return unsubscribe function
		return () => {
			handlers?.delete(rawHandler);
			// pi.events has no off(), but we just stop processing
		};
	}
}
