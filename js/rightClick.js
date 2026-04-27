// rightClick.js - custom context menu utility
let currentMenu = null;

export class ContextMenu {
    constructor() {
        this.configs = [];
        this.init();
    }

    add(selector, itemsResolver) {
        this.configs.push({ selector, itemsResolver });
    }

    init() {
        document.addEventListener('contextmenu', (e) => {
            let matchedConfig = null;
            let matchedTarget = null;
            let currentElem = e.target;

            // Bubble up DOM to find the most specific matching config
            while (currentElem && currentElem !== document) {
                for (const config of this.configs) {
                    if (currentElem.matches && currentElem.matches(config.selector)) {
                        matchedConfig = config;
                        matchedTarget = currentElem;
                        break;
                    }
                }
                if (matchedConfig) break;
                currentElem = currentElem.parentNode;
            }

            if (matchedConfig) {
                const items = typeof matchedConfig.itemsResolver === 'function' 
                              ? matchedConfig.itemsResolver(matchedTarget, e) 
                              : matchedConfig.itemsResolver;
                if (items && items.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showMenu(e.clientX, e.clientY, items, matchedTarget);
                } else {
                    this.hideMenu();
                }
            } else {
                // Allow native context menu if no custom config matches
                this.hideMenu();
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu')) {
                this.hideMenu();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.hideMenu();
        });
        
        window.addEventListener('resize', () => this.hideMenu());
        
        // Hide menu when clicking inside an iframe
        window.addEventListener('blur', () => this.hideMenu());
    }

    showMenu(x, y, items, target) {
        this.hideMenu();
        
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.display = 'flex';
        
        items.forEach(item => {
            if (item.type === 'separator') {
                 const sep = document.createElement('div');
                 sep.className = 'context-menu-separator';
                 menu.appendChild(sep);
            } else {
                const el = document.createElement('div');
                el.className = 'context-menu-item';
                el.innerHTML = item.label;
                if (item.disabled) {
                    el.classList.add('disabled');
                } else {
                    el.onclick = (e) => {
                        e.stopPropagation();
                        this.hideMenu();
                        if (item.action) item.action(target);
                    };
                }
                menu.appendChild(el);
            }
        });

        document.body.appendChild(menu);

        // Adjust position so it doesn't clip off screen
        const rect = menu.getBoundingClientRect();
        let finalX = x;
        let finalY = y;
        
        if (finalX + rect.width > window.innerWidth) finalX -= rect.width;
        if (finalY + rect.height > window.innerHeight) finalY -= rect.height;
        
        finalX = Math.max(0, finalX);
        finalY = Math.max(0, finalY);

        menu.style.left = finalX + 'px';
        menu.style.top = finalY + 'px';
        
        currentMenu = menu;
    }

    hideMenu() {
        if (currentMenu) {
            currentMenu.remove();
            currentMenu = null;
        }
    }
}

export const contextMenu = new ContextMenu();
