import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.4.2/+esm'

export const db = new Dexie('bananaOS');

db.version(2).stores({
    config: 'key',
    fs_nodes: '++id, parentId, name, type, [parentId+name]',
    fs_data: 'nodeId'
});

// Check if setup is complete
export async function isSetupComplete() {
    const entry = await db.config.get('setupComplete');
    return entry ? entry.value : false;
}

// File creation
export async function writeFile(parentId, name, content, type = 'text/plain') {
    return await db.transaction('rw', db.fs_nodes, db.fs_data, async () => {
        const id = await db.fs_nodes.add({ parentId, name, type: 'file', mime: type, size: content.size || content.length, modified: Date.now() });
        await db.fs_data.add({ nodeId: id, data: content });
        return id;
    });
}

// Read directory
export async function readDir(parentId) {
    return await db.fs_nodes.where({ parentId }).toArray();
}

// Make directory
export async function mkdir(parentId, name) {
    return await db.fs_nodes.add({ parentId, name, type: 'dir', modified: Date.now() });
}

// Resolve path to a node
export async function resolvePath(path, cwd = '/') {
    // Base case: root node
    let currentNode = await db.fs_nodes.where({ parentId: 0, name: '' }).first();
    if (!currentNode) return null;

    if (!path || path === '/') return currentNode;

    let targetPath = path.startsWith('/') ? path : `${cwd.replace(/\/$/, '')}/${path}`;
    const parts = targetPath.split('/').filter(p => p !== '');

    for (const part of parts) {
        if (part === '.') continue;
        if (part === '..') {
            if (currentNode.parentId !== 0) {
                currentNode = await db.fs_nodes.get(currentNode.parentId);
            }
            continue;
        }
        currentNode = await db.fs_nodes.where({ parentId: currentNode.id, name: part }).first();
        if (!currentNode) return null;
    }
    return currentNode;
}

// Initialize filesystem
export async function initFS() {
    const root = await db.fs_nodes.where({ parentId: 0, name: '' }).first();
    if (!root) {
        const rootId = await db.fs_nodes.add({ parentId: 0, name: '', type: 'dir' });
        const homeId = await db.fs_nodes.add({ parentId: rootId, name: 'home', type: 'dir' });
        await db.fs_nodes.add({ parentId: homeId, name: 'user', type: 'dir' });
    }
}