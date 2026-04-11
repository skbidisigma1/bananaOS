// Command Registry
import { db } from "../../js/db.js";

export const commands = {
    help: async (args) => {
        return args.join(' ') + '\nAvailable commands:\n- help: Show this message\n- echo: Echo an input back to the terminal\n- whoami: Show the current user\n- clear: Clear the terminal history';
    },
    echo: async (args) => {
        return args.join(' ');
    },
    whoami: async () => {
        const usernameEntry = await db.config.get('username');
        const username = usernameEntry ? (usernameEntry.value || 'user') : 'user';
        return 'You are ' + username;
    },
    clear: async () => {
        const history = document.getElementById('terminal-history');
        history.innerHTML = '';
        return '';
    }
};