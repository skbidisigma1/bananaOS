import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.4.2/+esm'

export const db = new Dexie('bananaOS');

db.version(1).stores({
    config: 'key'
});

// Helper to check if the setup process is complete
export async function isSetupComplete() {
    const username = await db.config.get('username');
    const theme = await db.config.get('theme');

    return (!!username && !!theme); // Setup is complete if both fields exist
}