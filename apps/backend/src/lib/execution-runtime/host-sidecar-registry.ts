/**
 * Tracks host-side MCP sidecar processes and kills them on cleanup.
 */
export class HostSidecarRegistry {
  readonly #sidecars = new Map<string, { kill: () => void }>();

  register(sessionId: string, sidecar: { kill: () => void }): void {
    this.#sidecars.set(sessionId, sidecar);
  }

  cleanup(sessionId: string): void {
    const sidecar = this.#sidecars.get(sessionId);
    if (sidecar) {
      sidecar.kill();
      this.#sidecars.delete(sessionId);
    }
  }

  dispose(): void {
    for (const sidecar of this.#sidecars.values()) {
      sidecar.kill();
    }
    this.#sidecars.clear();
  }
}
