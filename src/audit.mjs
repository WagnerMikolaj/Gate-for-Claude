import { DatabaseSync } from 'node:sqlite';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Audit {
  constructor(path, key) {
    this.key = key;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, tenant TEXT NOT NULL, payload TEXT NOT NULL, mac TEXT NOT NULL)');
    this.previous = '0'.repeat(64);
    try {
      for (const row of this.db.prepare('SELECT id, tenant, payload, mac FROM events ORDER BY id').iterate()) {
        const expected = this.mac(this.previous + '|' + row.id + '|' + row.tenant + '|' + row.payload);
        if (row.mac.length !== expected.length || !timingSafeEqual(Buffer.from(row.mac), Buffer.from(expected))) throw new Error('Audit integrity verification failed');
        this.previous = row.mac;
      }
    } catch (error) { this.db.close(); throw error; }
  }
  mac(value) { return createHmac('sha256', this.key).update(value).digest('hex'); }
  record({ tenant, subject, requestId, decision, categories = [] }) {
    // Explicit fields only: never serialize request bodies, identifiers, tokens or upstream errors.
    const payload = JSON.stringify({ at: new Date().toISOString(), actor: this.mac(`${tenant}|${subject || 'anonymous'}`), requestId, decision, categories });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const id = Number(this.db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM events').get().id);
      const mac = this.mac(this.previous + '|' + id + '|' + tenant + '|' + payload);
      this.db.prepare('INSERT INTO events (id, tenant, payload, mac) VALUES (?, ?, ?, ?)').run(id, tenant, payload, mac);
      this.db.exec('COMMIT');
      this.previous = mac;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  list(tenant) { return this.db.prepare('SELECT id, payload FROM events WHERE tenant = ? ORDER BY id DESC LIMIT 50').all(tenant).map(r => ({ id: r.id, ...JSON.parse(r.payload) })); }
  close() { this.db.close(); }
}
