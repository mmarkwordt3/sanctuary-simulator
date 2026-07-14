type Handler = ((event: any) => void) | null;

class Request<T = any> {
  result!: T;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
}

class MemoryCursor {
  private index = 0;
  constructor(private rows: any[], private store: MemoryObjectStore, public request: Request) {}
  get value() { return this.rows[this.index]; }
  delete() { this.store.deleteByKey(this.store.keyOf(this.value)); }
  continue() { this.index++; setTimeout(() => { this.request.result = this.index < this.rows.length ? this : null; this.request.onsuccess?.({ target: this.request }); }, 0); }
}

class MemoryObjectStore {
  rows = new Map<any, any>();
  constructor(public keyPath: string) {}
  keyOf(value: any) { return value[this.keyPath]; }
  clone<T>(value: T): T { return value == null ? value : structuredClone(value); }
  put(value: any) { this.rows.set(this.keyOf(value), this.clone(value)); return request(this.keyOf(value)); }
  get(key: any) { return request(this.clone(this.rows.get(key))); }
  getAll() { return request([...this.rows.values()].map((v) => this.clone(v))); }
  delete(key: any) { this.rows.delete(key); return request(undefined); }
  deleteByKey(key: any) { this.rows.delete(key); }
  createIndex() { return {}; }
  openCursor() { const r = new Request<MemoryCursor | null>(); const rows = [...this.rows.values()].map((v) => this.clone(v)); setTimeout(() => { r.result = rows.length ? new MemoryCursor(rows, this, r) : null; r.onsuccess?.({ target: r }); }, 0); return r as any; }
}

class MemoryTransaction {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  constructor(private db: MemoryDB, private stores: string | string[]) { setTimeout(() => this.oncomplete?.({ target: this }), 75); }
  objectStore(name: string) { return this.db.stores.get(name)! as any; }
}

class MemoryDB {
  stores = new Map<string, MemoryObjectStore>();
  constructor(public name: string, public version: number) {}
  createObjectStore(name: string, opts: { keyPath: string }) { const store = new MemoryObjectStore(opts.keyPath); this.stores.set(name, store); return store as any; }
  transaction(stores: string | string[]) { return new MemoryTransaction(this, stores) as any; }
  close() {}
}

export function installIndexedDbShim() {
  const dbs = new Map<string, MemoryDB>();
  (globalThis as any).indexedDB = {
    open(name: string, version: number) {
      const r = new Request<MemoryDB>();
      setTimeout(() => {
        let db = dbs.get(name);
        const upgrade = !db || version > db.version;
        if (!db) { db = new MemoryDB(name, version); dbs.set(name, db); }
        db.version = version;
        r.result = db;
        if (upgrade) r.onupgradeneeded?.({ target: r });
        setTimeout(() => r.onsuccess?.({ target: r }), 0);
      }, 0);
      return r;
    },
    deleteDatabase(name: string) { dbs.delete(name); return request(undefined); },
  };
}

function request<T>(value: T) { const r = new Request<T>(); setTimeout(() => { r.result = value; r.onsuccess?.({ target: r }); }, 0); return r as any; }
