class I18n {
    constructor() {
        this.cache = new Map();
        this.currentLang = 'en-US';
    }

    async setLanguage(lang) {
        if (!this.cache.has(lang)) {
            try {
                const response = await fetch(`../../locales/${lang}.json`);
                if (response.ok) {
                    const translations = await response.json();
                    this.cache.set(lang, translations);
                } else {
                    console.warn(`Failed to load locales for ${lang}`);
                }
            } catch (e) {
                console.error(`Error loading locale for ${lang}:`, e);
            }
        }
        this.currentLang = lang;
        this.translateDOM();
    }

    get(key) {
        const translations = this.cache.get(this.currentLang);
        return translations ? (translations[key] || key) : key;
    }

    translateDOM(root = document) {
        const elements = root.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = this.get(key);
            if (translation !== key) {
                if (el.tagName === 'OPTION') {
                    el.textContent = translation;
                } else {
                    el.innerText = translation;
                }
            }
        });
    }
}

export const i18n = new I18n();
