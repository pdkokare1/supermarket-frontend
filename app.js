// --- Configuration ---
const BACKEND_URL = 'https://supermarket-backend-production-3a4d.up.railway.app';
const DELIVERY_FEE = 20;

// --- Local State Management ---
let allProducts = []; 
let cart = []; 
let currentSelectedProduct = null;

// --- DOM Elements (Views & Nav) ---
const views = {
    shop: document.getElementById('shop-view'),
    orders: document.getElementById('orders-view')
};
const navBtns = {
    shop: document.getElementById('nav-shop'),
    orders: document.getElementById('nav-orders')
};

// --- DOM Elements (Catalog & Cart) ---
const storefront = document.getElementById('storefront');
const modalOverlay = document.getElementById('product-modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalPrice = document.getElementById('modal-price');
const cartCountDisplay = document.getElementById('cart-count');
const toastContainer = document.getElementById('toast-container');
const cartView = document.getElementById('cart-view');
const cartItemsContainer = document.getElementById('cart-items-container');
const cartSubtotalEl = document.getElementById('cart-subtotal');
const cartDeliveryEl = document.getElementById('cart-delivery');
const cartTotalEl = document.getElementById('cart-total');

// --- DOM Elements (Tracking) ---
const trackingContent = document.getElementById('tracking-content');

// --- View Toggling ---
function switchView(viewName) {
    Object.keys(views).forEach(key => {
        if (key === viewName) {
            views[key].classList.add('active');
            views[key].classList.remove('hidden');
            navBtns[key].classList.add('active');
        } else {
            views[key].classList.remove('active');
            views[key].classList.add('hidden');
            navBtns[key].classList.remove('active');
        }
    });

    // If switching to orders tab, actively pull the latest tracking data
    if (viewName === 'orders') {
        checkOrderStatus();
    }
}

// --- Live Data Fetching & Rendering ---
async function fetchProducts() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/products`);
        const result = await response.json();

        if (result.success && result.data) {
            allProducts = result.data; 
            renderProducts(allProducts); 
        }
    } catch (error) {
        console.error('Error fetching live catalog:', error);
        storefront.innerHTML = '<p style="text-align:center; grid-column: span 2; color: #94A3B8;">Failed to load market items. Please refresh.</p>';
    }
}

function renderProducts(productsToRender) {
    storefront.innerHTML = ''; 
    
    if (productsToRender.length === 0) {
        storefront.innerHTML = '<p style="text-align:center; grid-column: span 2; color: #94A3B8; margin-top: 40px;">No items found in this category.</p>';
        return;
    }

    productsToRender.forEach(product => {
        const card = createProductCard(product);
        storefront.appendChild(card);
    });
}

function filterCategory(category, btnElement) {
    document.querySelectorAll('.category-pill').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');

    if (category === 'All') {
        renderProducts(allProducts);
    } else {
        const filtered = allProducts.filter(p => p.category === category);
        renderProducts(filtered);
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

// --- Cart Logic ---
function addToCart() {
    const existingItem = cart.find(item => item._id === currentSelectedProduct._id);
    if (existingItem) {
        existingItem.qty += 1; 
    } else {
        cart.push({ ...currentSelectedProduct, qty: 1 });
    }
    updateCartUI();
    showToast(`Added ${currentSelectedProduct.name}`);
    closeModal();
}

function updateCartUI() {
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    cartCountDisplay.innerText = totalItems;

    cartItemsContainer.innerHTML = '';
    
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<p style="text-align:center; color: #94A3B8; margin-top:40px;">Your cart is empty.</p>';
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
        if (cart[itemIndex].qty <= 0) cart.splice(itemIndex, 1);
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

// --- Checkout & Tracking Logic ---
async function placeOrder() {
    if (cart.length === 0) {
        showToast('Your cart is empty!');
        return;
    }

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const finalTotal = subtotal + DELIVERY_FEE;

    const checkoutBtn = document.querySelector('.checkout-btn');
    checkoutBtn.innerText = 'Processing...';
    checkoutBtn.disabled = true;

    try {
        const response = await fetch(`${BACKEND_URL}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: cart,
                totalAmount: finalTotal
            })
        });

        const result = await response.json();

        if (result.success) {
            // Save the exact database ID to the browser's persistent memory
            localStorage.setItem('dailyPick_activeOrderId', result.orderId);
            
            cart = [];
            updateCartUI();
            closeCart();
            
            // Automatically switch the user to the tracking screen
            switchView('orders');
            showToast('Order Placed Successfully! 🚀');
        } else {
            showToast('Failed to place order.');
        }
    } catch (error) {
        showToast('Network error. Check your connection.');
    } finally {
        checkoutBtn.innerText = 'Place Order';
        checkoutBtn.disabled = false;
    }
}

async function checkOrderStatus() {
    // Look in the phone's memory for a saved order
    const savedOrderId = localStorage.getItem('dailyPick_activeOrderId');
    
    if (!savedOrderId) {
        trackingContent.innerHTML = '<p class="empty-state">You have no active orders right now.</p>';
        return;
    }

    trackingContent.innerHTML = '<p class="empty-state">Fetching live status...</p>';

    try {
        const response = await fetch(`${BACKEND_URL}/api/orders/${savedOrderId}`);
        const result = await response.json();

        if (result.success) {
            const order = result.data;
            const timeString = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            // Render the live tracking card
            trackingContent.innerHTML = `
                <div class="tracking-card">
                    <h3>Order #${(order._id).toString().slice(-4).toUpperCase()}</h3>
                    <p>Placed at ${timeString}</p>
                    
                    <div class="status-badge ${order.status === 'Dispatched' ? 'dispatched' : ''}">
                        ${order.status}
                    </div>
                    
                    <div style="margin-top: 24px; font-size: 14px; font-weight: 500;">
                        Total Amount: ₹${order.totalAmount}
                    </div>
                </div>
            `;
        } else {
            trackingContent.innerHTML = '<p class="empty-state">Order details could not be found.</p>';
        }
    } catch (error) {
        trackingContent.innerHTML = '<p class="empty-state">Network error checking status.</p>';
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.classList.add('toast');
    toast.innerText = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// --- Boot Sequence ---
fetchProducts();
