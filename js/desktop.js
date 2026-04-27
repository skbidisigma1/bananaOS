// desktop.js - Way too much stuff
import { db, isSetupComplete, initFS, resolvePath, writeFile, readDir, mkdir } from './db.js';
import { contextMenu } from './rightClick.js';

// Check if setup is complete before loading desktop
async function checkSetup() {
    const setupComplete = await isSetupComplete();
    if (!setupComplete) {
        // Redirect to setup page if not set up
        window.location.replace('./setup');
    } else {
        // Run any FS initialization guarantees needed
        await initFS();
        await initializeDesktop();
        // Unhide body since setup is complete
        document.body.classList.remove('hidden');
    }
}
checkSetup();

// Element references
const clockTime = document.getElementById('clock-time');
const clockDate = document.getElementById('clock-date');
const getWindows = () => document.querySelectorAll('.window');
const container = document.getElementById('window-container');
const minimizedMenu = document.getElementById('minimized-menu');
const desktopGrid = document.getElementById('desktop-grid');
let minimizedMenuAnchorIcon = null;
let activeMinimizedMenuAppId = null;
let appsRegistry = [];
let desktopDirNode = null;
let desktopLayout = { positions: {} };
let desktopSignature = '';
let desktopWatchTimer = null;
let desktopRefreshInFlight = false;

const SHORTCUT_MIME = 'application/x-bananaos-shortcut+json';
const DESKTOP_LAYOUT_PATH = '/home/user/config/desktop-layout.json';
const DESKTOP_DIR_PATH = '/home/user/Desktop';

if (minimizedMenu) {
    minimizedMenu.innerHTML = '';
}

function showDesktopError(message) {
    console.error(message);
    window.alert(message);
}

function getInstalledAppsForShortcuts() {
    if (appsRegistry.length > 0) {
        return appsRegistry.filter(app => app.id !== 'start-menu');
    }

    return [
        { id: 'welcome', name: 'Welcome' },
        { id: 'settings', name: 'Settings' },
        { id: 'files', name: 'Files' },
        { id: 'terminal', name: 'Terminal' },
        { id: 'text-editor', name: 'Text Editor' },
        { id: 'photos', name: 'Photos' }
    ];
}

function getLayoutKeyForNode(nodeId) {
    return `node:${nodeId}`;
}

function isShortcutFileName(name) {
    return /\.shortcut(\.json)?$/i.test(name || '');
}

function stripShortcutSuffix(name) {
    return (name || '').replace(/\.shortcut(\.json)?$/i, '').trim() || name;
}

function isImageFileName(name) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || '');
}

function isTextFileName(name) {
    return /\.(txt|md|json|js|ts|css|html?|xml|csv|log|ini|yaml|yml)$/i.test(name || '');
}

function getDesktopItemGlyph(node, shortcutData = null) {
    if (node.type === 'dir') return '📁';
    if (shortcutData) return '🔗';
    if (isImageFileName(node.name)) return '🖼️';
    return '📄';
}

function buildUniqueName(existingNames, requestedName) {
    const trimmed = (requestedName || '').trim();
    if (!trimmed) return null;

    if (!existingNames.has(trimmed)) return trimmed;

    const dotIndex = trimmed.lastIndexOf('.');
    const hasExtension = dotIndex > 0;
    const base = hasExtension ? trimmed.slice(0, dotIndex) : trimmed;
    const ext = hasExtension ? trimmed.slice(dotIndex) : '';

    let attempt = 1;
    let candidate = `${base} (${attempt})${ext}`;
    while (existingNames.has(candidate)) {
        attempt++;
        candidate = `${base} (${attempt})${ext}`;
    }
    return candidate;
}

function snapToGrid(rawX, rawY) {
    let snapX = Math.round((rawX - GRID_PADDING) / GRID_SIZE_X) * GRID_SIZE_X + GRID_PADDING;
    let snapY = Math.round((rawY - GRID_PADDING) / GRID_SIZE_Y) * GRID_SIZE_Y + GRID_PADDING;

    const maxX = Math.max(0, container.clientWidth - 60);
    const maxY = Math.max(0, container.clientHeight - 70);

    snapX = Math.max(0, Math.min(snapX, maxX));
    snapY = Math.max(0, Math.min(snapY, maxY));

    return { left: snapX, top: snapY };
}

function gridCellKey(left, top) {
    const col = Math.round((left - GRID_PADDING) / GRID_SIZE_X);
    const row = Math.round((top - GRID_PADDING) / GRID_SIZE_Y);
    return `${col}:${row}`;
}

function getDefaultDesktopPosition(index, occupiedCells) {
    const usableHeight = Math.max(1, container.clientHeight - (GRID_PADDING * 2));
    const rowsPerColumn = Math.max(1, Math.floor(usableHeight / GRID_SIZE_Y));

    let probe = index;
    while (probe < 2000) {
        const col = Math.floor(probe / rowsPerColumn);
        const row = probe % rowsPerColumn;
        const rawLeft = GRID_PADDING + (col * GRID_SIZE_X);
        const rawTop = GRID_PADDING + (row * GRID_SIZE_Y);
        const snapped = snapToGrid(rawLeft, rawTop);
        const cell = gridCellKey(snapped.left, snapped.top);
        if (!occupiedCells.has(cell)) {
            return snapped;
        }
        probe++;
    }

    return snapToGrid(GRID_PADDING, GRID_PADDING);
}

async function ensureDesktopDirectoryNode() {
    desktopDirNode = await resolvePath(DESKTOP_DIR_PATH);
    return desktopDirNode;
}

async function readFileTextFromNode(node) {
    if (!node || node.type !== 'file') return null;

    const dataEntry = await db.fs_data.where({ nodeId: node.id }).first();
    if (!dataEntry) return null;

    const rawData = dataEntry.data;
    if (typeof rawData === 'string') return rawData;
    if (rawData instanceof Blob) return await rawData.text();
    if (rawData instanceof ArrayBuffer) return new TextDecoder().decode(rawData);
    if (rawData instanceof Uint8Array) return new TextDecoder().decode(rawData);
    return null;
}

async function readShortcutData(node) {
    if (!node || node.type !== 'file') return null;
    if (node.mime !== SHORTCUT_MIME && !isShortcutFileName(node.name)) return null;

    try {
        const text = await readFileTextFromNode(node);
        if (!text) return null;
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!parsed.appId || typeof parsed.appId !== 'string') return null;
        return parsed;
    } catch {
        return null;
    }
}

async function getNodeAbsolutePath(nodeId) {
    const parts = [];
    let current = await db.fs_nodes.get(nodeId);

    while (current && current.parentId !== 0) {
        if (current.name) parts.unshift(current.name);
        current = await db.fs_nodes.get(current.parentId);
    }

    return `/${parts.join('/')}`;
}

function getDesktopNodesSignature(nodes) {
    return nodes
        .map(node => `${node.id}:${node.name}:${node.type}:${node.modified || 0}:${node.size || 0}`)
        .sort()
        .join('|');
}

async function loadDesktopLayout() {
    try {
        const node = await resolvePath(DESKTOP_LAYOUT_PATH);
        if (!node) {
            desktopLayout = { positions: {} };
            return;
        }

        const text = await readFileTextFromNode(node);
        if (!text) {
            desktopLayout = { positions: {} };
            return;
        }

        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') {
            desktopLayout = { positions: {} };
            return;
        }

        desktopLayout = {
            positions: typeof parsed.positions === 'object' && parsed.positions !== null ? parsed.positions : {}
        };
    } catch (error) {
        console.warn('Failed to load desktop layout, using defaults:', error);
        desktopLayout = { positions: {} };
    }
}

async function saveDesktopLayout() {
    try {
        let configDir = await resolvePath('/home/user/config');
        if (!configDir) {
            const userDir = await resolvePath('/home/user');
            if (!userDir) return;
            await mkdir(userDir.id, 'config');
            configDir = await resolvePath('/home/user/config');
            if (!configDir) return;
        }

        await writeFile(
            configDir.id,
            'desktop-layout.json',
            JSON.stringify(desktopLayout, null, 2),
            'application/json'
        );
    } catch (error) {
        console.warn('Failed to save desktop layout:', error);
    }
}

async function setDesktopIconPosition(iconEl, left, top, persist = true) {
    if (!iconEl) return;

    const snapped = snapToGrid(left, top);
    iconEl.style.left = `${snapped.left}px`;
    iconEl.style.top = `${snapped.top}px`;
    iconEl.style.position = 'absolute';

    const nodeId = Number(iconEl.dataset.nodeId);
    if (!Number.isFinite(nodeId)) return;

    desktopLayout.positions[getLayoutKeyForNode(nodeId)] = {
        left: snapped.left,
        top: snapped.top
    };

    if (persist) {
        await saveDesktopLayout();
    }
}

async function openDesktopNode(nodeId) {
    const node = await db.fs_nodes.get(nodeId);
    if (!node) return;

    if (node.type === 'dir') {
        const path = await getNodeAbsolutePath(node.id);
        openApp('files', { path });
        return;
    }

    const shortcutData = await readShortcutData(node);
    if (shortcutData?.appId) {
        openApp(shortcutData.appId);
        return;
    }

    const path = await getNodeAbsolutePath(node.id);
    if (isImageFileName(node.name)) {
        openApp('photos', { image: path });
    } else {
        openApp('text-editor', { file: path });
    }
}

async function renameDesktopNode(nodeId) {
    try {
        const node = await db.fs_nodes.get(nodeId);
        if (!node) return;

        const requestedName = window.prompt('Rename item:', node.name);
        if (requestedName === null) return;

        const trimmed = requestedName.trim();
        if (!trimmed || trimmed === node.name) return;

        if (/[<>:"/\\|?*]/.test(trimmed)) {
            showDesktopError(`Invalid characters in name: ${trimmed}`);
            return;
        }

        const siblings = await readDir(node.parentId);
        if (siblings.some(sibling => sibling.id !== node.id && sibling.name === trimmed)) {
            showDesktopError(`An item named '${trimmed}' already exists.`);
            return;
        }

        await db.fs_nodes.update(node.id, { name: trimmed, modified: Date.now() });
        await refreshDesktopIcons(true);
    } catch (error) {
        showDesktopError(`Failed to rename item: ${error.message}`);
    }
}

async function deleteNodeRecursive(nodeId) {
    const children = await db.fs_nodes.where({ parentId: nodeId }).toArray();
    for (const child of children) {
        await deleteNodeRecursive(child.id);
    }

    await db.fs_data.where({ nodeId }).delete();
    await db.fs_nodes.delete(nodeId);
}

async function deleteDesktopNode(nodeId) {
    try {
        const node = await db.fs_nodes.get(nodeId);
        if (!node) return;

        const displayName = node.type === 'dir' ? node.name : stripShortcutSuffix(node.name);
        const confirmed = window.confirm(`Delete '${displayName}'?`);
        if (!confirmed) return;

        await deleteNodeRecursive(node.id);
        delete desktopLayout.positions[getLayoutKeyForNode(node.id)];
        await saveDesktopLayout();
        await refreshDesktopIcons(true);
    } catch (error) {
        showDesktopError(`Failed to delete item: ${error.message}`);
    }
}

async function createDesktopFile() {
    try {
        if (!desktopDirNode) return;

        const requestedName = window.prompt('New file name:', 'New File.txt');
        if (requestedName === null) return;

        const trimmed = requestedName.trim();
        if (!trimmed) return;

        const entries = await readDir(desktopDirNode.id);
        const existingNames = new Set(entries.map(entry => entry.name));
        const finalName = buildUniqueName(existingNames, trimmed);
        if (!finalName) return;

        await writeFile(desktopDirNode.id, finalName, '', 'text/plain');
        await refreshDesktopIcons(true);
    } catch (error) {
        showDesktopError(`Failed to create file: ${error.message}`);
    }
}

async function createDesktopFolder() {
    try {
        if (!desktopDirNode) return;

        const requestedName = window.prompt('New folder name:', 'New Folder');
        if (requestedName === null) return;

        const trimmed = requestedName.trim();
        if (!trimmed) return;

        const entries = await readDir(desktopDirNode.id);
        const existingNames = new Set(entries.map(entry => entry.name));
        const finalName = buildUniqueName(existingNames, trimmed);
        if (!finalName) return;

        await mkdir(desktopDirNode.id, finalName);
        await refreshDesktopIcons(true);
    } catch (error) {
        showDesktopError(`Failed to create folder: ${error.message}`);
    }
}

async function createDesktopShortcut() {
    try {
        if (!desktopDirNode) return;

        const apps = getInstalledAppsForShortcuts();
        if (apps.length === 0) {
            showDesktopError('No installed apps available for shortcuts.');
            return;
        }

        const appPrompt = apps.map(app => `${app.id} (${app.name})`).join(', ');
        const requestedApp = window.prompt(`Enter app id for shortcut:\n${appPrompt}`, apps[0].id);
        if (requestedApp === null) return;

        const appId = requestedApp.trim();
        if (!appId) return;

        const app = apps.find(candidate => candidate.id.toLowerCase() === appId.toLowerCase());
        if (!app) {
            showDesktopError(`Unknown app id: ${appId}`);
            return;
        }

        const requestedName = `${app.name}.shortcut`;
        const entries = await readDir(desktopDirNode.id);
        const existingNames = new Set(entries.map(entry => entry.name));
        const finalName = buildUniqueName(existingNames, requestedName);
        if (!finalName) return;

        await writeFile(
            desktopDirNode.id,
            finalName,
            JSON.stringify({ type: 'app-shortcut', appId: app.id }, null, 2),
            SHORTCUT_MIME
        );

        await refreshDesktopIcons(true);
    } catch (error) {
        showDesktopError(`Failed to create shortcut: ${error.message}`);
    }
}

function openDisplaySettings() {
    openApp('settings', { section: 'appearance' });
}

async function renderDesktopIcons(nodes) {
    if (!desktopGrid) return;

    desktopGrid.innerHTML = '';
    const occupiedCells = new Set();
    const sortedNodes = [...nodes].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    for (let index = 0; index < sortedNodes.length; index++) {
        const node = sortedNodes[index];
        const shortcutData = await readShortcutData(node);
        const displayName = shortcutData ? stripShortcutSuffix(node.name) : node.name;
        const glyph = getDesktopItemGlyph(node, shortcutData);

        const icon = document.createElement('div');
        icon.className = 'desktop-icon';
        icon.dataset.nodeId = String(node.id);
        icon.dataset.nodeType = node.type;
        if (shortcutData?.appId) {
            icon.dataset.shortcutAppId = shortcutData.appId;
        }
        icon.title = displayName;

        const glyphEl = document.createElement('div');
        glyphEl.className = 'desktop-icon-glyph';
        glyphEl.textContent = glyph;

        const labelEl = document.createElement('span');
        labelEl.className = 'desktop-icon-label';
        labelEl.textContent = displayName;

        icon.appendChild(glyphEl);
        icon.appendChild(labelEl);
        desktopGrid.appendChild(icon);

        const layoutPos = desktopLayout.positions[getLayoutKeyForNode(node.id)];
        let chosenPosition = null;

        if (layoutPos && Number.isFinite(layoutPos.left) && Number.isFinite(layoutPos.top)) {
            const snapped = snapToGrid(layoutPos.left, layoutPos.top);
            const cell = gridCellKey(snapped.left, snapped.top);
            if (!occupiedCells.has(cell)) {
                chosenPosition = snapped;
            }
        }

        if (!chosenPosition) {
            chosenPosition = getDefaultDesktopPosition(index, occupiedCells);
            desktopLayout.positions[getLayoutKeyForNode(node.id)] = {
                left: chosenPosition.left,
                top: chosenPosition.top
            };
        }

        occupiedCells.add(gridCellKey(chosenPosition.left, chosenPosition.top));
        icon.style.position = 'absolute';
        icon.style.left = `${chosenPosition.left}px`;
        icon.style.top = `${chosenPosition.top}px`;
    }

    const validKeys = new Set(sortedNodes.map(node => getLayoutKeyForNode(node.id)));
    const beforeCleanupCount = Object.keys(desktopLayout.positions).length;
    Object.keys(desktopLayout.positions).forEach((key) => {
        if (!validKeys.has(key)) {
            delete desktopLayout.positions[key];
        }
    });

    if (Object.keys(desktopLayout.positions).length !== beforeCleanupCount) {
        await saveDesktopLayout();
    }
}

async function refreshDesktopIcons(force = false) {
    if (!desktopDirNode || desktopRefreshInFlight) return;

    desktopRefreshInFlight = true;
    try {
        const nodes = await readDir(desktopDirNode.id);
        const nextSignature = getDesktopNodesSignature(nodes);
        if (!force && nextSignature === desktopSignature) {
            return;
        }

        desktopSignature = nextSignature;
        await renderDesktopIcons(nodes);
    } finally {
        desktopRefreshInFlight = false;
    }
}

function startDesktopWatcher() {
    if (desktopWatchTimer) {
        clearInterval(desktopWatchTimer);
    }

    desktopWatchTimer = setInterval(() => {
        refreshDesktopIcons(false);
    }, 2500);

    window.addEventListener('focus', () => {
        refreshDesktopIcons(false);
    });
}

async function initializeDesktop() {
    if (!desktopGrid || !container) return;

    await ensureDesktopDirectoryNode();
    if (!desktopDirNode) return;

    await loadDesktopLayout();
    await refreshDesktopIcons(true);
    startDesktopWatcher();
}

function getTaskbarIcon(appId) {
    return document.querySelector(`.taskbar-app-icon[id="${appId}"]`);
}

function getWindowFromSource(sourceWindow) {
    if (!sourceWindow) return null;
    const frames = document.querySelectorAll('.window-content iframe');
    for (const frame of frames) {
        if (frame.contentWindow === sourceWindow) {
            return frame.closest('.window');
        }
    }
    return null;
}

function getAppName(appId) {
    const app = appsRegistry.find(entry => entry.id === appId);
    return app ? app.name : appId;
}

function getMinimizedWindows(appId) {
    return Array.from(document.querySelectorAll(`.window[data-app-id="${appId}"]`)).filter(win => {
        return win.dataset.minimized === 'true' || win.classList.contains('hidden');
    });
}

function getWindowContextLabel(win) {
    if (!win) return 'Window';

    const explicitTitle = (win.dataset.contextTitle || '').trim();
    if (explicitTitle) return explicitTitle;

    const fallbackTitle = (win.querySelector('.window-title')?.textContent || '').trim();
    const appName = getAppName(win.dataset.appId);
    const appPrefix = `${appName} - `;

    if (fallbackTitle.startsWith(appPrefix) && fallbackTitle.length > appPrefix.length) {
        return fallbackTitle.slice(appPrefix.length).trim();
    }

    return fallbackTitle || appName || 'Window';
}

function hideMinimizedMenu() {
    if (!minimizedMenu) return;
    minimizedMenu.classList.add('hidden');
    minimizedMenu.innerHTML = '';
    activeMinimizedMenuAppId = null;
    minimizedMenuAnchorIcon = null;
}

function positionMinimizedMenu(anchorIcon) {
    if (!minimizedMenu || minimizedMenu.classList.contains('hidden') || !anchorIcon) return;

    const footer = document.querySelector('footer');
    if (!footer) return;

    const iconRect = anchorIcon.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const menuWidth = minimizedMenu.offsetWidth;
    const centeredLeft = iconRect.left - footerRect.left + (iconRect.width / 2) - (menuWidth / 2);
    const maxLeft = Math.max(0, footerRect.width - menuWidth);
    const clampedLeft = Math.max(0, Math.min(centeredLeft, maxLeft));

    minimizedMenu.style.left = `${clampedLeft}px`;
}

function refreshMinimizedStateForApp(appId) {
    const icon = getTaskbarIcon(appId);
    if (!icon) return;

    const hasMinimizedWindows = getMinimizedWindows(appId).length > 0;
    icon.classList.toggle('minimized-app', hasMinimizedWindows);

    if (!hasMinimizedWindows && activeMinimizedMenuAppId === appId) {
        hideMinimizedMenu();
    }
}

function showMinimizedMenuForApp(appId, anchorIcon) {
    if (!minimizedMenu) return false;

    const minimizedWindows = getMinimizedWindows(appId);
    if (minimizedWindows.length === 0) {
        hideMinimizedMenu();
        return false;
    }

    minimizedMenu.innerHTML = '';
    minimizedWindows.forEach(win => {
        const item = document.createElement('div');
        item.className = 'minimized-menu-item';
        item.textContent = getWindowContextLabel(win);
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            restoreWindow(win);
            hideMinimizedMenu();
        });
        minimizedMenu.appendChild(item);
    });

    activeMinimizedMenuAppId = appId;
    minimizedMenuAnchorIcon = anchorIcon;
    minimizedMenu.classList.remove('hidden');
    positionMinimizedMenu(anchorIcon);
    return true;
}

function setWindowMinimized(win, minimized) {
    if (!win) return;

    win.dataset.minimized = minimized ? 'true' : 'false';
    win.classList.toggle('hidden', minimized);
    refreshMinimizedStateForApp(win.dataset.appId);

    if (activeMinimizedMenuAppId === win.dataset.appId) {
        const icon = minimizedMenuAnchorIcon || getTaskbarIcon(win.dataset.appId);
        if (icon && getMinimizedWindows(win.dataset.appId).length > 0) {
            showMinimizedMenuForApp(win.dataset.appId, icon);
        } else {
            hideMinimizedMenu();
        }
    }
}

function restoreWindow(win) {
    if (!win) return;
    setWindowMinimized(win, false);

    getWindows().forEach(w => w.style.zIndex = '500');
    win.style.zIndex = '1000';
}

function closeWindow(win) {
    if (!win) return;

    const appId = win.dataset.appId;
    win.remove();
    refreshMinimizedStateForApp(appId);

    if (activeMinimizedMenuAppId === appId) {
        const icon = minimizedMenuAnchorIcon || getTaskbarIcon(appId);
        if (icon && getMinimizedWindows(appId).length > 0) {
            showMinimizedMenuForApp(appId, icon);
        } else {
            hideMinimizedMenu();
        }
    }
}

function setWindowContextTitleFromSource(sourceWindow, contextTitle) {
    const win = getWindowFromSource(sourceWindow);
    if (!win) return;

    const normalizedTitle = typeof contextTitle === 'string' ? contextTitle.trim() : '';
    win.dataset.contextTitle = normalizedTitle || getAppName(win.dataset.appId);

    if (activeMinimizedMenuAppId === win.dataset.appId) {
        const icon = minimizedMenuAnchorIcon || getTaskbarIcon(win.dataset.appId);
        if (icon) {
            showMinimizedMenuForApp(win.dataset.appId, icon);
        }
    }
}

if (container) {
    const windowRemovalObserver = new MutationObserver((records) => {
        const affectedAppIds = new Set();
        for (const record of records) {
            record.removedNodes.forEach((node) => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;
                if (node.classList?.contains('window')) {
                    if (node.dataset?.appId) {
                        affectedAppIds.add(node.dataset.appId);
                    }
                    return;
                }
                node.querySelectorAll?.('.window').forEach((removedWindow) => {
                    if (removedWindow.dataset?.appId) {
                        affectedAppIds.add(removedWindow.dataset.appId);
                    }
                });
            });
        }

        affectedAppIds.forEach((appId) => {
            refreshMinimizedStateForApp(appId);
            if (activeMinimizedMenuAppId === appId) {
                const icon = minimizedMenuAnchorIcon || getTaskbarIcon(appId);
                if (icon && getMinimizedWindows(appId).length > 0) {
                    showMinimizedMenuForApp(appId, icon);
                } else {
                    hideMinimizedMenu();
                }
            }
        });
    });

    windowRemovalObserver.observe(container, { childList: true, subtree: true });
}

// Handle custom wallpaper broadcasts
window.updateWallpaper = async function(wallpaperUrl, style = 'cover') {
    const mainElement = document.querySelector('main');
    if (wallpaperUrl.startsWith('fs:')) {
        const fullPath = wallpaperUrl.replace('fs:', '');
        const node = await resolvePath(fullPath);
        if (node) {
            const fileData = await db.fs_data.where({ nodeId: node.id }).first();
            if (fileData) {
                const blob = fileData.data instanceof Blob ? fileData.data : new Blob([fileData.data]);
                const url = URL.createObjectURL(blob);
                mainElement.style.backgroundImage = `url('${url}')`;
            }
        }
    } else {
        mainElement.style.backgroundImage = `url('../assets/images/wallpaper/${wallpaperUrl}')`;
    }
    
    // Apply styling options
    mainElement.style.backgroundSize = style;
    mainElement.style.backgroundRepeat = 'no-repeat';
    if (style === 'auto' || style === 'contain') { // specific adjustments
        mainElement.style.backgroundPosition = 'center';
    } else {
        mainElement.style.backgroundPosition = 'center';
    }
};

// On load, apply saved wallpaper preferences
async function applyUserPreferences() {
    try {
        let config = null;
        try {
            const configNode = await resolvePath('/home/user/config/options.json');
            if (configNode) {
                const fileData = await db.fs_data.where({ nodeId: configNode.id }).first();
                if (fileData) {
                    config = JSON.parse(fileData.data);
                }
            }
        } catch (e) {
            console.warn('Error reading config, using defaults', e);
        }

        // Wallpaper Fallback logic
        const wallpaper = config?.wallpaper || 'wallpaper-1.jpg';
        const wallpaperStyle = config?.wallpaperStyle || 'cover';
        window.updateWallpaper(wallpaper, wallpaperStyle);

        // Apply visual preferences
        if (config?.accentColor) {
            document.documentElement.style.setProperty('--color-primary', config.accentColor);
        }
        if (config?.theme) {
            document.body.className = config?.theme === 'dark' ? 'dark-theme' : config?.theme === 'light' ? 'light-theme' : '';
        }
        
        // Expose timezone for clock
        window.OS_TIMEZONE = config?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    } catch(e) {}
}
// Ensure it applies once setup/DB is good
isSetupComplete().then(complete => { if (complete) applyUserPreferences(); });

// Update clock every second
setInterval(function() {
    const now = new Date();
    
    // Configure timezone if available, and drop leading zeros on hours
    const timeOptions = { hour: 'numeric', minute: '2-digit' };
    const dateOptions = {};
    
    if (window.OS_TIMEZONE) {
        try {
            timeOptions.timeZone = window.OS_TIMEZONE;
            dateOptions.timeZone = window.OS_TIMEZONE;
        } catch (e) {
            // Fallback to local user time if the timezone is invalid in options
            console.warn('Invalid OS Timezone:', window.OS_TIMEZONE);
        }
    }

    clockTime.textContent = now.toLocaleTimeString('en-US', timeOptions);
    clockDate.textContent = now.toLocaleDateString('en-US', dateOptions);
}, 1000);

// Variables for dragging and resizing
let activeWindow = null;
let offsetX = 0;
let offsetY = 0;
let dragStartX = 0;
let dragStartY = 0;
let isResizing = false;
let currentResizer = null;
let draggingIcon = null;
let draggingSelectionBox = false;
let justCompletedSelectionBox = false;
let selectionBoxDragStarted = false;
let potentialDragIcon = null;
let initialMouseX = 0;
let initialMouseY = 0;
const GRID_PADDING = 16;
const GRID_SIZE_X = 76; // .desktop-icon width (60) + gap (16)
const GRID_SIZE_Y = 86; // .desktop-icon height (70) + gap (16)

// Helper function to save window sizes
function saveWindowSizes(win) {
    win.dataset.restoreWidth = `${win.offsetWidth}px`;
    win.dataset.restoreHeight = `${win.offsetHeight}px`;
    win.dataset.restoreLeft = `${win.offsetLeft}px`;
    win.dataset.restoreTop = `${win.offsetTop}px`;
}

// Helper function to restore window sizes
function restoreWindowSizes(win) {
    const defaultWidth = Math.min(800, window.innerWidth - 40);
    const defaultHeight = Math.min(500, window.innerHeight - 80);
    win.style.width = win.dataset.restoreWidth || `${defaultWidth}px`;
    win.style.height = win.dataset.restoreHeight || `${defaultHeight}px`;
    win.style.left = win.dataset.restoreLeft || '50px';
    win.style.top = win.dataset.restoreTop || '50px';
}

// Handle desktop icon drag pickup via event delegation
document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;

    const icon = e.target.closest('.desktop-icon');
    if (!icon) return;

    e.stopPropagation();
    potentialDragIcon = icon;
    initialMouseX = e.clientX;
    initialMouseY = e.clientY;

    const rect = icon.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
});

document.addEventListener('dblclick', async (e) => {
    const icon = e.target.closest('.desktop-icon');
    if (!icon) return;

    e.stopPropagation();
    const nodeId = Number(icon.dataset.nodeId);
    if (!Number.isFinite(nodeId)) return;
    await openDesktopNode(nodeId);
});

// Visually follow the mouse while dragging the icon
document.addEventListener('mousemove', (e) => {
    if (!draggingIcon && potentialDragIcon) {
        if (Math.abs(e.clientX - initialMouseX) > 2 || Math.abs(e.clientY - initialMouseY) > 2) {
            draggingIcon = potentialDragIcon;
            potentialDragIcon = null;
            draggingIcon.classList.add('dragging');
            draggingIcon.style.position = 'absolute';
        } else {
            return;
        }
    }

    if (!draggingIcon) return;

    const containerRect = container.getBoundingClientRect();

    let x = e.clientX - containerRect.left - offsetX;
    let y = e.clientY - containerRect.top - offsetY;

    draggingIcon.style.left = `${x}px`;
    draggingIcon.style.top = `${y}px`;
});

// Mouse up to snap icon to grid and stop dragging
document.addEventListener('mouseup', (e) => {
    if (!draggingIcon) return;

    const movedIcon = draggingIcon;

    const containerRect = container.getBoundingClientRect();

    const iconX = e.clientX - containerRect.left - offsetX;
    const iconY = e.clientY - containerRect.top - offsetY;

    // Snap to grid
    let snapX = Math.round((iconX - GRID_PADDING) / GRID_SIZE_X) * GRID_SIZE_X + GRID_PADDING;
    let snapY = Math.round((iconY - GRID_PADDING) / GRID_SIZE_Y) * GRID_SIZE_Y + GRID_PADDING;

    const maxX = container.clientWidth - draggingIcon.offsetWidth;
    const maxY = container.clientHeight - draggingIcon.offsetHeight;

    snapX = Math.max(0, Math.min(snapX, maxX));
    snapY = Math.max(0, Math.min(snapY, maxY));

    movedIcon.style.position = 'absolute';
    movedIcon.style.left = `${snapX}px`;
    movedIcon.style.top = `${snapY}px`;
    movedIcon.classList.remove('dragging');
    draggingIcon = null;

    setDesktopIconPosition(movedIcon, snapX, snapY).catch(error => {
        console.warn('Failed to persist desktop icon position:', error);
    });
});

// Handle mouse up to stop dragging
document.addEventListener('mouseup', () => {
    activeWindow = null;
    isResizing = false;
    currentResizer = null;
    potentialDragIcon = null;
    document.querySelectorAll('.window-content iframe').forEach(iframe => iframe.style.pointerEvents = 'auto');
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('#minimized-menu') && !e.target.closest('.taskbar-app-icon')) {
        hideMinimizedMenu();
    }

    // If clicking outside of any window, reset z-index of all windows
    if (!e.target.closest('.window')) {
        getWindows().forEach(win => win.style.zIndex = "500");
    }

    if (justCompletedSelectionBox) {
        justCompletedSelectionBox = false;
        return;
    }

    // If clicking after a desktop icon is selected, remove the "selected" state from all icons
    if (e.target.closest('.desktop-icon')) {
        document.querySelectorAll('.desktop-icon').forEach(icon => icon.classList.remove('selected'));
        e.target.closest('.desktop-icon').classList.add('selected');
    } else {
        if (!draggingSelectionBox) {
            document.querySelectorAll('.desktop-icon').forEach(icon => icon.classList.remove('selected'));
        }
    }
});

// When mouse dragged across desktop, show selection box and select icons within it
let selectionBox = null;

document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.window') || e.target.closest('.desktop-icon') || e.target.closest('footer')) {
        return;
    }

    draggingSelectionBox = true;
    selectionBoxDragStarted = false;

    const startX = e.clientX;
    const startY = e.clientY;

    const handleMouseMove = (moveEvent) => {
        const width = moveEvent.clientX - startX;
        const height = moveEvent.clientY - startY;

        if (!selectionBox) {
            if (Math.abs(width) < 5 && Math.abs(height) < 5) {
                return;
            }
            selectionBox = document.createElement('div');
            selectionBox.id = 'selection-box';
            container.appendChild(selectionBox);
            selectionBoxDragStarted = true;
        }

        selectionBox.style.left = `${Math.min(startX, moveEvent.clientX)}px`;
        selectionBox.style.top = `${Math.min(startY, moveEvent.clientY)}px`;
        selectionBox.style.width = `${Math.abs(width)}px`;
        selectionBox.style.height = `${Math.abs(height)}px`;
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        if (selectionBox) {
            document.querySelectorAll('.desktop-icon').forEach(icon => {
                const iconRect = icon.getBoundingClientRect();
                const boxRect = selectionBox.getBoundingClientRect();

                if (
                    iconRect.left < boxRect.right &&
                    iconRect.right > boxRect.left &&
                    iconRect.top < boxRect.bottom &&
                    iconRect.bottom > boxRect.top
                ) {
                    icon.classList.add('selected');
                }
            });

            container.removeChild(selectionBox);
            selectionBox = null;
        }

        draggingSelectionBox = false;
        justCompletedSelectionBox = selectionBoxDragStarted;
        selectionBoxDragStarted = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
});

// Initialize windows
getWindows().forEach(win => {
    const header = win.querySelector('.window-header');

    // Fallback if window is missing header
    if (!header) {
        console.error('Window is missing header:', win);
        return;
    }

    // Bring window to front when clicked
    win.onmousedown = () => {
        win.style.zIndex = "1000";
    }

    // Enable dragging when header is clicked
    header.onmousedown = (e) => {
        activeWindow = win;
        offsetX = e.clientX - win.offsetLeft;
        offsetY = e.clientY - win.offsetTop;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        isResizing = false;

        getWindows().forEach(w => w.style.zIndex = "500");
        win.style.zIndex = "1000";
        document.querySelectorAll('.window-content iframe').forEach(iframe => iframe.style.pointerEvents = 'none');
    }

    // Enable resizing
    const resizers = win.querySelectorAll('.resizer');
    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', function(e) {
            e.preventDefault();
            isResizing = true;
            currentResizer = resizer;
            activeWindow = win;
            getWindows().forEach(w => w.style.zIndex = "500");
            win.style.zIndex = "1000";
            document.querySelectorAll('.window-content iframe').forEach(iframe => iframe.style.pointerEvents = 'none');
        });
    });
});

// Clamp windows within the window-container when dragging
document.addEventListener('mousemove', (e) => {
    if (activeWindow && !isResizing) {
        // Calculate where the user is dragging the window
        let newX = e.clientX - offsetX;
        let newY = e.clientY - offsetY;

        // If window is maximized, restore it before dragging
        const windowContainerRect = container.getBoundingClientRect();
        const windowRect = activeWindow.getBoundingClientRect();
        const dragDeltaY = e.clientY - dragStartY;
        if (windowRect.width >= windowContainerRect.width && windowRect.height >= windowContainerRect.height && dragDeltaY > 10) {
            restoreWindowSizes(activeWindow);
        }

        // Clamp the window's position within the container
        const maxX = container.clientWidth - activeWindow.offsetWidth;
        const maxY = container.clientHeight - activeWindow.offsetHeight;

        const clampedX = Math.max(0, Math.min(newX, maxX));
        const clampedY = Math.max(0, Math.min(newY, maxY));

        // Apply the clamped position to the window
        activeWindow.style.left = `${clampedX}px`;
        activeWindow.style.top = `${clampedY}px`;
    } else if (activeWindow && isResizing) {
        handleResize(e);
    }
});

function handleResize(e) {
    const rect = container.getBoundingClientRect();
    const winRect = activeWindow.getBoundingClientRect();

    if (currentResizer.classList.contains('e')) {
        const newWidth = e.clientX - winRect.left;
        activeWindow.style.width = Math.max(200, Math.min(newWidth, container.clientWidth - activeWindow.offsetLeft)) + 'px';
    }

    if (currentResizer.classList.contains('w')) {
        const newWidth = winRect.right - e.clientX;
        if (e.clientX >= rect.left && newWidth > 200) {
            activeWindow.style.width = newWidth + 'px';
            activeWindow.style.left = e.clientX - rect.left + 'px';
        }
    }

    if (currentResizer.classList.contains('s')) {
        const newHeight = e.clientY - winRect.top;
        activeWindow.style.height = Math.max(100, Math.min(newHeight, container.clientHeight - activeWindow.offsetTop)) + 'px';
    }

    if (currentResizer.classList.contains('n')) {
        const newHeight = winRect.bottom - e.clientY;
        if (e.clientY >= rect.top && newHeight > 100) {
            activeWindow.style.height = newHeight + 'px';
            activeWindow.style.top = e.clientY - rect.top + 'px';
        }
    }

    if (currentResizer.classList.contains('se')) {
        const newWidth = e.clientX - winRect.left;
        const newHeight = e.clientY - winRect.top;
        activeWindow.style.width = Math.max(200, Math.min(newWidth, container.clientWidth - activeWindow.offsetLeft)) + 'px';
        activeWindow.style.height = Math.max(100, Math.min(newHeight, container.clientHeight - activeWindow.offsetTop)) + 'px';
    }

    if (currentResizer.classList.contains('sw')) {
        const newWidth = winRect.right - e.clientX;
        const newHeight = e.clientY - winRect.top;
        if (e.clientX >= rect.left && newWidth > 200) {
            activeWindow.style.width = newWidth + 'px';
            activeWindow.style.left = e.clientX - rect.left + 'px';
        }
        activeWindow.style.height = Math.max(100, Math.min(newHeight, container.clientHeight - activeWindow.offsetTop)) + 'px';
    }

    if (currentResizer.classList.contains('nw')) {
        const newWidth = winRect.right - e.clientX;
        const newHeight = winRect.bottom - e.clientY;
        if (e.clientX >= rect.left && newWidth > 200) {
            activeWindow.style.width = newWidth + 'px';
            activeWindow.style.left = e.clientX - rect.left + 'px';
        }
        if (e.clientY >= rect.top && newHeight > 100) {
            activeWindow.style.height = newHeight + 'px';
            activeWindow.style.top = e.clientY - rect.top + 'px';
        }
    }

    if (currentResizer.classList.contains('ne')) {
        const newWidth = e.clientX - winRect.left;
        const newHeight = winRect.bottom - e.clientY;
        activeWindow.style.width = Math.max(200, Math.min(newWidth, container.clientWidth - activeWindow.offsetLeft)) + 'px';
        if (e.clientY >= rect.top && newHeight > 100) {
            activeWindow.style.height = newHeight + 'px';
            activeWindow.style.top = e.clientY - rect.top + 'px';
        }
    }
}

// Ensure windows are within bounds on browser resize
window.addEventListener('resize', () => {
    getWindows().forEach(win => {
        const maxX = container.clientWidth - win.offsetWidth;
        const maxY = container.clientHeight - win.offsetHeight;

        if (win.offsetLeft > maxX) {
            win.style.left = `${Math.max(0, maxX)}px`;
        }
        if (win.offsetTop > maxY) {
            win.style.top = `${Math.max(0, maxY)}px`;
        }
    });

    if (!minimizedMenu.classList.contains('hidden') && minimizedMenuAnchorIcon) {
        positionMinimizedMenu(minimizedMenuAnchorIcon);
    }
});

// Maximize app when double-clicking header or clicking maximize button
getWindows().forEach(win => {
    const header = win.querySelector('.window-header');
    const fullscreenBtn = header.querySelector('.window-operations').querySelector('.window-fullscreen');

    if (header) {
        header.addEventListener('dblclick', () => {
            const windowContainerRect = document.getElementById('window-container').getBoundingClientRect();
            const windowRect = win.getBoundingClientRect();
            // If unmaximizing
            if (windowRect.width >= windowContainerRect.width && windowRect.height >= windowContainerRect.height) {
                restoreWindowSizes(win);
            } else {
                // If maximizing
                saveWindowSizes(win);
                win.style.width = `${windowContainerRect.width}px`;
                win.style.height = `${windowContainerRect.height}px`;
                win.style.top = `0px`;
                win.style.left = `0px`;
            }
        });
    }

    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            const windowContainerRect = document.getElementById('window-container').getBoundingClientRect();
            const windowRect = win.getBoundingClientRect();
            // If unmaximizing
            if (windowRect.width >= windowContainerRect.width && windowRect.height >= windowContainerRect.height) {
                restoreWindowSizes(win);
            } else {
                // If maximizing
                saveWindowSizes(win);
                win.style.width = `${windowContainerRect.width}px`;
                win.style.height = `${windowContainerRect.height}px`;
                win.style.top = `0px`;
                win.style.left = `0px`;
            }
        });
    }
});

// Fullscreen window when dragged to top of screen
let topSnapMouseUpHandler = null;

document.addEventListener('mousemove', (e) => {
    if (activeWindow && !isResizing) {
        const containerRect = container.getBoundingClientRect();
        const windowRect = activeWindow.getBoundingClientRect();
        const isNearTop = e.clientY - containerRect.top <= 2;

        if (isNearTop && !topSnapMouseUpHandler) {
            const draggedWindow = activeWindow;
            topSnapMouseUpHandler = () => {
                topSnapMouseUpHandler = null;
                if (!draggedWindow) return;

                const windowContainerRect = container.getBoundingClientRect();
                if (windowRect.width >= windowContainerRect.width && windowRect.height >= windowContainerRect.height) {
                    restoreWindowSizes(draggedWindow);
                } else {
                    saveWindowSizes(draggedWindow);
                    draggedWindow.style.width = `${windowContainerRect.width}px`;
                    draggedWindow.style.height = `${windowContainerRect.height}px`;
                    draggedWindow.style.top = `0px`;
                    draggedWindow.style.left = `0px`;
                }
            };

            document.addEventListener('mouseup', topSnapMouseUpHandler, { once: true });
        }

        if (!isNearTop && topSnapMouseUpHandler) {
            document.removeEventListener('mouseup', topSnapMouseUpHandler);
            topSnapMouseUpHandler = null;
        }
    }
});

// Close windows when close button is clicked
getWindows().forEach(win => {
    const closeBtn = win.querySelector('.window-operations').querySelector('.window-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeWindow(win);
        });
    }
});

// Close windows when buttons with data-action="close" are clicked
getWindows().forEach(win => {
    const closeButtons = win.querySelectorAll('[data-action="close"]');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            closeWindow(win);
        });
    });
});


// Load app registry
fetch('./data/apps.json')
    .then(res => res.json())
    .then(data => {
        appsRegistry = data.apps;
    });

window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'WINDOW_CONTEXT_TITLE') {
        setWindowContextTitleFromSource(e.source, e.data.contextTitle || e.data.title || '');
    }

    if (e.data && e.data.type === 'CLOSE_WINDOW') {
        const frames = document.querySelectorAll('iframe');
        let matched = false;
        frames.forEach(f => {
            if (f.contentWindow === e.source) {
                closeWindow(f.closest('.window'));
                matched = true;
            }
        });
        if (!matched && e.data.appId) {
            const win = document.querySelector(`.window[data-app-id="${e.data.appId}"]`);
            if (win) closeWindow(win);
        }
    }
    if (e.data && e.data.type === 'FILE_PICKED') {
        const frames = document.querySelectorAll('iframe');
        frames.forEach(f => {
            if (f.contentWindow !== e.source) {
                f.contentWindow.postMessage(e.data, '*');
            }
        });
    }
});

function openApp(appId, queryParams = {}) {
    const queryString = new URLSearchParams(queryParams).toString();
    const queryAppend = queryString ? `?${queryString}` : '';
    const instanceId = queryString ? `${appId}-${queryString}` : appId;

    const existingWin = document.querySelector(`.window[data-instance-id="${instanceId}"]`);
    if (existingWin) {
        getWindows().forEach(w => w.style.zIndex = "500");
        existingWin.style.zIndex = "1000";
    }

    const app = appsRegistry.find(a => a.id === appId);
    if (!app) {
        console.error("App " + appId + " not found!");
        return;
    }

    const currentWindowsCount = getWindows().length;
    const offset = (currentWindowsCount % 10) * 30; // Cascade down and right

    const startWidth = Math.min(800, window.innerWidth - 40);
    const startHeight = Math.min(500, window.innerHeight - 80);
    const startLeft = Math.max(0, Math.min(50 + offset, window.innerWidth - startWidth));
    const startTop = Math.max(0, Math.min(50 + offset, window.innerHeight - startHeight));

    const win = document.createElement('div');
    win.className = 'window';
    win.dataset.appId = app.id;
    win.dataset.instanceId = instanceId;
    win.dataset.minimized = 'false';
    win.style.width = `${startWidth}px`;
    win.style.height = `${startHeight}px`;
    win.style.left = `${startLeft}px`;
    win.style.top = `${startTop}px`;
    win.style.zIndex = "1000";
    getWindows().forEach(w => w.style.zIndex = "500");
    
    // Save these initial dimensions as restore sizes
    win.dataset.restoreWidth = win.style.width;
    win.dataset.restoreHeight = win.style.height;
    win.dataset.restoreLeft = win.style.left;
    win.dataset.restoreTop = win.style.top;

    // HTML for resizers and window
    // This is safe right? Prolly
    let resizersHtml = '';
    if (app.resizable !== false) {
        resizersHtml = `
            <div class="resizer n"></div>
            <div class="resizer e"></div>
            <div class="resizer s"></div>
            <div class="resizer w"></div>
            <div class="resizer ne"></div>
            <div class="resizer se"></div>
            <div class="resizer sw"></div>
            <div class="resizer nw"></div>
        `;
    }

    // Set iframe title conditionally based on file open
    let windowTitle = app.name;
    if (queryParams.file) {
        windowTitle += ` - ${queryParams.file.split('/').pop()}`;
    } else if (queryParams.image) {
        windowTitle += ` - ${queryParams.image.split('/').pop()}`;
    }

    let contextLabel = app.name;
    if (queryParams.file) {
        contextLabel = queryParams.file.split('/').pop() || app.name;
    } else if (queryParams.image) {
        contextLabel = queryParams.image.split('/').pop() || app.name;
    }
    win.dataset.contextTitle = contextLabel;

    win.innerHTML = `
        ${resizersHtml}
        <div class="window-header">
            <span class="window-title">${windowTitle}</span>
            <div class="window-operations">
                <button class="window-minimize"></button>
                <button class="window-fullscreen"></button>
                <button class="window-close"></button>
            </div>
        </div>
        <div class="window-content" style="padding: 0; overflow: hidden;">
            <iframe src="${app.path}${queryAppend}" style="width: 100%; height: 100%; border: none; border-bottom-left-radius: 0.5rem; border-bottom-right-radius: 0.5rem;"></iframe>
        </div>
    `;

    document.getElementById('window-container').appendChild(win);
    initWindow(win);
    refreshMinimizedStateForApp(app.id);
}

// Expose openApp for apps starting from within iframes
window.openApp = openApp;

// Ensure functionality is attached dynamically to newly created windows
function initWindow(win) {
    const header = win.querySelector('.window-header');
    if (!header) return;

    win.onmousedown = () => { win.style.zIndex = "1000"; }

    header.onmousedown = (e) => {
        activeWindow = win;
        offsetX = e.clientX - win.offsetLeft;
        offsetY = e.clientY - win.offsetTop;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        isResizing = false;
        getWindows().forEach(w => w.style.zIndex = "500");
        win.style.zIndex = "1000";
        document.querySelectorAll('.window-content iframe').forEach(iframe => iframe.style.pointerEvents = 'none');
    }

    const resizers = win.querySelectorAll('.resizer');
    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', function(e) {
            e.preventDefault();
            isResizing = true;
            currentResizer = resizer;
            activeWindow = win;
            getWindows().forEach(w => w.style.zIndex = "500");
            win.style.zIndex = "1000";
            document.querySelectorAll('.window-content iframe').forEach(iframe => iframe.style.pointerEvents = 'none');
        });
    });

    const fullscreenBtn = header.querySelector('.window-operations').querySelector('.window-fullscreen');
    const toggleMax = () => {
        const containerRect = document.getElementById('window-container').getBoundingClientRect();
        const windowRect = win.getBoundingClientRect();
        if (windowRect.width >= containerRect.width && windowRect.height >= containerRect.height) {
            restoreWindowSizes(win);
        } else {
            saveWindowSizes(win);
            win.style.width = `${containerRect.width}px`;
            win.style.height = `${containerRect.height}px`;
            win.style.top = `0px`;
            win.style.left = `0px`;
        }
    };

    header.addEventListener('dblclick', toggleMax);
    if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleMax);

    const minimizeBtn = header.querySelector('.window-operations > .window-minimize');
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            setWindowMinimized(win, true);
        });
    }

    const closeBtn = win.querySelector('.window-operations').querySelector('.window-close');
    if (closeBtn) closeBtn.addEventListener('click', () => closeWindow(win));

    const closeButtons = win.querySelectorAll('[data-action="close"]');
    closeButtons.forEach(btn => btn.addEventListener('click', () => closeWindow(win)));
}


document.querySelectorAll('.taskbar-app-icon').forEach(icon => {
    icon.addEventListener('click', () => {
        const appId = icon.id;

        if (!appsRegistry.some(app => app.id === appId)) {
            hideMinimizedMenu();
            return;
        }

        refreshMinimizedStateForApp(appId);
        const minimizedInstances = getMinimizedWindows(appId);

        if (minimizedInstances.length > 0) {
            const isSameMenuOpen = !minimizedMenu.classList.contains('hidden') && activeMinimizedMenuAppId === appId;
            if (isSameMenuOpen) {
                hideMinimizedMenu();
            } else {
                showMinimizedMenuForApp(appId, icon);
            }
            return;
        }

        hideMinimizedMenu();
        openApp(appId);
    });
});

contextMenu.add('#window-container', (target, e) => {
    if (!e) return [];

    if (e.target.closest('.window') || e.target.closest('.desktop-icon') || e.target.closest('footer')) {
        return [];
    }

    return [
        { label: 'New File', action: () => createDesktopFile() },
        { label: 'New Folder', action: () => createDesktopFolder() },
        { label: 'New Shortcut', action: () => createDesktopShortcut() },
        { type: 'separator' },
        { label: 'Appearance Settings', action: () => openDisplaySettings() }
    ];
});

contextMenu.add('.desktop-icon', (target) => {
    const nodeId = Number(target.dataset.nodeId);
    if (!Number.isFinite(nodeId)) return [];

    return [
        { label: 'Open', action: () => openDesktopNode(nodeId) },
        { label: 'Rename', action: () => renameDesktopNode(nodeId) },
        { label: 'Delete', action: () => deleteDesktopNode(nodeId) }
    ];
});
