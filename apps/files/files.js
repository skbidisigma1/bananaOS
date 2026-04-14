import { db, readDir, resolvePath, mkdir, writeFile, initFS } from '../../js/db.js';

// App state
let tabsData = new Map();
let activeTabId = null;

function getActiveTab() {
    return tabsData.get(activeTabId);
}

let clipboard = { files: [], operation: null };

// DOM Elements
const fileView = document.getElementById('file-view');
const pathDisplay = document.getElementById('path-display');
const backButton = document.getElementById('back-button');
const forwardButton = document.getElementById('forward-button');
const upButton = document.getElementById('up-button');
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
const tabs = document.getElementById('tabs');

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
        currentSortMode: 'name'
    });
    return tabId;
}

// Initialize app
async function init() {
    await initFS();
    const startPath = await getDefaultPath();
    
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
            const targetPath = label === 'Downloads' ? '/home/user/Downloads' : '/home/user/Pictures';
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
            const allTabs = document.querySelectorAll('.tab');
            if (allTabs.length > 1) {
                const tab = closeBtn.closest('.tab');
                const idToRemove = tab.dataset.tabId;
                
                let nextActive = null;
                if (tab.classList.contains('active')) {
                    const nextTab = tab.nextElementSibling?.classList.contains('tab') ? tab.nextElementSibling : tab.previousElementSibling;
                    if (nextTab) {
                        nextActive = nextTab.dataset.tabId;
                    }
                }
                
                tabsData.delete(idToRemove);
                tab.remove();
                updateTabsUI();
                
                if (nextActive) {
                    await switchToTab(nextActive);
                }
            }
        } else if (newTabBtn) {
            e.stopPropagation();
            const startPath = await getDefaultPath();
            const newTabId = createTab(startPath);
            const newTab = document.querySelector('.tab').cloneNode(true);
            newTab.dataset.tabId = newTabId;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            newTab.classList.add('active');
            newTab.querySelector('.tab-label').textContent = 'Loading...'; 
            tabs.insertBefore(newTab, newTabBtn);
            updateTabsUI();
            await switchToTab(newTabId);
            await navigateTo(startPath);
        } else if (tabEl) {
            await switchToTab(tabEl.dataset.tabId);
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
            const children = await readDir(getActiveTab().currentNode);
            if (children.some(c => c.name === name)) {
                let attempts = 1;
                while (children.some(c => c.name === `${name} (${attempts})`)) {
                    attempts++;
                }
                name = `${name} (${attempts})`;
            }
            await mkdir(getActiveTab().currentNode, name);
            await renderFileView();
            document.getElementById('new-folder-modal').classList.add('hidden');
        }
    });

    document.getElementById('cancel-new-file').addEventListener('click', () => {
        document.getElementById('new-file-modal').classList.add('hidden');
    });
    
    document.getElementById('confirm-new-file').addEventListener('click', async () => {
        const input = document.querySelector('#new-file-modal input[name="file-name"]');
        let name = input.value.trim();
        if (name) {
            const children = await readDir(getActiveTab().currentNode);
            if (children.some(c => c.name === name)) {
                const dotIndex = name.lastIndexOf('.');
                let base = name;
                let ext = '';
                if(dotIndex !== -1 && dotIndex !== 0) {
                     base = name.substring(0, dotIndex);
                     ext = name.substring(dotIndex);
                }
                
                let attempts = 1;
                while(children.some(c => c.name === `${base} (${attempts})${ext}`)) {
                    attempts++;
                }
                name = `${base} (${attempts})${ext}`;
            }
            
            await writeFile(getActiveTab().currentNode, name, '', 'text/plain');
            await renderFileView();
            document.getElementById('new-file-modal').classList.add('hidden');
        }
    });
    
    document.getElementById('upload-file').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const contentConfig = { size: file.size };
            await writeFile(getActiveTab().currentNode, file.name, contentConfig, file.type || 'application/octet-stream');
            await renderFileView();
            document.getElementById('new-file-modal').classList.add('hidden');
        };
        input.click();
    });

    document.querySelector('#search-menu input').addEventListener('input', applyFilters);
    document.querySelector('#filter-menu select').addEventListener('change', applyFilters);
    document.querySelector('.filter-other input').addEventListener('input', applyFilters);
}

function applyFilters() {
    const searchQuery = document.querySelector('#search-menu input').value.toLowerCase();
    const filterType = document.querySelector('#filter-menu select').value;
    const filterCustom = document.querySelector('.filter-other input').value.toLowerCase();

    document.querySelectorAll('.file-row').forEach(row => {
        const name = row.querySelector('.file-name').textContent;
        const lowerName = name.toLowerCase();
        const icon = row.querySelector('.file-icon').textContent;
        const isFolder = icon === '📁';
        
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

        row.style.display = match ? '' : 'none';
    });
}

// Navigation history
async function navigateTo(path, pushHistory = true) {
    try {
        const node = await resolvePath(path);
        if (!node) {
            if (path.startsWith('/home/user/')) {
                let currentId = (await resolvePath('/home/user')).id;
                const part = path.replace('/home/user/', '');
                await mkdir(currentId, part);
            }
        }
        
        const finalNode = await resolvePath(path);
        if(!finalNode) return;
        
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
        
        if (files.length === 0) {
            fileView.innerHTML = '<div style="padding: 1rem; color: var(--color-subtle-text);">This folder is empty</div>';
            return;
        }
        
        files.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            if (getActiveTab().currentSortMode === 'name') return a.name.localeCompare(b.name);
            if (getActiveTab().currentSortMode === 'size') return (a.size || 0) - (b.size || 0);
            if (getActiveTab().currentSortMode === 'date') return (b.modified || 0) - (a.modified || 0);
            return 0;
        });
        
        for (const file of files) {
            const row = document.createElement('div');
            row.className = 'file-row';
            if (getActiveTab().selectedFiles.has(file.id)) row.classList.add('selected');
            
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
                if (!e.ctrlKey && !e.metaKey) {
                    document.querySelectorAll('.file-row').forEach(r => r.classList.remove('selected'));
                    getActiveTab().selectedFiles.clear();
                }
                if (getActiveTab().selectedFiles.has(file.id)) {
                    getActiveTab().selectedFiles.delete(file.id);
                    row.classList.remove('selected');
                } else {
                    getActiveTab().selectedFiles.add(file.id);
                    row.classList.add('selected');
                }
                updateToolbarState();
            });
            
            row.addEventListener('dblclick', async () => {
                if (file.type === 'dir') {
                    await navigateTo(`${getActiveTab().currentPath === '/' ? '' : getActiveTab().currentPath}/${file.name}`);
                }
            });
            
            fileView.appendChild(row);
        }
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
    if (!sourceNode) return;

    let newName = sourceNode.name;
    if (isRoot) newName += ' (copy)';
    
    // Check if name exists
    const children = await readDir(targetParentId);
    if (children.some(c => c.name === newName)) {
         newName += `_${Date.now()}`;
    }

    const newDirNode = await mkdir(targetParentId, newName);
    
    const sourceChildren = await readDir(sourceId);
    for (const child of sourceChildren) {
        if (child.type === 'dir') {
            await copyDirectoryRecursive(child.id, newDirNode.id);
        } else {
            const data = await db.fs_data.get({nodeId: child.id});
            await writeFile(newDirNode.id, child.name, data?.data || '', child.mime);
        }
    }
}

async function handlePaste() {
    if (clipboard.files.length === 0) return;
    for (const fileId of clipboard.files) {
        const file = await db.fs_nodes.get(fileId);
        if (file) {
            if (clipboard.operation === 'cut') {
                await db.fs_nodes.update(fileId, { parentId: getActiveTab().currentNode });
            } else if (clipboard.operation === 'copy') {
                if (file.type === 'dir') {
                    await copyDirectoryRecursive(fileId, getActiveTab().currentNode, true);
                } else {
                    const data = await db.fs_data.get({nodeId: fileId});
                    let newName = file.name;
                    
                    const children = await readDir(getActiveTab().currentNode);
                    if(children.some(c => c.name === newName)) {
                        const dotIndex = newName.lastIndexOf('.');
                        if (dotIndex !== -1 && dotIndex !== 0) {
                            const nameBase = newName.substring(0, dotIndex);
                            const ext = newName.substring(dotIndex);
                            newName = `${nameBase} (copy)${ext}`;
                        } else {
                            newName = `${newName} (copy)`;
                        }
                    }
                    
                    let attempts = 1;
                    let finalName = newName;
                    while(children.some(c => c.name === finalName)) {
                        finalName = newName.replace('(copy)', `(copy ${attempts})`);
                        attempts++;
                    }

                    await writeFile(getActiveTab().currentNode, finalName, data?.data || '', file.mime);
                }
            }
        }
    }
    if (clipboard.operation === 'cut') {
        clipboard = { files: [], operation: null };
    }
    await renderFileView();
    updateToolbarState();
}

async function handleDelete() {
    if (getActiveTab().selectedFiles.size === 0) return;
    for (const fileId of getActiveTab().selectedFiles) {
        await db.fs_nodes.delete(fileId);
        await db.fs_data.where({nodeId: fileId}).delete();
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



function getFileIcon(file) {
    if (file.type === 'dir') return '📁';
    if (!file.name.includes('.')) return '❓';
    const ext = file.name.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️';
    if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'md'].includes(ext)) return '📄';
    if (['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(ext)) return '▶️';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '🎧';
    return '❓';
}
