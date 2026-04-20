import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { oneDark } from "@codemirror/theme-one-dark";

// Elements for the status bar
const lnCol = document.getElementById('ln-col');
const characters = document.getElementById('characters');
const words = document.getElementById('words');

// Function to update the status bar
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
}

const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet) {
        updateStatusBar(update.view);
    }
});

// Setup CodeMirror
const parent = document.getElementById("editor-container");
const state = EditorState.create({
    doc: "",
    extensions: [
        basicSetup,
        oneDark,
        javascript(),
        html(),
        css(),
        updateListener
    ]
});

const view = new EditorView({
    state,
    parent
});

// Initialize status bar
updateStatusBar(view);

// Menu logic
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
        
        e.stopPropagation(); // prevent document click from closing it immediately
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
