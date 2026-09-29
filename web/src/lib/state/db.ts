// IndexedDB storage: projects, uploaded files, and preview note stores.

import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { AssetMeta, Project } from '../../model/types.ts';

export interface StoredAsset {
  meta: AssetMeta;
  blob?: Blob;
  frames?: { blob: Blob; delayMs: number }[];
}

interface Schema extends DBSchema {
  projects: { key: string; value: Project };
  assets: { key: string; value: StoredAsset };
  stores: { key: string; value: Uint8Array };
  kv: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>('numnotes', 1, {
    upgrade(database) {
      database.createObjectStore('projects');
      database.createObjectStore('assets');
      database.createObjectStore('stores');
      database.createObjectStore('kv');
    },
  });
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await (await db()).get('kv', key)) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await (await db()).put('kv', value, key);
  } catch {
    /* storage unavailable (private mode): keep working in memory */
  }
}
