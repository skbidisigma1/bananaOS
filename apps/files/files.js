// TODO fix: When navigating to a file path that doesn't exist in the app, it creates that directory instead of telling you it's an invalid path

import { db, readDir, resolvePath, mkdir, writeFile, initFS } from '../../js/db.js';
import { contextMenu } from '../../js/rightClick.js';

// App state
const urlParams = new URLSearchParams(window.location.search);
const isPickerMode = urlParams.get('mode') === 'picker';
const pickerDefaultPath = urlParams.get('defaultPath') || '';
const directOpenPath = urlParams.get('path') || '';

let tabsData = new Map();
let activeTabId = null;

function getActiveTab() {
    return tabsData.get(activeTabId);
}

let clipboard = { files: [], operation: null };

function publishWindowContextTitle(contextTitle) {
    if (!window.parent) return;
    window.parent.postMessage({
        type: 'WINDOW_CONTEXT_TITLE',
        contextTitle
    }, '*');
}

function getDirectoryLabel(path) {
    const parts = (path || '').split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : '/';
}

function updateWindowContextTitle() {
    const tab = getActiveTab();
    if (!tab) return;
    publishWindowContextTitle(getDirectoryLabel(tab.currentPath));
}

// DOM Elements
const fileView = document.getElementById('file-view');
const pathDisplay = document.getElementById('path-display');
const alertModal = document.getElementById('alert-modal');
const alertMessage = document.getElementById('alert-message');
const alertOkBtn = document.getElementById('alert-ok');
const backButton = document.getElementById('back-button');
const forwardButton = document.getElementById('forward-button');
const upButton = document.getElementById('up-button');
const refreshButton = document.getElementById('refresh-button');
const newFolderBtn = document.getElementById('new-folder');
const newFileBtn = document.getElementById('new-file');
const cutBtn = document.getElementById('cut');
const copyBtn = document.getElementById('copy');
const pasteBtn = document.getElementById('paste');
const deleteBtn = document.getElementById('delete');
const sortBtn = document.getElementById('sort');
const searchBtn = document.getElementById('search');
const filterMenu = document.getElementById('filter-menu');
const searchMenu = document.getElementById('search-menu');
const searchInput = document.getElementById('search-input');
const tabs = document.getElementById('tabs');

// Picker DOM
const pickerFooter = document.getElementById('picker-footer');
const pickerFilename = document.getElementById('picker-filename');
const pickerCancel = document.getElementById('picker-cancel');
const pickerSelect = document.getElementById('picker-select');

async function getDefaultPath() {
    if (await resolvePath('/home/user/Downloads')) return '/home/user/Downloads';
    if (await resolvePath('/home/user')) return '/home/user';
    return '/';
}

function createTab(path = '/home/user/Downloads') {
    const tabId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    tabsData.set(tabId, {
        currentPath: path,
        currentNode: null,
        historyRec: [],
        historyIndex: -1,
        selectedFiles: new Set(),
        currentSortMode: 'name',
        undoStack: [],
        redoStack: []
    });
    return tabId;
}

// Initialize app
async function init() {
    await initFS();
    const startPath = pickerDefaultPath || directOpenPath || await getDefaultPath();
    
    // Setup picker UI if needed
    if (isPickerMode) {
        pickerFooter.classList.remove('hidden');
        pickerFilename.value = pickerDefaultPath || '';
        
        pickerCancel.addEventListener('click', () => {
            window.parent.postMessage({ type: 'FILE_PICKED', path: null }, '*');
            window.parent.postMessage({ type: 'CLOSE_WINDOW', appId: 'files' }, '*');
        });
        
        pickerSelect.addEventListener('click', async () => {
            let finalPath = pickerFilename.value;
            if (!finalPath.startsWith('/')) {
                finalPath = getActiveTab().currentPath === '/' 
                    ? '/' + finalPath 
                    : getActiveTab().currentPath + '/' + finalPath;
            }
            window.parent.postMessage({ type: 'FILE_PICKED', path: finalPath }, '*');
            window.parent.postMessage({ type: 'CLOSE_WINDOW', appId: 'files' }, '*');
        });
        
        tabs.style.display = 'none';
        document.getElementById('new-folder').style.display = 'none';
        document.getElementById('new-file').style.display = 'none';
        document.getElementById('cut').style.display = 'none';
        document.getElementById('copy').style.display = 'none';
        document.getElementById('paste').style.display = 'none';
        document.getElementById('delete').style.display = 'none';
        document.querySelectorAll('.file-control-separator').forEach(el => el.style.display = 'none');
    }

    const initialTabId = createTab(startPath);
    activeTabId = initialTabId;
    
    // Give the first DOM tab the id
    const firstTab = document.querySelector('.tab');
    if (firstTab) firstTab.dataset.tabId = initialTabId;
    
    await navigateTo(startPath);
    setupEventListeners();
}

function setupEventListeners() {
    // Navigation
    backButton.addEventListener('click', goBack);
    forwardButton.addEventListener('click', goForward);
    upButton.addEventListener('click', goUp);
    refreshButton.addEventListener('click', handleRefresh);
    
    // File operations
    newFolderBtn.addEventListener('click', handleNewFolder);
    newFileBtn.addEventListener('click', handleNewFile);
    cutBtn.addEventListener('click', handleCut);
    copyBtn.addEventListener('click', handleCopy);
    pasteBtn.addEventListener('click', handlePaste);
    deleteBtn.addEventListener('click', handleDelete);
    
    // Menus
    sortBtn.addEventListener('click', toggleFilterMenu);
    searchBtn.addEventListener('click', toggleSearchMenu);
    
    // Sidebar navigation
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', async () => {
            const label = item.querySelector('.sidebar-item-label').textContent;
            let targetPath = label;
            switch (label) {
                case 'Home': targetPath = '/home/user'; break;
                case 'Downloads': targetPath = '/home/user/Downloads'; break;
                case 'Desktop': targetPath = '/home/user/Desktop'; break;
                case 'Pictures': targetPath = '/home/user/Pictures'; break;
                case 'Videos': targetPath = '/home/user/Videos'; break;
                case 'Documents': targetPath = '/home/user/Documents'; break;
                default: break;
            }
            await navigateTo(targetPath);
        });
    });
    
    // Tab handling
    tabs.addEventListener('click', async (e) => {
        const closeBtn = e.target.closest('.tab-close');
        const newTabBtn = e.target.closest('.new-tab');
        const tabEl = e.target.closest('.tab');
        
        if (closeBtn) {
            e.stopPropagation();
            const tab = closeBtn.closest('.tab');
            await handleCloseTab(tab.dataset.tabId);
        } else if (newTabBtn) {
            e.stopPropagation();
            await handleNewTab();
        } else if (tabEl) {
            await switchToTab(tabEl.dataset.tabId);
        }
    });

    tabs.addEventListener('auxclick', async (e) => {
        if (e.button === 1) {
            const tabEl = e.target.closest('.tab');
            if (tabEl) {
                e.preventDefault();
                await handleCloseTab(tabEl.dataset.tabId);
            }
        }
    });
    
    // Sort logic
    document.querySelectorAll('.sort-option').forEach(option => {
        if (option.querySelector('select')) return;
        
        if (option.textContent.includes('Name') && getActiveTab().currentSortMode === 'name') option.classList.add('selected');
        
        option.addEventListener('click', async () => {
            document.querySelectorAll('.sort-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');
            
            if (option.textContent.includes('Name')) getActiveTab().currentSortMode = 'name';
            else if (option.textContent.includes('Size')) getActiveTab().currentSortMode = 'size';
            else if (option.textContent.includes('Date')) getActiveTab().currentSortMode = 'date';
            
            await renderFileView();
        });
    });

    // Path Display
    pathDisplay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const targetPath = pathDisplay.value;
            pathDisplay.blur();
            if (targetPath !== getActiveTab().currentPath) {
                navigateTo(targetPath);
            }
        }
    });

    pathDisplay.addEventListener('blur', () => {
        if (getActiveTab()) {
            pathDisplay.value = getActiveTab().currentPath;
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', async (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            await handleRedo();
            return;
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            await handleRedo();
            return;
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            await handleUndo();
            return;
        } else if (e.key === 'F2' && getActiveTab().selectedFiles.size === 1) {
            handleRename();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            await selectAll();
        } else if (e.key === 'Delete' && getActiveTab().selectedFiles.size > 0) {
            await handleDelete();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            handleCopy();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
            handleCut();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            await handlePaste();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            await handleDuplicate();
        } else if ((e.altKey) && e.key === 't') {
            e.preventDefault();
            await handleNewTab(); 
        } else if ((e.altKey) && e.key === 'w') {
            e.preventDefault();
            await handleCloseTab();
        } else if (e.key === 'Enter' && getActiveTab().selectedFiles.size === 1) {
            await handleOpenFile();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            toggleSearchMenu();
        } else if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
            e.preventDefault();
            await handleRefresh();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            await navigateUp();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            await navigateDown();
        } else if (e.key === 'Backspace') {
            await goUp();
        };
    });

    // Close menus on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#sort') && !e.target.closest('#filter-menu')) {
            filterMenu.classList.remove('visible');
        }
        if (!e.target.closest('#search') && !e.target.closest('#search-menu')) {
            searchMenu.classList.remove('visible');
        }
        
        // Modals outside click
        if (e.target.classList.contains('modal')) {
            e.target.classList.add('hidden');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
            document.querySelectorAll('.file-row').forEach(r => r.classList.remove('selected'));
            if(getActiveTab()) getActiveTab().selectedFiles.clear();
            updateToolbarState();
        }
        if (e.key === 'Enter') {
            const folderModal = document.getElementById('new-folder-modal');
            if(!folderModal.classList.contains('hidden')) {
                document.getElementById('confirm-new-folder').click();
            }
            const fileModal = document.getElementById('new-file-modal');
            if(!fileModal.classList.contains('hidden')) {
                document.getElementById('confirm-new-file').click();
            }
            const renameModal = document.getElementById('rename-modal');
            if(!renameModal.classList.contains('hidden')) {
                document.getElementById('confirm-rename').click();
            }
        }
    });

    // Modals
    document.getElementById('cancel-new-folder').addEventListener('click', () => {
        document.getElementById('new-folder-modal').classList.add('hidden');
    });
    
    document.getElementById('confirm-new-folder').addEventListener('click', async () => {
        const input = document.querySelector('#new-folder-modal input[name="folder-name"]');
        let name = input.value.trim();
        if (name) {
            try {
                const normalizedPath = name.replace(/\\/g, '/');
                const parts = normalizedPath.split('/').filter(p => p !== '');
                const finalName = parts.pop();
                
                if (parts.length === 0) {
                    const children = await readDir(getActiveTab().currentNode);
                    if (children.some(c => c.name === finalName)) {
                        let attempts = 1;
                        while (children.some(c => c.name === `${finalName} (${attempts})`)) {
                            attempts++;
                        }
                        name = `${finalName} (${attempts})`;
                    }
                }
                
                const id = await mkdir(getActiveTab().currentNode, name);
                const snapshot = await db.fs_nodes.get(id);
                pushHistoryAction({ type: 'create', fileIds: [id], nodesSnapshot: [snapshot] });
                
                await renderFileView();
                document.getElementById('new-folder-modal').classList.add('hidden');
            } catch (err) {
                showAlert(err.message);
            }
        }
    });

    document.getElementById('cancel-new-file').addEventListener('click', () => {
        document.getElementById('new-file-modal').classList.add('hidden');
    });
    
    document.getElementById('confirm-new-file').addEventListener('click', async () => {
        const input = document.querySelector('#new-file-modal input[name="file-name"]');
        let name = input.value.trim();
        if (name) {
            try {
                const normalizedPath = name.replace(/\\/g, '/');
                const parts = normalizedPath.split('/').filter(p => p !== '');
                const finalName = parts.pop();
                
                if (parts.length === 0) {
                    const children = await readDir(getActiveTab().currentNode);
                    if (children.some(c => c.name === finalName)) {
                        const dotIndex = finalName.lastIndexOf('.');
                        let base = finalName, ext = '';
                        if(dotIndex !== -1 && dotIndex !== 0) {
                             base = finalName.substring(0, dotIndex);
                             ext = finalName.substring(dotIndex);
                        }
                        let attempts = 1;
                        while(children.some(c => c.name === `${base} (${attempts})${ext}`)) {
                            attempts++;
                        }
                        name = `${base} (${attempts})${ext}`;
                    }
                }
                
                const id = await writeFile(getActiveTab().currentNode, name, '', 'text/plain');
                const nodeSnapshot = await db.fs_nodes.get(id);
                pushHistoryAction({ type: 'create', fileIds: [id], nodesSnapshot: [{...nodeSnapshot, data: ''}] });
                
                await renderFileView();
                document.getElementById('new-file-modal').classList.add('hidden');
            } catch (err) {
                showAlert(err.message);
            }
        }
    });
    
    document.getElementById('cancel-rename').addEventListener('click', () => {
        document.getElementById('rename-modal').classList.add('hidden');
    });
    
    document.getElementById('confirm-rename').addEventListener('click', async () => {
        const input = document.querySelector('#rename-modal input[name="rename-name"]');
        let newName = input.value.trim();
        if (newName && getActiveTab().selectedFiles.size === 1) {
            if (/[<>:"/\\|?*]/.test(newName)) {
                showAlert(`Invalid characters in filename: ${newName}`);
                return;
            }

            const fileId = Array.from(getActiveTab().selectedFiles)[0];
            const file = await db.fs_nodes.get(fileId);
            
            // Check for protected directories before attempting rename
            const protectedDirs = ['Downloads', 'Desktop', 'Pictures', 'Videos', 'Documents'];
            if (getActiveTab().currentPath === '/home/user' && file && file.type === 'dir' && protectedDirs.includes(file.name)) {
                showAlert(`Cannot rename protected system directory: ${file.name}`);
                document.getElementById('rename-modal').classList.add('hidden');
                return;
            }

            const children = await readDir(getActiveTab().currentNode);
            if (children.some(c => c.name === newName && c.id !== fileId)) {
                showAlert(`A file or folder with the name '${newName}' already exists.`);
                return;
            }
            
            pushHistoryAction({ type: 'rename', fileId, oldName: file.name, newName });
            await db.fs_nodes.update(fileId, { name: newName, modified: Date.now() });
            
            await renderFileView();
            document.getElementById('rename-modal').classList.add('hidden');
        }
    });

    document.getElementById('upload-file').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const id = await writeFile(getActiveTab().currentNode, file.name, file, file.type || 'application/octet-stream');
            const snapshot = await db.fs_nodes.get(id);
            pushHistoryAction({ type: 'create', fileIds: [id], nodesSnapshot: [{...snapshot, data: file}] });
            await renderFileView();
            document.getElementById('new-file-modal').classList.add('hidden');
        };
        input.click();
    });

    alertOkBtn.addEventListener('click', () => {
        alertModal.classList.add('hidden');
    });

    fileView.addEventListener('click', (e) => {
        if (e.target === fileView || e.target.classList.contains('empty-state')) {
            document.querySelectorAll('.file-row').forEach(r => r.classList.remove('selected'));
            if(getActiveTab()) getActiveTab().selectedFiles.clear();
            updateToolbarState();
        }
    });

    document.querySelector('#search-menu input').addEventListener('input', applyFilters);
    document.querySelector('#filter-menu select').addEventListener('change', applyFilters);
    document.querySelector('.filter-other input').addEventListener('input', applyFilters);
}

function applyFilters() {
    getActiveTab().filteredFiles = getActiveTab().files.filter(file => {
        const searchQuery = document.querySelector('#search-menu input').value.toLowerCase();
        const filterType = document.querySelector('#filter-menu select').value;
        const filterCustom = document.querySelector('.filter-other input').value.toLowerCase();

        const name = file.name;
        const lowerName = name.toLowerCase();
        const isFolder = file.type === 'dir';
        
        let match = lowerName.includes(searchQuery);

        if (match && filterType !== 'all') {
            if (filterType === 'folders' && !isFolder) match = false;
            else if (filterType !== 'folders' && isFolder) match = false;
            else if (filterType === 'images' && !lowerName.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) match = false;
            else if (filterType === 'documents' && !lowerName.match(/\.(pdf|doc|docx|txt|rtf|md)$/)) match = false;
            else if (filterType === 'videos' && !lowerName.match(/\.(mp4|webm|mkv|avi|mov)$/)) match = false;
            else if (filterType === 'audio' && !lowerName.match(/\.(mp3|wav|ogg|flac)$/)) match = false;
            else if (filterType === 'archives' && !lowerName.match(/\.(zip|rar|7z|tar|gz)$/)) match = false;
            else if (filterType === 'other' && !lowerName.includes(filterCustom)) match = false;
        }

        return match;
    });
    
    // Reset virtual scroll state
    getActiveTab().renderedCount = 0;
    fileView.innerHTML = '';
    if (getActiveTab().filteredFiles.length === 0) {
        fileView.innerHTML = '<div class="empty-state" style="padding: 1rem; color: var(--color-subtle-text);">No items found</div>';
    } else {
        renderNextChunk();
    }
}

function renderNextChunk() {
    const tab = getActiveTab();
    if (!tab || !tab.filteredFiles) return;
    
    const CHUNK_SIZE = 50;
    const chunk = tab.filteredFiles.slice(tab.renderedCount, tab.renderedCount + CHUNK_SIZE);
    if (chunk.length === 0) return;
    
    chunk.forEach(async (file) => {
        const row = document.createElement('div');
        row.className = 'file-row';
        row.dataset.id = file.id;
        if (tab.selectedFiles.has(file.id)) row.classList.add('selected');
        
        const icon = getFileIcon(file);
        let sizeStr = '';
        if (file.type === 'dir') {
            const inner = await readDir(file.id);
            sizeStr = `${inner.length} items`;
        } else {
            sizeStr = formatFileSize(file.size || 0);
        }
        
        row.innerHTML = `
            <span class="file-icon">${icon}</span>
            <span class="file-name">${file.name}</span>
            <span class="file-size">${sizeStr}</span>
            <span class="file-date">${formatDate(file.modified)}</span>
        `;
        
        row.addEventListener('click', (e) => {
            const filesList = Array.from(fileView.querySelectorAll('.file-row'));
            const currentIndex = filesList.indexOf(row);
            
            if (e.shiftKey && tab.lastSelectedIndex !== -1 && tab.lastSelectedIndex !== undefined) {
                const start = Math.min(tab.lastSelectedIndex, currentIndex);
                const end = Math.max(tab.lastSelectedIndex, currentIndex);
                
                if (!e.ctrlKey && !e.metaKey) {
                    filesList.forEach(r => r.classList.remove('selected'));
                    tab.selectedFiles.clear();
                }
                
                for (let i = start; i <= end; i++) {
                    const r = filesList[i];
                    tab.selectedFiles.add(Number(r.dataset.id));
                    r.classList.add('selected');
                }
            } else {
                if (!e.ctrlKey && !e.metaKey) {
                    filesList.forEach(r => r.classList.remove('selected'));
                    tab.selectedFiles.clear();
                }
                
                if (tab.selectedFiles.has(file.id)) {
                    tab.selectedFiles.delete(file.id);
                    row.classList.remove('selected');
                } else {
                    tab.selectedFiles.add(file.id);
                    row.classList.add('selected');
                }
            }
            tab.lastSelectedIndex = currentIndex;
            updateToolbarState();
            
            // Picker mode update
            if (isPickerMode && tab.selectedFiles.has(file.id)) {
                const fullPath = `${tab.currentPath === '/' ? '' : tab.currentPath}/${file.name}`;
                pickerFilename.value = fullPath;
            }
        });
        
        row.addEventListener('dblclick', async () => {
            const isDir = file.type === 'dir';
            const fullPath = `${tab.currentPath === '/' ? '' : tab.currentPath}/${file.name}`;
            
            if (isDir) {
                await navigateTo(fullPath);
                if (isPickerMode) pickerFilename.value = fullPath;
            } else {
                if (isPickerMode) {
                    pickerFilename.value = fullPath;
                    pickerSelect.click();
                    return;
                }
                
                if (window.parent && window.parent.openApp) {
                    const ext = fullPath.split('.').pop().toLowerCase();
                    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
                    if (imageExts.includes(ext)) {
                        window.parent.openApp('photos', { image: fullPath });
                    } else {
                        window.parent.openApp('text-editor', { file: fullPath });
                    }
                }
            }
        });
        
        fileView.appendChild(row);
    });
    
    tab.renderedCount += chunk.length;
}

// Handle scroll for lazy loading
fileView.addEventListener('scroll', () => {
    if (fileView.scrollTop + fileView.clientHeight >= fileView.scrollHeight - 100) {
        const tab = getActiveTab();
        if (tab && tab.filteredFiles && tab.renderedCount < tab.filteredFiles.length) {
            renderNextChunk();
        }
    }
});

// Navigation history
async function navigateTo(path, pushHistory = true) {
    try {
        const node = await resolvePath(path);
        if (!node) {
            showAlert(`Path does not exist: ${path}`);
            return;
        }
        
        const finalNode = node;
        
        getActiveTab().currentPath = path;
        getActiveTab().currentNode = finalNode.id;
        getActiveTab().selectedFiles.clear();
        
        if (pushHistory) {
            if (getActiveTab().historyIndex < getActiveTab().historyRec.length - 1) {
                getActiveTab().historyRec = getActiveTab().historyRec.slice(0, getActiveTab().historyIndex + 1);
            }
            if (getActiveTab().historyRec[getActiveTab().historyIndex] !== path) {
                getActiveTab().historyRec.push(path);
                getActiveTab().historyIndex = getActiveTab().historyRec.length - 1;
            }
        }
        
        pathDisplay.value = getActiveTab().currentPath;
        updateWindowContextTitle();
        
        const activeTabEl = document.querySelector(`.tab[data-tab-id="${activeTabId}"]`);
        if (activeTabEl) {
            const titleEl = activeTabEl.querySelector('.tab-label');
            if (titleEl) {
                const parts = path.split('/').filter(p => p);
                titleEl.textContent = parts.length > 0 ? parts[parts.length - 1] : '/';
            }
        }
        
        updateNavigationButtons();
        await renderFileView();
    } catch (error) {
        console.error('Error navigating to path:', error);
    }
}
function goBack() {
    if (getActiveTab().historyIndex > 0) {
        getActiveTab().historyIndex--;
        navigateTo(getActiveTab().historyRec[getActiveTab().historyIndex], false);
    }
}

function goForward() {
    if (getActiveTab().historyIndex < getActiveTab().historyRec.length - 1) {
        getActiveTab().historyIndex++;
        navigateTo(getActiveTab().historyRec[getActiveTab().historyIndex], false);
    }
}

async function goUp() {
    if (getActiveTab().currentPath === '/') return;
    const parts = getActiveTab().currentPath.split('/').filter(p => p);
    if (parts.length > 0) {
        parts.pop();
        const newPath = '/' + parts.join('/');
        await navigateTo(newPath || '/');
    }
}

function updateNavigationButtons() {
    backButton.disabled = getActiveTab().historyIndex <= 0;
    forwardButton.disabled = getActiveTab().historyIndex >= getActiveTab().historyRec.length - 1;
    upButton.disabled = getActiveTab().currentPath === '/';
    updateToolbarState();
}

async function renderFileView() {
    try {
        fileView.innerHTML = '';
        if (!getActiveTab() || getActiveTab().currentNode === null) return;
        
        const files = await readDir(getActiveTab().currentNode);
        getActiveTab().files = files;
        
        if (files.length === 0) {
            fileView.innerHTML = '<div class="empty-state" style="padding: 1rem; color: var(--color-subtle-text);">This folder is empty</div>';
            return;
        }
        
        files.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            if (getActiveTab().currentSortMode === 'name') return a.name.localeCompare(b.name);
            if (getActiveTab().currentSortMode === 'size') return (a.size || 0) - (b.size || 0);
            if (getActiveTab().currentSortMode === 'date') return (b.modified || 0) - (a.modified || 0);
            return 0;
        });
        
        applyFilters();
    } catch (e) { console.error(e); }
}

async function handleNewFolder() {
    const modal = document.getElementById('new-folder-modal');
    const input = modal.querySelector('input[name="folder-name"]');
    input.value = '';
    modal.classList.remove('hidden');
    input.focus();
}

async function handleNewFile() {
    const modal = document.getElementById('new-file-modal');
    const input = modal.querySelector('input[name="file-name"]');
    input.value = '';
    modal.classList.remove('hidden');
    input.focus();
}

function handleCut() {
    if (getActiveTab().selectedFiles.size === 0) return;
    clipboard = { files: Array.from(getActiveTab().selectedFiles), operation: 'cut' };
    updateToolbarState();
}

function handleCopy() {
    if (getActiveTab().selectedFiles.size === 0) return;
    clipboard = { files: Array.from(getActiveTab().selectedFiles), operation: 'copy' };
    updateToolbarState();
}

async function copyDirectoryRecursive(sourceId, targetParentId, isRoot = false) {
    const sourceNode = await db.fs_nodes.get(sourceId);
    if (!sourceNode) return null;

    let newName = sourceNode.name;
    if (isRoot) newName += ' (copy)';
    
    // Check if name exists
    const children = await readDir(targetParentId);
    let attempts = 1;
    let finalName = newName;
    while (children.some(c => c.name === finalName)) {
        finalName = `${newName} (copy) (${attempts})`;
        attempts++;
    }
    newName = finalName;

    const newDirNodeId = await mkdir(targetParentId, newName);
    
    const sourceChildren = await readDir(sourceId);
    for (const child of sourceChildren) {
        if (child.type === 'dir') {
            await copyDirectoryRecursive(child.id, newDirNodeId);
        } else {
            const data = await db.fs_data.get({nodeId: child.id});
            await writeFile(newDirNodeId, child.name, data?.data || '', child.mime);
        }
    }
    
    return newDirNodeId;
}

async function handlePaste() {
    if (clipboard.files.length === 0) return;
    
    let createdIds = [];
    let moves = [];
    
    for (const fileId of clipboard.files) {
        const file = await db.fs_nodes.get(fileId);
        if (file) {
            if (clipboard.operation === 'cut') {
                const oldParent = file.parentId;
                await db.fs_nodes.update(fileId, { parentId: getActiveTab().currentNode });
                moves.push({ fileId, oldParent, newParent: getActiveTab().currentNode });
            } else if (clipboard.operation === 'copy') {
                if (file.type === 'dir') {
                    const newId = await copyDirectoryRecursive(fileId, getActiveTab().currentNode, true);
                    createdIds.push(newId);
                } else {
                    const data = await db.fs_data.get({nodeId: fileId});
                    let newName = file.name;
                    
                    const children = await readDir(getActiveTab().currentNode);
                    const dotIndex = newName.lastIndexOf('.');
                    let nameBase = newName;
                    let ext = '';
                    if (dotIndex !== -1 && dotIndex !== 0) {
                        nameBase = newName.substring(0, dotIndex);
                        ext = newName.substring(dotIndex);
                    }
                    
                    let attempts = 1;
                    let finalName = newName;
                    
                    if (children.some(c => c.name === finalName)) {
                        finalName = `${nameBase} (copy)${ext}`;
                    }
                    
                    while(children.some(c => c.name === finalName)) {
                        finalName = `${nameBase} (copy) (${attempts})${ext}`;
                        attempts++;
                    }

                    const newId = await writeFile(getActiveTab().currentNode, finalName, data?.data || '', file.mime);
                    createdIds.push(newId);
                }
            }
        }
    }
    
    if (clipboard.operation === 'cut') {
        if (moves.length > 0) pushHistoryAction({ type: 'move', moves });
        clipboard = { files: [], operation: null };
    } else if (clipboard.operation === 'copy') {
        if (createdIds.length > 0) {
            const nodesSnapshot = await Promise.all(createdIds.map(id => db.fs_nodes.get(id)));
            pushHistoryAction({ type: 'create', fileIds: createdIds, nodesSnapshot });
        }
    }
    
    await renderFileView();
    updateToolbarState();
}

function showAlert(message) {
    alertMessage.textContent = message;
    alertModal.classList.remove('hidden');
}

async function selectAll() {
    const visibleRows = Array.from(document.querySelectorAll('.file-row')).filter(r => r.style.display !== 'none');
            visibleRows.forEach(row => {
                getActiveTab().selectedFiles.add(Number(row.dataset.id));
                row.classList.add('selected');
            });
            updateToolbarState();
}

async function handleDelete() {
    if (getActiveTab().selectedFiles.size === 0) return;
    
    // Check for protected directories before attempting deletion
    const protectedDirs = ['Downloads', 'Desktop', 'Pictures', 'Videos', 'Documents'];
    const currentPath = getActiveTab().currentPath;
    
    let deletedNodes = [];
    
    for (const fileId of getActiveTab().selectedFiles) {
        const fileNode = await db.fs_nodes.get(fileId);
        if (currentPath === '/home/user' && fileNode && fileNode.type === 'dir' && protectedDirs.includes(fileNode.name)) {
            showAlert(`Cannot delete protected system directory: ${fileNode.name}`);
            continue;
        }
        
        const dataObj = await db.fs_data.where({nodeId: fileId}).first();
        if (fileNode) {
            deletedNodes.push({ ...fileNode, data: dataObj ? dataObj.data : null });
        }
        
        await db.fs_nodes.delete(fileId);
        await db.fs_data.where({nodeId: fileId}).delete();
    }
    
    if (deletedNodes.length > 0) {
        pushHistoryAction({ type: 'delete', nodes: deletedNodes });
    }
    
    getActiveTab().selectedFiles.clear();
    await renderFileView();
    updateToolbarState();
}

function toggleFilterMenu() {
    filterMenu.classList.toggle('visible');
    searchMenu.classList.remove('visible');
}

function toggleSearchMenu() {
    searchMenu.classList.toggle('visible');
    filterMenu.classList.remove('visible');
    searchInput.focus();
}

function pushHistoryAction(action) {
    const tab = getActiveTab();
    tab.undoStack.push(action);
    if (tab.undoStack.length > 50) tab.undoStack.shift();
    tab.redoStack = [];
}

async function handleUndo() {
    const tab = getActiveTab();
    if (tab.undoStack.length === 0) return;
    const action = tab.undoStack.pop();
    
    try {
        if (action.type === 'create') {
            for (const id of action.fileIds) {
                await db.fs_nodes.delete(id);
                await db.fs_data.where({nodeId: id}).delete();
            }
        } else if (action.type === 'delete') {
            for (const node of action.nodes) {
                await db.fs_nodes.put({ id: node.id, parentId: node.parentId, name: node.name, type: node.type, mime: node.mime, size: node.size, modified: node.modified });
                if (node.data) {
                    await db.fs_data.put({ nodeId: node.id, data: node.data });
                }
            }
        } else if (action.type === 'rename') {
            await db.fs_nodes.update(action.fileId, { name: action.oldName });
        } else if (action.type === 'move') {
            for (const move of action.moves) {
                await db.fs_nodes.update(move.fileId, { parentId: move.oldParent });
            }
        }
        tab.redoStack.push(action);
        await renderFileView();
    } catch (e) {
        console.error('Undo failed:', e);
    }
}

async function handleRedo() {
    const tab = getActiveTab();
    if (tab.redoStack.length === 0) return;
    const action = tab.redoStack.pop();
    
    try {
        if (action.type === 'create') {
            for (const node of action.nodesSnapshot) {
                await db.fs_nodes.put({ id: node.id, parentId: node.parentId, name: node.name, type: node.type, mime: node.mime, size: node.size, modified: node.modified });
                if (node.data) {
                    await db.fs_data.put({ nodeId: node.id, data: node.data });
                }
            }
        } else if (action.type === 'delete') {
            for (const node of action.nodes) {
                await db.fs_nodes.delete(node.id);
                await db.fs_data.where({nodeId: node.id}).delete();
            }
        } else if (action.type === 'rename') {
            await db.fs_nodes.update(action.fileId, { name: action.newName });
        } else if (action.type === 'move') {
            for (const move of action.moves) {
                await db.fs_nodes.update(move.fileId, { parentId: move.newParent });
            }
        }
        tab.undoStack.push(action);
        await renderFileView();
    } catch (e) {
        console.error('Redo failed:', e);
    }
}

function updateToolbarState() {
    const s = getActiveTab().selectedFiles.size > 0;
    cutBtn.style.opacity = s ? '1' : '0.5';
    copyBtn.style.opacity = s ? '1' : '0.5';
    deleteBtn.style.opacity = s ? '1' : '0.5';
    pasteBtn.style.opacity = clipboard.files.length > 0 ? '1' : '0.5';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + ['B', 'KB', 'MB', 'GB'][i];
}

function formatDate(timestamp) {
    const d = Math.floor((Date.now() - timestamp) / 86400000);
    return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${Math.round(d/30)} months ago`;
}

// Keyboard Shortcut Helper Functions
async function handleRename() {
    if (getActiveTab().selectedFiles.size !== 1) return;
    const fileId = Array.from(getActiveTab().selectedFiles)[0];
    const file = await db.fs_nodes.get(fileId);
    if (!file) return;

    const modal = document.getElementById('rename-modal');
    const input = modal.querySelector('input[name="rename-name"]');
    input.value = file.name;
    modal.classList.remove('hidden');
    input.focus();

    const dotIndex = file.name.lastIndexOf('.');
    if (dotIndex > 0 && file.type !== 'dir') {
        input.setSelectionRange(0, dotIndex);
    } else {
        input.select();
    }
}

async function handleDuplicate() {
    if (getActiveTab().selectedFiles.size === 0) return;
    
    let createdIds = [];
    
    for (const fileId of getActiveTab().selectedFiles) {
        const file = await db.fs_nodes.get(fileId);
        if (!file) continue;
        
        let newName = file.name;
        const dotIndex = newName.lastIndexOf('.');
        let base = newName, ext = '';
        if(dotIndex !== -1 && dotIndex !== 0) {
            base = newName.substring(0, dotIndex);
            ext = newName.substring(dotIndex);
        }
        
        const children = await readDir(getActiveTab().currentNode);
        let attempts = 1;
        let finalName = `${base} (copy)${ext}`;
        while (children.some(c => c.name === finalName)) {
            finalName = `${base} (copy) (${attempts})${ext}`;
            attempts++;
        }
        
        if (file.type === 'dir') {
            const newId = await copyDirectoryRecursive(file.id, getActiveTab().currentNode, true);
            createdIds.push(newId);
        } else {
            const data = await db.fs_data.get({nodeId: file.id});
            const newId = await writeFile(getActiveTab().currentNode, finalName, data?.data || '', file.mime);
            createdIds.push(newId);
        }
    }
    
    if (createdIds.length > 0) {
        const nodesSnapshot = await Promise.all(createdIds.map(id => db.fs_nodes.get(id)));
        pushHistoryAction({ type: 'create', fileIds: createdIds, nodesSnapshot });
    }
    
    await renderFileView();
}

async function handleNewTab() {
    const startPath = await getDefaultPath();
    const newTabId = createTab(startPath);
    const newTab = document.querySelector('.tab').cloneNode(true);
    newTab.dataset.tabId = newTabId;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    newTab.classList.add('active');
    newTab.querySelector('.tab-label').textContent = 'Loading...'; 
    tabs.insertBefore(newTab, document.querySelector('.new-tab'));
    updateTabsUI();
    await switchToTab(newTabId);
    await navigateTo(startPath);
}

async function handleCloseTab(tabId = activeTabId) {
    const allTabs = document.querySelectorAll('.tab');
    if (allTabs.length > 1) {
        const tabList = Array.from(allTabs);
        const tabIndex = tabList.findIndex(t => t.dataset.tabId === tabId);
        if (tabIndex === -1) return;
        const tab = tabList[tabIndex];
        
        let nextActive = null;
        if (tab.classList.contains('active')) {
            const nextTab = tab.nextElementSibling?.classList.contains('tab') ? tab.nextElementSibling : tab.previousElementSibling;
            if (nextTab) {
                nextActive = nextTab.dataset.tabId;
            }
        }
        
        tabsData.delete(tabId);
        tab.remove();
        updateTabsUI();
        
        if (nextActive) {
            await switchToTab(nextActive);
        }
    }
}

async function handleOpenFile() {
    if (getActiveTab().selectedFiles.size !== 1) return;
    const fileId = Array.from(getActiveTab().selectedFiles)[0];
    const file = await db.fs_nodes.get(fileId);
    if (file && file.type === 'dir') {
        const pathSuffix = getActiveTab().currentPath === '/' ? '' : getActiveTab().currentPath;
        await navigateTo(`${pathSuffix}/${file.name}`);
    } else if (file && file.type === 'file') {
        const pathSuffix = getActiveTab().currentPath === '/' ? '' : getActiveTab().currentPath;
        const fullPath = `${pathSuffix}/${file.name}`;
        if (window.parent && window.parent.openApp) {
            const ext = file.name.split('.').pop().toLowerCase();
            const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
            if (imageExts.includes(ext)) {
                window.parent.openApp('photos', { image: fullPath });
            } else {
                window.parent.openApp('text-editor', { file: fullPath });
            }
        }
    }
}

async function handleRefresh() {
    await renderFileView();
}

async function navigateUp() {
    const visibleRows = Array.from(document.querySelectorAll('.file-row')).filter(r => r.style.display !== 'none');
    if (visibleRows.length === 0) return;
    
    let newIndex = visibleRows.length - 1;
    const selectedRows = getActiveTab().selectedFiles;
    
    if (selectedRows.size > 0) {
        const currentFileId = Array.from(selectedRows)[0];
        const currentIndex = visibleRows.findIndex(r => Number(r.dataset.id) === currentFileId);
        if (currentIndex > 0) newIndex = currentIndex - 1;
        else if (currentIndex === 0) newIndex = 0;
    }
    
    const newFileId = Number(visibleRows[newIndex].dataset.id);
    document.querySelectorAll('.file-row').forEach(r => r.classList.remove('selected'));
    getActiveTab().selectedFiles.clear();
    getActiveTab().selectedFiles.add(newFileId);
    visibleRows[newIndex].classList.add('selected');
    visibleRows[newIndex].scrollIntoView({ block: 'nearest' });
    updateToolbarState();
}

async function navigateDown() {
    const visibleRows = Array.from(document.querySelectorAll('.file-row')).filter(r => r.style.display !== 'none');
    if (visibleRows.length === 0) return;
    
    let newIndex = 0;
    const selectedRows = getActiveTab().selectedFiles;
    
    if (selectedRows.size > 0) {
        const currentFileId = Array.from(selectedRows)[0];
        const currentIndex = visibleRows.findIndex(r => Number(r.dataset.id) === currentFileId);
        if (currentIndex !== -1 && currentIndex < visibleRows.length - 1) newIndex = currentIndex + 1;
        else if (currentIndex === visibleRows.length - 1) newIndex = currentIndex;
    }
    
    const newFileId = Number(visibleRows[newIndex].dataset.id);
    document.querySelectorAll('.file-row').forEach(r => r.classList.remove('selected'));
    getActiveTab().selectedFiles.clear();
    getActiveTab().selectedFiles.add(newFileId);
    visibleRows[newIndex].classList.add('selected');
    visibleRows[newIndex].scrollIntoView({ block: 'nearest' });
    updateToolbarState();
}

init();

// UI Helper
async function switchToTab(tabId) {
    if (!tabId || !tabsData.has(tabId)) return;
    
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tabId === tabId);
    });
    
    activeTabId = tabId;
    const tabState = getActiveTab();
    
    pathDisplay.value = tabState.currentPath;
    updateWindowContextTitle();
    
    // Sort logic update
    document.querySelectorAll('.sort-option').forEach(opt => {
        if(opt.querySelector('select')) return;
        opt.classList.remove('selected');
        if (opt.textContent.toLowerCase().includes(tabState.currentSortMode.toLowerCase())) {
            opt.classList.add('selected');
        }
    });

    updateNavigationButtons();
    await renderFileView();
}

function updateTabsUI() {
    const allTabs = document.querySelectorAll(".tab");
    allTabs.forEach(tab => {
        const closeBtn = tab.querySelector(".tab-close");
        if (closeBtn) {
            closeBtn.style.display = allTabs.length <= 1 ? "none" : "flex";
        }
    });
}

setTimeout(updateTabsUI, 50);

function getFileIcon(file) { // I don't like this system so TODO: add custom svg icons
    if (file.type === 'dir') return '📁';
    if (!file.name.includes('.')) return '❓';
    const ext = file.name.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg'].includes(ext)) return '🖼️';
    if (['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(ext)) return '▶️';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '🎧';
    if (['c', 'cpp', 'h', 'hpp'].includes(ext)) return ' C';
    if (['cs', 'csx'].includes(ext)) return 'C#';
    if (['py'].includes(ext)) return '🐍';
    if (['js', 'jsx'].includes(ext)) return 'JS';
    if (['ts', 'tsx'].includes(ext)) return 'TS';
    return '📄';
}

// Context menus
contextMenu.add('#file-view', (target) => {
    // Only show file-view context menu if clicked directly on file-view
    if (target.id !== 'file-view' && !target.classList.contains('empty-state')) return [];

    return [
        { label: 'New Folder', action: () => handleNewFolder() },
        { label: 'New File', action: () => handleNewFile() },
        { type: 'separator' },
        { label: 'Refresh', action: () => handleRefresh() },
        { label: 'Undo', action: () => handleUndo(), disabled: getActiveTab().undoStack.length === 0 },
        { label: 'Redo', action: () => handleRedo(), disabled: getActiveTab().redoStack.length === 0 },
        { type: 'separator' },
        { label: 'Paste', action: () => handlePaste(), disabled: clipboard.files.length === 0 }
    ];
});

contextMenu.add('.file-row', (target) => {
    const fileRow = target.closest('.file-row');
    if (!fileRow) return [];
    
    // Select the file if not already selected
    if (!fileRow.classList.contains('selected')) {
        const tab = getActiveTab();
        document.querySelectorAll('.file-row').forEach(r => r.classList.remove('selected'));
        tab.selectedFiles.clear();
        tab.selectedFiles.add(Number(fileRow.dataset.id));
        fileRow.classList.add('selected');
        updateToolbarState();
    }

    return [
        { label: 'Open', action: () => handleOpenFile() },
        { label: 'Open with Text Editor', action: () => {
            const fileName = fileRow.querySelector('.file-name')?.textContent;
            if (fileName && window.parent && window.parent.openApp) {
                const tab = getActiveTab();
                const fullPath = `${tab.currentPath === '/' ? '' : tab.currentPath}/${fileName}`;
                window.parent.openApp('text-editor', { file: fullPath });
            }
        } },
        { type: 'separator' },
        { label: 'Cut', action: () => handleCut() },
        { label: 'Copy', action: () => handleCopy() },
        { type: 'separator' },
        { label: 'Delete', action: () => handleDelete() }
    ];
});
