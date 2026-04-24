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
    // Normalize backslashes to forward slashes
    name = name.replace(/\\/g, '/');
    
    // Automatically create parent directories if path contains slashes
    if (name.includes('/')) {
        const parts = name.split('/').filter(p => p !== '');
        name = parts.pop(); // The actual filename is the last part
        
        for (const part of parts) {
            parentId = await mkdir(parentId, part);
        }
    }

    // Invalid characters check
    if (/[<>:"|?*]/.test(name)) {
        throw new Error(`Invalid characters in filename: ${name}`);
    }

    return await db.transaction('rw', db.fs_nodes, db.fs_data, async () => {
        const existing = await db.fs_nodes.where({ parentId, name }).first();
        if (existing) {
            if (existing.type === 'file') {
                await db.fs_data.where({ nodeId: existing.id }).modify({ data: content });
                await db.fs_nodes.update(existing.id, { modified: Date.now(), size: content.size || content.length });
                return existing.id;
            } else if (existing.type === 'dir') {
                throw new Error(`Cannot write file. A directory with the name '${name}' already exists.`);
            }
        }

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
    // Normalize backslashes to forward slashes
    name = name.replace(/\\/g, '/');

    // Automatically create parent directories if path contains slashes
    if (name.includes('/')) {
        const parts = name.split('/').filter(p => p !== '');
        
        for (const part of parts) {
            parentId = await mkdir(parentId, part);
        }
        return parentId; // Return the ID of the last created directory
    }

    // Invalid characters check
    if (/[<>:"|?*]/.test(name)) {
        throw new Error(`Invalid characters in directory name: ${name}`);
    }

    const existing = await db.fs_nodes.where({ parentId, name }).first();
    if (existing) {
        if (existing.type === 'dir') {
            return existing.id; // avoid duplicate paths mapping errors
        } else if (existing.type === 'file') {
            throw new Error(`Cannot create directory. A file with the name '${name}' already exists.`);
        }
    }
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
    let root = await db.fs_nodes.where({ parentId: 0, name: '' }).first();
    if (!root) {
        const rootId = await db.fs_nodes.add({ parentId: 0, name: '', type: 'dir' });
        root = { id: rootId };
    }

    let home = await db.fs_nodes.where({ parentId: root.id, name: 'home' }).first();
    if (!home) {
        const homeId = await db.fs_nodes.add({ parentId: root.id, name: 'home', type: 'dir' });
        home = { id: homeId };
    }

    let user = await db.fs_nodes.where({ parentId: home.id, name: 'user' }).first();
    if (!user) {
        const userId = await db.fs_nodes.add({ parentId: home.id, name: 'user', type: 'dir' });
        user = { id: userId };
    }

    // Ensure default user directories exist on every launch
    const defaultDirs = ['Downloads', 'Desktop', 'Pictures', 'Videos', 'Documents'];
    for (const dir of defaultDirs) {
        const existing = await db.fs_nodes.where({ parentId: user.id, name: dir }).first();
        if (!existing) {
            await db.fs_nodes.add({ parentId: user.id, name: dir, type: 'dir', modified: Date.now() });
        }
    }
}