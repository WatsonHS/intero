import {
  DaemonRpcError,
  type DaemonClient,
  SocketDaemonClient,
} from "@intero/local-ipc";

export { DaemonRpcError, type DaemonClient, SocketDaemonClient };

const LOCAL_AUTHENTICATION_ERROR = -32001;

export class ReloadingDaemonClient implements DaemonClient {
  #clientPromise: Promise<DaemonClient> | undefined;

  constructor(private readonly loadClient: () => Promise<DaemonClient>) {}

  async call(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const initialPromise = this.#getClient();
    const initialClient = await initialPromise;
    try {
      return await initialClient.call(method, params);
    } catch (error) {
      if (
        !(error instanceof DaemonRpcError) ||
        error.code !== LOCAL_AUTHENTICATION_ERROR
      ) {
        throw error;
      }

      const refreshedPromise =
        this.#clientPromise === initialPromise
          ? (this.#clientPromise = this.#createClient())
          : this.#getClient();
      const refreshedClient = await refreshedPromise;
      return refreshedClient.call(method, params);
    }
  }

  #getClient(): Promise<DaemonClient> {
    this.#clientPromise ??= this.#createClient();
    return this.#clientPromise;
  }

  #createClient(): Promise<DaemonClient> {
    const promise = this.loadClient().catch((error: unknown) => {
      if (this.#clientPromise === promise) {
        this.#clientPromise = undefined;
      }
      throw error;
    });
    return promise;
  }
}
