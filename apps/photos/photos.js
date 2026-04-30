import { db, resolvePath, writeFile } from "../../js/db.js";

function publishWindowContextTitle(contextTitle) {
    if (!window.parent) return;
    window.parent.postMessage({
        type: 'WINDOW_CONTEXT_TITLE',
        contextTitle
    }, '*');
}

// Utility Modals
function showModal(message, confirmText = "Discard", title = "Confirm") {
    return new Promise(resolve => {
        const modal = document.getElementById('discard-modal');
        const msgEl = document.getElementById('discard-message');
        const titleEl = document.getElementById('discard-title');
        const confirmBtn = document.getElementById('discard-confirm');
        const cancelBtn = document.getElementById('discard-cancel');

        if(titleEl) titleEl.textContent = title;
        msgEl.textContent = message;
        confirmBtn.textContent = confirmText;
        modal.classList.remove('hidden');

        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            modal.classList.add('hidden');
        };

        const onConfirm = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    });
}

function customAlert(message, title = "Notice") {
    return new Promise(resolve => {
        const modal = document.getElementById('alert-modal');
        const msgEl = document.getElementById('alert-message');
        const titleEl = document.getElementById('alert-title');
        const okBtn = document.getElementById('alert-ok');

        if(titleEl) titleEl.textContent = title;
        msgEl.textContent = message;
        modal.classList.remove('hidden');

        const cleanup = () => {
            okBtn.removeEventListener('click', onOk);
            modal.classList.add('hidden');
        };

        const onOk = () => { cleanup(); resolve(); };
        okBtn.addEventListener('click', onOk);
    });
}

function customPrompt(message, defaultValue = "", title = "Input Required") {
    return new Promise(resolve => {
        const modal = document.getElementById('prompt-modal');
        const msgEl = document.getElementById('prompt-message');
        const titleEl = document.getElementById('prompt-title');
        const inputEl = document.getElementById('prompt-input');
        const confirmBtn = document.getElementById('prompt-confirm');
        const cancelBtn = document.getElementById('prompt-cancel');

        if(titleEl) titleEl.textContent = title;
        msgEl.textContent = message;
        inputEl.value = defaultValue;
        modal.classList.remove('hidden');
        inputEl.focus();

        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            inputEl.removeEventListener('keydown', onKeyDown);
            modal.classList.add('hidden');
        };

        const onConfirm = () => { cleanup(); resolve(inputEl.value); };
        const onCancel = () => { cleanup(); resolve(null); };
        const onKeyDown = (e) => {
            if (e.key === 'Enter') onConfirm();
            if (e.key === 'Escape') onCancel();
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        inputEl.addEventListener('keydown', onKeyDown);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    let currentFilePath = null;

    const updateWindowContextTitle = () => {
        const contextTitle = currentFilePath
            ? (currentFilePath.split('/').pop() || 'Photos')
            : 'Photos';
        publishWindowContextTitle(contextTitle);
    };

    const urlParams = new URLSearchParams(window.location.search);
    const imageToLoadPath = urlParams.get('image');
    let imageName = urlParams.get('name') || 'Blank';
    let imageToLoad = null;

    if (imageToLoadPath) {
        currentFilePath = imageToLoadPath;
        try {
            const node = await resolvePath(imageToLoadPath);
            if (node && node.type === 'file') {
                const dataEntry = await db.fs_data.where({ nodeId: node.id }).first();
                if (dataEntry && dataEntry.data instanceof Blob) {
                    imageToLoad = URL.createObjectURL(dataEntry.data);
                    imageName = imageToLoadPath.split('/').pop();
                } else if (dataEntry && (dataEntry.data instanceof Uint8Array || dataEntry.data instanceof ArrayBuffer)) {
                    const blob = new Blob([dataEntry.data], { type: node.mime || 'image/png' });
                    imageToLoad = URL.createObjectURL(blob);
                    imageName = imageToLoadPath.split('/').pop();
                } else if (dataEntry && typeof dataEntry.data === 'string') {
                    imageToLoad = dataEntry.data;
                    imageName = imageToLoadPath.split('/').pop();
                }
            } else {
                imageToLoad = imageToLoadPath;
            }
        } catch(err) {
            console.error("Failed to read image from db", err);
            imageToLoad = imageToLoadPath;
        }
    }

    const includeUIOptions = {
        theme: {
            'common.bg': '#242729',
            'header.display': 'none'
        },
        menuBarPosition: 'bottom'
    };

    // Only set loadImage if we actually have an image path
    if (imageToLoad) {
        includeUIOptions.loadImage = {
            path: imageToLoad,
            name: imageName
        };
    } else {
        // Create a blank white canvas to act as the default image
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        includeUIOptions.loadImage = {
            path: canvas.toDataURL('image/png'),
            name: 'BlankImage'
        };
    }

    updateWindowContextTitle();

    const imageEditor = new tui.ImageEditor('#tui-image-editor-container', {
        includeUI: includeUIOptions,
        cssMaxWidth: document.documentElement.clientWidth,
        cssMaxHeight: document.documentElement.clientHeight,
        usageStatistics: false,
    });

    // Make sure the editor resizes if the window properties change
    window.addEventListener('resize', () => {
        imageEditor.ui.resizeEditor({
            uiSize: {
                width: '100%',
                height: '100%'
            }
        });
    });

    // File Menu logic
    let pickerCallback = null;
    window.addEventListener('message', e => {
        if (e.data && e.data.type === 'FILE_PICKED') {
            if (pickerCallback) pickerCallback(e.data.path);
            pickerCallback = null;
        }
    });

    function openFilePicker(defaultPath) {
        return new Promise(resolve => {
            pickerCallback = resolve;
            if (window.parent && window.parent.openApp) {
                // For save dialog, pass the folder path, not a specific file path that might not exist
                let path = '/home/user/Pictures';
                if (defaultPath && typeof defaultPath === 'string') {
                    // If defaultPath is a folder, use it; otherwise use its parent folder
                    if (defaultPath.endsWith('/')) {
                        path = defaultPath;
                    } else {
                        const lastSlash = defaultPath.lastIndexOf('/');
                        path = lastSlash > 0 ? defaultPath.substring(0, lastSlash) : '/home/user/Pictures';
                    }
                }
                window.parent.openApp('files', { mode: 'picker', defaultPath: path });
            } else {
                customPrompt("Enter the full path of the file:", defaultPath || "/home/user/Pictures/image.png", "Save File").then(resolve);
            }
        });
    }

    async function saveActiveFileAS() {
        let defaultFolder = '/home/user/Pictures';
        if (currentFilePath) {
            const lastSlash = currentFilePath.lastIndexOf('/');
            defaultFolder = lastSlash > 0 ? currentFilePath.substring(0, lastSlash) : '/home/user/Pictures';
        }
        let path = await openFilePicker(defaultFolder);
        if (!path) return;
        
        let lastSlash = path.lastIndexOf('/');
        let folderPath = lastSlash === -1 ? '/' : path.substring(0, lastSlash) || '/';
        let fileName = path.substring(lastSlash + 1);

        // If user selected a folder (no filename), auto-generate one
        const checkFolderNode = await resolvePath(folderPath);
        if (checkFolderNode && checkFolderNode.type === 'dir' && (!fileName || fileName.trim() === '')) {
            fileName = 'NewPicture.png';
            path = folderPath.endsWith('/') ? folderPath + fileName : folderPath + '/' + fileName;
        } else if (!fileName || fileName.trim() === '') {
            // Path is invalid, ask user for a filename
            fileName = await customPrompt('Enter a filename:', 'NewPicture.png', 'Save Image');
            if (!fileName || fileName.trim() === '') return;
            path = folderPath.endsWith('/') ? folderPath + fileName : folderPath + '/' + fileName;
            folderPath = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath;
        }

        const folderNode = await resolvePath(folderPath);
        if (!folderNode || folderNode.type !== 'dir') {
            await customAlert("The directory does not exist: " + folderPath, "Error");
            return;
        }

        try {
            const existingNode = await resolvePath(path);
            if (existingNode && existingNode.type === 'file') {
                const overwrite = await showModal("A file with this name already exists. Overwrite?", "Overwrite", "File Exists");
                if (!overwrite) return;
            }

            const dataUrl = imageEditor.toDataURL();
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            await writeFile(folderNode.id, fileName, blob, blob.type || 'image/png');
            
            currentFilePath = path;
            updateWindowContextTitle();
            window.history.replaceState({}, '', `${window.location.pathname}?image=${encodeURIComponent(path)}`);
        } catch(err) {
            await customAlert("Error saving: " + err.message, "Error");
        }
    }

    async function saveActiveFile() {
        if (!currentFilePath) {
            document.getElementById('file-save-as').click();
            return;
        }
        try {
            const node = await resolvePath(currentFilePath);
            if (node && node.type === 'file') {
                const dataUrl = imageEditor.toDataURL();
                const res = await fetch(dataUrl);
                const blob = await res.blob();
                await db.fs_data.where({ nodeId: node.id }).modify({ data: blob });
                await db.fs_nodes.update(node.id, { modified: Date.now(), size: blob.size });
            }
        } catch(err) {
            console.error("Failed to save file", err);
        }
    }

    document.getElementById('file-new').addEventListener('click', async () => {
        window.location.href = window.location.pathname;
    });

    document.getElementById('file-open').addEventListener('click', async () => {
        const path = await openFilePicker(currentFilePath);
        if (path) {
            window.location.href = `${window.location.pathname}?image=${encodeURIComponent(path)}`;
        }
    });

    document.getElementById('file-save').addEventListener('click', () => { saveActiveFile(); });
    document.getElementById('file-save-as').addEventListener('click', () => { saveActiveFileAS(); });

    document.getElementById('file-exit').addEventListener('click', async () => {
        if (window.parent) {
            const frames = window.parent.document.querySelectorAll('iframe');
            frames.forEach(f => {
                if (f.contentWindow === window) {
                    f.closest('.window').remove();
                }
            });
        }
    });

    // Keyboard shortcuts for saving
    document.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey) {
            if (e.key === 's' || e.key === 'S') {
                e.preventDefault();
                if (e.shiftKey) {
                    saveActiveFileAS();
                } else {
                    saveActiveFile();
                }
            }
        }
    });

    // Menu dropdowns UI toggle
    const menuButtons = document.querySelectorAll('.top-bar-button');
    menuButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            menuButtons.forEach(btn => {
                if (btn !== button) {
                    const dropdown = btn.querySelector('.dropdown-menu');
                    if (dropdown) dropdown.classList.add('hidden');
                }
            });
            const dropdown = button.querySelector('.dropdown-menu');
            if (dropdown) dropdown.classList.toggle('hidden');
            e.stopPropagation();
        });
    });

    document.addEventListener('click', () => {
        menuButtons.forEach(button => {
            const dropdown = button.querySelector('.dropdown-menu');
            if (dropdown && !dropdown.classList.contains('hidden')) {
                dropdown.classList.add('hidden');
            }
        });
    });
});
