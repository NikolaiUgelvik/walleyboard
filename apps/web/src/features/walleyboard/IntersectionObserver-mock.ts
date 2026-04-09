type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;

export class IntersectionObserverMock {
  static instances: IntersectionObserverMock[] = [];
  callback: IntersectionCallback;
  elements: Set<Element> = new Set();
  options: IntersectionObserverInit | undefined;

  constructor(
    callback: IntersectionCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    IntersectionObserverMock.instances.push(this);
  }

  observe(target: Element): void {
    this.elements.add(target);
  }

  unobserve(target: Element): void {
    this.elements.delete(target);
  }

  disconnect(): void {
    this.elements.clear();
  }

  simulateEntries(entries: Partial<IntersectionObserverEntry>[]): void {
    this.callback(entries as IntersectionObserverEntry[]);
  }

  static reset(): void {
    IntersectionObserverMock.instances = [];
  }
}

Object.defineProperty(globalThis, "IntersectionObserver", {
  configurable: true,
  value: IntersectionObserverMock,
  writable: true,
});
