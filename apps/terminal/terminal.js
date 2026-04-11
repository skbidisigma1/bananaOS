// Terminal app code
import { db } from "../../js/db.js";
import { commands } from "./commands.js";

// Variables
const usernameEntry = await db.config.get('username');
const prompt = document.getElementById('prompt');
const input = document.getElementById('terminal-input');
const history = document.getElementById('terminal-history');
const terminalContainer = document.getElementById('terminal');

// Set prompt to username on load
if (usernameEntry) {
    const username = usernameEntry.value || 'user';
    prompt.textContent = `${username}@bananaOS:~$ `;
};

// Commands
input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const inputValue = input.value.trim();
        const [command, ...args] = inputValue.split(' ');

        // Append the command to history
        appendToHistory(`${prompt.textContent}${inputValue}`);

        // Execute command if it exists
        if (commands[command.toLowerCase()]) {
                const output = await commands[command.toLowerCase()](args);
                appendToHistory(output);
        } else if (inputValue !== '') {
                appendToHistory(`Command not found: ${command}`);
            }
            input.value = '';
        }
});

// Focus input whenever terminal is clicked
terminalContainer.addEventListener('click', () => {
    input.focus();
});

// Prevent focus loss when clicking outside the terminal
input.addEventListener('blur', () => {
    setTimeout(() => {
        if (!terminalContainer.contains(document.activeElement)) {
            input.focus();
        }
    }, 0);
});


// Helper to append text to history
function appendToHistory(text) {
    const line = document.createElement('div');
    line.textContent = text;
    if (line.textContent.includes('Command not found')) {
        line.style.color = 'red';
    }
    history.appendChild(line);
    history.scrollTop = history.scrollHeight; // Scroll to bottom
}