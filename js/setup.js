// Variables
let currentStep = 1;

const steps = document.querySelectorAll('.step');
const continueBtns = document.querySelectorAll('.continue-button');
const backBtns = document.querySelectorAll('.back-button');
const radioBtns = document.querySelectorAll('input[type="radio"]');
const usernameInput = document.getElementById('username-input');
const pfpInput = document.getElementById('pfp-upload');
const pfpPreview = document.getElementById('pfp-preview-img');
const pfpPreviewBox = document.querySelector('.preview-box');

// Event Listeners for continue buttons
continueBtns.forEach(button => {
    button.addEventListener('click', () => {

        if (currentStep === 3) {
            // TODO: Save selections to IndexedDB
            window.location.href = './desktop';
        }

        // Hide current step
        document.getElementById(`step-${currentStep}`).classList.add('hidden');

        // Increment step
        currentStep++;

        // Show next step
        document.getElementById(`step-${currentStep}`).classList.remove('hidden');
    })
});

// Event Listeners for back buttons
backBtns.forEach(button => {
    button.addEventListener('click', () => {

        // Hide current step
        document.getElementById(`step-${currentStep}`).classList.add('hidden');

        // Decrement step
        currentStep--;

        // Show next step
        document.getElementById(`step-${currentStep}`).classList.remove('hidden');
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