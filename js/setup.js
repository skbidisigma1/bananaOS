// Database import
import { db, isSetupComplete, initFS } from './db.js';

// Variables
let currentStep = 1;

const continueBtns = document.querySelectorAll('.continue-button');
const backBtns = document.querySelectorAll('.back-button');
const radioBtns = document.querySelectorAll('input[type="radio"]');
const usernameInput = document.getElementById('username-input');
const pfpInput = document.getElementById('pfp-upload');
const pfpPreview = document.getElementById('pfp-preview-img');
const pfpPreviewBox = document.querySelector('.preview-box');

// Check if setup is already complete before loading setup page
async function checkSetup() {
    const setupComplete = await isSetupComplete();

    if (setupComplete) {
        // Redirect to desktop page if already set up
        window.location.replace('./desktop');
} else {
    // Unhide body since setup is not complete
    document.body.classList.remove('hidden');
    }
}

// Run setup check immediately
checkSetup();

// Event listeners for continue buttons
continueBtns.forEach(button => {
    button.addEventListener('click', () => {

        if (currentStep === 3) {
            // Save settings to IndexedDB THEN redirect to desktop
            saveSettings().then(() => {
                window.location.href = './desktop';
            }).catch(err => {
                console.error('Error saving settings:', err);
            });
            return;
        }

        // Hide current step
        document.getElementById(`step-${currentStep}`).classList.add('hidden');

        // Hide current step buttons
        document.getElementById(`button-container-${currentStep}`).classList.add('hidden');

        // Increment step
        currentStep++;

        // Show next step
        document.getElementById(`step-${currentStep}`).classList.remove('hidden');

        // Show next step buttons
        document.getElementById(`button-container-${currentStep}`).classList.remove('hidden');
    })
});

// Event listeners for back buttons
backBtns.forEach(button => {
    button.addEventListener('click', () => {

        // Hide current step
        document.getElementById(`step-${currentStep}`).classList.add('hidden');

        // Hide current step buttons
        document.getElementById(`button-container-${currentStep}`).classList.add('hidden');

        // Decrement step
        currentStep--;

        // Show previous step
        document.getElementById(`step-${currentStep}`).classList.remove('hidden');

        // Show previous step buttons
        document.getElementById(`button-container-${currentStep}`).classList.remove('hidden');
    })

});

// Event listeners for radio buttons to enable theme continue button
radioBtns.forEach(radio => {
    radio.addEventListener('change', () => {
        const themeContinueBtn = document.getElementById('theme-continue-button');
        if (radio.checked) {
            themeContinueBtn.disabled = false;
        }
    });
});

// Event listener for username input with validation to enable profile continue button
usernameInput.addEventListener('input', () => {
    const profileContinueBtn = document.getElementById('profile-continue-button');
    let usernameValue = usernameInput.value;
    const sanitizedValue = usernameValue.replace(/[^a-zA-Z]/g, '').toLowerCase(); // Remove invalid characters and convert to lowercase

    if (usernameValue !== sanitizedValue) {
        usernameInput.value = sanitizedValue; // Update input with sanitized value in real time
    }

    const isValidLength = sanitizedValue.length >= 3 && sanitizedValue.length <= 10;
        profileContinueBtn.disabled = !isValidLength; // Enable if valid length

    if (isValidLength) {
        usernameInput.classList.add('green-border');
        usernameInput.classList.remove('red-border');
    } else {
        usernameInput.classList.add('red-border');
        usernameInput.classList.remove('green-border');
    }
});

// Event listener for profile picture upload
pfpInput.addEventListener('change', () => {
    const file = pfpInput.files[0];

    if (file) {
        const tempPath = URL.createObjectURL(file); // Create temporary URL for image

        pfpPreview.src = tempPath;
        pfpPreview.style.display = 'block';

        pfpPreviewBox.classList.remove('hidden');
    }
});

// Database Operations
async function saveSettings() {
    // First convert pfp to base64 string if it exists
    let pfpBase64;

    if (pfpInput.files && pfpInput.files.length > 0) {
        pfpBase64 = await convertFileToBase64(pfpInput.files[0]);
    } else {
        // If no profile picture is uploaded, fetch default svg
        const response = await fetch('./assets/images/user.svg');
        const blob = await response.blob();
        pfpBase64 = await convertFileToBase64(blob); // Default profile picture
    }

    // Validate theme selection and username
    let theme;

    try {
        theme = document.querySelector('input[name="theme"]:checked').value;
    } catch (error) {
        throw new Error('No theme selected');
    }

    if (theme !== 'light' && theme !== 'dark' && theme !== 'default') {
        throw new Error('Invalid theme selected');
    }

    let username;

    try {
        username = usernameInput.value;
    } catch (error) {
        throw new Error('Username input is invalid');
    }

    if (username.length < 3 || username.length > 10) {
        throw new Error('Username must be between 3 and 10 characters');
    }

    // Save values to IndexedDB
    await db.config.put({ key: 'theme', value: theme });
    await db.config.put({ key: 'username', value: username });
    await db.config.put({ key: 'pfp', value: pfpBase64 });
    await db.config.put({ key: 'setupComplete', value: true });

    // Initialize the file system upon completing setup
    await initFS();
}

// Helper to convert image to base64 string
function convertFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}