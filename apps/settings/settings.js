import { db, resolvePath, writeFile } from '../../js/db.js';
import * as ct from 'https://cdn.jsdelivr.net/npm/countries-and-timezones@3.3.0/+esm';
import { i18n } from '../../js/i18n.js';

class SettingsApp {
    constructor() {
        this.currentSection = 'home';
        this.config = {};
        this.configPathId = null;
        
        // DOM Elements
        this.titleElement = document.querySelector('#settings-title h1');
        this.sidebarElements = document.querySelectorAll('.sidebar-element');
        this.optionSections = document.querySelectorAll('.settings-options');
        this.homeNavigationOptions = document.querySelectorAll('#section-home .settings-option');
        
        // Modal Elements
        this.modalOverlay = document.getElementById('modal-overlay');
        this.modals = document.querySelectorAll('.modal');
        this.settingsOptionsWithModals = document.querySelectorAll('.settings-option[data-modal]');
        this.cancelButtons = document.querySelectorAll('.btn-cancel');
        this.applyButtons = document.querySelectorAll('.btn-apply');

        // Form Elements
        this.inputs = {
            language: document.getElementById('config-language'),
            region: document.getElementById('config-region'),
            timezone: document.getElementById('config-timezone'),
            theme: document.getElementById('config-theme'),
            accentColor: document.getElementById('config-accent-color'),
            wallpaper: document.getElementById('config-wallpaper'),
            customWallpaper: document.getElementById('config-custom-wallpaper')
        };

        this.init();
    }

    async init() {
        this.populateRegionDropdown();
        await this.loadWallpapers();
        await this.loadConfig();
        
        await i18n.setLanguage(this.config.language || 'en-US');

        // Ensure proper region -> timezone linking on change
        if (this.inputs.region) {
            this.inputs.region.addEventListener('change', (e) => {
                this.updateTimezoneDropdown(e.target.value);
            });
        }

        // Setup sidebar navigation
        this.sidebarElements.forEach(element => {
            element.addEventListener('click', () => {
                const target = element.getAttribute('data-target');
                if (target) {
                    this.navigateTo(target);
                }
            });
        });

        // Setup home page navigation buttons
        this.homeNavigationOptions.forEach(option => {
            option.addEventListener('click', () => {
                const target = option.getAttribute('data-target');
                if (target) {
                    this.navigateTo(target);
                }
            });
        });

        // Setup modal triggers
        this.settingsOptionsWithModals.forEach(option => {
            option.addEventListener('click', () => {
                const modalId = option.getAttribute('data-modal');
                if (modalId) {
                    this.openModal(modalId);
                }
            });
        });

        // Setup modal cancel/close buttons
        this.cancelButtons.forEach(btn => {
            btn.addEventListener('click', () => this.closeModal());
        });

        // Escape to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        });
        // Close modal when clicking on overlay outside the modal box
        this.modalOverlay.addEventListener('click', (e) => {
            if (e.target === this.modalOverlay) {
                this.closeModal();
            }
        });

        // Setup modal apply buttons
        this.applyButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const modal = e.target.closest('.modal');
                const modalId = modal.id.replace('modal-', '');
                await this.saveSetting(modalId);
                this.closeModal();
            });
        });

        // Setup custom wallpaper toggle
        this.inputs.wallpaper.addEventListener('change', (e) => {
            const customUpload = document.getElementById('wallpaper-custom-upload');
            if (e.target.value === 'custom') {
                customUpload.classList.remove('hidden');
            } else {
                customUpload.classList.add('hidden');
            }
        });

        // Setup opening Apps
        document.querySelectorAll('.app-list li').forEach(li => {
            li.addEventListener('click', () => {
                const appId = li.getAttribute('data-appid');
                if (window.parent && typeof window.parent.openApp === 'function') {
                    window.parent.openApp(appId);
                } else {
                    console.log(`Simulated open app: ${appId}`);
                }
            });
        });

        // Initial render
        this.navigateTo(this.currentSection);
    }

    async loadWallpapers() {
        const select = this.inputs.wallpaper;
        if (!select) return;

        select.innerHTML = '';
        
        try {
            // Read from vite glob or hardcode default list if not bundled correctly
            const presets = ['wallpaper-1.jpg', 'wallpaper-2.jpg', 'wallpaper-3.jpg', 'default.jpg']; 
            
            // Add known or auto-detected wallpapers
            presets.forEach(filename => {
                const option = document.createElement('option');
                option.value = filename;
                // Prettify name
                option.textContent = filename.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                select.appendChild(option);
            });
        } catch (e) {
            console.error('Failed to list wallpapers:', e);
        }
        
        const optionCustom = document.createElement('option');
        optionCustom.value = 'custom';
        optionCustom.setAttribute('data-i18n', 'settings.custom');
        optionCustom.textContent = 'Custom...';
        select.appendChild(optionCustom);
    }

    async loadConfig() {
        let defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        let defaultRegion = 'US';
        
        try {
            const tzData = ct.getTimezone(defaultTz);
            if (tzData && tzData.countries && tzData.countries.length > 0) {
                defaultRegion = tzData.countries[0];
            }
        } catch(e) {
            // Ignore parsing error for countries-and-timezones
        }

        const defaultConfig = {
            theme: 'default',
            language: navigator.language || 'en-US',
            region: defaultRegion,
            timezone: defaultTz,
            accentColor: '#2B652A',
            wallpaper: 'wallpaper-1.jpg'
        };

        try {
            const userDir = await resolvePath('/home/user');
            if (!userDir) return;
            
            const configNode = await resolvePath('/home/user/config/options.json');
            if (configNode) {
                const fileData = await db.fs_data.where({ nodeId: configNode.id }).first();
                if (fileData) {
                    try {
                        const parsed = JSON.parse(fileData.data);
                        this.config = { ...defaultConfig, ...parsed };
                    } catch (parseError) {
                        console.warn('Invalid options.json detected. Resetting to fallback defaults.', parseError);
                        this.config = { ...defaultConfig };
                        // Auto-repair the broken file
                        await writeFile(userDir.id, 'config/options.json', JSON.stringify(this.config, null, 4));
                    }
                }
            } else {
                // Config doesn't exist, create default
                this.config = { ...defaultConfig };
            }
            this.updateInputValues();
        } catch (e) {
            console.error('Error loading config:', e);
        }
    }

    updateInputValues() {
        if (this.config.language && this.inputs.language) this.inputs.language.value = this.config.language;
        if (this.config.region && this.inputs.region) {
            this.inputs.region.value = this.config.region;
            this.updateTimezoneDropdown(this.config.region);
        }
        if (this.config.timezone && this.inputs.timezone) this.inputs.timezone.value = this.config.timezone;
        if (this.config.theme && this.inputs.theme) this.inputs.theme.value = this.config.theme;
        if (this.config.accentColor && this.inputs.accentColor) this.inputs.accentColor.value = this.config.accentColor;
        
        if (this.config.wallpaper && this.inputs.wallpaper) {
            if (this.config.wallpaper.startsWith('fs:')) {
                this.inputs.wallpaper.value = 'custom';
                document.getElementById('wallpaper-custom-upload')?.classList.remove('hidden');
            } else {
                this.inputs.wallpaper.value = this.config.wallpaper;
                document.getElementById('wallpaper-custom-upload')?.classList.add('hidden');
            }
        }
        if (this.config.wallpaperStyle && document.getElementById('config-wallpaper-style')) {
            document.getElementById('config-wallpaper-style').value = this.config.wallpaperStyle;
        }
    }

    populateRegionDropdown() {
        const countries = ct.getAllCountries();
        const select = this.inputs.region;
        if (!select) return;

        select.innerHTML = ''; // Clear hardcoded
        
        // Convert to array and sort by name
        const countryList = Object.values(countries).sort((a, b) => a.name.localeCompare(b.name));
        
        countryList.forEach(country => {
            const option = document.createElement('option');
            option.value = country.id;
            option.textContent = country.name;
            select.appendChild(option);
        });
    }

    updateTimezoneDropdown(countryCode) {
        const timezonesNode = document.querySelector('[data-modal="timezone"]');
        const select = this.inputs.timezone;
        if (!select) return;

        const timezones = ct.getTimezonesForCountry(countryCode);
        if (!timezones || timezones.length === 0) return;

        select.innerHTML = '';
        timezones.forEach(tz => {
            const option = document.createElement('option');
            option.value = tz.name;
            option.textContent = tz.name;
            select.appendChild(option);
        });

        // Auto selection and UI hiding
        if (timezones.length === 1) {
            select.value = timezones[0].name;
            if (timezonesNode) timezonesNode.style.display = 'none'; // Hide exact setting UI
        } else {
            if (timezonesNode) timezonesNode.style.display = 'flex'; // Show exact setting UI
        }
    }

    async saveSetting(settingKey) {
        if (settingKey === 'language') {
            this.config.language = this.inputs.language.value;
            await i18n.setLanguage(this.config.language);
        }
        if (settingKey === 'region') {
            this.config.region = this.inputs.region.value;
        }
        if (settingKey === 'timezone') {
            this.config.timezone = this.inputs.timezone.value;
            if (window.parent && window.parent.OS_TIMEZONE !== undefined) {
                window.parent.OS_TIMEZONE = this.config.timezone;
            }
        }
        if (settingKey === 'theme') {
            this.config.theme = this.inputs.theme.value;
            await db.config.put({ key: 'theme', value: this.inputs.theme.value });
            if (window.parent && window.parent.document) {
                // Apply theme immediately
                window.parent.document.body.className = this.inputs.theme.value === 'dark' ? 'dark-theme' 
                    : this.inputs.theme.value === 'light' ? 'light-theme' : '';
            }
        }
        if (settingKey === 'accent-color') {
            this.config.accentColor = this.inputs.accentColor.value;
            if (window.parent && window.parent.document) {
                // Apply accent color immediately
                window.parent.document.documentElement.style.setProperty('--color-primary', this.config.accentColor);
            }
        }
        
        if (settingKey === 'wallpaper') {
            let wallpaperStyle = document.getElementById('config-wallpaper-style') ? document.getElementById('config-wallpaper-style').value : 'cover';
            this.config.wallpaperStyle = wallpaperStyle;

            if (this.inputs.wallpaper.value === 'custom') {
                const file = this.inputs.customWallpaper.files[0];
                if (file) {
                    // Validation: MUST be an image, less than 5MB
                    if (!file.type.startsWith('image/')) {
                        alert(i18n.get('settings.error.notImage') || 'Please select an image file.');
                        return;
                    }
                    if (file.size > 5 * 1024 * 1024) {
                        alert(i18n.get('settings.error.tooLarge') || 'Image must be smaller than 5MB.');
                        return;
                    }
                    
                    const btnApply = document.querySelector('#modal-wallpaper .btn-apply');
                    const originalText = btnApply.innerText;
                    btnApply.innerText = 'Saving...';
                    btnApply.disabled = true;
                    
                    try {
                        const userDir = await resolvePath('/home/user');
                        const configDir = await resolvePath('/home/user/config');
                        if (userDir && configDir) {
                            const ext = file.name.split('.').pop() || 'jpg';
                            const wallpaperFileName = `wallpaper.${ext}`;
                            await writeFile(configDir.id, wallpaperFileName, file, file.type);
                            this.config.wallpaper = `fs:/home/user/config/${wallpaperFileName}`;
                        }
                    } catch (e) {
                        console.error('Failed to write wallpaper to FS:', e);
                        alert('Failed to save wallpaper.');
                    } finally {
                        btnApply.innerText = originalText;
                        btnApply.disabled = false;
                    }
                } else if (!this.config.wallpaper) {
                    // Fallback if no file picked but custom selected previously without config
                    this.config.wallpaper = 'wallpaper-1.jpg';
                }
            } else {
                this.config.wallpaper = this.inputs.wallpaper.value;
            }
            
            // Dispatch event to desktop
            if (window.parent && typeof window.parent.updateWallpaper === 'function') {
                window.parent.updateWallpaper(this.config.wallpaper, this.config.wallpaperStyle);
            }
        }

        try {
            const userDir = await resolvePath('/home/user');
            if (userDir) {
                await writeFile(userDir.id, 'config/options.json', JSON.stringify(this.config, null, 4));
            }
        } catch (e) {
            console.error('Error saving config:', e);
        }
    }

    navigateTo(sectionId) {
        if (!sectionId) return;
        this.currentSection = sectionId;
        this.updateUI();
    }

    updateUI() {
        // Update Title
        const activeSidebarItem = Array.from(this.sidebarElements).find(
            el => el.getAttribute('data-target') === this.currentSection
        );
        if (activeSidebarItem) {
            this.titleElement.textContent = activeSidebarItem.textContent;
        }

        // Update sidebar active class
        this.sidebarElements.forEach(element => {
            if (element.getAttribute('data-target') === this.currentSection) {
                element.classList.add('active');
            } else {
                element.classList.remove('active');
            }
        });

        // Update sections visibility
        this.optionSections.forEach(section => {
            if (section.id === `section-${this.currentSection}`) {
                section.classList.remove('hidden');
            } else {
                section.classList.add('hidden');
            }
        });
    }

    openModal(modalId) {
        this.modals.forEach(mod => mod.classList.add('hidden'));
        
        // Show correct modal
        const targetModal = document.getElementById(`modal-${modalId}`);
        if (targetModal) {
            targetModal.classList.remove('hidden');
        }
        
        // Show overlay
        this.modalOverlay.classList.remove('hidden');
        setTimeout(() => {
            this.modalOverlay.style.opacity = '1';
            this.modalOverlay.style.visibility = 'visible';
            this.modalOverlay.style.pointerEvents = 'auto';
        }, 10);
    }

    closeModal() {
        this.modalOverlay.style.opacity = '0';
        this.modalOverlay.style.visibility = 'hidden';
        this.modalOverlay.style.pointerEvents = 'none';
        
        setTimeout(() => {
            this.modalOverlay.classList.add('hidden');
            this.modals.forEach(mod => mod.classList.add('hidden'));
            // Reset custom file upload input
            const fileInput = document.getElementById('config-custom-wallpaper');
            if (fileInput) fileInput.value = '';
        }, 200); // Matches the CSS transition time
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    new SettingsApp();
});
