/* app.js */
const BACKEND_URL = 'https://dailypick-backend-production-05d6.up.railway.app';
const DELIVERY_FEE = 20;

// --- MULTI-TENANT CONFIGURATION ---
// Set to FALSE to bypass the legacy single-store restriction and enable the DailyPick Hybrid Cart
const ENABLE_CART_ISOLATION = false; 

let allProducts = []; 
let cart = []; 
let selectedDeliveryType = 'Instant'; 
let selectedPaymentMethod = 'Cash'; // NEW: Default to COD
let allCategories = [];
let trackingStreamController = null; 
let isProcessingOrder = false; 

// GEOLOCATION STATE
let userLat = null;
let userLng = null;
let pendingProductToAdd = null;

// DOM Elements
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

const CATEGORY_IMAGES = {
    'Dairy & Breakfast': { emoji: '🥛', color: '#e0f2fe' },
    'Snacks & Munchies': { emoji: '🍿', color: '#ffedd5' },
    'Cold Drinks & Juices': { emoji: '🥤', color: '#dcfce7' },
    'Personal Care': { emoji: '🧴', color: '#fce7f3' },
    'Cleaning Essentials': { emoji: '🧽', color: '#f3e8ff' },
    'Grocery & Kitchen': { emoji: '🌾', color: '#fef3c7' }
};

// --- EXISTING: FIREBASE AUTHENTICATION CONFIGURATION ---
const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
let confirmationResult = null;

function openCustomerLogin() {
    const token = localStorage.getItem('dailyPick_customerToken');
    if (token) {
        if (confirm("You are already logged in. Do you want to logout?")) {
            logoutCustomer();
        }
    } else {
        document.getElementById('customer-login-modal').classList.remove('hidden');
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
                'size': 'normal',
                'callback': (response) => { }
            });
            window.recaptchaVerifier.render();
        }
    }
}

function closeCustomerLogin() {
    document.getElementById('customer-login-modal').classList.add('hidden');
    resetAuth();
}

function resetAuth() {
    document.getElementById('auth-step-1').classList.remove('hidden');
    document.getElementById('auth-step-2').classList.add('hidden');
    document.getElementById('auth-phone-input').value = '';
    document.getElementById('auth-otp-input').value = '';
}

function requestOTP() {
    const phoneNumber = document.getElementById('auth-phone-input').value.trim();
    if (!phoneNumber || phoneNumber.length < 10) return showToast("Enter a valid phone number with country code (e.g., +91).");

    const btn = document.getElementById('btn-request-otp');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    auth.signInWithPhoneNumber(phoneNumber, window.recaptchaVerifier)
        .then((confResult) => {
            confirmationResult = confResult;
            document.getElementById('auth-step-1').classList.add('hidden');
            document.getElementById('auth-step-2').classList.remove('hidden');
            showToast("OTP Sent!");
        }).catch((error) => {
            console.error(error);
            showToast("Error sending OTP. Check number format or Recaptcha.");
            if (window.recaptchaVerifier) window.recaptchaVerifier.render();
        }).finally(() => {
            btn.textContent = 'Send OTP';
            btn.disabled = false;
        });
}

function verifyOTP() {
    const code = document.getElementById('auth-otp-input').value.trim();
    if (code.length !== 6) return showToast("Enter the 6-digit OTP.");

    const btn = document.getElementById('btn-verify-otp');
    btn.textContent = 'Verifying...';
    btn.disabled = true;

    confirmationResult.confirm(code).then((result) => {
        const user = result.user;
        return user.getIdToken();
    }).then((idToken) => {
        localStorage.setItem('dailyPick_customerToken', idToken);
        showToast("Login Successful! 🎉");
        closeCustomerLogin();
        updateAuthUI();
    }).catch((error) => {
        showToast("Invalid OTP.");
        console.error(error);
    }).finally(() => {
        btn.textContent = 'Verify & Login';
        btn.disabled = false;
    });
}

function logoutCustomer() {
    auth.signOut().then(() => {
        localStorage.removeItem('dailyPick_customerToken');
        showToast("Logged out successfully.");
        updateAuthUI();
    });
}

function updateAuthUI() {
    const token = localStorage.getItem('dailyPick_customerToken');
    const profileIcon = document.querySelector('.profile-icon');
    if (token) {
        profileIcon.textContent = '🟢'; 
    } else {
        profileIcon.textContent = '👤'; 
    }
}

// --- EXISTING APP LOGIC ---

function initializeLocationAndFetch() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userLat = position.coords.latitude;
                userLng = position.coords.longitude;
                document.querySelector('.delivery-location').textContent = '📍 Near You ▼';
                fetchProducts(); 
            },
            (error) => {
                console.warn("Location access denied or failed. Loading default catalog.");
                fetchProducts(); 
            }
        );
    } else {
        fetchProducts();
    }
}

async function storeFetchWithAuth(url, options = {}) {
    const token = localStorage.getItem('dailyPick_customerToken'); 
    options.headers = options.headers || {};
    options.credentials = 'include';
    
    if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(url, options);
    
    if (response.status === 401 || response.status === 403) {
        console.warn('Unauthorized. Feature may require login.', url);
    }
    
    return response;
}

function optimizeCloudinaryUrl(url, width) {
    if (!url || !url.includes('cloudinary.com')) return url;
    if (url.includes('/upload/')) {
        return url.replace('/upload/', `/upload/q_auto,f_auto,w_${width}/`);
    }
    return url;
}

function switchView(viewName) { 
    Object.keys(views).forEach(key => { 
        if (key === viewName) {
            views[key].classList.add('active'); 
            views[key].classList.remove('hidden'); 
            document.getElementById(`nav-${key}`).classList.add('active');
        } else {
            views[key].classList.remove('active'); 
            views[key].classList.add('hidden'); 
            document.getElementById(`nav-${key}`).classList.remove('active');
        } 
    }); 
    
    if (viewName === 'orders') {
        checkOrderStatus(); 
    }
}

async function fetchCategories() {
    try {
        const res = await storeFetchWithAuth(`${BACKEND_URL}/api/categories`);
        const result = await res.json();
        
        if (result.success) {
            allCategories = result.data;
            const grid = document.getElementById('categories-grid');
            grid.innerHTML = ''; 
            
            const fragment = document.createDocumentFragment();
            allCategories.forEach(cat => {
                const visual = CATEGORY_IMAGES[cat.name] || { emoji: '🛍️', color: '#f1f5f9' };
                const card = document.createElement('div'); 
                card.className = 'category-card';
                card.addEventListener('click', () => filterCategory(cat.name));
                
                const imgWrapper = document.createElement('div');
                imgWrapper.className = 'category-img-wrapper';
                imgWrapper.style.backgroundColor = visual.color;
                imgWrapper.textContent = visual.emoji;
                
                const title = document.createElement('p');
                title.textContent = cat.name;
                
                card.appendChild(imgWrapper);
                card.appendChild(title);
                fragment.appendChild(card);
            });
            grid.appendChild(fragment);
        }
    } catch (e) { 
        console.error("Error fetching categories", e); 
    }
}

// --- NEW: PHASE 4 STORE-IN-STORE ENTERPRISE INTEGRATION ---
async function fetchEnterprisePartners() {
    try {
        // Fetch all active enterprise partners mapped in the database
        const res = await storeFetchWithAuth(`${BACKEND_URL}/api/stores?type=ENTERPRISE`);
        const result = await res.json();
        if (result.success && result.data && result.data.length > 0) {
            renderEnterpriseCarousel(result.data);
        }
    } catch(e) {
        console.warn("Could not load enterprise partners for Store-in-Store UI", e);
    }
}

function renderEnterpriseCarousel(stores) {
    let carousel = document.getElementById('enterprise-carousel');
    if (!carousel) {
        carousel = document.createElement('div');
        carousel.id = 'enterprise-carousel';
        carousel.className = 'enterprise-carousel';
        // Beautiful horizontal scrolling ribbon
        carousel.style.cssText = 'display: flex; gap: 12px; overflow-x: auto; padding: 10px 0; margin-bottom: 20px; scrollbar-width: none;';
        storefront.parentNode.insertBefore(carousel, storefront);
    }
    carousel.innerHTML = '';
    
    // Add "All" button to clear filter
    const allBtn = document.createElement('button');
    allBtn.style.cssText = 'padding: 8px 16px; border-radius: 20px; background: #e2e8f0; color: #334155; border: none; font-weight: bold; cursor: pointer; white-space: nowrap; flex-shrink: 0;';
    allBtn.textContent = `🌐 All Stores`;
    allBtn.onclick = () => filterCategory('All');
    carousel.appendChild(allBtn);

    stores.forEach(store => {
        const btn = document.createElement('button');
        btn.style.cssText = 'padding: 8px 16px; border-radius: 20px; background: #1e293b; color: white; border: none; font-weight: bold; cursor: pointer; white-space: nowrap; flex-shrink: 0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);';
        btn.textContent = `🏪 ${store.name}`;
        btn.onclick = () => filterByEnterpriseStore(store._id, store.name);
        carousel.appendChild(btn);
    });
}

function filterByEnterpriseStore(storeId, storeName) {
    document.getElementById('search-input').value = '';
    const title = document.getElementById('product-grid-title');
    title.textContent = `Store-in-Store: ${storeName}`;
    
    // Dynamically filter global catalog down to ONLY what is actively stocked by this partner
    const filtered = allProducts.filter(p => {
        return p.variants && p.variants.some(v => v.storeId === storeId);
    });
    
    renderProducts(filtered);
    title.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// -----------------------------------------------------------

async function fetchProducts() { 
    try { 
        let url = `${BACKEND_URL}/api/products`;
        if (userLat && userLng) {
            url += `?lat=${userLat}&lng=${userLng}`;
        }

        const res = await storeFetchWithAuth(url); 
        const result = await res.json(); 
        
        if (result.success && result.data) { 
            allProducts = result.data; 
            skeletonGrid.classList.add('hidden'); 
            storefront.classList.remove('hidden'); 
            renderProducts(allProducts); 
        } 
    } catch(e) { 
        skeletonGrid.innerHTML = '';
        const errorMsg = document.createElement('p');
        errorMsg.style.cssText = "grid-column: span 2; text-align:center;";
        errorMsg.textContent = "Failed to connect.";
        skeletonGrid.appendChild(errorMsg); 
    } 
}

function renderProducts(productsToRender) { 
    storefront.innerHTML = ''; 
    
    if (productsToRender.length === 0) { 
        const emptyState = document.createElement('p');
        emptyState.style.cssText = "grid-column:span 2;text-align:center;color:#94A3B8;margin-top:40px;";
        emptyState.textContent = "No products found in your area.";
        storefront.appendChild(emptyState); 
        return; 
    } 
    
    const fragment = document.createDocumentFragment();

    productsToRender.forEach(product => { 
        const card = document.createElement('div'); 
        card.className = 'product-card'; 
        
        const displayVariant = (product.variants && product.variants.length > 0) 
            ? product.variants[0] 
            : { price: 0, weightOrVolume: 'N/A', stock: 0, lowStockThreshold: 5 };

        const infoBlock = document.createElement('div');
        
        const imgContainer = document.createElement('div');
        imgContainer.className = 'product-image';
        imgContainer.style.cssText = 'padding:0; overflow:hidden; position:relative;';
        
        const threshold = displayVariant.lowStockThreshold || 5;
        if (displayVariant.stock > 0 && displayVariant.stock <= threshold) {
            const badge = document.createElement('div');
            badge.className = 'fomo-badge';
            badge.textContent = `🔥 Only ${displayVariant.stock} left!`;
            imgContainer.appendChild(badge);
        }

        const optimizedImg = optimizeCloudinaryUrl(product.imageUrl, 400);
        if (product.imageUrl) {
            const img = document.createElement('img');
            img.src = optimizedImg;
            img.style.cssText = 'width:100%; height:100%; object-fit:contain; border-radius:8px;';
            img.alt = product.name;
            imgContainer.appendChild(img);
        } else {
            const placeholder = document.createElement('div');
            placeholder.style.cssText = 'font-size:44px; display:flex; align-items:center; justify-content:center; width:100%; height:100%;';
            placeholder.textContent = '📦';
            imgContainer.appendChild(placeholder);
        }

        const textInfo = document.createElement('div');
        textInfo.className = 'product-info';
        
        const title = document.createElement('h3');
        title.textContent = product.name;
        
        const weight = document.createElement('p');
        weight.className = 'product-weight';
        weight.textContent = displayVariant.weightOrVolume;

        const storeName = displayVariant.storeName || 'Local Partner';
        const rating = displayVariant.storeRating ? `⭐ ${displayVariant.storeRating}` : '⭐ 4.5';
        
        const trustBadge = document.createElement('div');
        trustBadge.style.cssText = 'font-size: 11px; color: #64748b; margin-top: 4px; font-weight: 600;';
        // --- VISUAL ENHANCEMENT: Store-in-Store Trust Display ---
        if (displayVariant.storeType === 'ENTERPRISE') {
            trustBadge.style.color = '#3b82f6'; // Blue highlight for Enterprise APIs
            trustBadge.textContent = `🚀 Fulfilled by ${storeName} • ${rating}`;
        } else {
            trustBadge.textContent = `🏪 ${storeName} • ${rating}`;
        }
        
        textInfo.appendChild(title);
        textInfo.appendChild(weight);
        textInfo.appendChild(trustBadge);
        
        infoBlock.appendChild(imgContainer);
        infoBlock.appendChild(textInfo);

        const priceRow = document.createElement('div');
        priceRow.className = 'price-action-row';
        
        const priceDiv = document.createElement('div');
        priceDiv.className = 'product-price';
        priceDiv.textContent = `Rs ${displayVariant.price}`;
        
        const actionContainer = document.createElement('div');
        actionContainer.className = 'action-container';
        actionContainer.id = `action-container-${product._id}`;
        
        priceRow.appendChild(priceDiv);
        priceRow.appendChild(actionContainer);
        
        card.appendChild(infoBlock);
        card.appendChild(priceRow);
        fragment.appendChild(card);
    }); 
    
    storefront.appendChild(fragment);
    
    productsToRender.forEach(product => {
        updateCardActionUI(product._id); 
    });
}

function filterCategory(category) { 
    document.getElementById('search-input').value = ''; 
    const title = document.getElementById('product-grid-title');
    
    if (category === 'All') { 
        title.textContent = 'All Products'; 
        renderProducts(allProducts); 
    } else { 
        title.textContent = category; 
        renderProducts(allProducts.filter(p => p.category === category)); 
    }
    
    title.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function filterByTag(tag, displayTitle) {
    document.getElementById('search-input').value = ''; 
    const title = document.getElementById('product-grid-title'); 
    title.textContent = displayTitle;
    
    renderProducts(allProducts.filter(p => { 
        return p.searchTags && p.searchTags.toLowerCase().includes(tag.toLowerCase()); 
    }));
    
    title.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let searchDebounceTimeout = null;

async function handleSearch(event) { 
    const query = event.target.value.toLowerCase().trim(); 
    
    if (!query) { 
        filterCategory('All'); 
        return; 
    } 

    if (query.length < 2) return; 
    
    document.getElementById('product-grid-title').textContent = `Searching...`;
    
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(async () => {
        try {
            let url = `${BACKEND_URL}/api/products/autocomplete?q=${encodeURIComponent(query)}`;
            if (userLat && userLng) url += `&lat=${userLat}&lng=${userLng}`;

            const res = await storeFetchWithAuth(url);
            const result = await res.json();
            
            if (result.success) {
                document.getElementById('product-grid-title').textContent = `Search Results`;
                renderProducts(result.data);
            }
        } catch (e) {
            console.error("Autocomplete search failed", e);
            document.getElementById('product-grid-title').textContent = `Error searching`;
        }
    }, 300);
}

function quickAdd(productId) { 
    let p = allProducts.find(p => p._id === productId); 
    
    if (!p) {
        showToast("Added from search!");
        return; 
    }

    const displayVariant = (p.variants && p.variants.length > 0) ? p.variants[0] : { price: 0, weightOrVolume: 'N/A', storeId: null }; 

    // --- MODIFIED: OMNICHANNEL HYBRID CART GUARD ---
    if (ENABLE_CART_ISOLATION && cart.length > 0 && displayVariant.storeId && cart[0].storeId && cart[0].storeId !== displayVariant.storeId) {
        pendingProductToAdd = { ...p, targetVariant: displayVariant };
        document.getElementById('isolation-modal').classList.remove('hidden');
        return; 
    }
    
    cart.push({...p, qty: 1, currentPrice: displayVariant.price, storeId: displayVariant.storeId }); 
    
    updateCardActionUI(productId); 
    updateGlobalCartUI(); 
}

window.cancelClearCart = function() {
    pendingProductToAdd = null;
    document.getElementById('isolation-modal').classList.add('hidden');
};

window.confirmClearCart = function() {
    const oldCartIds = cart.map(i => i._id);
    cart = []; 
    oldCartIds.forEach(id => updateCardActionUI(id)); 

    document.getElementById('isolation-modal').classList.add('hidden');
    
    if (pendingProductToAdd) {
        cart.push({
            ...pendingProductToAdd, 
            qty: 1, 
            currentPrice: pendingProductToAdd.targetVariant.price, 
            storeId: pendingProductToAdd.targetVariant.storeId 
        }); 
        updateCardActionUI(pendingProductToAdd._id);
        updateGlobalCartUI();
        pendingProductToAdd = null;
    }
};

function adjustQty(productId, change) { 
    const idx = cart.findIndex(i => i._id === productId); 
    
    if (idx > -1) { 
        cart[idx].qty += change; 
        if (cart[idx].qty <= 0) cart.splice(idx, 1); 
    } 
    
    updateCardActionUI(productId); 
    updateGlobalCartUI(); 
}

function updateCardActionUI(productId) { 
    const container = document.getElementById(`action-container-${productId}`); 
    if (!container) return; 
    
    const item = cart.find(i => i._id === productId); 
    const qty = item ? item.qty : 0; 
    
    container.innerHTML = ''; 
    
    if (qty === 0) { 
        const btn = document.createElement('button');
        btn.className = 'add-btn';
        btn.textContent = 'ADD';
        btn.onclick = () => quickAdd(productId);
        container.appendChild(btn);
    } else { 
        const stepper = document.createElement('div');
        stepper.className = 'stepper';
        
        const minusBtn = document.createElement('button');
        minusBtn.textContent = '−';
        minusBtn.onclick = () => adjustQty(productId, -1);
        
        const span = document.createElement('span');
        span.textContent = qty;
        
        const plusBtn = document.createElement('button');
        plusBtn.textContent = '+';
        plusBtn.onclick = () => adjustQty(productId, 1);
        
        stepper.appendChild(minusBtn);
        stepper.appendChild(span);
        stepper.appendChild(plusBtn);
        container.appendChild(stepper);
    } 
}

function updateGlobalCartUI() { 
    const totalItems = cart.reduce((s, i) => s + i.qty, 0); 
    const subtotal = cart.reduce((s, i) => s + (i.currentPrice * i.qty), 0); 
    
    if (totalItems > 0) { 
        document.getElementById('ribbon-items-count').textContent = `${totalItems} ITEM${totalItems > 1 ? 'S' : ''}`; 
        document.getElementById('ribbon-total-price').textContent = `Rs ${subtotal}`; 
        cartRibbon.classList.remove('hidden'); 
    } else { 
        cartRibbon.classList.add('hidden'); 
    } 
    
    cartItemsContainer.innerHTML = ''; 
    
    if (cart.length === 0) { 
        const emptyCart = document.createElement('p');
        emptyCart.style.cssText = "text-align:center; color:#94A3B8; margin-top:40px;";
        emptyCart.textContent = "Your cart is empty.";
        cartItemsContainer.appendChild(emptyCart);
        document.getElementById('cart-subtotal').textContent = 'Rs 0'; 
        document.getElementById('cart-total').textContent = 'Rs 0'; 
        return; 
    } 
    
    const fragment = document.createDocumentFragment();

    cart.forEach(item => { 
        const row = document.createElement('div'); 
        row.className = 'cart-item-row'; 
        
        const imgDiv = document.createElement('div');
        imgDiv.style.cssText = "display:flex; align-items:center; justify-content:center; width:32px;";
        const optimizedThumb = optimizeCloudinaryUrl(item.imageUrl, 100);
        
        if (item.imageUrl) {
            const img = document.createElement('img');
            img.src = optimizedThumb;
            img.style.cssText = "width:32px; height:32px; border-radius:6px; object-fit:contain;";
            imgDiv.appendChild(img);
        } else {
            const box = document.createElement('div');
            box.style.fontSize = "24px";
            box.textContent = "📦";
            imgDiv.appendChild(box);
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'cart-item-info';
        const title = document.createElement('div');
        title.className = 'cart-item-title';
        title.textContent = item.name;
        const price = document.createElement('div');
        price.className = 'cart-item-price';
        price.textContent = `Rs ${item.currentPrice}`;
        infoDiv.appendChild(title);
        infoDiv.appendChild(price);

        const actionDiv = document.createElement('div');
        actionDiv.className = 'action-container';
        actionDiv.style.width = '72px';
        const stepper = document.createElement('div');
        stepper.className = 'stepper';
        
        const mBtn = document.createElement('button');
        mBtn.textContent = '−';
        mBtn.onclick = () => adjustQty(item._id, -1);
        
        const qSpan = document.createElement('span');
        qSpan.textContent = item.qty;
        
        const pBtn = document.createElement('button');
        pBtn.textContent = '+';
        pBtn.onclick = () => adjustQty(item._id, 1);
        
        stepper.appendChild(mBtn);
        stepper.appendChild(qSpan);
        stepper.appendChild(pBtn);
        actionDiv.appendChild(stepper);

        row.appendChild(imgDiv);
        row.appendChild(infoDiv);
        row.appendChild(actionDiv);
        fragment.appendChild(row);
    }); 
    
    cartItemsContainer.appendChild(fragment);
    
    // --- MODIFIED: Dynamic Omnichannel Delivery Fee UI ---
    // If user orders from 2 distinct stores, 2 delivery riders/trucks are needed, multiplying the base fee.
    const uniqueStoreIds = new Set(cart.map(i => i.storeId || 'default')).size;
    const dynamicDeliveryTotal = uniqueStoreIds === 0 ? 0 : (DELIVERY_FEE * uniqueStoreIds);

    document.getElementById('cart-subtotal').textContent = `Rs ${subtotal}`; 
    document.getElementById('cart-total').textContent = `Rs ${subtotal + dynamicDeliveryTotal}`; 
}

function openCart() { 
    if (cart.length === 0) return; 
    updateGlobalCartUI(); 
    cartView.classList.add('active'); 
}

function closeCart() { 
    cartView.classList.remove('active'); 
}

function setDeliveryType(type) { 
    selectedDeliveryType = type; 
    document.getElementById('tab-instant').classList.toggle('active', type === 'Instant'); 
    document.getElementById('tab-routine').classList.toggle('active', type === 'Routine'); 
    document.getElementById('routine-options').classList.toggle('hidden', type === 'Instant'); 
}

window.setPaymentMethod = function(method) {
    selectedPaymentMethod = method;
    document.getElementById('tab-pay-cod').classList.toggle('active', method === 'Cash');
    document.getElementById('tab-pay-online').classList.toggle('active', method === 'Online');
};

async function placeOrder() { 
    if (cart.length === 0 || isProcessingOrder) return; 
    
    const name = document.getElementById('cust-name').value.trim(); 
    const phone = document.getElementById('cust-phone').value.trim(); 
    const address = document.getElementById('cust-address').value.trim(); 
    
    if (!name || !phone || !address) {
        showToast('Please fill out all delivery details!');
        return;
    } 
    
    isProcessingOrder = true;
    const checkoutBtn = document.getElementById('btn-checkout'); 
    checkoutBtn.textContent = 'Processing...'; 
    checkoutBtn.disabled = true; 
    
    // --- MODIFIED: HYBRID CART MATRIX (OMNICHANNEL SPLITTER) ---
    
    // 1. Group all cart items by their specific Store ID
    const groupedCart = {};
    cart.forEach(item => {
        const sId = item.storeId || 'default';
        if (!groupedCart[sId]) groupedCart[sId] = { items: [], subtotal: 0 };
        groupedCart[sId].items.push(item);
        groupedCart[sId].subtotal += (item.currentPrice * item.qty);
    });

    const storeIds = Object.keys(groupedCart);
    const totalDeliveryFee = DELIVERY_FEE * storeIds.length; 
    const grandSubtotal = cart.reduce((s, i) => s + (i.currentPrice * i.qty), 0); 
    const finalTotal = grandSubtotal + totalDeliveryFee; 
    const scheduleTime = selectedDeliveryType === 'Routine' ? document.getElementById('schedule-time').value : 'ASAP'; 
    
    // Generate a unique tracking group ID if we need to link these sub-orders together
    const splitShipmentGroupId = 'GRP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

    // Inner function to finalize the concurrent POST requests after checking payment methodology
    const finalizeBackendOrder = async (transactionId = null) => {
        try { 
            let primaryDisplayOrderId = null;

            // 2. Map the groups into concurrent API requests so they are handled simultaneously 
            const orderPromises = storeIds.map(async (sId) => {
                const group = groupedCart[sId];
                const groupFinalTotal = group.subtotal + DELIVERY_FEE;
                const idempotencyKey = 'ONLINE-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);

                const res = await storeFetchWithAuth(`${BACKEND_URL}/api/orders`, { 
                    method: 'POST', 
                    headers: { 
                        'Content-Type': 'application/json',
                        'Idempotency-Key': idempotencyKey 
                    }, 
                    body: JSON.stringify({
                        customerName: name, 
                        customerPhone: phone, 
                        deliveryAddress: address, 
                        items: group.items, 
                        totalAmount: groupFinalTotal, 
                        deliveryType: selectedDeliveryType, 
                        scheduleTime: scheduleTime,
                        storeId: sId === 'default' ? null : sId,
                        paymentMethod: selectedPaymentMethod,
                        transactionId: transactionId,
                        splitShipmentGroupId: splitShipmentGroupId 
                    }) 
                }); 
                
                const result = await res.json();
                // Store the very first sub-order ID to show in the immediate UI tracking view
                if (result.success && !primaryDisplayOrderId) {
                    primaryDisplayOrderId = result.orderId || result.data?._id;
                }
                return result;
            });

            // 3. Await all separate enterprise/platform webhooks and dispatches
            await Promise.all(orderPromises);
            
            if (primaryDisplayOrderId) {
                localStorage.setItem('dailyPick_activeOrderId', primaryDisplayOrderId); 
                cart = []; 
                document.getElementById('cust-name').value = ''; 
                document.getElementById('cust-phone').value = ''; 
                document.getElementById('cust-address').value = ''; 
                setDeliveryType('Instant');
                window.setPaymentMethod('Cash'); 
                renderProducts(allProducts); 
                updateGlobalCartUI(); 
                closeCart(); 
                switchView('orders'); 
                showToast(`Order Received! Split into ${storeIds.length} shipments. 🚀`); 
            } else {
                showToast('Failed to place order.'); 
            }
        } catch(e) { 
            showToast('Network error.'); 
        } finally { 
            checkoutBtn.textContent = 'Place Order'; 
            checkoutBtn.disabled = false; 
            isProcessingOrder = false; 
        } 
    };

    // --- EXISTING: Trigger Razorpay UI before sending to backend ---
    if (selectedPaymentMethod === 'Online') {
        if (typeof Razorpay === 'undefined') {
            showToast("Payment gateway loading, please try again.");
            checkoutBtn.textContent = 'Place Order'; 
            checkoutBtn.disabled = false; 
            isProcessingOrder = false; 
            return;
        }
        
        var options = {
            "key": "rzp_test_dummykey", // Safe fallback key for sandbox UI rendering
            "amount": finalTotal * 100, // Paise
            "currency": "INR",
            "name": "DailyPick",
            "description": `Hybrid Store Checkout (${storeIds.length} Shipments)`,
            "handler": async function (response) {
                await finalizeBackendOrder(response.razorpay_payment_id);
            },
            "prefill": {
                "name": name,
                "contact": phone
            },
            "theme": {
                "color": "#16A34A" 
            }
        };
        var rzp1 = new Razorpay(options);
        rzp1.on('payment.failed', function (response){
            showToast('Payment Cancelled/Failed');
            checkoutBtn.textContent = 'Place Order'; 
            checkoutBtn.disabled = false;
            isProcessingOrder = false;
        });
        rzp1.open();
    } else {
        // Fallback to COD logic
        await finalizeBackendOrder();
    }
}

async function checkOrderStatus() { 
    const savedOrderId = localStorage.getItem('dailyPick_activeOrderId'); 
    
    if (!savedOrderId) {
        trackingContent.innerHTML = '';
        const emp = document.createElement('p');
        emp.className = 'empty-state';
        emp.textContent = 'You have no active orders right now.';
        trackingContent.appendChild(emp);
        return;
    } 
    
    trackingContent.innerHTML = '';
    const loading = document.createElement('p');
    loading.className = 'empty-state';
    loading.textContent = 'Fetching live status...';
    trackingContent.appendChild(loading);
    
    try { 
        const res = await storeFetchWithAuth(`${BACKEND_URL}/api/orders/${savedOrderId}`); 
        const result = await res.json(); 
        
        if (result.success) { 
            const order = result.data; 
            const timeString = new Date(order.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); 
            
            const displayId = order.orderNumber || '#' + (order._id).toString().slice(-4).toUpperCase();

            trackingContent.innerHTML = ''; 
            
            const card = document.createElement('div');
            card.className = 'tracking-card';
            
            const h3 = document.createElement('h3');
            h3.textContent = `Order ${displayId}`;
            
            const pTime = document.createElement('p');
            pTime.textContent = `Placed at ${timeString}`;
            
            const statusBadge = document.createElement('div');
            statusBadge.className = `status-badge ${order.status === 'Dispatched' ? 'dispatched' : ''}`;
            statusBadge.textContent = order.status;
            
            const schedBadge = document.createElement('div');
            if (order.deliveryType === 'Routine') {
                schedBadge.style.cssText = 'margin-top:12px; font-size:12px; color:#64748B; font-weight:700;';
                schedBadge.textContent = `📅 Routine: ${order.scheduleTime}`;
            } else {
                schedBadge.style.cssText = 'margin-top:12px; font-size:12px; color:#16A34A; font-weight:700;';
                schedBadge.textContent = '⚡ Instant Delivery';
            }
            
            const totalDiv = document.createElement('div');
            totalDiv.style.cssText = 'margin-top:24px; font-size:14px; font-weight:700;';
            totalDiv.textContent = order.paymentMethod === 'Online' ? `Paid: Rs ${order.totalAmount} (Online)` : `To Pay: Rs ${order.totalAmount} (COD)`;
            
            card.appendChild(h3);
            card.appendChild(pTime);
            card.appendChild(statusBadge);
            card.appendChild(schedBadge);
            card.appendChild(totalDiv);

            if (order.trackingLink) {
                const trackingBtn = document.createElement('a');
                trackingBtn.href = order.trackingLink;
                trackingBtn.target = '_blank';
                trackingBtn.className = 'primary-btn';
                trackingBtn.style.cssText = 'display:block; margin-top:16px; background:#8b5cf6; text-align:center; text-decoration:none; padding:12px; border-radius:8px; font-size:13px; color:white;';
                trackingBtn.innerHTML = `🛵 Track Rider: ${order.deliveryDriverName || 'Live Tracker'}`;
                card.appendChild(trackingBtn);
            }

            trackingContent.appendChild(card);
            
            if (order.status !== 'Dispatched' && !trackingStreamController) {
                const token = localStorage.getItem('dailyPick_customerToken') || '';
                trackingStreamController = new AbortController();
                
                (async () => {
                    try {
                        const response = await fetch(`${BACKEND_URL}/api/orders/stream/customer/${savedOrderId}`, {
                            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                            credentials: 'include', 
                            signal: trackingStreamController.signal
                        });

                        if (!response.ok) throw new Error('Tracking stream failed');
                        
                        const reader = response.body.getReader();
                        const decoder = new TextDecoder('utf-8');
                        let buffer = '';

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n\n');
                            buffer = lines.pop(); 

                            for (const line of lines) {
                                if (line.startsWith('data: ')) {
                                    const dataStr = line.substring(6).trim();
                                    if (dataStr === ':' || !dataStr) continue;
                                    
                                    try {
                                        const data = JSON.parse(dataStr);
                                        if (data.message) continue;
                                        
                                        if (data.type === 'STATUS_UPDATE') {
                                            showToast('🚚 Your order has been dispatched!');
                                            if (trackingStreamController) {
                                                trackingStreamController.abort();
                                                trackingStreamController = null;
                                            }
                                            checkOrderStatus();
                                            return; 
                                        }
                                    } catch (err) {
                                        console.error("Stream parse error", err);
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        if (error.name !== 'AbortError') {
                            console.warn("Live tracking disconnected. Will retry on next view.");
                            trackingStreamController = null;
                        }
                    }
                })();
            }
        } else { 
            trackingContent.innerHTML = '';
            const errP = document.createElement('p');
            errP.className = 'empty-state';
            errP.textContent = 'Order details could not be found.';
            trackingContent.appendChild(errP);
        } 
    } catch(e) { 
        trackingContent.innerHTML = '';
        const netErr = document.createElement('p');
        netErr.className = 'empty-state';
        netErr.textContent = 'Network error checking status.';
        trackingContent.appendChild(netErr);
    } 
}

function showToast(message) { 
    const toast = document.createElement('div'); 
    toast.classList.add('toast'); 
    toast.textContent = message; 
    toastContainer.appendChild(toast); 
    setTimeout(() => toast.remove(), 2500); 
}

// --- DOM Event Bindings ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('search-input').addEventListener('input', handleSearch);
    
    document.querySelectorAll('[data-action="filter-cat"]').forEach(el => {
        el.addEventListener('click', () => filterCategory(el.getAttribute('data-value')));
    });
    
    document.querySelectorAll('[data-action="filter-tag"]').forEach(el => {
        el.addEventListener('click', () => filterByTag(el.getAttribute('data-tag'), el.getAttribute('data-title')));
    });
    
    document.getElementById('btn-view-all').addEventListener('click', () => filterCategory('All'));
    document.getElementById('btn-refresh-orders').addEventListener('click', checkOrderStatus);
    document.getElementById('cart-ribbon').addEventListener('click', openCart);
    document.getElementById('btn-close-cart').addEventListener('click', closeCart);
    document.getElementById('btn-checkout').addEventListener('click', placeOrder);
    
    document.getElementById('tab-instant').addEventListener('click', () => setDeliveryType('Instant'));
    document.getElementById('tab-routine').addEventListener('click', () => setDeliveryType('Routine'));
    
    document.getElementById('nav-shop').addEventListener('click', () => switchView('shop'));
    document.getElementById('nav-orders').addEventListener('click', () => switchView('orders'));
    document.getElementById('nav-cats').addEventListener('click', () => window.scrollTo({top: 0, behavior: 'smooth'}));

    // BIND NEW AUTH LOGIC TO UI
    document.querySelector('.profile-icon').addEventListener('click', openCustomerLogin);
    updateAuthUI();

    fetchCategories(); 
    fetchEnterprisePartners(); // New Phase 4 Trigger
    initializeLocationAndFetch();
});
