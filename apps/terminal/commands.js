// Command Registry
import { db, readDir, mkdir, resolvePath } from "../../js/db.js";

export const commands = {
    help: async (args) => {
        return args.join(' ') + '\nAvailable commands:\n- help: Show this message\n- echo: Echo an input back to the terminal\n- whoami: Show the current user\n- clear: Clear the terminal history\n- pwd: Print working directory\n- ls: List directory contents\n- cd: Change directory\n- mkdir: Make directory\n- rm: Remove file or directory';
    },
    echo: async (args) => {
        return args.join(' ');
    },
    whoami: async () => {
        const usernameEntry = await db.config.get('username');
        const username = usernameEntry ? (usernameEntry.value || 'user') : 'user';
        return 'You are ' + username;
    },
    clear: async () => {
        const history = document.getElementById('terminal-history');
        history.innerHTML = '';
        return '';
    },
    pwd: async (args, { cwd }) => {
        return cwd;
    },
    ls: async (args, { cwd }) => {
        let path = args[0] ? args[0].replace(/\\/g, '/') : cwd;
        const targetNode = await resolvePath(path, cwd);
        if (!targetNode) return `ls: cannot access '${path}': No such file or directory`;
        if (targetNode.type !== 'dir') return targetNode.name;

        const contents = await readDir(targetNode.id);
        if (contents.length === 0) return '';
        return contents.map(node => (node.type === 'dir' ? `[DIR]  ${node.name}` : `${node.name}`)).join('\n');
    },
    cd: async (args, { cwd, setCwd }) => {
        let path = args[0] ? args[0].replace(/\\/g, '/') : '/home/user';
        const targetNode = await resolvePath(path, cwd);
        
        if (!targetNode) return `-bash: cd: ${path}: No such file or directory`;
        if (targetNode.type !== 'dir') return `-bash: cd: ${path}: Not a directory`;

        // Reconstruct the normalized path
        let newCwd = path;
        if (!path.startsWith('/')) {
            newCwd = cwd.endsWith('/') ? `${cwd}${path}` : `${cwd}/${path}`;
        }
        
        // Normalization for display
        const parts = newCwd.split('/').filter(p => p !== '');
        const normalized = [];
        for (const part of parts) {
            if (part === '.') continue;
            if (part === '..') normalized.pop();
            else normalized.push(part);
        }
        
        setCwd('/' + normalized.join('/'));
        return '';
    },
    mkdir: async (args, { cwd }) => {
        if (!args[0]) return 'mkdir: missing operand';
        let path = args[0].replace(/\\/g, '/');
        
        // Find parent dir
        const parts = path.split('/');
        const dirName = parts.pop();
        const parentPath = parts.join('/') || '.';
        
        const parentNode = await resolvePath(parentPath, cwd);
        if (!parentNode) {
            // Because db.js mkdir now intelligently creates nested directories,
            // we can pass the whole path to cwd node.
            const cwdNode = await resolvePath(cwd);
            try {
                await mkdir(cwdNode.id, path);
                return '';
            } catch (err) {
                return `mkdir: cannot create directory '${path}': ${err.message}`;
            }
        }
        
        if (parentNode.type !== 'dir') return `mkdir: cannot create directory '${path}': Not a directory`;
        
        try {
            await mkdir(parentNode.id, dirName);
            return '';
        } catch (err) {
            return `mkdir: cannot create directory '${path}': ${err.message}`;
        }
    },
    rm: async (args, { cwd }) => {
        if (!args[0]) return 'rm: missing operand';
        let path = args[0].replace(/\\/g, '/');
        
        const targetNode = await resolvePath(path, cwd);
        if (!targetNode) return `rm: cannot remove '${path}': No such file or directory`;
        
        const homeUser = await resolvePath('/home/user');
        const protectedDirs = ['Downloads', 'Desktop', 'Pictures', 'Videos', 'Documents'];
        
        if (homeUser && targetNode.parentId === homeUser.id && targetNode.type === 'dir' && protectedDirs.includes(targetNode.name)) {
            return `rm: cannot remove '${path}': Permission denied`;
        }
        
        await db.fs_nodes.delete(targetNode.id);
        await db.fs_data.where({nodeId: targetNode.id}).delete();
        return '';
    }
};