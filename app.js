// --- Configuration ---
const BACKEND_URL = 'https://supermarket-backend-production-3a4d.up.railway.app';

// --- Local State Management ---
let cartCount = 0;
let currentSelectedProduct = { name: '', price: '' };

// --- DOM Elements ---
const storefront = document.getElementById('storefront');
const modalOverlay = document.getElementById('product-modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalPrice = document.getElementById('modal-price');
const cartCountDisplay = document.getElementById('cart-count');
const toastContainer = document.getElementById('toast-container');

// --- Live Data Fetching ---
async function fetchProducts() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/products`);
        const result = await response.json();

        if (result.success && result.data) {
            storefront.innerHTML = ''; // Clear any existing content
            result.data.forEach(product => {
                const card = createProductCard(product);
                storefront.appendChild(card);
            });
        }
    } catch (error) {
        console.error('Error fetching live catalog:', error);
        storefront.innerHTML = '<p style="text-align:center; grid-column: span 2;">Failed to load market items. Please refresh.</p>';
    }
}

function createProductCard(product) {
    const card = document.createElement('div');
    card.classList.add('product-card');
    
    // Assign an emoji based on category for MVP visuals
    let emoji = '📦';
    if (product.category === 'Dairy') emoji = '🥛';
    if (product.category === 'Bakery') emoji = '🍞';
    if (product.category === 'Produce') emoji = '🍌';

    // Build the touch-friendly card HTML
    card.innerHTML = `
        <div class="product-image">${emoji}</div>
        <h3>${product.name}</h3>
        <p class="product-weight">${product.weightOrVolume}</p>
        <button class="add-btn">Add - ₹${product.price}</button>
    `;

    // Attach the modal trigger
    card.onclick = () => openModal(product.name, `₹${product.price}`);
    
    return card;
}

// --- Modal Logic ---
function openModal(productName, productPrice) {
    currentSelectedProduct.name = productName;
    currentSelectedProduct.price = productPrice;
    modalTitle.innerText = productName;
    modalPrice.innerText = productPrice;
    modalOverlay.classList.add('active');
}

function closeModal() {
    modalOverlay.classList.remove('active');
}

// --- Cart & Toast Logic ---
function addToCart() {
    cartCount++;
    cartCountDisplay.innerText = cartCount;
    showToast(`Added ${currentSelectedProduct.name} to cart`);
    closeModal();
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.classList.add('toast');
    toast.innerText = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// --- Boot Sequence ---
// Fetch and display live data immediately when the script loads
fetchProducts();
