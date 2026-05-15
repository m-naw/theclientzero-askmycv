/**
 * KV access helpers for tests. Thin wrappers around the bound STATE
 * namespace so smoke and feature tests can read/write typed values
 * without re-deriving JSON shapes inline.
 */

export async function putJson<T>(kv: KVNamespace, key: string, value: T, expirationTtl?: number): Promise<void> {
  await kv.put(key, JSON.stringify(value), expirationTtl ? { expirationTtl } : undefined);
}

export async function getJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  return kv.get<T>(key, { type: "json" });
}

export async function clearKeys(kv: KVNamespace, keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => kv.delete(k)));
}
