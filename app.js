// --- Configuration ---
const BACKEND_URL = 'https://supermarket-backend-production-3a4d.up.railway.app';
const DELIVERY_FEE = 20; // Fixed flat fee

// --- Local State Management ---
let cart = []; // Upgraded to an active memory array
let currentSelectedProduct = null;

// --- DOM Elements ---
const storefront = document.getElementById('storefront');
const modalOverlay = document.getElementById('product-modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalPrice = document.getElementById('modal-price');
const cartCountDisplay = document.getElementById('cart-count');
const toastContainer = document.getElementById('toast-container');

// Cart DOM Elements
const cartView = document.getElementById('cart-view');
const cartItemsContainer = document.getElementById('cart-items-container');
const cartSubtotalEl = document.getElementById('cart-subtotal');
const cartDeliveryEl = document.getElementById('cart-delivery');
const cartTotalEl = document.getElementById('cart-total');

// --- Live Data Fetching ---
async function fetchProducts() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/products`);
        const result = await response.json();

        if (result.success && result.data) {
            storefront.innerHTML = ''; 
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
    
    let emoji = '📦';
    if (product.category === 'Dairy') emoji = '🥛';
    if (product.category === 'Bakery') emoji = '🍞';
    if (product.category === 'Produce') emoji = '🍌';
    if (product.category === 'Pantry') emoji = '🌾';

    card.innerHTML = `
        <div class="product-image">${emoji}</div>
        <h3>${product.name}</h3>
        <p class="product-weight">${product.weightOrVolume}</p>
        <button class="add-btn">Add - ₹${product.price}</button>
    `;

    // Pass the entire product object to the modal
    card.onclick = () => openModal(product);
    return card;
}

// --- Modal Logic ---
function openModal(product) {
    currentSelectedProduct = product;
    modalTitle.innerText = product.name;
    modalPrice.innerText = `₹${product.price}`;
    modalOverlay.classList.add('active');
}

function closeModal() {
    modalOverlay.classList.remove('active');
}

// --- Cart & Checkout Logic ---
function addToCart() {
    const existingItem = cart.find(item => item._id === currentSelectedProduct._id);
    
    if (existingItem) {
        existingItem.qty += 1; 
    } else {
        cart.push({ ...currentSelectedProduct, qty: 1 });
    }

    updateCartUI();
    showToast(`Added ${currentSelectedProduct.name} to cart`);
    closeModal();
}

function updateCartUI() {
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    cartCountDisplay.innerText = totalItems;

    cartItemsContainer.innerHTML = '';
    
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<p style="text-align:center; color:gray; margin-top:40px;">Your cart is empty.</p>';
        cartSubtotalEl.innerText = '₹0';
        cartTotalEl.innerText = '₹0';
        return;
    }

    let subtotal = 0;

    cart.forEach(item => {
        subtotal += (item.price * item.qty);

        const row = document.createElement('div');
        row.classList.add('cart-item-row');
        row.innerHTML = `
            <div style="font-size: 24px;">🏷️</div>
            <div class="cart-item-info">
                <div class="cart-item-title">${item.name}</div>
                <div class="cart-item-price">₹${item.price}</div>
            </div>
            <div class="qty-controls">
                <button class="qty-btn" onclick="adjustQty('${item._id}', -1)">-</button>
                <span style="font-weight:bold;">${item.qty}</span>
                <button class="qty-btn" onclick="adjustQty('${item._id}', 1)">+</button>
            </div>
        `;
        cartItemsContainer.appendChild(row);
    });

    cartSubtotalEl.innerText = `₹${subtotal}`;
    cartDeliveryEl.innerText = `₹${DELIVERY_FEE}`;
    cartTotalEl.innerText = `₹${subtotal + DELIVERY_FEE}`;
}

function adjustQty(productId, change) {
    const itemIndex = cart.findIndex(item => item._id === productId);
    if (itemIndex > -1) {
        cart[itemIndex].qty += change;
        
        if (cart[itemIndex].qty <= 0) {
            cart.splice(itemIndex, 1);
        }
    }
    updateCartUI();
}

function openCart() {
    updateCartUI(); 
    cartView.classList.add('active');
}

function closeCart() {
    cartView.classList.remove('active');
}

async function placeOrder() {
    if (cart.length === 0) {
        showToast('Your cart is empty!');
        return;
    }

    // 1. Calculate the final total payload
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const finalTotal = subtotal + DELIVERY_FEE;

    // 2. Lock UI to prevent duplicate orders
    const checkoutBtn = document.querySelector('.checkout-btn');
    checkoutBtn.innerText = 'Processing...';
    checkoutBtn.disabled = true;

    try {
        // 3. Transmit the order to Railway
        const response = await fetch(`${BACKEND_URL}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                items: cart,
                totalAmount: finalTotal
            })
        });

        const result = await response.json();

        if (result.success) {
            // 4. Success Sequence
            cart = [];
            updateCartUI();
            closeCart();
            showToast('Order Placed Successfully! 🚀');
        } else {
            showToast('Failed to place order. Please try again.');
        }
    } catch (error) {
        console.error('Checkout error:', error);
        showToast('Network error. Check your connection.');
    } finally {
        // 5. Release UI lock
        checkoutBtn.innerText = 'Place Order (Cash on Delivery)';
        checkoutBtn.disabled = false;
    }
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
fetchProducts();
