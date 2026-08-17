import fs from 'fs';
let code = fs.readFileSync('src/lib/persistence.ts', 'utf8');

const target = `export async function syncCouncilSession(session: PersistedSession): Promise<string> {`;
const replacement = `const pendingSyncs = new Map<string, { session: PersistedSession, timeout: any, resolve: (val: string) => void, reject: (err: any) => void }>();

export async function syncCouncilSession(session: PersistedSession): Promise<string> {
  return new Promise((resolve, reject) => {
    if (pendingSyncs.has(session.id)) {
      clearTimeout(pendingSyncs.get(session.id)!.timeout);
    }
    
    const timeout = setTimeout(async () => {
      pendingSyncs.delete(session.id);
      try {
        const result = await _syncCouncilSessionImmediate(session);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }, 2500); // 2.5 second debounce to prevent Firestore quota exhaustion

    pendingSyncs.set(session.id, { session, timeout, resolve, reject });
  });
}

async function _syncCouncilSessionImmediate(session: PersistedSession): Promise<string> {`;

if (code.includes(target) && !code.includes('_syncCouncilSessionImmediate')) {
    code = code.replace(target, replacement);
    fs.writeFileSync('src/lib/persistence.ts', code);
    console.log("persistence.ts updated successfully with debouncing.");
} else {
    console.log("Target not found or already patched.");
}
