/**
 * Local exhibit blobs. IndexedDB, this device only.
 *
 * Why not Drive / localStorage:
 * - localStorage was silently slicing files to 2k chars.
 * - Drive on a 2G link cannot carry PDFs; session JSON stays small metadata.
 *
 * Debug: DevTools → Application → IndexedDB → council-evidence-v1 → blobs.
 * Key = evidence id (`ev_<sha prefix>`). Value = extracted UTF-8 text.
 */

const DB_NAME = 'council-evidence-v1';
const STORE = 'blobs';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser. Evidence blobs cannot be stored.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open evidence IndexedDB.'));
  });
}

export async function putEvidenceBlob(id: string, body: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).put(body, id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error(`Failed to write evidence blob ${id}.`));
      tx.onabort = () => reject(tx.error || new Error('Evidence blob write aborted (quota?).'));
    });
  } finally {
    db.close();
  }
}

export async function getEvidenceBlob(id: string): Promise<string | null> {
  const db = await openDb();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        const v = req.result;
        resolve(typeof v === 'string' ? v : null);
      };
      req.onerror = () => reject(req.error || new Error(`Failed to read evidence blob ${id}.`));
    });
  } finally {
    db.close();
  }
}

export async function hasEvidenceBlob(id: string): Promise<boolean> {
  const body = await getEvidenceBlob(id).catch(() => null);
  return body !== null;
}
