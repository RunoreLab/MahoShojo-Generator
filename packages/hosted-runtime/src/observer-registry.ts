type ObserverRegistration<T> = {
  token: symbol;
  observer: T;
};

export class ObserverRegistry<T> {
  private readonly registrations: ObserverRegistration<T>[] = [];

  get size(): number {
    return this.registrations.length;
  }

  current(): T | undefined {
    return this.registrations.at(-1)?.observer;
  }

  register(observer: T): () => void {
    const token = Symbol('observer-registration');
    this.registrations.push({ token, observer });
    return this.createUnregister(token);
  }

  clear(): void {
    this.registrations.splice(0, this.registrations.length);
  }

  private createUnregister(token: symbol): () => void {
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = this.registrations.findIndex((registration) => (
        registration.token === token
      ));
      if (index !== -1) this.registrations.splice(index, 1);
    };
  }
}
