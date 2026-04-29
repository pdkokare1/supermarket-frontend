/* app.js */
const BACKEND_URL = 'https://dailypick-backend-production-05d6.up.railway.app';
const DELIVERY_FEE = 20;

// --- MULTI-TENANT CONFIGURATION ---
// Set to FALSE to bypass the legacy single-store restriction and enable the DailyPick Hybrid Cart
const ENABLE_CART_ISOLATION = false; 

let allProducts = []; 
let cart = []; 
let selectedDeliveryType = 'Instant'; 
let selectedPaymentMethod = 'Cash'; 
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
        carousel.style.cssText = 'display: flex; gap: 12px; overflow-x: auto; padding: 10px 0; margin-bottom: 20px; scrollbar-width: none;';
        storefront.parentNode.insertBefore(carousel, storefront);
    }
    carousel.innerHTML = '';
    
    const allBtn = document.createElement('button');
    allBtn.style.cssText = 'padding: 8px 16px; border-radius: 20px; background: #e2e8f0; color: #334155; border: none; font-weight: bold; cursor: pointer; white-space: nowrap; flex-shrink: 0;';
    allBtn.textContent = `🌐 All Stores`;
    allBtn.onclick = () => filterCategory('All');
    carousel.appendChild(allBtn);

    stores.forEach(store => {
        const btn = document.createElement('button');
        btn.style.cssText = 'padding: 8px 16px; border-radius: 20px; background: #1e293b; color: white; border: none; font-weight: bold; cursor: pointer; white-space: nowrap; flex-shrink: 0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);';
        btn.textContent = `🏪 ${store.name}`;
        btn.onclick = () => filterByEnterpriseStore(storeId, store.name);
        carousel.appendChild(btn);
    });
}

function filterByEnterpriseStore(storeId, storeName) {
    document.getElementById('search-input').value = '';
    const title = document.getElementById('product-grid-title');
    title.textContent = `Store-in-Store: ${storeName}`;
    
    const filtered = allProducts.filter(p => {
        return p.variants && p.variants.some(v => v.storeId === storeId);
    });
    
    renderProducts(filtered);
    title.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- NEW: PHASE 2 CROSS-STORE PRICE ENGINE ---
async function openPriceCompare(sku, productName) {
    if (!userLat || !userLng) {
        showToast("Please allow location access to compare prices nearby.");
        return;
    }
    
    showToast("Scanning nearby stores...");
    try {
        const res = await storeFetchWithAuth(`${BACKEND_URL}/api/marketplace/compare?sku=${sku}&lat=${userLat}&lng=${userLng}`);
        const result = await res.json();
        
        if (result.success && result.options.length > 0) {
            let msg = `Best Prices for ${productName}:\n\n`;
            result.options.slice(0, 3).forEach((opt, idx) => {
                msg += `${idx === 0 ? '🏆' : '🏪'} ${opt.storeName}: Rs ${opt.bestPriceRs} (Rating: ${opt.rating})\n`;
            });
            alert(msg); // In production, this would open a beautiful Bottom Sheet Modal
        } else {
            showToast("No other stores nearby have this item.");
        }
    } catch (e) {
        showToast("Price Engine unavailable.");
    }
}

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
            : { price: 0, weightOrVolume: 'N/A', stock: 0, lowStockThreshold: 5, sku: null };

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
        if (displayVariant.storeType === 'ENTERPRISE') {
            trustBadge.style.color = '#3b82f6'; 
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
        actionContainer.style.display = 'flex';
        actionContainer.style.alignItems = 'center';

        // --- NEW: Cross-Store Price Compare Button ---
        if (displayVariant.sku) {
            const compareBtn = document.createElement('button');
            compareBtn.textContent = '🔍';
            compareBtn.style.cssText = 'background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 6px; border-radius: 4px; font-size: 14px; cursor: pointer; margin-right: 6px;';
            compareBtn.title = 'Compare Prices Nearby';
            compareBtn.onclick = (e) => { 
                e.stopPropagation(); 
                openPriceCompare(displayVariant.sku, product.name); 
            };
            actionContainer.appendChild(compareBtn);
        }
        
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
    if (!query) { filterCategory('All'); return; } 
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
    if (!p) { showToast("Added from search!"); return; }

    const displayVariant = (p.variants && p.variants.length > 0) ? p.variants[0] : { price: 0, weightOrVolume: 'N/A', storeId: null }; 

    if (ENABLE_CART_ISOLATION && cart.length > 0 && displayVariant.storeId && cart[0].storeId && cart[0].storeId !== displayVariant.storeId) {
        pendingProductToAdd = { ...p, targetVariant: displayVariant };
        document.getElementById('isolation-modal').classList.remove('hidden');
        return; 
    }
    
    // NEW: Save storeName natively to render Omni-Cart UI headers
    cart.push({
        ...p, 
        qty: 1, 
        currentPrice: displayVariant.price, 
        storeId: displayVariant.storeId,
        storeName: displayVariant.storeName || 'DailyPick Platform'
    }); 
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
            storeId: pendingProductToAdd.targetVariant.storeId,
            storeName: pendingProductToAdd.targetVariant.storeName || 'DailyPick Platform'
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
    
    // Preserve the compare button if it exists
    const compareBtn = container.querySelector('button[title="Compare Prices Nearby"]');
    container.innerHTML = ''; 
    if (compareBtn) container.appendChild(compareBtn);
    
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

    // --- NEW: PHASE 3 OMNI-CART VISUAL GROUPING ---
    const groupedCart = {};
    cart.forEach(item => {
        const sId = item.storeId || 'default';
        const sName = item.storeName || 'DailyPick Platform';
        if (!groupedCart[sId]) groupedCart[sId] = { storeName: sName, items: [], subtotal: 0 };
        groupedCart[sId].items.push(item);
        groupedCart[sId].subtotal += (item.currentPrice * item.qty);
    });

    const fragment = document.createDocumentFragment();

    Object.keys(groupedCart).forEach(storeId => {
        const group = groupedCart[storeId];
        
        // Group Header
        const headerDiv = document.createElement('div');
        headerDiv.style.cssText = "background: #f1f5f9; padding: 8px 12px; border-radius: 6px; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; margin: 16px 0 8px 0; letter-spacing: 0.5px;";
        headerDiv.textContent = `📦 Fulfilled by ${group.storeName}`;
        fragment.appendChild(headerDiv);

        // Group Items
        group.items.forEach(item => { 
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
    });
    
    cartItemsContainer.appendChild(fragment);
    
    const uniqueStoreIds = Object.keys(groupedCart).length;
    const dynamicDeliveryTotal = uniqueStoreIds === 0 ? 0 : (DELIVERY_FEE * uniqueStoreIds);

    document.getElementById('cart-subtotal').textContent = `Rs ${subtotal}`; 
    document.getElementById('cart-total').textContent = `Rs ${subtotal + dynamicDeliveryTotal}`; 
}

function openCart() { 
    if (cart.length === 0) return; 
    updateGlobalCartUI(); 
    cartView.classList.add('active'); 
}

function closeCart() { cartView.classList.remove('active'); }

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
    
    // --- MODIFIED: PHASE 3 OMNI-CART GATEWAY INVOCATION ---
    // Instead of looping, we securely package the cart matrix and send it once.
    const payloadCarts = storeIds.map(sId => ({
        storeId: sId === 'default' ? null : sId,
        items: groupedCart[sId].items,
        totalAmount: groupedCart[sId].subtotal + DELIVERY_FEE,
        deliveryType: selectedDeliveryType // Passing frontend selection to Omni-Cart handler
    }));

    const idempotencyKey = 'OMNI-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
    
    const finalizeBackendOrder = async (transactionId = null) => {
        try { 
            const res = await storeFetchWithAuth(`${BACKEND_URL}/api/orders/omni-checkout`, { 
                method: 'POST', 
                headers: { 
                    'Content-Type': 'application/json',
                    'Idempotency-Key': idempotencyKey 
                }, 
                body: JSON.stringify({
                    customerName: name, 
                    customerPhone: phone, 
                    deliveryAddress: address, 
                    carts: payloadCarts, 
                    notes: '',
                    paymentMethod: selectedPaymentMethod,
                    transactionId: transactionId
                }) 
            }); 
            
            const result = await res.json();
            
            if (result.success) {
                // Tracking UI can use the Group ID or we just wipe cart and show success
                localStorage.setItem('dailyPick_activeOrderId', result.splitShipmentGroupId || 'Group_Processing'); 
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
                showToast(`Omni-Cart Success! Split into ${result.totalShipments || storeIds.length} shipments. 🚀`); 
            } else {
                showToast('Failed to place order: ' + result.message); 
            }
        } catch(e) { 
            showToast('Network error.'); 
        } finally { 
            checkoutBtn.textContent = 'Place Order'; 
            checkoutBtn.disabled = false; 
            isProcessingOrder = false; 
        } 
    };

    if (selectedPaymentMethod === 'Online') {
        if (typeof Razorpay === 'undefined') {
            showToast("Payment gateway loading, please try again.");
            checkoutBtn.textContent = 'Place Order'; 
            checkoutBtn.disabled = false; 
            isProcessingOrder = false; 
            return;
        }
        
        var options = {
            "key": "rzp_test_dummykey", 
            "amount": finalTotal * 100, 
            "currency": "INR",
            "name": "DailyPick",
            "description": `Omni-Cart (${storeIds.length} Shipments)`,
            "handler": async function (response) {
                await finalizeBackendOrder(response.razorpay_payment_id);
            },
            "prefill": { "name": name, "contact": phone },
            "theme": { "color": "#16A34A" }
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
        // Handles tracking for either a single order ID or an Omni-Cart Group ID natively
        const endpoint = savedOrderId.startsWith('OMNI-') ? `/api/orders?groupId=${savedOrderId}` : `/api/orders/${savedOrderId}`;
        const res = await storeFetchWithAuth(`${BACKEND_URL}${endpoint}`); 
        const result = await res.json(); 
        
        if (result.success) { 
            // In a real scenario with Omni-Cart, we would loop over `result.data` array.
            // Assuming legacy fallback here so it doesn't break your existing UI
            const order = Array.isArray(result.data) ? result.data[0] : result.data; 
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
                        const response = await fetch(`${BACKEND_URL}/api/orders/stream/customer/${order._id}`, {
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
    fetchEnterprisePartners(); 
    initializeLocationAndFetch();
});

// ============================================================================
// --- NEW: PHASE 4 OMNI-CART CONSUMER UI ENHANCEMENT ---
// ============================================================================
// Safely overwriting updateGlobalCartUI to add dynamic delivery ETAs without deleting legacy logic
const legacyUpdateGlobalCartUI = updateGlobalCartUI;
window.updateGlobalCartUI = function() {
    legacyUpdateGlobalCartUI(); 
    
    const groups = document.querySelectorAll('#cart-items-container > div');
    groups.forEach(group => {
        if (group.textContent.includes('📦 Fulfilled by')) {
            const isEnterprise = !group.textContent.includes('DailyPick Platform');
            
            const deliveryEta = document.createElement('div');
            deliveryEta.style.cssText = `font-size: 10px; font-weight: 700; margin-top: 4px; padding: 2px 6px; border-radius: 4px; display: inline-block; ${isEnterprise ? 'background: #dbeafe; color: #0369a1;' : 'background: #dcfce7; color: #166534;'}`;
            deliveryEta.textContent = isEnterprise ? '🚚 Enterprise Delivery (Next Day)' : '⚡ Platform Delivery (15 Mins)';
            
            group.appendChild(deliveryEta);
        }
    });

    const uniqueStores = [...new Set(cart.map(i => i.storeId || 'default'))];
    const header = document.querySelector('.cart-header');
    let existingBanner = document.getElementById('omni-cart-banner');

    if (uniqueStores.length > 1) {
        if (!existingBanner) {
            existingBanner = document.createElement('div');
            existingBanner.id = 'omni-cart-banner';
            existingBanner.style.cssText = "background: #eef2ff; padding: 12px; border-bottom: 1px solid #cbd5e1; text-align: center;";
            existingBanner.innerHTML = '<p style="font-size: 12px; font-weight: 800; color: #3b82f6; margin: 0;">Omni-Cart Active</p><p style="font-size: 11px; color: #475569; margin: 4px 0 0 0;">Items will arrive in separate shipments.</p>';
            header.parentNode.insertBefore(existingBanner, header.nextSibling);
        }
    } else {
        if (existingBanner) existingBanner.remove();
    }
};

updateGlobalCartUI = window.updateGlobalCartUI;

// ============================================================================
// --- NEW: PHASE 6 OMNI-LOYALTY ENGINE (SUPER WALLET) ---
// ============================================================================
let customerLoyaltyBalance = 0;
let isLoyaltyApplied = false;

const originalUpdateAuthUIPhase6 = window.updateAuthUI;
window.updateAuthUI = async function() {
    if (typeof originalUpdateAuthUIPhase6 === 'function') originalUpdateAuthUIPhase6();
    
    const token = localStorage.getItem('dailyPick_customerToken');
    if (token) {
        try {
            const res = await storeFetchWithAuth(`${BACKEND_URL}/api/customers/me`);
            const result = await res.json();
            if (result.success && result.data) {
                customerLoyaltyBalance = result.data.loyaltyPoints || 0;
                if (customerLoyaltyBalance > 0) {
                    document.getElementById('loyalty-wallet-container').classList.remove('hidden');
                    document.getElementById('loyalty-balance-display').textContent = `Rs ${customerLoyaltyBalance}`;
                }
            }
        } catch(e) { console.warn("Loyalty fetch failed", e); }
    } else {
        customerLoyaltyBalance = 0;
        isLoyaltyApplied = false;
        if(document.getElementById('use-loyalty-toggle')) document.getElementById('use-loyalty-toggle').checked = false;
        if(document.getElementById('loyalty-wallet-container')) document.getElementById('loyalty-wallet-container').classList.add('hidden');
    }
};

window.toggleLoyaltyPoints = function() {
    isLoyaltyApplied = document.getElementById('use-loyalty-toggle').checked;
    window.updateGlobalCartUI();
};

const originalUpdateGlobalCartUIPhase6 = window.updateGlobalCartUI;
window.updateGlobalCartUI = function() {
    originalUpdateGlobalCartUIPhase6();
    
    if (cart.length === 0) return;

    const groupedCart = {};
    cart.forEach(item => {
        const sId = item.storeId || 'default';
        if (!groupedCart[sId]) groupedCart[sId] = true;
    });
    const uniqueStores = Object.keys(groupedCart).length;
    
    const subtotal = cart.reduce((s, i) => s + (i.currentPrice * i.qty), 0);
    const totalDeliveryFee = uniqueStores === 0 ? 0 : (DELIVERY_FEE * uniqueStores);
    let finalTotal = subtotal + totalDeliveryFee;
    let discountApplied = 0;

    if (isLoyaltyApplied && customerLoyaltyBalance > 0) {
        discountApplied = Math.min(customerLoyaltyBalance, subtotal); 
        finalTotal -= discountApplied;
        
        document.getElementById('loyalty-discount-row').classList.remove('hidden');
        document.getElementById('cart-loyalty-discount').textContent = `-Rs ${discountApplied}`;
    } else {
        document.getElementById('loyalty-discount-row').classList.add('hidden');
    }

    document.getElementById('cart-total').textContent = `Rs ${finalTotal}`;
};

// Intercept standard fetch to silently append the loyalty boolean to the checkout JSON payload
const originalStoreFetchWithAuthPhase6 = window.storeFetchWithAuth;
window.storeFetchWithAuth = async function(url, options = {}) {
    if (url.includes('/api/orders/omni-checkout') && options.body) {
        try {
            let payload = JSON.parse(options.body);
            payload.useLoyaltyPoints = isLoyaltyApplied;
            options.body = JSON.stringify(payload);
        } catch(e) {}
    }
    return await originalStoreFetchWithAuthPhase6(url, options);
};

// ============================================================================
// --- NEW: PHASE 10 ALGORITHMIC SMART CART UPSELLS ---
// ============================================================================
const originalUpdateGlobalCartUIPhase10 = window.updateGlobalCartUI;

window.updateGlobalCartUI = function() {
    originalUpdateGlobalCartUIPhase10();
    
    // Fire async fetch safely outside the main synchronous render thread
    setTimeout(async () => {
        const upsellsContainer = document.getElementById('smart-cart-upsells-container');
        const upsellsList = document.getElementById('smart-cart-upsells-list');
        
        if (cart.length === 0 || !upsellsContainer || !upsellsList) {
            if(upsellsContainer) upsellsContainer.classList.add('hidden');
            return;
        }
        
        const cartCategories = [...new Set(cart.map(item => item.category).filter(Boolean))];
        
        try {
            const res = await storeFetchWithAuth(`${BACKEND_URL}/api/products/smart-upsells`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cartCategories, storeId: cart[0].storeId })
            });
            const result = await res.json();
            
            if (result.success && result.data && result.data.length > 0) {
                upsellsList.innerHTML = '';
                
                // Filter out items that are already inside the user's cart
                const cartIds = cart.map(i => i._id.toString());
                const filteredUpsells = result.data.filter(u => !cartIds.includes(u._id.toString())).slice(0, 3);
                
                if (filteredUpsells.length === 0) {
                    upsellsContainer.classList.add('hidden');
                    return;
                }
                
                filteredUpsells.forEach(item => {
                    const v = item.variants[0];
                    upsellsList.innerHTML += `
                        <div style="flex-shrink: 0; width: 120px; background: white; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; text-align: center;">
                            <img src="${optimizeCloudinaryUrl(item.imageUrl, 100) || ''}" style="width: 60px; height: 60px; object-fit: contain; margin-bottom: 8px;" onerror="this.style.display='none'">
                            <p style="font-size: 11px; font-weight: 700; margin: 0 0 4px 0; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</p>
                            <p style="font-size: 11px; color: #16a34a; font-weight: 800; margin: 0 0 8px 0;">Rs ${v.price}</p>
                            <button onclick="quickAdd('${item._id}')" style="background: #e2e8f0; color: #0f172a; border: none; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; cursor: pointer; width: 100%;">+ ADD</button>
                        </div>
                    `;
                    
                    // Add items to allProducts array temporarily so quickAdd can find them
                    if (!allProducts.find(p => p._id === item._id)) {
                        allProducts.push(item);
                    }
                });
                
                upsellsContainer.classList.remove('hidden');
            } else {
                upsellsContainer.classList.add('hidden');
            }
        } catch (e) {
            console.warn("Smart Upsells failed to load", e);
            upsellsContainer.classList.add('hidden');
        }
    }, 10);
};

// ============================================================================
// --- NEW: PHASE 11 $0 IN-MEMORY FUZZY & SYNONYM SEARCH ENGINE ---
// ============================================================================
const commonSynonyms = {
    "late night": ["chips", "snack", "coke", "soda", "chocolate", "munchies", "ice cream"],
    "morning": ["milk", "bread", "butter", "eggs", "coffee", "tea"],
    "cleaning": ["soap", "detergent", "broom", "mop", "phenyl", "harpic"],
    "party": ["cold drink", "soda", "chips", "namkeen", "disposable", "cups"],
    "sick": ["medicine", "soup", "honey", "tea", "vicks", "crocin"],
    "mlik": ["milk"],
    "bred": ["bread"],
    "shmpoo": ["shampoo"],
    "sope": ["soap"],
    "cravings": ["chips", "chocolate", "soda", "snack"]
};

// Override the global handleSearch function safely before DOM bindings
handleSearch = async function(event) { 
    const rawQuery = event.target.value.toLowerCase().trim(); 
    if (!rawQuery) { filterCategory('All'); return; } 
    if (rawQuery.length < 2) return; 
    
    document.getElementById('product-grid-title').textContent = `Searching...`;
    
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
        let searchTerms = rawQuery.split(' ');
        
        // Inject synonyms into search terms array
        for (const [key, related] of Object.entries(commonSynonyms)) {
            if (rawQuery.includes(key)) {
                searchTerms.push(...related);
            }
        }
        
        // $0 Cost In-Memory Heuristic Search
        const scoredProducts = allProducts.map(p => {
            let score = 0;
            const pName = (p.name || '').toLowerCase();
            const pCat = (p.category || '').toLowerCase();
            const pTags = (p.searchTags || '').toLowerCase();
            
            searchTerms.forEach(term => {
                if (pName.includes(term)) score += 10;
                if (pCat.includes(term)) score += 5;
                if (pTags.includes(term)) score += 5;
                
                // Extremely basic fuzzy matching (ignores last character typo)
                if (term.length > 3 && pName.includes(term.substring(0, term.length - 1))) score += 2;
            });
            return { product: p, score };
        }).filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .map(item => item.product);

        document.getElementById('product-grid-title').textContent = `Search Results`;
        renderProducts(scoredProducts);
    }, 300);
};

// ============================================================================
// --- NEW: PHASE 11 CUSTOMER RATING & FEEDBACK UI TRIGGERS ---
// ============================================================================
const originalCheckOrderStatusPhase11 = checkOrderStatus;

window.checkOrderStatus = async function() {
    await originalCheckOrderStatusPhase11();
    
    // Give the DOM a moment to render the tracking content
    setTimeout(() => {
        const savedOrderId = localStorage.getItem('dailyPick_activeOrderId');
        const content = document.getElementById('tracking-content');
        
        // If the order has reached terminal "Completed" state, prompt for feedback
        if (savedOrderId && content && content.innerHTML.includes('Completed')) {
            if (localStorage.getItem(`rated_${savedOrderId}`)) return; // Already rated
            
            const ratingContainer = document.getElementById('customer-rating-modal');
            if (ratingContainer) {
                ratingContainer.classList.remove('hidden');
                ratingContainer.setAttribute('data-order-id', savedOrderId);
            }
        }
    }, 500); 
};

window.submitOrderRating = async function(score) {
    const modal = document.getElementById('customer-rating-modal');
    if (!modal) return;
    
    const orderId = modal.getAttribute('data-order-id');
    
    // Optimistic UI interaction
    modal.innerHTML = '<div style="padding: 24px; text-align: center;"><h3 style="color:#0f172a;">Thank you for your feedback! ❤️</h3><p style="color:#64748B; font-size:14px;">We are constantly improving.</p></div>';
    setTimeout(() => modal.classList.add('hidden'), 2000);
    
    if (orderId) {
        localStorage.setItem(`rated_${orderId}`, 'true');
        try {
            await storeFetchWithAuth(`${BACKEND_URL}/api/orders/${orderId}/rate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating: score })
            });
        } catch(e) {}
    }
};

// ============================================================================
// --- NEW: PHASE 12 ABANDONED CART RECOVERY ENGINE ---
// ============================================================================
document.addEventListener('visibilitychange', () => {
    // Triggers silently if the user closes or backgrounds the tab
    if (document.visibilityState === 'hidden' && cart && cart.length > 0) {
        const token = localStorage.getItem('dailyPick_customerToken');
        if (token) {
            // Uses navigator.sendBeacon to ensure the payload is delivered even as the page unloads
            navigator.sendBeacon(`${BACKEND_URL}/api/orders/abandoned-cart`, JSON.stringify({
                cartSnapshot: cart,
                timestamp: new Date().toISOString()
            }));
        }
    }
});
