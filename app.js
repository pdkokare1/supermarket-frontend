// --- Configuration ---
const BACKEND_URL = 'https://supermarket-backend-production-3a4d.up.railway.app';
const DELIVERY_FEE = 20;

// --- Local State Management ---
let allProducts = []; 
let cart = []; 

// --- DOM Elements ---
const storefront = document.getElementById('storefront');
const skeletonGrid = document.getElementById('skeleton-grid');
const cartRibbon = document.getElementById('cart-ribbon');
const cartView = document.getElementById('cart-view');
const cartItemsContainer = document.getElementById('cart-items-container');
const toastContainer = document.getElementById('toast-container');
const trackingContent = document.getElementById('tracking-content');

const views = {
    shop: document.getElementById('shop-view'),
    orders: document.getElementById('orders-view')
};
const navBtns = {
    shop: document.getElementById('nav-shop'),
    orders: document.getElementById('nav-orders')
};

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

    if (viewName === 'orders') checkOrderStatus();
}

// --- Live Data Fetching & Rendering ---
async function fetchProducts() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/products`);
        const result = await response.json();

        if (result.success && result.data) {
            allProducts = result.data; 
            // Hide skeletons, show real grid
            skeletonGrid.classList.add('hidden');
            storefront.classList.remove('hidden');
            renderProducts(allProducts); 
        }
    } catch (error) {
        skeletonGrid.innerHTML = '<p style="grid-column: span 2; text-align:center;">Failed to connect.</p>';
    }
}

function renderProducts(productsToRender) {
    storefront.innerHTML = ''; 
    
    productsToRender.forEach(product => {
        const card = document.createElement('div');
        card.classList.add('product-card');
        
        let emoji = '📦';
        if (product.category === 'Dairy') emoji = '🥛';
        if (product.category === 'Bakery') emoji = '🍞';
        if (product.category === 'Produce') emoji = '🍌';
        if (product.category === 'Pantry') emoji = '🌾';

        card.innerHTML = `
            <div>
                <div class="product-image">${emoji}</div>
                <div class="product-info">
                    <h3>${product.name}</h3>
                    <p class="product-weight">${product.weightOrVolume}</p>
                </div>
            </div>
            <div class="price-action-row">
                <div class="product-price">₹${product.price}</div>
                <div class="action-container" id="action-container-${product._id}">
                    </div>
            </div>
        `;
        storefront.appendChild(card);
        
        // Immediately render the correct button state for this card
        updateCardActionUI(product._id);
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

// --- Quick Commerce Cart Engine ---
function quickAdd(productId) {
    const product = allProducts.find(p => p._id === productId);
    if (!product) return;
    
    cart.push({ ...product, qty: 1 });
    updateCardActionUI(productId);
    updateGlobalCartUI();
}

function adjustQty(productId, change) {
    const itemIndex = cart.findIndex(item => item._id === productId);
    if (itemIndex > -1) {
        cart[itemIndex].qty += change;
        if (cart[itemIndex].qty <= 0) {
            cart.splice(itemIndex, 1); // Remove if 0
        }
    }
    updateCardActionUI(productId);
    updateGlobalCartUI();
}

// Surgically updates just the one button container on the storefront grid
function updateCardActionUI(productId) {
    const container = document.getElementById(`action-container-${productId}`);
    if (!container) return; // Happens if the item is filtered out of view
    
    const cartItem = cart.find(item => item._id === productId);
    const qty = cartItem ? cartItem.qty : 0;
    
    if (qty === 0) {
        container.innerHTML = `<button class="add-btn" onclick="quickAdd('${productId}')">ADD</button>`;
    } else {
        container.innerHTML = `
            <div class="stepper">
                <button onclick="adjustQty('${productId}', -1)">−</button>
                <span>${qty}</span>
                <button onclick="adjustQty('${productId}', 1)">+</button>
            </div>
        `;
    }
}

function updateGlobalCartUI() {
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    
    // 1. Toggle the Sticky Ribbon
    if (totalItems > 0) {
        document.getElementById('ribbon-items-count').innerText = `${totalItems} ITEM${totalItems > 1 ? 'S' : ''}`;
        document.getElementById('ribbon-total-price').innerText = `₹${subtotal}`;
        cartRibbon.classList.remove('hidden');
    } else {
        cartRibbon.classList.add('hidden');
    }

    // 2. Render Full Cart View (only if it's open, but we update DOM anyway for safety)
    cartItemsContainer.innerHTML = '';
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<p style="text-align:center; color: #94A3B8; margin-top:40px;">Your cart is empty.</p>';
        document.getElementById('cart-subtotal').innerText = '₹0';
        document.getElementById('cart-total').innerText = '₹0';
        return;
    }

    cart.forEach(item => {
        const row = document.createElement('div');
        row.classList.add('cart-item-row');
        row.innerHTML = `
            <div style="font-size: 24px;">🏷️</div>
            <div class="cart-item-info">
                <div class="cart-item-title">${item.name}</div>
                <div class="cart-item-price">₹${item.price}</div>
            </div>
            <div class="action-container" style="width: 72px;">
                <div class="stepper">
                    <button onclick="adjustQty('${item._id}', -1)">−</button>
                    <span>${item.qty}</span>
                    <button onclick="adjustQty('${item._id}', 1)">+</button>
                </div>
            </div>
        `;
        cartItemsContainer.appendChild(row);
    });

    document.getElementById('cart-subtotal').innerText = `₹${subtotal}`;
    document.getElementById('cart-total').innerText = `₹${subtotal + DELIVERY_FEE}`;
}

function openCart() {
    if (cart.length === 0) return; // Don't open empty cart
    updateGlobalCartUI(); 
    cartView.classList.add('active');
}

function closeCart() {
    cartView.classList.remove('active');
}

// --- Checkout & Tracking Logic ---
async function placeOrder() {
    if (cart.length === 0) return;

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const finalTotal = subtotal + DELIVERY_FEE;

    const checkoutBtn = document.querySelector('.checkout-btn');
    checkoutBtn.innerText = 'Processing...';
    checkoutBtn.disabled = true;

    try {
        const response = await fetch(`${BACKEND_URL}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: cart, totalAmount: finalTotal })
        });

        const result = await response.json();

        if (result.success) {
            localStorage.setItem('dailyPick_activeOrderId', result.orderId);
            
            cart = [];
            // Re-render the grid to clear all the steppers back to "ADD"
            renderProducts(allProducts);
            updateGlobalCartUI();
            closeCart();
            
            switchView('orders');
            showToast('Order Received! 🚀');
        } else {
            showToast('Failed to place order.');
        }
    } catch (error) {
        showToast('Network error.');
    } finally {
        checkoutBtn.innerText = 'Place Order';
        checkoutBtn.disabled = false;
    }
}

async function checkOrderStatus() {
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
            
            trackingContent.innerHTML = `
                <div class="tracking-card">
                    <h3>Order #${(order._id).toString().slice(-4).toUpperCase()}</h3>
                    <p>Placed at ${timeString}</p>
                    <div class="status-badge ${order.status === 'Dispatched' ? 'dispatched' : ''}">
                        ${order.status}
                    </div>
                    <div style="margin-top: 24px; font-size: 14px; font-weight: 700;">
                        To Pay: ₹${order.totalAmount} (COD)
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
    setTimeout(() => toast.remove(), 2500);
}

// --- Boot Sequence ---
fetchProducts();
