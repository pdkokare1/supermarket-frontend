// --- Local State Management ---
let cartCount = 0;
let currentSelectedProduct = { name: '', price: '' };

// --- Modal Logic ---
const modalOverlay = document.getElementById('product-modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalPrice = document.getElementById('modal-price');
const cartCountDisplay = document.getElementById('cart-count');
const toastContainer = document.getElementById('toast-container');

function openModal(productName, productPrice) {
    // Store current selection
    currentSelectedProduct.name = productName;
    currentSelectedProduct.price = productPrice;

    // Inject data into the modal UI
    modalTitle.innerText = productName;
    modalPrice.innerText = productPrice;

    // Trigger the slide-up and screen blur transition
    modalOverlay.classList.add('active');
}

function closeModal() {
    // Remove the active class to slide down and remove blur
    modalOverlay.classList.remove('active');
}

// --- Cart & Toast Logic ---
function addToCart() {
    // Increment cart state
    cartCount++;
    cartCountDisplay.innerText = cartCount;

    // Trigger automated UI feedback
    showToast(`Added ${currentSelectedProduct.name} to cart`);

    // Close the modal immediately for a frictionless feel
    closeModal();
}

function showToast(message) {
    // Create the toast element dynamically
    const toast = document.createElement('div');
    toast.classList.add('toast');
    toast.innerText = message;

    // Append to our fixed container
    toastContainer.appendChild(toast);

    // Automated timing: Remove the element from the DOM after the 3-second CSS animation completes
    setTimeout(() => {
        toast.remove();
    }, 3000);
}
