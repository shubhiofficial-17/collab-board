import { HubConnectionLike } from './realtime.service';

/** In-memory stand-in for a SignalR connection, for tests. */
export class FakeHubConnection {
  connectionId: string | null = 'conn-me';
  readonly sent: unknown[][] = [];
  readonly invoked: unknown[][] = [];
  startError: Error | null = null;
  joinResult: unknown = { version: 0, participants: [] };

  private readonly handlers = new Map<string, (...args: any[]) => void>();
  private reconnected: (() => void | Promise<void>) | null = null;

  start(): Promise<void> {
    return this.startError ? Promise.reject(this.startError) : Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  invoke<T>(...args: unknown[]): Promise<T> {
    this.invoked.push(args);
    return Promise.resolve(this.joinResult as T);
  }

  send(...args: unknown[]): Promise<void> {
    this.sent.push(args);
    return Promise.resolve();
  }

  on(name: string, handler: (...args: any[]) => void): void {
    this.handlers.set(name, handler);
  }

  onreconnecting(): void {}

  onreconnected(callback: () => void | Promise<void>): void {
    this.reconnected = callback;
  }

  onclose(): void {}

  /** Simulates a message from the server. */
  emit(name: string, ...args: unknown[]): void {
    this.handlers.get(name)?.(...args);
  }

  async simulateReconnect(newConnectionId: string): Promise<void> {
    this.connectionId = newConnectionId;
    await this.reconnected?.();
  }

  asConnection(): HubConnectionLike {
    return this as unknown as HubConnectionLike;
  }
}
