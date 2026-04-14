// desktop.js - Way too much stuff
import { db, isSetupComplete, initFS } from './db.js';

// Check if setup is complete before loading desktop
async function checkSetup() {
    const setupComplete = await isSetupComplete();
    if (!setupComplete) {
        // Redirect to setup page if not set up
        window.location.replace('./setup');
    } else {
        // Run any FS initialization guarantees needed
        await initFS();
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

// Update clock every second
setInterval(function() {
    const now = new Date();
    clockTime.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    clockDate.textContent = now.toLocaleDateString('en-US');
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

function restoreWindowDimensions(win) {
    const defaultWidth = Math.min(800, window.innerWidth - 40);
    const defaultHeight = Math.min(500, window.innerHeight - 80);
    win.style.width = win.dataset.restoreWidth || `${defaultWidth}px`;
    win.style.height = win.dataset.restoreHeight || `${defaultHeight}px`;
}


// Event listener for desktop icon dragging
document.querySelectorAll('.desktop-icon').forEach(icon => {
    icon.onmousedown = (e) => {

        e.stopPropagation();
        potentialDragIcon = icon;
        initialMouseX = e.clientX;
        initialMouseY = e.clientY;

    const rect = icon.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    };
});

// Add selected class to clicked desktop icon and remove from others
document.querySelectorAll('.desktop-icon').forEach(icon => {
    icon.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.desktop-icon').forEach(i => i.classList.remove('selected'));
        icon.classList.add('selected');
    });

    icon.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const appId = icon.dataset.appId || icon.id.replace('desktop-', '');
        openApp(appId);
    });
});

// Visually follow the mouse while dragging the icon
document.addEventListener('mousemove', (e) => {
    if (!draggingIcon && potentialDragIcon) {
        if (Math.abs(e.clientX - initialMouseX) > 2 || Math.abs(e.clientY - initialMouseY) > 2) {
            draggingIcon = potentialDragIcon;
            potentialDragIcon = null;
            draggingIcon.classList.add('dragging');
            container.appendChild(draggingIcon);
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

    draggingIcon.style.position = 'absolute';
    draggingIcon.style.left = `${snapX}px`;
    draggingIcon.style.top = `${snapY}px`;
    draggingIcon.classList.remove('dragging');
    draggingIcon = null;
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
    // If clicking outside of any window, reset z-index of all windows
    if (!e.target.closest('.window')) {
        getWindows().forEach(win => win.style.zIndex = "500");
    }

    // If clicking after a desktop icon is selected, remove the "selected" state from all icons
    if (e.target.closest('.desktop-icon')) {
        document.querySelectorAll('.desktop-icon').forEach(icon => icon.classList.remove('selected'));
        e.target.closest('.desktop-icon').classList.add('selected');
    } else {
        document.querySelectorAll('.desktop-icon').forEach(icon => icon.classList.remove('selected'));
    }
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
            restoreWindowDimensions(activeWindow);
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
            win.remove();
        });
    }
});

// Close windows when buttons with data-action="close" are clicked
getWindows().forEach(win => {
    const closeButtons = win.querySelectorAll('[data-action="close"]');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            win.remove();
        });
    });
});


// Load app registry
let appsRegistry = [];
fetch('./data/apps.json')
    .then(res => res.json())
    .then(data => {
        appsRegistry = data.apps;
    });

window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'CLOSE_WINDOW') {
        const win = document.querySelector(`.window[data-app-id="${e.data.appId}"]`);
        if (win) win.remove();
    }
});

function openApp(appId) {
    const existingWin = document.querySelector(`.window[data-app-id="${appId}"]`);
    if (existingWin) {
        getWindows().forEach(w => w.style.zIndex = "500");
        existingWin.style.zIndex = "1000";
        return;
    }

    const app = appsRegistry.find(a => a.id === appId);
    if (!app) {
        console.error("App " + appId + " not found!");
        return;
    }

    const startWidth = Math.min(800, window.innerWidth - 40);
    const startHeight = Math.min(500, window.innerHeight - 80);
    const startLeft = Math.max(0, Math.min(50, window.innerWidth - startWidth));
    const startTop = Math.max(0, Math.min(50, window.innerHeight - startHeight));

    const win = document.createElement('div');
    win.className = 'window';
    win.dataset.appId = app.id;
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

    win.innerHTML = `
        ${resizersHtml}
        <div class="window-header">
            <span class="window-title">${app.name}</span>
            <div class="window-operations">
                <button class="window-minimize"></button>
                <button class="window-fullscreen">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="#FFFFFF" viewBox="0 0 256 256"></svg>
                </button>
                <button class="window-close">
                </button>
            </div>
        </div>
        <div class="window-content" style="padding: 0; overflow: hidden;">
            <iframe src="${app.path}" style="width: 100%; height: 100%; border: none; border-bottom-left-radius: 0.5rem; border-bottom-right-radius: 0.5rem;"></iframe>
        </div>
    `;

    document.getElementById('window-container').appendChild(win);
    initWindow(win);
}

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

    const closeBtn = win.querySelector('.window-operations').querySelector('.window-close');
    if (closeBtn) closeBtn.addEventListener('click', () => win.remove());

    const closeButtons = win.querySelectorAll('[data-action="close"]');
    closeButtons.forEach(btn => btn.addEventListener('click', () => win.remove()));
}


document.querySelectorAll('.taskbar-app-icon').forEach(icon => {
    icon.addEventListener('click', (e) => {
        const appId = icon.id;
        openApp(appId);
    });
});