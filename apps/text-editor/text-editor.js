import { basicSetup, minimalSetup } from "codemirror";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { cpp } from "@codemirror/lang-cpp";
import { oneDark } from "@codemirror/theme-one-dark";
import { db, resolvePath, writeFile } from "../../js/db.js";

// Elements for the status bar
const lnCol = document.getElementById('ln-col');
const characters = document.getElementById('characters');
const words = document.getElementById('words');
const fileTypeDisplay = document.getElementById('file-type');

// App state
let currentFilePath = null;
let currentFileType = 'Plain Text';
let view = null;
let hasUnsavedChanges = false;

const wordWrapCompartment = new Compartment();
let isWordWrap = false;

function publishWindowContextTitle(contextTitle) {
    if (!window.parent) return;
    window.parent.postMessage({
        type: 'WINDOW_CONTEXT_TITLE',
        contextTitle
    }, '*');
}

function extractTextEditorContext(titleStr) {
    const fallback = 'Text Editor';
    if (typeof titleStr !== 'string') return fallback;

    const prefix = 'Text Editor - ';
    if (titleStr.startsWith(prefix)) {
        const context = titleStr.slice(prefix.length).trim();
        return context || fallback;
    }

    return titleStr.trim() || fallback;
}

// Function to update the status bar
function showModal(message, confirmText = "Discard", title = "Confirm") {
    return new Promise(resolve => {
        const modal = document.getElementById('discard-modal');
        const msgEl = document.getElementById('discard-message');
        const titleEl = document.getElementById('discard-title');
        const confirmBtn = document.getElementById('discard-confirm');
        const cancelBtn = document.getElementById('discard-cancel');

        if(titleEl) titleEl.textContent = title;
        msgEl.textContent = message;
        confirmBtn.textContent = confirmText;
        modal.classList.remove('hidden');

        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            modal.classList.add('hidden');
        };

        const onConfirm = () => {
            cleanup();
            resolve(true);
        };
        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
    });
}

function customAlert(message, title = "Notice") {
    return new Promise(resolve => {
        const modal = document.getElementById('alert-modal');
        const msgEl = document.getElementById('alert-message');
        const titleEl = document.getElementById('alert-title');
        const okBtn = document.getElementById('alert-ok');

        if(titleEl) titleEl.textContent = title;
        msgEl.textContent = message;
        modal.classList.remove('hidden');

        const cleanup = () => {
            okBtn.removeEventListener('click', onOk);
            modal.classList.add('hidden');
        };

        const onOk = () => {
            cleanup();
            resolve();
        };

        okBtn.addEventListener('click', onOk);
    });
}

function customPrompt(message, defaultValue = "", title = "Input Required") {
    return new Promise(resolve => {
        const modal = document.getElementById('prompt-modal');
        const msgEl = document.getElementById('prompt-message');
        const titleEl = document.getElementById('prompt-title');
        const inputEl = document.getElementById('prompt-input');
        const confirmBtn = document.getElementById('prompt-confirm');
        const cancelBtn = document.getElementById('prompt-cancel');

        if(titleEl) titleEl.textContent = title;
        msgEl.textContent = message;
        inputEl.value = defaultValue;
        modal.classList.remove('hidden');
        inputEl.focus();

        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            inputEl.removeEventListener('keydown', onKeyDown);
            modal.classList.add('hidden');
        };

        const onConfirm = () => {
            cleanup();
            resolve(inputEl.value);
        };
        const onCancel = () => {
            cleanup();
            resolve(null); // Return null exactly like prompt() on cancel
        };
        const onKeyDown = (e) => {
            if (e.key === 'Enter') onConfirm();
            if (e.key === 'Escape') onCancel();
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        inputEl.addEventListener('keydown', onKeyDown);
    });
}

function updateStatusBar(view) {
    const text = view.state.doc.toString();
    const charsCount = text.length;
    
    // Word count calculation
    const wordsArray = text.trim().split(/\s+/);
    const wordsCount = text.trim() === '' ? 0 : wordsArray.length;

    // Line and Column calculation
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.head);
    const currentLine = line.number;
    const currentCol = selection.head - line.from + 1;

    characters.textContent = `${charsCount} characters`;
    words.textContent = `${wordsCount} words`;
    lnCol.textContent = `Ln ${currentLine}, Col ${currentCol}`;
    fileTypeDisplay.textContent = currentFileType + (hasUnsavedChanges ? " (Unsaved)" : "");
}

const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
        hasUnsavedChanges = true;
    }
    if (update.docChanged || update.selectionSet) {
        updateStatusBar(update.view);

        // Update undo/redo buttons disabled state dynamically
        const dropdownEdit = document.getElementById('dropdown-edit');
        if (dropdownEdit) {
            const undoBtn = dropdownEdit.querySelector('.dropdown-menu-item:nth-child(1)');
            const redoBtn = dropdownEdit.querySelector('.dropdown-menu-item:nth-child(2)');
            if (undoBtn) {
                if (undoDepth(update.state) === 0) undoBtn.classList.add('disabled');
                else undoBtn.classList.remove('disabled');
            }
            if (redoBtn) {
                if (redoDepth(update.state) === 0) redoBtn.classList.add('disabled');
                else redoBtn.classList.remove('disabled');
            }
        }
    }
});

// Helper to update window title dynamically
function setWindowTitle(titleStr) {
    if (window.parent) {
        const frames = Array.from(window.parent.document.querySelectorAll('iframe'));
        const myFrame = frames.find(f => f.contentWindow === window);
        if (myFrame) {
            const winNode = myFrame.closest('.window');
            if (winNode) {
                const titleNode = winNode.querySelector('.window-title');
                if (titleNode) {
                    titleNode.textContent = titleStr;
                }
            }
        }
    }

    publishWindowContextTitle(extractTextEditorContext(titleStr));
}

// Intercept window close from title bar if unsaved changes exist
if (window.parent) {
    const frames = Array.from(window.parent.document.querySelectorAll('iframe'));
    const myFrame = frames.find(f => f.contentWindow === window);
    if (myFrame) {
        const winNode = myFrame.closest('.window');
        if (winNode) {
            const closeBtn = winNode.querySelector('.window-operations .window-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', async (e) => {
                    if (hasUnsavedChanges) {
                        e.stopImmediatePropagation();
                        e.preventDefault();
                        const discard = await showModal("You have unsaved changes. Are you sure you want to close and lose them?", "Discard");
                        if (discard) {
                            winNode.remove();
                        }
                    }
                }, true);
            }
        }
    }
}

// Setup CodeMirror
const parent = document.getElementById("editor-container");

async function saveActiveFileAS(view) {
    if (currentFileType === 'Unsupported') {
        await customAlert("Cannot save unsupported or binary files.", "Error");
        return;
    }

    let defaultPath = currentFilePath || '/home/user/Documents/newfile.txt';
    if (currentFilePath) {
        let lastSlash = currentFilePath.lastIndexOf('/');
        defaultPath = lastSlash === -1 ? '/' : currentFilePath.substring(0, lastSlash) || '/';
    }
    let path = await openFilePicker(defaultPath);
    if (!path) return;
    
    let lastSlash = path.lastIndexOf('/');
    let folderPath = lastSlash === -1 ? '/' : path.substring(0, lastSlash) || '/';
    let fileName = path.substring(lastSlash + 1);

    const folderNode = await resolvePath(folderPath);
    if (!folderNode || folderNode.type !== 'dir') {
        await customAlert("The directory does not exist: " + folderPath, "Error");
        return;
    }

    try {
        const existingNode = await resolvePath(path);
        if (existingNode && existingNode.type === 'file') {
            const overwrite = await showModal("A file with this name already exists. Overwrite?", "Overwrite", "File Exists");
            if (!overwrite) return;
        }

        await writeFile(folderNode.id, fileName, view.state.doc.toString(), 'text/plain');
        currentFilePath = path;
        hasUnsavedChanges = false;
        setWindowTitle(`Text Editor - ${fileName}`);
        updateStatusBar(view);
        window.history.replaceState({}, '', `${window.location.pathname}?file=${encodeURIComponent(path)}`);
    } catch(err) {
        await customAlert("Error saving: " + err.message, "Error");
    }
}

async function saveActiveFile(view) {
    if (currentFileType === 'Unsupported') {
        await customAlert("Cannot save unsupported or binary files.", "Error");
        return;
    }

    if (!currentFilePath) {
        // Trigger Save As if there's no file path to save to
        document.querySelector('#dropdown-file .dropdown-menu-item:nth-child(4)').click();
        return;
    }
    const content = view.state.doc.toString();
    try {
        const node = await resolvePath(currentFilePath);
        if (node && node.type === 'file') {
            await db.fs_data.where({ nodeId: node.id }).modify({ data: content });
            await db.fs_nodes.update(node.id, { modified: Date.now(), size: content.length });
            
            hasUnsavedChanges = false;
            setWindowTitle(`Text Editor - ${currentFilePath.split('/').pop()}`);
            updateStatusBar(view);

            // Visual indicator
            const originalText = fileTypeDisplay.textContent;
            fileTypeDisplay.textContent = "Saved.";
            setTimeout(() => { fileTypeDisplay.textContent = originalText; }, 2000);
        }
    } catch(err) {
        console.error("Failed to save file", err);
    }
}

async function initEditor() {
    const urlParams = new URLSearchParams(window.location.search);
    currentFilePath = urlParams.get('file');

    let initialContent = "";
    let extensions = [
        updateListener, 
        oneDark,
        keymap.of([
            indentWithTab,
            {
                key: "Mod-s",
                run: (view) => {
                    saveActiveFile(view);
                    return true; // Prevent default browser save
                }
            },
            {
                key: "Mod-S",
                run: (view) => {
                    saveActiveFileAS(view);
                    return true;
                }
            }
        ])
    ];

    if (currentFilePath) {
        try {
            const node = await resolvePath(currentFilePath);
            if (node && node.type === 'file') {
                const dataEntry = await db.fs_data.where({ nodeId: node.id }).first();
                if (dataEntry) {
                    if (dataEntry.data instanceof Blob) {
                        try {
                            initialContent = await dataEntry.data.text();
                        } catch(e) {
                             currentFileType = 'Unsupported';
                        }
                    } else if (typeof dataEntry.data === 'string') {
                        initialContent = dataEntry.data;
                    } else if (dataEntry.data instanceof Uint8Array || dataEntry.data instanceof ArrayBuffer) {
                        // Try to decode as UTF-8
                        try {
                            const decoder = new TextDecoder('utf-8', { fatal: true });
                            initialContent = decoder.decode(dataEntry.data);
                        } catch(e) {
                             currentFileType = 'Unsupported';
                        }
                    } else {
                         currentFileType = 'Unsupported';
                    }
                }
            }
        } catch(e) {
            console.error('Error resolving or reading file:', e);
            await customAlert("Error loading file: " + e.message, "Error");
            currentFileType = 'Unsupported';
        }
        setWindowTitle(`Text Editor - ${currentFilePath.split('/').pop()}`);
    } else {
        setWindowTitle('Text Editor');
    }

    // Determine Language Mode and other settings
    let isPlainText = true;
    extensions.push(wordWrapCompartment.of(isWordWrap ? [EditorView.lineWrapping] : []));
    
    if (currentFilePath && currentFileType !== 'Unsupported') {
        const ext = currentFilePath.split('.').pop().toLowerCase();
        if (ext === 'js' || ext === 'json') {
            currentFileType = 'JavaScript';
            extensions.push(basicSetup, javascript());
            isPlainText = false;
        } else if (ext === 'html' || ext === 'htm') {
            currentFileType = 'HTML';
            extensions.push(basicSetup, html());
            isPlainText = false;
        } else if (ext === 'css') {
            currentFileType = 'CSS';
            extensions.push(basicSetup, css());
            isPlainText = false;
        } else if (ext === 'c' || ext === 'h' || ext === 'cpp' || ext === 'hpp') {
            currentFileType = 'C/C++';
            extensions.push(basicSetup, cpp());
            isPlainText = false;
        } else if (ext === 'md') {
            currentFileType = 'Markdown';
            extensions.push(basicSetup);
            isPlainText = false;
        } else {
            currentFileType = 'Plain Text';
        }
    } else if (currentFileType !== 'Unsupported') {
        currentFileType = 'Plain Text';
    }

    if (isPlainText && currentFileType !== 'Unsupported') {
        extensions.push(
            minimalSetup,
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap])
        );
    }

    const state = EditorState.create({
        doc: initialContent,
        extensions: extensions
    });

    view = new EditorView({
        state,
        parent
    });

    if (currentFileType === 'Unsupported') {
        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.inset = '0';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        overlay.style.color = 'white';
        overlay.style.fontSize = '1.2rem';
        overlay.style.zIndex = '10';
        overlay.textContent = 'This file type is not supported.';
        parent.style.position = 'relative';
        parent.appendChild(overlay);
        view.dispatch({ effects: wordWrapCompartment.reconfigure([EditorState.readOnly.of(true)]) });
    }

    updateStatusBar(view);
}

initEditor();

// Document menu logic
document.querySelector('#dropdown-file .dropdown-menu-item:nth-child(1)').addEventListener('click', async () => { // New
    if (hasUnsavedChanges) {
        const discard = await showModal("You have unsaved changes. Are you sure you want to open a new file and lose them?", "Yes");
        if (!discard) return;
    }
    // Load without any file params
    window.location.href = window.location.pathname;
});

let pickerCallback = null;
window.addEventListener('message', e => {
    if (e.data && e.data.type === 'FILE_PICKED') {
        if (pickerCallback) pickerCallback(e.data.path);
        pickerCallback = null;
    }
});

function openFilePicker(defaultPath) {
    return new Promise(resolve => {
        pickerCallback = resolve;
        if (window.parent && window.parent.openApp) {
            let path = defaultPath;
            if (path && typeof path === 'object') path = path.toString();
            window.parent.openApp('files', { mode: 'picker', defaultPath: path || '' });
        } else {
            customPrompt("Enter the full path of the file:", defaultPath || "/home/user/Documents/file.txt", "Open File").then(resolve);
        }
    });
}

document.querySelector('#dropdown-file .dropdown-menu-item:nth-child(2)').addEventListener('click', async () => { // Open
    if (hasUnsavedChanges) {
        const discard = await showModal("You have unsaved changes. Are you sure you want to open another file and lose them?", "Yes");
        if (!discard) return;
    }
    const path = await openFilePicker(currentFilePath);
    if (path) {
        window.location.href = `${window.location.pathname}?file=${encodeURIComponent(path)}`;
    }
});

document.querySelector('#dropdown-file .dropdown-menu-item:nth-child(3)').addEventListener('click', () => { // Save
    if (view) saveActiveFile(view);
});

document.querySelector('#dropdown-file .dropdown-menu-item:nth-child(4)').addEventListener('click', async () => { // Save As
    if (view) saveActiveFileAS(view);
});

document.querySelector('#dropdown-file .dropdown-menu-item:nth-child(6)').addEventListener('click', async () => { // Exit
    if (hasUnsavedChanges) {
        const discard = await showModal("You have unsaved changes. Are you sure you want to close and lose them?", "Close without saving");
        if (!discard) return;
    }
    if (window.parent) {
        const frames = window.parent.document.querySelectorAll('iframe');
        frames.forEach(f => {
            if (f.contentWindow === window) {
                f.closest('.window').remove();
            }
        });
    }
});

document.querySelector('#dropdown-edit .dropdown-menu-item:nth-child(1)').addEventListener('click', () => { // Undo
    if (view) undo(view);
});

document.querySelector('#dropdown-edit .dropdown-menu-item:nth-child(2)').addEventListener('click', () => { // Redo
    if (view) redo(view);
});

document.querySelector('#dropdown-edit .dropdown-menu-item:nth-child(4)').addEventListener('click', () => { // Cut
    if (!view) return;
    const text = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    navigator.clipboard.writeText(text);
    view.dispatch(view.state.replaceSelection(""));
});

document.querySelector('#dropdown-edit .dropdown-menu-item:nth-child(5)').addEventListener('click', () => { // Copy
    if (!view) return;
    const text = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    navigator.clipboard.writeText(text);
});

document.querySelector('#dropdown-edit .dropdown-menu-item:nth-child(6)').addEventListener('click', async () => { // Paste
    if (!view) return;
    try {
        const text = await navigator.clipboard.readText();
        view.dispatch(view.state.replaceSelection(text));
    } catch (err) {
        console.error('Failed to read clipboard contents: ', err);
    }
});

document.querySelector('#dropdown-view .dropdown-menu-item:nth-child(1)').addEventListener('click', () => { // Word Wrap
    if (!view) return;
    isWordWrap = !isWordWrap;
    view.dispatch({
        effects: wordWrapCompartment.reconfigure(isWordWrap ? [EditorView.lineWrapping] : [])
    });
});

let currentZoom = 14;
document.querySelector('#dropdown-view .dropdown-menu-item:nth-child(2)').addEventListener('click', () => { // Zoom In
    const editorNode = document.querySelector('.cm-editor');
    if (editorNode) {
        currentZoom += 2;
        editorNode.style.fontSize = currentZoom + 'px';
        view.requestMeasure();
    }
});

document.querySelector('#dropdown-view .dropdown-menu-item:nth-child(3)').addEventListener('click', () => { // Zoom Out
    const editorNode = document.querySelector('.cm-editor');
    if (editorNode) {
        currentZoom = Math.max(8, currentZoom - 2);
        editorNode.style.fontSize = currentZoom + 'px';
        view.requestMeasure();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
            e.preventDefault();
            document.querySelector('#dropdown-view .dropdown-menu-item:nth-child(2)').click();
        } else if (e.key === '-') {
            e.preventDefault();
            document.querySelector('#dropdown-view .dropdown-menu-item:nth-child(3)').click();
        }
    }
});

document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
            document.querySelector('#dropdown-view .dropdown-menu-item:nth-child(2)').click();
        } else if (e.deltaY > 0) {
            document.querySelector('#dropdown-view .dropdown-menu-item:nth-child(3)').click();
        }
    }
}, { passive: false });

// Menu dropdowns UI toggle
const menuButtons = document.querySelectorAll('.top-bar-button');

menuButtons.forEach(button => {
    button.addEventListener('click', (e) => {
        // Close all other menus first
        menuButtons.forEach(btn => {
            if (btn !== button) {
                const dropdown = btn.querySelector('.dropdown-menu');
                if (dropdown) dropdown.classList.add('hidden');
            }
        });
        
        // Toggle the clicked menu
        const dropdown = button.querySelector('.dropdown-menu');
        if (dropdown) dropdown.classList.toggle('hidden');
        
        e.stopPropagation();
    });
});

// Close open menus if clicking outside
document.addEventListener('click', () => {
    menuButtons.forEach(button => {
        const dropdown = button.querySelector('.dropdown-menu');
        if (dropdown && !dropdown.classList.contains('hidden')) {
            dropdown.classList.add('hidden');
        }
    });
});
