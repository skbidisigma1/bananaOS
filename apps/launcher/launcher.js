// DOM References
const searchInput = document.getElementById('search-input');
const appsGrid = document.getElementById('apps-grid');
let apps = [];

// When "/" or "Enter" or "meta + L" is pressed, focus the search input
document.addEventListener('keydown', (e) => {
    if ((e.key === '/' || e.key === 'Enter' || (e.ctrlKey || e.metaKey) && e.key === 'l') && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
    }
});

async function loadApps() {
    try {
        const response = await fetch('../../data/apps.json');
        const data = await response.json();
        // Ignore launcher if it's there
        apps = data.apps.filter(app => app.id !== 'start-menu' && app.id !== 'launcher');
        renderApps(apps);
    } catch (e) {
        console.error('Failed to load apps in launcher', e);
    }
}

function renderApps(appsToRender) {
    if (!appsGrid) return;
    appsGrid.innerHTML = '';
    
    if (appsToRender.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'app-grid-icon';
        msg.style.opacity = '0.5';
        msg.style.gridColumn = '1 / -1';
        msg.innerHTML = '<div class="app-name" style="text-align: center; width: 100%;">No apps found</div>';
        appsGrid.appendChild(msg);
        return;
    }

    appsToRender.forEach(app => {
        const div = document.createElement('div');
        div.className = 'app-grid-icon';
        div.dataset.app = app.id;
        
        let path = app.icon;
        if (path && path.startsWith('./')) {
             path = '../../' + path.substring(2);
        }

        const imgContent = `<img class="app-icon-img" src="${path}" alt="${app.name}" style="width:100%;height:100%" onerror="this.parentElement.style.opacity='0'">`;

        div.innerHTML = `
            <div class="app-icon" style="display:flex; justify-content:center; align-items:center;">
                ${imgContent}
            </div>
            <div class="app-name">${app.name}</div>
        `;
        
        div.addEventListener('click', () => {
            if (window.parent && window.parent.openApp) {
                window.parent.openApp(app.id);
                // Also close launcher
                window.parent.postMessage({ type: 'CLOSE_LAUNCHER' }, '*');
            }
        });
        
        appsGrid.appendChild(div);
    });
}

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            renderApps(apps);
            return;
        }
        const filtered = apps.filter(app => app.name.toLowerCase().includes(query));
        renderApps(filtered);
    });
}

// Reset launcher when it opens
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'LAUNCHER_OPENED') {
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
        renderApps(apps);
    }
});

loadApps();