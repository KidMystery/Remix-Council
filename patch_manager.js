const fs = require('fs');
let code = fs.readFileSync('src/hooks/useSessionManager.ts', 'utf8');

const target = `        if (sessionsToUpload.length > 0) {
          Promise.allSettled(
            sessionsToUpload.map((s) =>
              syncCouncilSession({`;

const replacement = `        if (sessionsToUpload.length > 0) {
          // Process uploads sequentially or in small batches to prevent Firestore quota exhaustion
          const uploadConcurrently = async () => {
            for (let i = 0; i < sessionsToUpload.length; i += 5) {
              const batch = sessionsToUpload.slice(i, i + 5);
              await Promise.allSettled(batch.map((s) => 
                syncCouncilSession({`;

const targetEnd = `              })
            )
          ).catch((err) => console.warn('Background batch sync encountered an issue:', err));
        }`;

const replacementEnd = `              })
              ));
            }
          };
          uploadConcurrently().catch((err) => console.warn('Background batch sync encountered an issue:', err));
        }`;

if (code.includes(target) && code.includes(targetEnd)) {
    code = code.replace(target, replacement).replace(targetEnd, replacementEnd);
    fs.writeFileSync('src/hooks/useSessionManager.ts', code);
    console.log("useSessionManager.ts updated successfully to batch uploads.");
} else {
    console.log("Target not found.");
}
