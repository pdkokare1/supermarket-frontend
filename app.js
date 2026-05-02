/* supermarket-frontend/app.js */

// ============================================================================
// --- SECURE GLOBAL STATE ENCAPSULATION MODULE ---
// ============================================================================
(function() {
const BACKEND_URL = 'https://dailypick-backend-production-05d6.up.railway.app';
const DELIVERY_FEE = 20;

const ENABLE_CART_ISOLATION = false; 

let allProducts = []; 
let cart = []; 
let selectedDeliveryType = 'Instant'; 
let selectedPaymentMethod = 'Cash'; 
let allCategories = [];
let trackingStreamController = null; 
let isProcessingOrder = false; 

let userLat = null;
let userLng = null;
let pendingProductToAdd = null;

// DOM Anchors
const storefront = document.getElementById('storefront'); 
const skeletonGrid = document.getElementById('skeleton-grid'); 
const cartRibbon = document.getElementById('cart-ribbon'); 
const cartView = document.getElementById('cart-view'); 
const cartItemsContainer = document.getElementById('cart-items-container'); 
const toastContainer = document.getElementById('toast-container'); 
const trackingContent = document.getElementById('tracking-content');

// Dynamic Shelf Anchors (Phase 34 UI)
const megaDealsSection = document.getElementById('mega-deals-section');
const megaDealsShelf = document.getElementById('mega-deals-shelf');
const trendingSection = document.getElementById('trending-section');
const trendingShelf = document.getElementById('trending-shelf');
const categorySectionContainer = document.getElementById('category-section-container');
const collectivesPoint = document.getElementById('collectives-injection-point');

const views = { 
    shop: document.getElementById('shop-view'), 
    orders: document.getElementById('orders-view') 
}; 

const navBtns = { 
    shop: document.getElementById('nav-shop'), 
    orders: document.getElementById('nav-orders') 
};

// --- NEW: PHASE 34 RICH CATEGORY STYLING (Zepto Mimic) ---
const CATEGORY_IMAGES = {
    'Dairy & Breakfast': { emoji: '🥛', color: '#ecfdf5', sub: 'UP TO 15% OFF' }, // Greenish
    'Snacks & Munchies': { emoji: '🍿', color: '#fff7ed', sub: 'STARTS AT Rs19' }, // Orangish
    'Cold Drinks & Juices': { emoji: '🥤', color: '#eff6ff', sub: 'UP TO 50% OFF' }, // Blueish
    'Personal Care': { emoji: '🧴', color: '#fdf4ff', sub: 'UP TO 85% OFF' }, // Pinkish
    'Cleaning Essentials': { emoji: '🧽', color: '#f8fafc', sub: 'UP TO 80% OFF' }, // Grayish
    'Grocery & Kitchen': { emoji: '🌾', color: '#fefce8', sub: 'MEGA PACKS' }, // Yellowish
    'Default': { emoji: '🛍️', color: '#f1f5f9', sub: 'EXPLORE' }
};

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
        
        if (window.Capacitor && window.Capacitor.Plugins.PushNotifications) {
            window.registerNativePushToken(idToken);
        }
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
        profileIcon.innerHTML = '<span style="color:#16a34a;">🟢</span>'; 
    } else {
        profileIcon.textContent = '👤'; 
    }
}

function initializeLocationAndFetch() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userLat = position.coords.latitude;
                userLng = position.coords.longitude;
                document.querySelector('.delivery-location').innerHTML = '📍 Nearby Available ▼';
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
                const visual = CATEGORY_IMAGES[cat.name] || CATEGORY_IMAGES['Default'];
                const card = document.createElement('div'); 
                card.className = 'rich-cat-card';
                card.style.backgroundColor = visual.color;
                card.addEventListener('click', () => filterCategory(cat.name));
                
                card.innerHTML = `
                    <div class="rich-cat-title">${cat.name}</div>
                    <div class="rich-cat-discount">${visual.sub}</div>
                    <div class="rich-cat-img">${visual.emoji}</div>
                `;
                fragment.appendChild(card);
            });
            grid.appendChild(fragment);
        }
    } catch (e) { 
        console.error("Error fetching categories", e); 
    }
}

async function fetchEnterprisePartners() {
    try {
        const res = await storeFetchWithAuth(`${BACKEND_URL}/api/stores?type=ENTERPRISE`);
        const result = await res.json();
        if (result.success && result.data && result.data.length > 0) {
            // Keep logic but visual integration might not fit Zepto UI perfectly right now.
        }
    } catch(e) {}
}

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
            alert(msg); 
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
        if (userLat && userLng) url += `?lat=${userLat}&lng=${userLng}`;

        const res = await storeFetchWithAuth(url); 
        const result = await res.json(); 
        
        if (result.success && result.data) { 
            allProducts = result.data; 
            skeletonGrid.classList.add('hidden'); 
            storefront.classList.remove('hidden'); 
            
            // Phase 34: On initial load, try to build shelves
            buildHomeUI(allProducts);
        } 
    } catch(e) { 
        skeletonGrid.innerHTML = '';
        const errorMsg = document.createElement('p');
        errorMsg.style.cssText = "grid-column: span 2; text-align:center;";
        errorMsg.textContent = "Failed to connect.";
        skeletonGrid.appendChild(errorMsg); 
    } 
}

// Helper to create a single product card DOM element
function createProductCardNode(product, isHorizontalShelf = false) {
    const card = document.createElement('div'); 
    card.className = 'product-card'; 
    if (isHorizontalShelf) {
        card.style.minWidth = '150px';
        card.style.maxWidth = '150px';
        card.style.scrollSnapAlign = 'start';
    }
    
    const displayVariant = (product.variants && product.variants.length > 0) ? product.variants[0] : { price: 0, weightOrVolume: 'N/A', stock: 0, lowStockThreshold: 5, sku: null };

    const infoBlock = document.createElement('div');
    const imgContainer = document.createElement('div');
    imgContainer.className = 'product-image';
    
    const threshold = displayVariant.lowStockThreshold || 5;
    if (displayVariant.stock > 0 && displayVariant.stock <= threshold) {
        const badge = document.createElement('div');
        badge.className = 'fomo-badge';
        badge.textContent = `🔥 Only ${displayVariant.stock} left`;
        imgContainer.appendChild(badge);
    }

    // Mock "Mega Drop" tag for UI flavor
    if (isHorizontalShelf && Math.random() > 0.5) {
        const dBadge = document.createElement('div');
        dBadge.className = 'discount-tag';
        dBadge.textContent = '₹' + Math.floor(Math.random() * 50 + 10) + ' OFF';
        imgContainer.appendChild(dBadge);
    }

    const optimizedImg = optimizeCloudinaryUrl(product.imageUrl, 400);
    if (product.imageUrl) {
        const img = document.createElement('img');
        img.src = optimizedImg;
        img.style.cssText = 'width:100%; height:100%; object-fit:contain; padding:10px;';
        img.alt = product.name;
        imgContainer.appendChild(img);
    } else {
        imgContainer.innerHTML = '<div style="font-size:44px;">📦</div>';
    }

    const textInfo = document.createElement('div');
    textInfo.className = 'product-info';
    
    const title = document.createElement('h3');
    title.textContent = product.name;
    
    const weight = document.createElement('p');
    weight.className = 'product-weight';
    weight.textContent = displayVariant.weightOrVolume;
    
    textInfo.appendChild(title);
    textInfo.appendChild(weight);
    
    infoBlock.appendChild(imgContainer);
    infoBlock.appendChild(textInfo);

    const priceRow = document.createElement('div');
    priceRow.className = 'price-action-row';
    
    const priceBlock = document.createElement('div');
    priceBlock.className = 'price-block';
    
    const priceDiv = document.createElement('div');
    priceDiv.className = 'product-price';
    priceDiv.textContent = `₹${displayVariant.price}`; // Using ₹ for authenticity
    
    priceBlock.appendChild(priceDiv);
    
    // Add mock MRP
    if (isHorizontalShelf) {
        const mrpDiv = document.createElement('div');
        mrpDiv.className = 'product-mrp';
        mrpDiv.textContent = `₹${displayVariant.price + Math.floor(Math.random() * 30 + 10)}`;
        priceBlock.appendChild(mrpDiv);
    }

    const actionContainer = document.createElement('div');
    actionContainer.className = 'action-container';
    actionContainer.id = `action-container-${product._id}-${Math.random().toString(36).substr(2, 5)}`; // Unique ID for multiple instances
    
    priceRow.appendChild(priceBlock);
    priceRow.appendChild(actionContainer);
    
    card.appendChild(infoBlock);
    card.appendChild(priceRow);

    // After appending to DOM, we need to bind the action UI
    setTimeout(() => {
        updateSpecificCardActionUI(product._id, actionContainer);
    }, 0);

    return card;
}

// --- NEW: Phase 34 Rendering Engine ---
function buildHomeUI(products) {
    document.getElementById('product-grid-title').textContent = 'All Products';
    document.getElementById('btn-view-all').classList.add('hidden');
    categorySectionContainer.classList.remove('hidden');
    collectivesPoint.classList.remove('hidden');

    if (products.length < 8) {
        // Not enough products for shelves, just render flat
        megaDealsSection.classList.add('hidden');
        trendingSection.classList.add('hidden');
        renderFlatGrid(products);
        return;
    }

    // Activate Shelves
    megaDealsSection.classList.remove('hidden');
    trendingSection.classList.remove('hidden');
    
    megaDealsShelf.innerHTML = '';
    trendingShelf.innerHTML = '';

    // Split array (mock logic for "Deals" and "Trending")
    const deals = products.slice(0, 5);
    const trending = products.slice(5, 10);
    const rest = products.slice(10);

    deals.forEach(p => megaDealsShelf.appendChild(createProductCardNode(p, true)));
    trending.forEach(p => trendingShelf.appendChild(createProductCardNode(p, true)));
    
    renderFlatGrid(rest);
}

function renderFlatGrid(productsToRender) {
    storefront.innerHTML = ''; 
    
    if (productsToRender.length === 0) { 
        storefront.innerHTML = '<p style="grid-column:span 2;text-align:center;color:#94A3B8;margin-top:40px;">No products found.</p>';
        return; 
    } 
    
    const fragment = document.createDocumentFragment();
    productsToRender.forEach(product => { 
        fragment.appendChild(createProductCardNode(product, false));
    }); 
    storefront.appendChild(fragment);
}

// Fallback for direct array passing (legacy support)
function renderProducts(productsToRender) { 
    // If we are filtering, kill the shelves and show everything in the flat grid
    megaDealsSection.classList.add('hidden');
    trendingSection.classList.add('hidden');
    categorySectionContainer.classList.add('hidden');
    collectivesPoint.classList.add('hidden');
    
    renderFlatGrid(productsToRender);
}

function filterCategory(category) { 
    document.getElementById('search-input').value = ''; 
    const title = document.getElementById('product-grid-title');
    document.getElementById('btn-view-all').classList.remove('hidden');

    if (category === 'All') { 
        buildHomeUI(allProducts); 
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
    document.getElementById('btn-view-all').classList.remove('hidden');

    renderProducts(allProducts.filter(p => p.searchTags && p.searchTags.toLowerCase().includes(tag.toLowerCase())));
    title.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let searchDebounceTimeout = null;
const commonSynonyms = {
    "late night": ["chips", "snack", "coke", "soda", "chocolate", "munchies", "ice cream"],
    "morning": ["milk", "bread", "butter", "eggs", "coffee", "tea"],
    "cleaning": ["soap", "detergent", "broom", "mop", "phenyl", "harpic"],
    "party": ["cold drink", "soda", "chips", "namkeen", "disposable", "cups"],
    "sick": ["medicine", "soup", "honey", "tea", "vicks", "crocin"],
    "mlik": ["milk"], "bred": ["bread"], "shmpoo": ["shampoo"], "sope": ["soap"]
};

let handleSearch = async function(event) { 
    const rawQuery = event.target.value.toLowerCase().trim(); 
    if (!rawQuery) { filterCategory('All'); return; } 
    if (rawQuery.length < 2) return; 
    
    document.getElementById('product-grid-title').textContent = `Searching...`;
    document.getElementById('btn-view-all').classList.remove('hidden');

    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(async () => {
        // Try local search first for speed
        let searchTerms = rawQuery.split(' ');
        for (const [key, related] of Object.entries(commonSynonyms)) {
            if (rawQuery.includes(key)) searchTerms.push(...related);
        }
        
        const scoredProducts = allProducts.map(p => {
            let score = 0;
            const pName = (p.name || '').toLowerCase();
            const pCat = (p.category || '').toLowerCase();
            const pTags = (p.searchTags || '').toLowerCase();
            
            searchTerms.forEach(term => {
                if (pName.includes(term)) score += 10;
                if (pCat.includes(term)) score += 5;
                if (pTags.includes(term)) score += 5;
            });
            return { product: p, score };
        }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).map(item => item.product);

        if (scoredProducts.length > 0) {
            document.getElementById('product-grid-title').textContent = `Search Results`;
            renderProducts(scoredProducts);
        } else {
            // Fallback to backend autocomplete if local fails
            try {
                let url = `${BACKEND_URL}/api/products/autocomplete?q=${encodeURIComponent(rawQuery)}`;
                if (userLat && userLng) url += `&lat=${userLat}&lng=${userLng}`;
                const res = await storeFetchWithAuth(url);
                const result = await res.json();
                if (result.success) {
                    document.getElementById('product-grid-title').textContent = `Search Results`;
                    renderProducts(result.data);
                }
            } catch (e) {}
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
    
    cart.push({ ...p, qty: 1, currentPrice: displayVariant.price, storeId: displayVariant.storeId, storeName: displayVariant.storeName || 'DailyPick Platform' }); 
    updateAllActionUIs(productId); 
    updateGlobalCartUI(); 
}

window.cancelClearCart = function() {
    pendingProductToAdd = null;
    document.getElementById('isolation-modal').classList.add('hidden');
};

window.confirmClearCart = function() {
    const oldCartIds = cart.map(i => i._id);
    cart = []; 
    oldCartIds.forEach(id => updateAllActionUIs(id)); 

    document.getElementById('isolation-modal').classList.add('hidden');
    
    if (pendingProductToAdd) {
        cart.push({ ...pendingProductToAdd, qty: 1, currentPrice: pendingProductToAdd.targetVariant.price, storeId: pendingProductToAdd.targetVariant.storeId, storeName: pendingProductToAdd.targetVariant.storeName || 'DailyPick Platform' }); 
        updateAllActionUIs(pendingProductToAdd._id);
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
    updateAllActionUIs(productId); 
    updateGlobalCartUI(); 
}

// Since a product can now exist in a shelf AND the main grid, we update all instances
function updateAllActionUIs(productId) {
    document.querySelectorAll(`[id^="action-container-${productId}"]`).forEach(container => {
        updateSpecificCardActionUI(productId, container);
    });
}

function updateSpecificCardActionUI(productId, container) { 
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

// Phase 34: Floating Cart Pill UI Logic
let updateGlobalCartUI = function() { 
    const totalItems = cart.reduce((s, i) => s + i.qty, 0); 
    const subtotal = cart.reduce((s, i) => s + (i.currentPrice * i.qty), 0); 
    
    // Inject Overlapping Thumbnails
    const ribbonThumbnails = document.getElementById('ribbon-thumbnails');
    if (ribbonThumbnails) {
        ribbonThumbnails.innerHTML = '';
        if (totalItems > 0) {
            const uniqueImages = [...new Set(cart.map(i => i.imageUrl).filter(Boolean))].slice(0, 3);
            uniqueImages.forEach(imgUrl => {
                const img = document.createElement('img');
                img.src = optimizeCloudinaryUrl(imgUrl, 50);
                ribbonThumbnails.appendChild(img);
            });
            if (cart.length > 3) {
                const overflow = document.createElement('div');
                overflow.className = 'ribbon-overflow-count';
                overflow.textContent = `+${cart.length - 3}`;
                ribbonThumbnails.appendChild(overflow);
            }
        }
    }
    
    if (totalItems > 0) { 
        document.getElementById('ribbon-items-count').textContent = `${totalItems} ITEM${totalItems > 1 ? 'S' : ''}`; 
        document.getElementById('ribbon-total-price').textContent = `₹${subtotal}`; 
        cartRibbon.classList.remove('hidden'); 
    } else { 
        cartRibbon.classList.add('hidden'); 
    } 
    
    cartItemsContainer.innerHTML = ''; 
    
    if (cart.length === 0) { 
        cartItemsContainer.innerHTML = '<p style="text-align:center; color:#94A3B8; margin-top:40px;">Your cart is empty.</p>';
        document.getElementById('cart-subtotal').textContent = '₹0'; 
        document.getElementById('cart-total').textContent = '₹0'; 
        return; 
    } 

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
        
        const headerDiv = document.createElement('div');
        headerDiv.style.cssText = "background: #f8fafc; padding: 8px 12px; border-radius: 8px; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; margin: 16px 0 8px 0; letter-spacing: 0.5px;";
        headerDiv.textContent = `📦 Fulfilled by ${group.storeName}`;
        fragment.appendChild(headerDiv);

        group.items.forEach(item => { 
            const row = document.createElement('div'); 
            row.className = 'cart-item-row'; 
            
            const imgDiv = document.createElement('div');
            imgDiv.style.cssText = "display:flex; align-items:center; justify-content:center; width:40px;";
            const optimizedThumb = optimizeCloudinaryUrl(item.imageUrl, 100);
            
            if (item.imageUrl) {
                const img = document.createElement('img');
                img.src = optimizedThumb;
                img.style.cssText = "width:40px; height:40px; border-radius:8px; object-fit:contain; border: 1px solid #e2e8f0;";
                imgDiv.appendChild(img);
            } else {
                imgDiv.innerHTML = '<div style="font-size:24px;">📦</div>';
            }

            const infoDiv = document.createElement('div');
            infoDiv.className = 'cart-item-info';
            const title = document.createElement('div');
            title.className = 'cart-item-title';
            title.textContent = item.name;
            const price = document.createElement('div');
            price.className = 'cart-item-price';
            price.textContent = `₹${item.currentPrice}`;
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

    // Apply Loyalty if active
    let finalTotal = subtotal + dynamicDeliveryTotal;
    let discountApplied = 0;

    if (isLoyaltyApplied && customerLoyaltyBalance > 0) {
        discountApplied = Math.min(customerLoyaltyBalance, subtotal); 
        finalTotal -= discountApplied;
        document.getElementById('loyalty-discount-row').classList.remove('hidden');
        document.getElementById('cart-loyalty-discount').textContent = `-₹${discountApplied}`;
    } else {
        document.getElementById('loyalty-discount-row').classList.add('hidden');
    }

    document.getElementById('cart-subtotal').textContent = `₹${subtotal}`; 
    document.getElementById('cart-delivery').textContent = `₹${dynamicDeliveryTotal}`; 
    document.getElementById('cart-total').textContent = `₹${finalTotal}`; 
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
    
    const marketingRef = localStorage.getItem('dailyPick_marketingRef');
    const finalNotes = marketingRef ? `[MARKETING REF: ${marketingRef}]` : '';

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
    let finalTotal = grandSubtotal + totalDeliveryFee; 
    if (isLoyaltyApplied) finalTotal -= Math.min(customerLoyaltyBalance, grandSubtotal);
    
    const scheduleTime = selectedDeliveryType === 'Routine' ? document.getElementById('schedule-time').value : 'ASAP'; 
    
    const payloadCarts = storeIds.map(sId => ({
        storeId: sId === 'default' ? null : sId,
        items: groupedCart[sId].items,
        totalAmount: groupedCart[sId].subtotal + DELIVERY_FEE,
        deliveryType: selectedDeliveryType 
    }));

    const idempotencyKey = 'OMNI-' + Date.now() + '-' + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).substring(2, 9));
    
    const finalizeBackendOrder = async (transactionId = null) => {
        try { 
            const res = await storeFetchWithAuth(`${BACKEND_URL}/api/orders/omni-checkout`, { 
                method: 'POST', 
                headers: { 
                    'Content-Type': 'application/json',
                    'Idempotency-Key': idempotencyKey,
                    'x-marketing-attribution-id': marketingRef || '' 
                }, 
                body: JSON.stringify({
                    customerName: name, customerPhone: phone, deliveryAddress: address, 
                    carts: payloadCarts, notes: finalNotes, paymentMethod: selectedPaymentMethod,
                    transactionId: transactionId, useLoyaltyPoints: isLoyaltyApplied
                }) 
            }); 
            
            const result = await res.json();
            
            if (result.success) {
                localStorage.setItem('dailyPick_activeOrderId', result.splitShipmentGroupId || 'Group_Processing'); 
                cart = []; 
                document.getElementById('cust-name').value = ''; document.getElementById('cust-phone').value = ''; document.getElementById('cust-address').value = ''; 
                setDeliveryType('Instant'); window.setPaymentMethod('Cash'); 
                buildHomeUI(allProducts); 
                updateGlobalCartUI(); 
                closeCart(); 
                switchView('orders'); 
                showToast(`Success! 🚀`); 
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
            checkoutBtn.textContent = 'Place Order'; checkoutBtn.disabled = false; isProcessingOrder = false; 
            return;
        }
        let razorpayKey = 'rzp_test_dummykey';
        try {
            const configRes = await fetch(`${BACKEND_URL}/api/config/gateway`);
            const configData = await configRes.json();
            if (configData.success) razorpayKey = configData.key;
        } catch(e) {}

        var options = {
            "key": razorpayKey, "amount": finalTotal * 100, "currency": "INR", "name": "DailyPick",
            "handler": async function (response) { await finalizeBackendOrder(response.razorpay_payment_id); },
            "prefill": { "name": name, "contact": phone }, "theme": { "color": "#4F46E5" }
        };
        var rzp1 = new Razorpay(options);
        rzp1.on('payment.failed', function (response){
            showToast('Payment Cancelled/Failed');
            checkoutBtn.textContent = 'Place Order'; checkoutBtn.disabled = false; isProcessingOrder = false;
        });
        rzp1.open();
    } else {
        await finalizeBackendOrder();
    }
}

let checkOrderStatus = async function() { 
    const savedOrderId = localStorage.getItem('dailyPick_activeOrderId'); 
    
    if (!savedOrderId) {
        trackingContent.innerHTML = '<p class="empty-state" style="color: #64748b; text-align: center; margin-top: 40px;">You have no active orders right now.</p>';
        return;
    } 
    
    trackingContent.innerHTML = '<p class="empty-state" style="text-align: center; margin-top: 40px;">Fetching live status...</p>';
    
    try { 
        const endpoint = savedOrderId.startsWith('OMNI-') ? `/api/orders?groupId=${savedOrderId}` : `/api/orders/${savedOrderId}`;
        const res = await storeFetchWithAuth(`${BACKEND_URL}${endpoint}`); 
        const result = await res.json(); 
        
        if (result.success) { 
            const order = Array.isArray(result.data) ? result.data[0] : result.data; 
            const timeString = new Date(order.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); 
            const displayId = order.orderNumber || '#' + (order._id).toString().slice(-4).toUpperCase();

            trackingContent.innerHTML = ''; 
            
            const card = document.createElement('div');
            card.className = 'tracking-card';
            card.innerHTML = `
                <h3 style="font-size: 16px; margin-bottom: 4px;">Order ${displayId}</h3>
                <p style="color: #64748b; font-size: 12px; margin-bottom: 16px;">Placed at ${timeString}</p>
                <div class="status-badge ${order.status === 'Dispatched' ? 'dispatched' : ''}">${order.status}</div>
                <div style="margin-top:16px; font-size:12px; font-weight:700; color: ${order.deliveryType === 'Routine' ? '#64748B' : '#16A34A'}">
                    ${order.deliveryType === 'Routine' ? `📅 Routine: ${order.scheduleTime}` : '⚡ Instant Delivery'}
                </div>
                <div style="margin-top:16px; font-size:15px; font-weight:800;">
                    ${order.paymentMethod === 'Online' ? `Paid: ₹${order.totalAmount} (Online)` : `To Pay: ₹${order.totalAmount} (COD)`}
                </div>
            `;

            if (order.trackingLink) {
                const trackingBtn = document.createElement('a');
                trackingBtn.href = order.trackingLink;
                trackingBtn.target = '_blank';
                trackingBtn.style.cssText = 'display:block; margin-top:16px; background:var(--primary); text-align:center; text-decoration:none; padding:14px; border-radius:12px; font-size:14px; font-weight: 800; color:white; box-shadow: 0 4px 10px rgba(79, 70, 229, 0.2);';
                trackingBtn.innerHTML = `🛵 Track Rider: ${order.deliveryDriverName || 'Live'}`;
                card.appendChild(trackingBtn);
            }

            if (order.status === 'Delivered' || order.status === 'Completed') {
                const issueBtn = document.createElement('button');
                issueBtn.onclick = () => window.openReportIssueModal(order._id);
                issueBtn.style.cssText = 'display:block; width:100%; margin-top:12px; background:white; color:#ef4444; border:1px solid #fecaca; text-align:center; padding:12px; border-radius:12px; font-size:13px; font-weight:800; cursor:pointer;';
                issueBtn.innerHTML = `⚠️ Report Damaged/Missing Item`;
                card.appendChild(issueBtn);
                
                setTimeout(() => {
                    if (!localStorage.getItem(`rated_${savedOrderId}`)) {
                        document.getElementById('customer-rating-modal').classList.remove('hidden');
                        document.getElementById('customer-rating-modal').setAttribute('data-order-id', savedOrderId);
                    }
                }, 500);
            }

            trackingContent.appendChild(card);
            
            if (order.status !== 'Dispatched' && !trackingStreamController) {
                const token = localStorage.getItem('dailyPick_customerToken') || '';
                trackingStreamController = new AbortController();
                
                (async () => {
                    try {
                        const response = await fetch(`${BACKEND_URL}/api/orders/stream/customer/${order._id}`, {
                            headers: token ? { 'Authorization': `Bearer ${token}` } : {}, credentials: 'include', signal: trackingStreamController.signal
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
                                            if (trackingStreamController) { trackingStreamController.abort(); trackingStreamController = null; }
                                            checkOrderStatus();
                                            return; 
                                        }
                                    } catch (err) {}
                                }
                            }
                        }
                    } catch (error) { trackingStreamController = null; }
                })();
            }
        } else { 
            trackingContent.innerHTML = '<p class="empty-state" style="text-align:center; margin-top:40px;">Order not found.</p>';
        } 
    } catch(e) { 
        trackingContent.innerHTML = '<p class="empty-state" style="text-align:center; margin-top:40px;">Network error.</p>';
    } 
}

function showToast(message) { 
    const toast = document.createElement('div'); 
    toast.classList.add('toast'); 
    toast.textContent = message; 
    toastContainer.appendChild(toast); 
    setTimeout(() => toast.remove(), 2500); 
}

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref') || urlParams.get('utm_campaign') || urlParams.get('source');
    if (ref) localStorage.setItem('dailyPick_marketingRef', ref);

    document.getElementById('search-input').addEventListener('input', handleSearch);
    document.querySelectorAll('[data-action="filter-cat"]').forEach(el => el.addEventListener('click', () => filterCategory(el.getAttribute('data-value'))));
    document.querySelectorAll('[data-action="filter-tag"]').forEach(el => el.addEventListener('click', () => filterByTag(el.getAttribute('data-tag'), el.getAttribute('data-title'))));
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
    document.querySelector('.profile-icon').addEventListener('click', openCustomerLogin);
    updateAuthUI();
    fetchCategories(); 
    fetchEnterprisePartners(); 
    initializeLocationAndFetch();
});

let customerLoyaltyBalance = 0;
let isLoyaltyApplied = false;

const originalUpdateAuthUIPhase6 = updateAuthUI;
updateAuthUI = async function() {
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
                    document.getElementById('loyalty-balance-display').textContent = `₹${customerLoyaltyBalance}`;
                }
            }
        } catch(e) {}
    } else {
        customerLoyaltyBalance = 0;
        isLoyaltyApplied = false;
        if(document.getElementById('use-loyalty-toggle')) document.getElementById('use-loyalty-toggle').checked = false;
        if(document.getElementById('loyalty-wallet-container')) document.getElementById('loyalty-wallet-container').classList.add('hidden');
    }
};

window.toggleLoyaltyPoints = function() {
    isLoyaltyApplied = document.getElementById('use-loyalty-toggle').checked;
    updateGlobalCartUI();
};

window.submitOrderRating = async function(score) {
    const modal = document.getElementById('customer-rating-modal');
    if (!modal) return;
    const orderId = modal.getAttribute('data-order-id');
    modal.innerHTML = '<div style="padding: 32px; text-align: center;"><h3 style="color:#0f172a; font-size:24px;">Thank you! ❤️</h3><p style="color:#64748B; font-size:14px; margin-top:8px;">Your feedback helps us improve.</p></div>';
    setTimeout(() => modal.classList.add('hidden'), 2000);
    
    if (orderId) {
        localStorage.setItem(`rated_${orderId}`, 'true');
        try {
            await storeFetchWithAuth(`${BACKEND_URL}/api/orders/${orderId}/rate`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: score })
            });
        } catch(e) {}
    }
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && cart && cart.length > 0) {
        const token = localStorage.getItem('dailyPick_customerToken');
        if (token) {
            navigator.sendBeacon(`${BACKEND_URL}/api/orders/abandoned-cart`, JSON.stringify({ cartSnapshot: cart, timestamp: new Date().toISOString() }));
        }
    }
});

let consumerLiveMap = null;
let riderMarker = null;
let consumerTrackingWS = null;

const originalCheckOrderStatusPhase13 = checkOrderStatus;
checkOrderStatus = async function() {
    await originalCheckOrderStatusPhase13();
    setTimeout(() => {
        const content = document.getElementById('tracking-content');
        if (!content) return;
        if (content.innerHTML.includes('Dispatched') && !content.innerHTML.includes('live-rider-map')) {
            const savedOrderId = localStorage.getItem('dailyPick_activeOrderId');
            if(!savedOrderId) return;
            if (typeof L === 'undefined') {
                const leafletCss = document.createElement('link'); leafletCss.rel = 'stylesheet'; leafletCss.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(leafletCss);
                const leafletJs = document.createElement('script'); leafletJs.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; document.head.appendChild(leafletJs);
                leafletJs.onload = () => initializeLiveMap(savedOrderId);
            } else { initializeLiveMap(savedOrderId); }
        }
    }, 800);
};

function initializeLiveMap(orderId) {
    const mapContainer = document.createElement('div');
    mapContainer.id = 'live-rider-map';
    mapContainer.style.cssText = 'width: 100%; height: 250px; margin-top: 20px; border-radius: 16px; z-index: 1; border: 1px solid #e2e8f0;';
    document.getElementById('tracking-content').appendChild(mapContainer);

    const defaultLat = userLat || 18.6298; const defaultLng = userLng || 73.7997;
    consumerLiveMap = L.map('live-rider-map').setView([defaultLat, defaultLng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(consumerLiveMap);
    
    const riderIcon = L.divIcon({ html: '<div style="font-size: 28px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.2));">🛵</div>', className: '', iconSize: [28, 28], iconAnchor: [14, 14] });
    riderMarker = L.marker([defaultLat, defaultLng], { icon: riderIcon }).addTo(consumerLiveMap);

    if (consumerTrackingWS) consumerTrackingWS.close();
    consumerTrackingWS = new WebSocket(`wss://dailypick-backend-production-05d6.up.railway.app/api/ws/track?orderId=${orderId}`);
    consumerTrackingWS.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.lat && data.lng) {
                const newLatLng = new L.LatLng(data.lat, data.lng);
                riderMarker.setLatLng(newLatLng);
                consumerLiveMap.panTo(newLatLng); 
            }
        } catch(e) {}
    };
}

window.quickAdd = quickAdd;
window.openCustomerLogin = openCustomerLogin;
window.closeCustomerLogin = closeCustomerLogin;
window.requestOTP = requestOTP;
window.verifyOTP = verifyOTP;
window.logoutCustomer = logoutCustomer;

})();

(function() {
    window.registerNativePushToken = async function(jwtToken) {
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            try {
                const { PushNotifications } = window.Capacitor.Plugins;
                const permStatus = await PushNotifications.requestPermissions();
                if (permStatus.receive === 'granted') {
                    await PushNotifications.register();
                    PushNotifications.addListener('registration', (token) => {
                        fetch('https://dailypick-backend-production-05d6.up.railway.app/api/customers/device-token', {
                            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwtToken}` }, body: JSON.stringify({ fcmToken: token.value })
                        }).catch(()=>{});
                    });
                    PushNotifications.addListener('pushNotificationReceived', (notification) => {
                        if (notification.data && notification.data.orderId) {
                            localStorage.setItem('dailyPick_activeOrderId', notification.data.orderId);
                            document.getElementById('nav-orders').click();
                        }
                    });
                }
            } catch(e) {}
        }
    };
})();

(function() {
    const triggerHaptic = async (style = 'LIGHT') => {
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            try { const { Haptics, ImpactStyle } = window.Capacitor.Plugins; await Haptics.impact({ style: ImpactStyle[style] || ImpactStyle.Light }); } catch (e) {}
        }
    };

    const originalQuickAddPhase16 = window.quickAdd;
    window.quickAdd = function(productId) { triggerHaptic('MEDIUM'); originalQuickAddPhase16(productId); };

    const originalAdjustQtyPhase16 = window.adjustQty;
    window.adjustQty = function(productId, change) { triggerHaptic('LIGHT'); originalAdjustQtyPhase16(productId, change); };

    window.openReportIssueModal = function(orderId) {
        const modal = document.getElementById('report-issue-modal');
        if (modal) { modal.classList.remove('hidden'); modal.setAttribute('data-issue-order', orderId); }
    };

    window.closeReportIssueModal = function() {
        const modal = document.getElementById('report-issue-modal');
        if (modal) { modal.classList.add('hidden'); document.getElementById('photo-preview-container').classList.add('hidden'); document.getElementById('issue-photo-preview').src = ''; modal.removeAttribute('data-issue-photo-base64'); }
    };

    window.triggerNativeCamera = async function() {
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            try {
                const { Camera, CameraResultType, CameraSource } = window.Capacitor.Plugins;
                const image = await Camera.getPhoto({ quality: 80, allowEditing: false, resultType: CameraResultType.Base64, source: CameraSource.Prompt });
                if (image && image.base64String) processBase64Photo(image.base64String);
            } catch (error) {}
        } else { document.getElementById('fallback-file-upload').click(); }
    };

    window.handleFallbackPhotoUpload = function(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => { processBase64Photo(reader.result.split(',')[1]); };
    };

    function processBase64Photo(base64String) {
        document.getElementById('issue-photo-preview').src = `data:image/jpeg;base64,${base64String}`;
        document.getElementById('photo-preview-container').classList.remove('hidden');
        document.getElementById('report-issue-modal').setAttribute('data-issue-photo-base64', base64String);
        triggerHaptic('HEAVY');
    }

    window.submitIssueReport = async function() {
        const modal = document.getElementById('report-issue-modal');
        const orderId = modal.getAttribute('data-issue-order');
        const photoBase64 = modal.getAttribute('data-issue-photo-base64');
        if (!orderId || !photoBase64) return;
        
        const btn = document.querySelector('#photo-preview-container .primary-btn');
        const originalText = btn.textContent; btn.textContent = 'Uploading...'; btn.disabled = true;

        try {
            const token = localStorage.getItem('dailyPick_customerToken');
            const res = await fetch('https://dailypick-backend-production-05d6.up.railway.app/api/orders/report-issue', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, body: JSON.stringify({ orderId, imageBase64: photoBase64 })
            });
            const result = await res.json();
            if (result.success || res.status === 404) {
                alert("Thank you. Our team has received the photo and will process your refund shortly.");
                closeReportIssueModal();
            } else { alert("Upload failed. Please try again."); }
        } catch(e) { alert("Network error."); } finally { btn.textContent = originalText; btn.disabled = false; }
    };

    const originalGetCurrentPosition = navigator.geolocation.getCurrentPosition;
    navigator.geolocation.getCurrentPosition = async function(success, error, options) {
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            try {
                const { Geolocation } = window.Capacitor.Plugins;
                const permissions = await Geolocation.requestPermissions();
                if (permissions.location === 'granted') {
                    const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
                    success({ coords: { latitude: position.coords.latitude, longitude: position.coords.longitude } });
                } else { if (error) error(new Error("Location permission denied.")); }
            } catch (e) { if (error) error(e); }
        } else { return originalGetCurrentPosition.call(navigator.geolocation, success, error, options); }
    };
})();

// ============================================================================
// --- NEW: PHASE 33 PINDUODUO PROTOCOL (MICRO-NEIGHBORHOOD GROUP BUYS) ---
// ============================================================================
(function() {
    let isJoiningCollective = false;

    const MOCK_COLLECTIVES = [
        { _id: "COL_001", productName: "Aashirvaad Select Premium Sharbati Atta, 5 kg", originalPriceRs: 310, collectiveDiscountRs: 245, targetParticipants: 5, currentParticipants: 3, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 14).toISOString(), dropoffAddress: "Society Main Gate" },
        { _id: "COL_002", productName: "Maggi 2-Minute Instant Noodles, 12 Pack", originalPriceRs: 168, collectiveDiscountRs: 125, targetParticipants: 10, currentParticipants: 8, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString(), dropoffAddress: "Society Main Gate" }
    ];

    function renderNeighborhoodDeals() {
        const injectionPoint = document.getElementById('collectives-injection-point');
        if (!injectionPoint) return;

        const container = document.createElement('div');
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 24px 16px 12px 16px;';
        header.innerHTML = `
            <h2 class="section-title" style="padding: 0; margin: 0;">Neighborhood Deals</h2>
            <span style="background: #fee2e2; color: #ef4444; border: 1px solid #fecaca; font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 8px; letter-spacing: 0.5px;">GROUP BUY</span>
        `;
        container.appendChild(header);

        const carousel = document.createElement('div');
        carousel.className = 'collective-carousel';

        MOCK_COLLECTIVES.forEach(deal => {
            const pct = (deal.currentParticipants / deal.targetParticipants) * 100;
            const remaining = deal.targetParticipants - deal.currentParticipants;
            const card = document.createElement('div');
            card.className = 'collective-card';
            
            card.innerHTML = `
                <span class="collective-badge">Ends in <span class="countdown-timer" data-expires="${deal.expiresAt}">--:--</span></span>
                <h3 class="collective-title">${deal.productName}</h3>
                <p class="collective-price">₹${deal.collectiveDiscountRs} <span>₹${deal.originalPriceRs}</span></p>
                <div class="collective-progress-bg"><div class="collective-progress-bar" style="width: ${pct}%"></div></div>
                <div class="collective-meta"><span>${deal.currentParticipants} joined</span><span>Need ${remaining} more</span></div>
                <button class="collective-btn" onclick="joinCollective('${deal._id}', ${deal.collectiveDiscountRs})">
                    🛒 Lock in ₹${deal.collectiveDiscountRs}
                </button>
            `;
            carousel.appendChild(card);
        });

        container.appendChild(carousel);
        injectionPoint.appendChild(container);
        startCountdowns();
    }

    function startCountdowns() {
        setInterval(() => {
            document.querySelectorAll('.countdown-timer').forEach(el => {
                const distance = new Date(el.getAttribute('data-expires')).getTime() - new Date().getTime();
                if (distance < 0) { el.textContent = "EXPIRED"; return; }
                const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                el.textContent = `${hours}h ${minutes}m`;
            });
        }, 60000); 
    }

    window.joinCollective = async function(collectiveId, amountRs) {
        if (isJoiningCollective) return;
        const token = localStorage.getItem('dailyPick_customerToken');
        if (!token) return window.openCustomerLogin();

        isJoiningCollective = true;
        if (typeof Razorpay === 'undefined') { alert("Payment gateway loading. Try again."); isJoiningCollective = false; return; }

        var options = {
            "key": "rzp_test_dummykey", "amount": amountRs * 100, "currency": "INR", "name": "DailyPick Collectives",
            "description": `Group Buy Authorization Lock`,
            "handler": async function (response) { alert(`Success! You have joined the Group Buy. You will only be charged when the threshold is hit.`); isJoiningCollective = false; },
            "theme": { "color": "#4F46E5" } 
        };
        var rzp1 = new Razorpay(options);
        rzp1.on('payment.failed', function (response){ alert('Authorization Failed'); isJoiningCollective = false; });
        rzp1.open();
    };

    document.addEventListener('DOMContentLoaded', () => { setTimeout(renderNeighborhoodDeals, 500); });
})();
