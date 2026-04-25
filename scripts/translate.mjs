import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, '../locales');
const ROOT_DIR = path.join(__dirname, '..');

// English is our base language
const baseLang = 'en-US';
const targetLangs = [
    'en-GB', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh-CN', 'ko', 
    'ar', 'hi', 'tr', 'nl', 'pl', 'sv', 'vi', 'th', 'id', 'fi', 
    'da', 'no', 'cs', 'el'
];

async function extractStrings() {
    const keys = new Set();
    
    async function walkPath(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const res = path.resolve(dir, entry.name);
            if (entry.isDirectory() && !res.includes('node_modules') && !res.includes('locales') && !res.includes('.git') && !res.includes('assets')) {
                await walkPath(res);
            } else if (!entry.isDirectory() && (res.endsWith('.html') || res.endsWith('.js'))) {
                const content = await fs.readFile(res, 'utf-8');
                
                // Match `data-i18n="something"` or `data-i18n='something'`
                const regex = /data-i18n=["']([^"']+)["']/g;
                let match;
                while ((match = regex.exec(content)) !== null) {
                    keys.add(match[1]);
                }

                // Match i18n.get('something') or i18n.get("something")
                const jsRegex = /i18n\.get\(['"]([^"']+)['"]\)/g;
                while ((match = jsRegex.exec(content)) !== null) {
                    keys.add(match[1]);
                }
            }
        }
    }
    
    await walkPath(ROOT_DIR);
    return Array.from(keys);
}

async function translateText(text, targetLang) {
    if (targetLang === 'en-GB' || targetLang === 'en-US') return text;
    
    // MyMemory API
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetLang.split('-')[0]}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.responseData && data.responseData.translatedText) {
            return data.responseData.translatedText;
        }
    } catch (e) {
        console.error(`Failed to translate "${text}" to ${targetLang}`, e);
    }
    return text;
}

async function generateLocales() {
    console.log('Extracting translation keys...');
    const extractedKeys = await extractStrings();
    console.log(`Found ${extractedKeys.length} keys.`);

    await fs.mkdir(LOCALES_DIR, { recursive: true });
    
    const baseFilePath = path.join(LOCALES_DIR, `${baseLang}.json`);
    let baseTranslations = {};
    try {
        const existingBase = await fs.readFile(baseFilePath, 'utf8');
        baseTranslations = JSON.parse(existingBase);
    } catch (e) {
        // Doesn't exist yet
    }

    // Add any missing keys to base translations with a placeholder
    let added = 0;
    for (const key of extractedKeys) {
        if (!(key in baseTranslations)) {
            // Generate a readable default string from the key ('settings.homeDir' -> 'Home Dir')
            const text = key.split('.').pop();
            baseTranslations[key] = text.charAt(0).toUpperCase() + text.slice(1).replace(/([A-Z])/g, ' $1');
            added++;
        }
    }
    
    console.log(`Added ${added} new keys to base language.`);

    await fs.writeFile(
        baseFilePath,
        JSON.stringify(baseTranslations, null, 2)
    );
    console.log(`Saved ${baseLang}.json`);

    for (const lang of targetLangs) {
        if (lang === baseLang) continue;
        console.log(`Translating to ${lang}...`);
        
        const langPath = path.join(LOCALES_DIR, `${lang}.json`);
        let langTranslations = {};
        try {
            const existingLang = await fs.readFile(langPath, 'utf8');
            langTranslations = JSON.parse(existingLang);
        } catch (e) {}

        const finalTranslations = {};
        for (const [key, text] of Object.entries(baseTranslations)) {
            if (langTranslations[key] && langTranslations[key] !== text && langTranslations[key] !== key) {
                finalTranslations[key] = langTranslations[key]; // Keep existing if translated
            } else {
                finalTranslations[key] = await translateText(text, lang);
                await new Promise(r => setTimeout(r, 200));
            }
        }

        await fs.writeFile(
            langPath,
            JSON.stringify(finalTranslations, null, 2)
        );
        console.log(`Saved ${lang}.json`);
    }
    console.log('All translations generated successfully!');
}

generateLocales().catch(console.error);
