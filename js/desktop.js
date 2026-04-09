import { db, isSetupComplete } from './db.js';

// Check if setup is complete before loading desktop
async function checkSetup() {
    const setupComplete = await isSetupComplete();
    if (!setupComplete) {
        // Redirect to setup page if not set up
        window.location.replace('./setup');
} else {
    // Unhide body since setup is complete
    document.body.classList.remove('hidden');
    }
}
checkSetup();

// Element references
const clockTime = document.getElementById('clock-time');
const clockDate = document.getElementById('clock-date');
const windows = document.querySelectorAll('.window');
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
let isResizing = false;
let currentResizer = null;
let draggingIcon = null;
const GRID_SIZE_X = 70; // .desktop-icon width + gap
const GRID_SIZE_Y = 80; // .desktop-icon height + gap

// Event listener for desktop icon dragging
document.querySelectorAll('.desktop-icon').forEach(icon => {
    icon.onmousedown = (e) => {
        e.stopPropagation();
        draggingIcon = icon;

    const rect = icon.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    icon.classList.add('dragging');

    container.appendChild(icon); // Restores absolute positioning
    };
});

// Visually follow the mouse while dragging the icon
document.addEventListener('mousemove', (e) => {
    if (!draggingIcon) return;

    const containerRect = container.getBoundingClientRect();

    let x = e.clientX - containerRect.left - offsetX;
    let y = e.clientY - containerRect.top - offsetY;

    draggingIcon.style.left = `${x}px`;
    draggingIcon.style.top = `${y}px`;
});

document.addEventListener('mouseup', (e) => {
    if (!draggingIcon) return;

    const containerRect = container.getBoundingClientRect();

    const iconX = e.clientX - containerRect.left - offsetX;
    const iconY = e.clientY - containerRect.top - offsetY;

    // Snap to grid
    let snapX = Math.round(iconX / GRID_SIZE_X) * GRID_SIZE_X;
    let snapY = Math.round(iconY / GRID_SIZE_Y) * GRID_SIZE_Y;

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
});

// Initialize windows
windows.forEach(win => {
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
        isResizing = false;

        windows.forEach(w => w.style.zIndex = "1");
        win.style.zIndex = "1000";
    }

    // Enable resizing
    const resizers = win.querySelectorAll('.resizer');
    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', function(e) {
            e.preventDefault();
            isResizing = true;
            currentResizer = resizer;
            activeWindow = win;
            windows.forEach(w => w.style.zIndex = "1");
            win.style.zIndex = "1000";
        });
    });
});

// Clamp windows within the window-container when dragging
document.addEventListener('mousemove', (e) => {
    if (activeWindow && !isResizing) {
        // Calculate where the user is dragging the window
        let newX = e.clientX - offsetX;
        let newY = e.clientY - offsetY;

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
    windows.forEach(win => {
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