import fs from 'fs';
let code = fs.readFileSync('src/lib/persistence.ts', 'utf8');

const target = `export async function syncCouncilSession(session: PersistedSession): Promise<string> {
  return new Promise((resolve, reject) => {
    if (pendingSyncs.has(session.id)) {
      clearTimeout(pendingSyncs.get(session.id)!.timeout);
    }`;
const replacement = `export async function syncCouncilSession(session: PersistedSession): Promise<string> {
  return new Promise((resolve, reject) => {
    if (pendingSyncs.has(session.id)) {
      clearTimeout(pendingSyncs.get(session.id)!.timeout);
      pendingSyncs.get(session.id)!.resolve(session.shareToken || session.id);
    }`;

if (code.includes(target)) {
    code = code.replace(target, replacement);
    fs.writeFileSync('src/lib/persistence.ts', code);
    console.log("persistence.ts updated successfully with resolve fix.");
} else {
    console.log("Target not found.");
}
