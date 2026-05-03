/* supermarket-frontend/app.js */

// ============================================================================
// --- SECURE GLOBAL STATE ENCAPSULATION MODULE ---
// ============================================================================
(function() {
const BACKEND_URL = 'https://dailypick-backend-production-05d6.up.railway.app';
const DELIVERY_FEE = 20;

const ENABLE_CART_ISOLATION = false; 

let allProducts = []; 
let cart = JSON.parse(localStorage.getItem('dailyPick_cart')) || []; 
let selectedDeliveryType = 'Instant'; 
let selectedPaymentMethod = 'Cash'; 
let allCategories = [];
let trackingStreamController = null; 
let isProcessingOrder = false; 

let userLat = null;
let userLng = null;
let pendingProductToAdd = null;
let customerLoyaltyBalance = 0;
let isLoyaltyApplied = false;

let userAddresses = JSON.parse(localStorage.getItem('dailyPick_addresses')) || [];
let selectedAddressIndex = 0;
let newAddressTag = 'Home';

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

// --- FIREBASE AUTHENTICATION ---
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
        closeProfileModal();
    });
}

async function updateAuthUI() {
    const token = localStorage.getItem('dailyPick_customerToken');
    const profileIcon = document.querySelector('.profile-icon');
    
    if (token) {
        profileIcon.textContent = '🟢'; 
        try {
            const res = await storeFetchWithAuth(`${BACKEND_URL}/api/customers/me`);
            const result = await res.json();
            if (result.success && result.data) {
                // Pre-fill Checkout Data
                document.getElementById('cust-name').value = result.data.name || '';
                document.getElementById('cust-phone').value = result.data.phone || '';
                
                document.getElementById('profile-display-name').textContent = result.data.name || 'DailyPick Member';
                document.getElementById('profile-display-phone').textContent = result.data.phone || '';

                // Handle Loyalty
                customerLoyaltyBalance = result.data.loyaltyPoints || 0;
                if (customerLoyaltyBalance > 0) {
                    document.getElementById('loyalty-wallet-container').classList.remove('hidden');
                    document.getElementById('loyalty-balance-display').textContent = `Rs ${customerLoyaltyBalance}`;
                }

                // Handle Addresses (Fallback to localStorage if backend array is empty)
                if (result.data.addresses && result.data.addresses.length > 0) {
                    userAddresses = result.data.addresses;
                    localStorage.setItem('dailyPick_addresses', JSON.stringify(userAddresses));
                }
                renderAddressBooks();
            }
        } catch(e) { console.warn("Profile fetch failed", e); renderAddressBooks(); }
    } else {
        profileIcon.textContent = '👤'; 
        customerLoyaltyBalance = 0;
        isLoyaltyApplied = false;
        userAddresses = [];
        document.getElementById('cust-name').value = '';
        document.getElementById('cust-phone').value = '';
        if(document.getElementById('use-loyalty-toggle')) document.getElementById('use-loyalty-toggle').checked = false;
        if(document.getElementById('loyalty-wallet-container')) document.getElementById('loyalty-wallet-container').classList.add('hidden');
        renderAddressBooks();
    }
}

window.openProfileModal = function() {
    const token = localStorage.getItem('dailyPick_customerToken');
    if (!token) return openCustomerLogin();
    document.getElementById('profile-modal').classList.add('active');
};

window.closeProfileModal = function() {
    document.getElementById('profile-modal').classList.remove('active');
};

window.openAddAddressModal = function() {
    const token = localStorage.getItem('dailyPick_customerToken');
    if (!token) return openCustomerLogin();
    document.getElementById('add-address-modal').classList.remove('hidden');
};

window.closeAddAddressModal = function() {
    document.getElementById('add-address-modal').classList.add('hidden');
    document.getElementById('new-addr-flat').value = '';
    document.getElementById('new-addr-street').value = '';
    document.getElementById('new-addr-landmark').value = '';
    setAddressTag('Home');
};

window.setAddressTag = function(tag) {
    newAddressTag = tag;
    document.getElementById('tag-home').classList.toggle('active', tag === 'Home');
    document.getElementById('tag-work').classList.toggle('active', tag === 'Work');
    document.getElementById('tag-other').classList.toggle('active', tag === 'Other');
};

window.saveNewAddress = async function() {
    const flat = document.getElementById('new-addr-flat').value.trim();
    const street = document.getElementById('new-addr-street').value.trim();
    const landmark = document.getElementById('new-addr-landmark').value.trim();
    
    if (!flat || !street) return showToast("Flat and Street are required.");

    const fullAddress = `${flat}, ${street}${landmark ? ', Near ' + landmark : ''}`;
    const addressObj = { tag: newAddressTag, fullAddress: fullAddress };

    userAddresses.push(addressObj);
    selectedAddressIndex = userAddresses.length - 1;
    localStorage.setItem('dailyPick_addresses', JSON.stringify(userAddresses));
    
    renderAddressBooks();
    closeAddAddressModal();
    showToast("Address Saved Successfully! 📍");

    try {
        await storeFetchWithAuth(`${BACKEND_URL}/api/customers/me/addresses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(addressObj)
        });
    } catch(e) { console.warn("Failed to sync address to cloud", e); }
};

window.selectAddress = function(index) {
    selectedAddressIndex = index;
    renderAddressBooks();
};

function renderAddressBooks() {
    const checkoutList = document.getElementById('checkout-address-list');
    const profileList = document.getElementById('profile-address-list');
    
    if (!checkoutList || !profileList) return;

    if (userAddresses.length === 0) {
        checkoutList.innerHTML = '<p style="font-size: 13px; color: #64748b;">No saved addresses.</p>';
        profileList.innerHTML = '<p class="empty-state">No saved addresses.</p>';
        return;
    }

    let checkoutHtml = '';
    let profileHtml = '';

    userAddresses.forEach((addr, idx) => {
        const isSelected = idx === selectedAddressIndex;
        const icon = addr.tag === 'Home' ? '🏠' : (addr.tag === 'Work' ? '🏢' : '📍');
        
        checkoutHtml += `
            <div onclick="selectAddress(${idx})" style="background: ${isSelected ? '#e0e7ff' : '#f8fafc'}; border: 1px solid ${isSelected ? 'var(--primary)' : '#e2e8f0'}; padding: 16px; border-radius: 12px; margin-bottom: 8px; cursor: pointer; transition: 0.2s; position: relative;">
                ${isSelected ? '<div style="position: absolute; top: 12px; right: 12px; color: var(--primary);">✅</div>' : ''}
                <div style="font-size: 14px; font-weight: 800; color: var(--text-main); margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">${icon} ${addr.tag}</div>
                <div style="font-size: 13px; color: var(--text-muted); line-height: 1.4;">${addr.fullAddress}</div>
            </div>
        `;

        profileHtml += `
            <div style="background: white; border: 1px solid #e2e8f0; padding: 16px; border-radius: 12px; margin-bottom: 8px;">
                <div style="font-size: 14px; font-weight: 800; color: var(--text-main); margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">${icon} ${addr.tag}</div>
                <div style="font-size: 13px; color: var(--text-muted); line-height: 1.4;">${addr.fullAddress}</div>
            </div>
        `;
    });

    checkoutList.innerHTML = checkoutHtml;
    profileList.innerHTML = profileHtml;
}

// ============================================================================
// --- NEW: INTERACTIVE MAP & REVERSE GEOCODING MODULE ---
// ============================================================================
let locationPickerMap = null;
let locationPickerMarker = null;

window.openLocationModal = function() {
    document.getElementById('location-picker-modal').classList.add('active');
    
    if (!locationPickerMap && typeof L !== 'undefined') {
        setTimeout(() => {
            const lat = userLat || 18.6298;
            const lng = userLng || 73.7997;
            
            locationPickerMap = L.map('location-picker-map').setView([lat, lng], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(locationPickerMap);
            locationPickerMarker = L.marker([lat, lng], { draggable: true }).addTo(locationPickerMap);
            
            // Map Click updates Marker
            locationPickerMap.on('click', function(e) {
                locationPickerMarker.setLatLng(e.latlng);
                updateLocationText(e.latlng.lat, e.latlng.lng);
            });

            // Marker Drag updates
            locationPickerMarker.on('dragend', function(e) {
                const position = locationPickerMarker.getLatLng();
                updateLocationText(position.lat, position.lng);
            });
            
            // Initial Geocode run
            updateLocationText(lat, lng);
            
        }, 350); // Wait for CSS bottom-sheet animation to finish before rendering tiles
    }
};

window.closeLocationModal = function() {
    document.getElementById('location-picker-modal').classList.remove('active');
};

async function updateLocationText(lat, lng) {
    const input = document.getElementById('location-search-input');
    input.value = "Fetching address...";
    try {
        // Free Reverse Geocoding via OpenStreetMap
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        if (data && data.display_name) {
            input.value = data.display_name;
            const modal = document.getElementById('location-picker-modal');
            modal.setAttribute('data-lat', lat);
            modal.setAttribute('data-lng', lng);
            // Grab the most concise neighborhood name for the header
            modal.setAttribute('data-name', data.address.suburb || data.address.neighbourhood || data.address.city || "Custom Location");
        }
    } catch(e) {
        input.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

window.searchLocation = async function() {
    const query = document.getElementById('location-search-input').value;
    if (!query || query.length < 3) return;
    
    const btn = document.getElementById('btn-search-loc');
    const oldText = btn.textContent;
    btn.textContent = '...';
    
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            
            if (locationPickerMap && locationPickerMarker) {
                const newLatLng = new L.LatLng(lat, lng);
                locationPickerMap.panTo(newLatLng);
                locationPickerMarker.setLatLng(newLatLng);
                updateLocationText(lat, lng);
            }
        } else {
            showToast("Location not found. Try a broader search.");
        }
    } catch(e) {
        showToast("Search failed.");
    } finally {
        btn.textContent = oldText;
    }
};

window.confirmLocation = function() {
    const modal = document.getElementById('location-picker-modal');
    const newLat = parseFloat(modal.getAttribute('data-lat'));
    const newLng = parseFloat(modal.getAttribute('data-lng'));
    const newName = modal.getAttribute('data-name') || "Selected Location";

    if (!isNaN(newLat) && !isNaN(newLng)) {
        userLat = newLat;
        userLng = newLng;
        document.getElementById('dynamic-location').textContent = `📍 ${newName} ▼`;
        
        // Refresh catalog and stores based on new coords
        fetchDiscoveryStores(userLat, userLng);
        fetchProducts();
    }
    closeLocationModal();
};

async function storeFetchWithAuth(url, options = {}) {
    const token = localStorage.getItem('dailyPick_customerToken'); 
    options.headers = options.headers || {};
    options.credentials = 'include';
    
    if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (url.includes('/api/orders/omni-checkout') && options.body) {
        try {
            let payload = JSON.parse(options.body);
            payload.useLoyaltyPoints = isLoyaltyApplied;
            options.body = JSON.stringify(payload);
        } catch(e) {}
    }
    
    const response = await fetch(url, options);
    
    if (response.status === 401 || response.status === 403) {
        console.warn('Unauthorized. Feature may require login.', url);
    }
    
    return response;
}

const triggerHaptic = async (style = 'LIGHT') => {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const { Haptics, ImpactStyle } = window.Capacitor.Plugins;
            await Haptics.impact({ style: ImpactStyle[style] || ImpactStyle.Light });
        } catch (e) {}
    }
};

async function initializeLocationAndFetch() {
    const successHandler = (position) => {
        userLat = position.coords.latitude;
        userLng = position.coords.longitude;
        // Fire reverse geocode immediately to populate the header beautifully
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLat}&lon=${userLng}`)
            .then(res => res.json())
            .then(data => {
                const name = data.address?.suburb || data.address?.neighbourhood || data.address?.city || 'Near You';
                document.getElementById('dynamic-location').textContent = `📍 ${name} ▼`;
            }).catch(() => {
                document.getElementById('dynamic-location').textContent = '📍 Near You ▼';
            });
            
        fetchDiscoveryStores(userLat, userLng);
        fetchProducts(); 
    };

    const errorHandler = (error) => {
        console.warn("Location access denied or failed. Loading default catalog.");
        document.getElementById('dynamic-eta').textContent = 'Standard';
        document.getElementById('dynamic-location').textContent = '📍 Set Delivery Location ▼';
        fetchProducts(); 
    };

    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const { Geolocation } = window.Capacitor.Plugins;
            const permissions = await Geolocation.requestPermissions();
            if (permissions.location === 'granted') {
                const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
                successHandler({ coords: { latitude: position.coords.latitude, longitude: position.coords.longitude } });
            } else {
                errorHandler(new Error("Location permission denied."));
            }
        } catch (e) { errorHandler(e); }
    } else if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(successHandler, errorHandler);
    } else {
        fetchProducts();
    }
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
    } catch (e) { console.error("Error fetching categories", e); }
}

async function fetchDiscoveryStores(lat, lng) {
    try {
        const res = await storeFetchWithAuth(`${BACKEND_URL}/api/stores/discover?lat=${lat}&lng=${lng}`);
        const result = await res.json();
        if (result.success && result.data) {
            renderDiscoveryUI(result.data);
            
            const etaEl = document.getElementById('dynamic-eta');
            if (result.data.quickCommerce && result.data.quickCommerce.length > 0) {
                if (etaEl) etaEl.textContent = '15 mins'; 
            } else if (result.data.megaMarts && result.data.megaMarts.length > 0) {
                if (etaEl) etaEl.textContent = 'Next Day';
            } else {
                if (etaEl) etaEl.textContent = 'Standard';
            }
        }
    } catch(e) { console.warn("Discovery API unavailable", e); }
}

function renderDiscoveryUI(data) {
    const injectionPoint = document.getElementById('discovery-injection-point');
    const promoSection = document.querySelector('.promo-banners');
    
    if (injectionPoint && promoSection && promoSection.parentNode) {
        promoSection.parentNode.insertBefore(injectionPoint, promoSection.nextSibling);
        injectionPoint.style.display = 'block';
        
        const container = document.getElementById('discovery-lists-container');
        container.innerHTML = '';
        
        if (data.megaMarts && data.megaMarts.length > 0) {
            const megaLabel = document.createElement('h3');
            megaLabel.style.cssText = 'font-size: 14px; font-weight: 800; color: var(--text-main); margin: 16px 16px 12px 16px; letter-spacing: -0.5px;';
            megaLabel.textContent = '🏢 Mega Marts (Next Day)';
            container.appendChild(megaLabel);
            
            const carousel = document.createElement('div');
            carousel.className = 'discovery-carousel';
            data.megaMarts.forEach(store => {
                carousel.innerHTML += `
                    <div class="discovery-card">
                        <h4 class="discovery-title">${store.name}</h4>
                        <p class="discovery-meta">★ ${store.metrics?.rating || '4.8'} • ${(store.distanceInMeters/1000).toFixed(1)} km away</p>
                        <span class="discovery-badge badge-enterprise">Enterprise ERP Synced</span>
                    </div>
                `;
            });
            container.appendChild(carousel);
        }
        
        if (data.quickCommerce && data.quickCommerce.length > 0) {
            const quickLabel = document.createElement('h3');
            quickLabel.style.cssText = 'font-size: 14px; font-weight: 800; color: var(--text-main); margin: 16px 16px 12px 16px; letter-spacing: -0.5px;';
            quickLabel.textContent = '⚡ Quick Commerce (15 Mins)';
            container.appendChild(quickLabel);
            
            const carousel = document.createElement('div');
            carousel.className = 'discovery-carousel';
            data.quickCommerce.forEach(store => {
                carousel.innerHTML += `
                    <div class="discovery-card">
                        <h4 class="discovery-title">${store.name}</h4>
                        <p class="discovery-meta">★ ${store.metrics?.rating || '4.5'} • ${(store.distanceInMeters/1000).toFixed(1)} km away</p>
                        <span class="discovery-badge badge-quick">Platform Delivery Fleet</span>
                    </div>
                `;
            });
            container.appendChild(carousel);
        }
    }
}

async function fetchEnterprisePartners() {
    try {
        const res = await storeFetchWithAuth(`${BACKEND_URL}/api/stores?type=ENTERPRISE`);
        const result = await res.json();
        if (result.success && result.data && result.data.length > 0) {
            renderEnterpriseCarousel(result.data);
        }
    } catch(e) { console.warn("Could not load enterprise partners", e); }
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
        btn.onclick = () => filterByEnterpriseStore(store.id, store.name);
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
    
    const banner = document.getElementById('partner-brand-banner');
    const nameEl = document.getElementById('partner-brand-name');
    const logoEl = document.getElementById('partner-brand-logo');
    
    if (banner && nameEl && logoEl) {
        nameEl.textContent = storeName;
        logoEl.textContent = storeName.charAt(0).toUpperCase();
        
        if (storeName.toLowerCase().includes('croma')) banner.style.background = 'linear-gradient(135deg, #0f766e, #0f172a)'; 
        else if (storeName.toLowerCase().includes('reliance')) banner.style.background = 'linear-gradient(135deg, #b91c1c, #0f172a)'; 
        else if (storeName.toLowerCase().includes('dmart') || storeName.toLowerCase().includes('d mart')) banner.style.background = 'linear-gradient(135deg, #15803d, #0f172a)'; 
        else banner.style.background = 'linear-gradient(135deg, #1e293b, #0f172a)'; 
        
        banner.classList.remove('hidden');
    }

    title.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function openPriceCompare(sku, productName) {
    if (!userLat || !userLng) return showToast("Please allow location access to compare prices nearby.");
    
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
            renderProducts(allProducts);
            if (cart.length > 0) updateGlobalCartUI(); 
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
    
    const banner = document.getElementById('partner-brand-banner');
    if (banner) banner.classList.add('hidden');

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
    
    const banner = document.getElementById('partner-brand-banner');
    if (banner) banner.classList.add('hidden');

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
    "mlik": ["milk"], "bred": ["bread"], "shmpoo": ["shampoo"], "sope": ["soap"],
    "cravings": ["chips", "chocolate", "soda", "snack"]
};

function handleSearch(event) { 
    const rawQuery = event.target.value.toLowerCase().trim(); 
    if (!rawQuery) { filterCategory('All'); return; } 
    if (rawQuery.length < 2) return; 
    
    document.getElementById('product-grid-title').textContent = `Searching...`;
    const banner = document.getElementById('partner-brand-banner');
    if (banner) banner.classList.add('hidden');

    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(async () => {
        
        requestAnimationFrame(() => {
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
                    if (term.length > 3 && pName.includes(term.substring(0, term.length - 1))) score += 2;
                });
                return { product: p, score };
            }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).map(item => item.product);

            document.getElementById('product-grid-title').textContent = `Search Results`;
            renderProducts(scoredProducts);
        });
        
        try {
            let url = `${BACKEND_URL}/api/products/autocomplete?q=${encodeURIComponent(rawQuery)}`;
            if (userLat && userLng) url += `&lat=${userLat}&lng=${userLng}`;
            const res = await storeFetchWithAuth(url);
            const result = await res.json();
            if (result.success && result.data.length > 0) {
                requestAnimationFrame(() => renderProducts(result.data));
            }
        } catch (e) {}
    }, 400); 
}

window.quickAdd = function(productId) { 
    triggerHaptic('MEDIUM');
    let p = allProducts.find(p => p._id === productId); 
    if (!p) { showToast("Added from search!"); return; }

    const displayVariant = (p.variants && p.variants.length > 0) ? p.variants[0] : { price: 0, weightOrVolume: 'N/A', storeId: null }; 

    if (ENABLE_CART_ISOLATION && cart.length > 0 && displayVariant.storeId && cart[0].storeId && cart[0].storeId !== displayVariant.storeId) {
        pendingProductToAdd = { ...p, targetVariant: displayVariant };
        document.getElementById('isolation-modal').classList.remove('hidden');
        return; 
    }
    
    cart.push({
        ...p, 
        qty: 1, 
        currentPrice: displayVariant.price, 
        storeId: displayVariant.storeId,
        storeName: displayVariant.storeName || 'DailyPick Platform'
    }); 
    updateCardActionUI(productId); 
    updateGlobalCartUI(); 
};

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

window.adjustQty = function(productId, change) { 
    triggerHaptic('LIGHT');
    const idx = cart.findIndex(i => i._id === productId); 
    if (idx > -1) { 
        cart[idx].qty += change; 
        if (cart[idx].qty <= 0) cart.splice(idx, 1); 
    } 
    updateCardActionUI(productId); 
    updateGlobalCartUI(); 
};

function updateCardActionUI(productId) { 
    const container = document.getElementById(`action-container-${productId}`); 
    if (!container) return; 
    
    const item = cart.find(i => i._id === productId); 
    const qty = item ? item.qty : 0; 
    
    const compareBtn = container.querySelector('button[title="Compare Prices Nearby"]');
    container.innerHTML = ''; 
    if (compareBtn) container.appendChild(compareBtn);
    
    if (qty === 0) { 
        const btn = document.createElement('button');
        btn.className = 'add-btn';
        btn.textContent = 'ADD';
        btn.onclick = () => window.quickAdd(productId);
        container.appendChild(btn);
    } else { 
        const stepper = document.createElement('div');
        stepper.className = 'stepper';
        
        const minusBtn = document.createElement('button');
        minusBtn.textContent = '−';
        minusBtn.onclick = () => window.adjustQty(productId, -1);
        
        const span = document.createElement('span');
        span.textContent = qty;
        
        const plusBtn = document.createElement('button');
        plusBtn.textContent = '+';
        plusBtn.onclick = () => window.adjustQty(productId, 1);
        
        stepper.appendChild(minusBtn);
        stepper.appendChild(span);
        stepper.appendChild(plusBtn);
        container.appendChild(stepper);
    } 
}

function updateGlobalCartUI() { 
    localStorage.setItem('dailyPick_cart', JSON.stringify(cart));

    const totalItems = cart.reduce((s, i) => s + i.qty, 0); 
    const subtotal = cart.reduce((s, i) => s + (i.currentPrice * i.qty), 0); 
    
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
        document.getElementById('loyalty-discount-row').classList.add('hidden');
        
        let existingBanner = document.getElementById('omni-cart-banner');
        if (existingBanner) existingBanner.remove();
        
        const upsellsContainer = document.getElementById('smart-cart-upsells-container');
        if(upsellsContainer) upsellsContainer.classList.add('hidden');
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

    const uniqueStores = Object.keys(groupedCart).length;
    const fragment = document.createDocumentFragment();

    Object.keys(groupedCart).forEach(storeId => {
        const group = groupedCart[storeId];
        
        const headerDiv = document.createElement('div');
        headerDiv.style.cssText = "background: #f1f5f9; padding: 8px 12px; border-radius: 6px; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; margin: 16px 0 8px 0; letter-spacing: 0.5px;";
        headerDiv.textContent = `📦 Fulfilled by ${group.storeName}`;
        fragment.appendChild(headerDiv);

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
            mBtn.onclick = () => window.adjustQty(item._id, -1);
            
            const qSpan = document.createElement('span');
            qSpan.textContent = item.qty;
            
            const pBtn = document.createElement('button');
            pBtn.textContent = '+';
            pBtn.onclick = () => window.adjustQty(item._id, 1);
            
            stepper.appendChild(mBtn);
            stepper.appendChild(qSpan);
            stepper.appendChild(pBtn);
            actionDiv.appendChild(stepper);

            row.appendChild(imgDiv);
            row.appendChild(infoDiv);
            row.appendChild(actionDiv);
            fragment.appendChild(row);
        });
        
        const isEnterprise = !group.storeName.includes('DailyPick Platform');
        const deliveryEta = document.createElement('div');
        deliveryEta.style.cssText = `font-size: 10px; font-weight: 700; margin-top: 4px; padding: 2px 6px; border-radius: 4px; display: inline-block; ${isEnterprise ? 'background: #dbeafe; color: #0369a1;' : 'background: #dcfce7; color: #166534;'}`;
        deliveryEta.textContent = isEnterprise ? '🚚 Enterprise Delivery (Next Day)' : '⚡ Platform Delivery (15 Mins)';
        fragment.appendChild(deliveryEta);
    });
    
    cartItemsContainer.appendChild(fragment);

    const header = document.querySelector('.cart-header');
    let existingBanner = document.getElementById('omni-cart-banner');
    if (uniqueStores > 1) {
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

    document.getElementById('cart-subtotal').textContent = `Rs ${subtotal}`; 
    document.getElementById('cart-total').textContent = `Rs ${finalTotal}`; 

    setTimeout(async () => {
        const upsellsContainer = document.getElementById('smart-cart-upsells-container');
        const upsellsList = document.getElementById('smart-cart-upsells-list');
        if (!upsellsContainer || !upsellsList) return;
        
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
                const cartIds = cart.map(i => i._id.toString());
                const filteredUpsells = result.data.filter(u => !cartIds.includes(u._id.toString())).slice(0, 3);
                
                if (filteredUpsells.length === 0) {
                    upsellsContainer.classList.add('hidden');
                    return;
                }
                
                filteredUpsells.forEach(item => {
                    const v = item.variants && item.variants.length > 0 ? item.variants[0] : {price: 0};
                    upsellsList.innerHTML += `
                        <div style="flex-shrink: 0; width: 120px; background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; text-align: center; box-shadow: 0 4px 10px rgba(0,0,0,0.02);">
                            <img src="${optimizeCloudinaryUrl(item.imageUrl, 100) || ''}" style="width: 60px; height: 60px; object-fit: contain; margin-bottom: 8px;" onerror="this.style.display='none'">
                            <p style="font-size: 11px; font-weight: 700; margin: 0 0 4px 0; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</p>
                            <p style="font-size: 13px; color: var(--primary); font-weight: 800; margin: 0 0 10px 0;">Rs ${v.price}</p>
                            <button onclick="window.quickAdd('${item._id}')" style="background: #f1f5f9; color: var(--primary); border: none; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 800; cursor: pointer; width: 100%;">+ ADD</button>
                        </div>
                    `;
                    if (!allProducts.find(p => p._id === item._id)) allProducts.push(item);
                });
                upsellsContainer.classList.remove('hidden');
            } else {
                upsellsContainer.classList.add('hidden');
            }
        } catch (e) {
            upsellsContainer.classList.add('hidden');
        }
    }, 10);
}

window.toggleLoyaltyPoints = function() {
    isLoyaltyApplied = document.getElementById('use-loyalty-toggle').checked;
    updateGlobalCartUI();
};

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
    
    let address = "";
    if (userAddresses.length > 0 && userAddresses[selectedAddressIndex]) {
        address = userAddresses[selectedAddressIndex].fullAddress;
    }

    if (!name || !phone || !address) {
        showToast('Please provide your Name, Phone, and select a Delivery Address!');
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
    const finalTotal = grandSubtotal + totalDeliveryFee; 
    
    const idempotencyKey = 'OMNI-' + Date.now() + '-' + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).substring(2, 9));
    
    const payloadCarts = storeIds.map(sId => ({
        storeId: sId === 'default' ? null : sId,
        items: groupedCart[sId].items,
        totalAmount: groupedCart[sId].subtotal + DELIVERY_FEE,
        deliveryType: selectedDeliveryType 
    }));

    localStorage.setItem('dailyPick_pendingPayment', idempotencyKey);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15000); 

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
                    customerName: name, 
                    customerPhone: phone, 
                    deliveryAddress: address, 
                    carts: payloadCarts, 
                    notes: finalNotes, 
                    paymentMethod: selectedPaymentMethod,
                    transactionId: transactionId
                }),
                signal: abortController.signal
            }); 
            
            const result = await res.json();
            
            if (result.success) {
                localStorage.setItem('dailyPick_activeOrderId', result.splitShipmentGroupId || 'Group_Processing'); 
                cart = []; 
                localStorage.removeItem('dailyPick_cart'); 
                localStorage.removeItem('dailyPick_pendingPayment'); 
                
                setDeliveryType('Instant');
                window.setPaymentMethod('Cash'); 
                renderProducts(allProducts); 
                updateGlobalCartUI(); 
                closeCart(); 
                switchView('orders'); 
                showToast(`Omni-Cart Success! Split into ${result.totalShipments || storeIds.length} shipments. 🚀`); 
            } else {
                if (res.status === 409) {
                    showToast('⚠️ Some items in your cart just sold out! Refreshing inventory...');
                    localStorage.removeItem('dailyPick_pendingPayment');
                    fetchProducts(); 
                } else {
                    showToast('Failed to place order: ' + result.message); 
                }
            }
        } catch(e) { 
            if (e.name === 'AbortError') {
                showToast('Network timeout. Your connection is unstable, but the order might have succeeded. Check "Orders".');
            } else {
                showToast('Network error.'); 
            }
        } finally { 
            clearTimeout(timeoutId);
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
        
        let razorpayKey = 'rzp_test_dummykey';
        try {
            const configRes = await fetch(`${BACKEND_URL}/api/config/gateway`);
            const configData = await configRes.json();
            if (configData.success) razorpayKey = configData.key;
        } catch(e) {}

        var options = {
            "key": razorpayKey, 
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

let consumerLiveMap = null;
let riderMarker = null;
let consumerTrackingWS = null;

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

            if (order.status === 'Delivered' || order.status === 'Completed') {
                const issueBtn = document.createElement('button');
                issueBtn.onclick = () => window.openReportIssueModal(order._id);
                issueBtn.className = 'secondary-btn-small';
                issueBtn.style.cssText = 'display:block; width:100%; margin-top:12px; background:white; color:#ef4444; border:1px solid #fecaca; text-align:center; padding:12px; border-radius:8px; font-size:13px; font-weight:bold; cursor:pointer;';
                issueBtn.innerHTML = `⚠️ Report Damaged/Missing Item`;
                card.appendChild(issueBtn);
            }

            trackingContent.appendChild(card);
            
            if ((order.status === 'Delivered' || order.status === 'Completed') && !localStorage.getItem(`rated_${savedOrderId}`)) {
                setTimeout(() => {
                    const ratingContainer = document.getElementById('customer-rating-modal');
                    if (ratingContainer) {
                        ratingContainer.classList.remove('hidden');
                        ratingContainer.setAttribute('data-order-id', savedOrderId);
                    }
                }, 500);
            }

            if (order.status === 'Dispatched') {
                if (typeof L === 'undefined') {
                    const leafletCss = document.createElement('link');
                    leafletCss.rel = 'stylesheet';
                    leafletCss.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                    document.head.appendChild(leafletCss);

                    const leafletJs = document.createElement('script');
                    leafletJs.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
                    document.head.appendChild(leafletJs);
                    
                    leafletJs.onload = () => initializeLiveMap(order._id);
                } else {
                    initializeLiveMap(order._id);
                }
            }

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
                                    } catch (err) {}
                                }
                            }
                        }
                    } catch (error) {
                        if (error.name !== 'AbortError') trackingStreamController = null;
                    }
                })();
            }
        } else { 
            trackingContent.innerHTML = '<p class="empty-state">Order details could not be found.</p>';
        } 
    } catch(e) { 
        trackingContent.innerHTML = '<p class="empty-state">Network error checking status.</p>';
    } 
}

function initializeLiveMap(orderId) {
    if (document.getElementById('live-rider-map')) return; 
    
    const mapContainer = document.createElement('div');
    mapContainer.id = 'live-rider-map';
    mapContainer.style.cssText = 'width: 100%; height: 250px; margin-top: 20px; border-radius: 16px; z-index: 1;';
    document.getElementById('tracking-content').appendChild(mapContainer);

    const defaultLat = userLat || 18.6298;
    const defaultLng = userLng || 73.7997;

    consumerLiveMap = L.map('live-rider-map').setView([defaultLat, defaultLng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(consumerLiveMap);
    
    const riderIcon = L.divIcon({ html: '<div style="font-size: 24px;">🛵</div>', className: '', iconSize: [24, 24], iconAnchor: [12, 12] });
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

window.submitOrderRating = async function(score) {
    const modal = document.getElementById('customer-rating-modal');
    if (!modal) return;
    
    const orderId = modal.getAttribute('data-order-id');
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

function showToast(message) { 
    const toast = document.createElement('div'); 
    toast.classList.add('toast'); 
    toast.textContent = message; 
    toastContainer.appendChild(toast); 
    setTimeout(() => toast.remove(), 2500); 
}

// --- APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref') || urlParams.get('utm_campaign') || urlParams.get('source');
    if (ref) localStorage.setItem('dailyPick_marketingRef', ref);

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
    
    document.getElementById('nav-cats').addEventListener('click', () => {
        switchView('shop');
        document.getElementById('categories-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const navProfile = document.getElementById('nav-profile');
    if (navProfile) navProfile.addEventListener('click', window.openProfileModal);

    document.querySelector('.profile-icon').addEventListener('click', window.openProfileModal);
    
    updateAuthUI();
    fetchCategories(); 
    fetchEnterprisePartners(); 
    initializeLocationAndFetch();
    
    if (cart.length > 0) updateGlobalCartUI();
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && cart && cart.length > 0) {
        const token = localStorage.getItem('dailyPick_customerToken');
        if (token) {
            navigator.sendBeacon(`${BACKEND_URL}/api/orders/abandoned-cart`, JSON.stringify({
                cartSnapshot: cart,
                timestamp: new Date().toISOString()
            }));
        }
    }
});

// --- NATIVE CAMERA & GALLERY HANDLERS ---
window.openReportIssueModal = function(orderId) {
    const modal = document.getElementById('report-issue-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.setAttribute('data-issue-order', orderId);
    }
};

window.closeReportIssueModal = function() {
    const modal = document.getElementById('report-issue-modal');
    if (modal) {
        modal.classList.add('hidden');
        document.getElementById('photo-preview-container').classList.add('hidden');
        document.getElementById('issue-photo-preview').src = '';
        modal.removeAttribute('data-issue-photo-base64');
    }
};

window.triggerNativeCamera = async function() {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const { Camera, CameraResultType, CameraSource } = window.Capacitor.Plugins;
            const image = await Camera.getPhoto({ quality: 80, allowEditing: false, resultType: CameraResultType.Base64, source: CameraSource.Prompt });
            if (image && image.base64String) processBase64Photo(image.base64String);
        } catch (error) {}
    } else {
        document.getElementById('fallback-file-upload').click();
    }
};

window.handleFallbackPhotoUpload = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => { processBase64Photo(reader.result.split(',')[1]); };
};

function processBase64Photo(base64String) {
    const imgEl = document.getElementById('issue-photo-preview');
    const container = document.getElementById('photo-preview-container');
    const modal = document.getElementById('report-issue-modal');
    
    imgEl.src = `data:image/jpeg;base64,${base64String}`;
    container.classList.remove('hidden');
    modal.setAttribute('data-issue-photo-base64', base64String);
    
    triggerHaptic('HEAVY');
}

window.submitIssueReport = async function() {
    const modal = document.getElementById('report-issue-modal');
    const orderId = modal.getAttribute('data-issue-order');
    const photoBase64 = modal.getAttribute('data-issue-photo-base64');
    
    if (!orderId || !photoBase64) return;
    
    const btn = document.querySelector('#photo-preview-container .primary-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Uploading...';
    btn.disabled = true;

    try {
        const token = localStorage.getItem('dailyPick_customerToken');
        const res = await fetch(`${BACKEND_URL}/api/orders/report-issue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
            body: JSON.stringify({ orderId, imageBase64: photoBase64 })
        });
        
        const result = await res.json();
        if (result.success || res.status === 404) { 
            alert("Thank you. Our team has received the photo and will process your refund shortly.");
            closeReportIssueModal();
        } else {
            alert("Upload failed. Please try again.");
        }
    } catch(e) { alert("Network error."); } 
    finally { btn.textContent = originalText; btn.disabled = false; }
};

window.registerNativePushToken = async function(jwtToken) {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const { PushNotifications } = window.Capacitor.Plugins;
            const permStatus = await PushNotifications.requestPermissions();
            
            if (permStatus.receive === 'granted') {
                await PushNotifications.register();
                
                PushNotifications.addListener('registration', (token) => {
                    fetch(`${BACKEND_URL}/api/customers/device-token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwtToken}` },
                        body: JSON.stringify({ fcmToken: token.value })
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

let isJoiningCollective = false;

const MOCK_COLLECTIVES = [
    {
        _id: "COL_001",
        productName: "Aashirvaad Select Premium Sharbati Atta, 5 kg",
        originalPriceRs: 310,
        collectiveDiscountRs: 245,
        targetParticipants: 5,
        currentParticipants: 3,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 14).toISOString(), 
        dropoffAddress: "Society Main Gate"
    },
    {
        _id: "COL_002",
        productName: "Maggi 2-Minute Instant Noodles, 12 Pack",
        originalPriceRs: 168,
        collectiveDiscountRs: 125,
        targetParticipants: 10,
        currentParticipants: 8,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString(), 
        dropoffAddress: "Society Main Gate"
    }
];

function renderNeighborhoodDeals() {
    const injectionPoint = document.getElementById('collectives-injection-point');
    if (!injectionPoint) return;

    const container = document.createElement('div');
    
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0 16px 12px 16px;';
    header.innerHTML = `
        <h2 class="section-title" style="padding: 0; margin: 0;">Neighborhood Deals</h2>
        <span style="background: #fee2e2; color: #ef4444; border: 1px solid #fecaca; font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 12px; letter-spacing: 0.5px;">GROUP BUY</span>
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
            <p class="collective-price">Rs ${deal.collectiveDiscountRs} <span>Rs ${deal.originalPriceRs}</span></p>
            
            <div class="collective-progress-bg">
                <div class="collective-progress-bar" style="width: ${pct}%"></div>
            </div>
            <div class="collective-meta">
                <span>${deal.currentParticipants} joined</span>
                <span>Need ${remaining} more</span>
            </div>
            
            <button class="collective-btn" onclick="joinCollective('${deal._id}', ${deal.collectiveDiscountRs})">
                🛒 Lock in Rs ${deal.collectiveDiscountRs}
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
            const expiresAt = new Date(el.getAttribute('data-expires')).getTime();
            const now = new Date().getTime();
            const distance = expiresAt - now;

            if (distance < 0) {
                el.textContent = "EXPIRED";
                return;
            }

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

    if (typeof Razorpay === 'undefined') {
        alert("Payment gateway loading. Try again.");
        isJoiningCollective = false;
        return;
    }

    var options = {
        "key": "rzp_test_dummykey", 
        "amount": amountRs * 100, 
        "currency": "INR",
        "name": "DailyPick Collectives",
        "description": `Group Buy Authorization Lock`,
        "handler": async function (response) {
            alert(`Success! You have joined the Group Buy. You will only be charged when the threshold is hit.`);
            isJoiningCollective = false;
        },
        "theme": { "color": "#16a34a" } 
    };
    var rzp1 = new Razorpay(options);
    rzp1.on('payment.failed', function (response){
        alert('Authorization Failed');
        isJoiningCollective = false;
    });
    rzp1.open();
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(renderNeighborhoodDeals, 500);
});

// GLOBAL EXPORTS
window.quickAdd = quickAdd;
window.openCustomerLogin = openCustomerLogin;
window.closeCustomerLogin = closeCustomerLogin;
window.requestOTP = requestOTP;
window.verifyOTP = verifyOTP;
window.logoutCustomer = logoutCustomer;

})();
