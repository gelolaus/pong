export type FakeSocketAttachment = unknown;

export class FakeSocket {
  readonly sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  attachment: FakeSocketAttachment = null;
  readyState = 1;

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.readyState = 3;
  }

  serializeAttachment(value: unknown) {
    this.attachment = value;
  }

  deserializeAttachment() {
    return this.attachment;
  }

  messages() {
    return this.sent.map((item) => JSON.parse(item));
  }
}

export class FakeDurableObjectState {
  readonly storageMap = new Map<string, unknown>();
  readonly sockets: FakeSocket[] = [];
  readonly waitUntilPromises: Promise<unknown>[] = [];
  alarmTime: number | null = null;
  readonly id = { toString: () => "room-do" };

  readonly storage = {
    get: async <T>(key: string): Promise<T | undefined> => this.storageMap.get(key) as T | undefined,
    put: async (key: string, value: unknown) => {
      this.storageMap.set(key, structuredClone(value));
    },
    delete: async (key: string) => this.storageMap.delete(key),
    setAlarm: async (scheduledTime: number | Date) => {
      this.alarmTime = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
    },
    getAlarm: async () => this.alarmTime,
  };

  acceptWebSocket(ws: FakeSocket) {
    this.sockets.push(ws);
  }

  getWebSockets() {
    return this.sockets.filter((socket) => socket.readyState === 1);
  }

  waitUntil(promise: Promise<unknown>) {
    this.waitUntilPromises.push(promise);
  }

  async flush() {
    await Promise.all(this.waitUntilPromises.splice(0));
  }

  blockConcurrencyWhile<T>(callback: () => Promise<T>) {
    return callback();
  }
}
