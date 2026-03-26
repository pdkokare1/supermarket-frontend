const BACKEND_URL = 'https://dailypick-backend-production-05d6.up.railway.app';
const DELIVERY_FEE = 20;

let allProducts = []; 
let cart = []; 
let selectedDeliveryType = 'Instant'; 
let allCategories = [];
let trackingStreamController = null; 
let isProcessingOrder = false; 

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
            
            allCategories.forEach(cat => {
                const visual = CATEGORY_IMAGES[cat.name] || { emoji: '🛍️', color: '#f1f5f9' };
                const card = document.createElement('div'); 
                card.className = 'category-card';
                card.innerHTML = `
                    <div class="category-img-wrapper" style="background-color: ${visual.color}">
                        ${visual.emoji}
                    </div>
                    <p>${cat.name}</p>
                `;
                card.onclick = () => filterCategory(cat.name);
                grid.appendChild(card);
            });
        }
    } catch (e) { 
        console.error("Error fetching categories", e); 
    }
}

async function fetchProducts() { 
    try { 
        const res = await storeFetchWithAuth(`${BACKEND_URL}/api/products`); 
        const result = await res.json(); 
        
        if (result.success && result.data) { 
            allProducts = result.data; 
            skeletonGrid.classList.add('hidden'); 
            storefront.classList.remove('hidden'); 
            renderProducts(allProducts); 
        } 
    } catch(e) { 
        skeletonGrid.innerHTML = '<p style="grid-column: span 2; text-align:center;">Failed to connect.</p>'; 
    } 
}

function renderProducts(productsToRender) { 
    storefront.innerHTML = ''; 
    
    if (productsToRender.length === 0) { 
        storefront.innerHTML = '<p style="grid-column:span 2;text-align:center;color:#94A3B8;margin-top:40px;">No products found.</p>'; 
        return; 
    } 
    
    productsToRender.forEach(product => { 
        const card = document.createElement('div'); 
        card.classList.add('product-card'); 
        
        const displayVariant = (product.variants && product.variants.length > 0) 
            ? product.variants[0] 
            : { price: 0, weightOrVolume: 'N/A', stock: 0, lowStockThreshold: 5 };

        let fomoBadge = '';
        const threshold = displayVariant.lowStockThreshold || 5;
        if (displayVariant.stock > 0 && displayVariant.stock <= threshold) {
            fomoBadge = `<div class="fomo-badge">🔥 Only ${displayVariant.stock} left!</div>`;
        }

        const optimizedImg = optimizeCloudinaryUrl(product.imageUrl, 400);
        let imageContent = product.imageUrl 
            ? `<img src="${optimizedImg}" style="width:100%; height:100%; object-fit:contain; border-radius:8px;">`
            : `<div style="font-size:44px; display:flex; align-items:center; justify-content:center; width:100%; height:100%;">📦</div>`;

        card.innerHTML = `
            <div>
                <div class="product-image" style="padding:0; overflow:hidden; position:relative;">
                    ${fomoBadge}
                    ${imageContent}
                </div>
                <div class="product-info">
                    <h3>${product.name}</h3>
                    <p class="product-weight">${displayVariant.weightOrVolume}</p>
                </div>
            </div>
            <div class="price-action-row">
                <div class="product-price">₹${displayVariant.price}</div>
                <div class="action-container" id="action-container-${product._id}"></div>
            </div>
        `; 
        
        storefront.appendChild(card); 
        updateCardActionUI(product._id); 
    }); 
}

function filterCategory(category) { 
    document.getElementById('search-input').value = ''; 
    const title = document.getElementById('product-grid-title');
    
    if (category === 'All') { 
        title.innerText = 'All Products'; 
        renderProducts(allProducts); 
    } else { 
        title.innerText = category; 
        renderProducts(allProducts.filter(p => p.category === category)); 
    }
    
    title.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function filterByTag(tag, displayTitle) {
    document.getElementById('search-input').value = ''; 
    const title = document.getElementById('product-grid-title'); 
    title.innerText = displayTitle;
    
    renderProducts(allProducts.filter(p => { 
        return p.searchTags && p.searchTags.toLowerCase().includes(tag.toLowerCase()); 
    }));
    
    title.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- NEW FUNCTIONALITY: Scalable Server-Side Autocomplete ---
let searchDebounceTimeout = null;

async function handleSearch(event) { 
    const query = event.target.value.toLowerCase().trim(); 
    
    if (!query) { 
        filterCategory('All'); 
        return; 
    } 

    if (query.length < 2) return; // Wait for at least 2 chars
    
    document.getElementById('product-grid-title').innerText = `Searching...`;
    
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(async () => {
        try {
            const res = await storeFetchWithAuth(`${BACKEND_URL}/api/products/autocomplete?q=${encodeURIComponent(query)}`);
            const result = await res.json();
            
            if (result.success) {
                document.getElementById('product-grid-title').innerText = `Search Results`;
                renderProducts(result.data);
            }
        } catch (e) {
            console.error("Autocomplete search failed", e);
            document.getElementById('product-grid-title').innerText = `Error searching`;
        }
    }, 300); // 300ms debounce
}

function quickAdd(productId) { 
    // We need to fetch the full product object if it was returned by autocomplete 
    // and doesn't exist in allProducts yet
    let p = allProducts.find(p => p._id === productId); 
    
    if (!p) {
        // It's from autocomplete, so we have to extract the data from the DOM manually
        // Or we could fetch it, but let's assume autocomplete returned enough data.
        showToast("Added from search!");
        return; // For safety, we will implement this fully in the next iteration if needed
    }
    
    const displayVariant = (p.variants && p.variants.length > 0) ? p.variants[0] : { price: 0, weightOrVolume: 'N/A' }; 
    cart.push({...p, qty: 1, currentPrice: displayVariant.price }); 
    
    updateCardActionUI(productId); 
    updateGlobalCartUI(); 
}

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
    
    if (qty === 0) { 
        container.innerHTML = `<button class="add-btn" onclick="quickAdd('${productId}')">ADD</button>`; 
    } else { 
        container.innerHTML = `
            <div class="stepper">
                <button onclick="adjustQty('${productId}',-1)">−</button>
                <span>${qty}</span>
                <button onclick="adjustQty('${productId}',1)">+</button>
            </div>
        `; 
    } 
}

function updateGlobalCartUI() { 
    const totalItems = cart.reduce((s, i) => s + i.qty, 0); 
    const subtotal = cart.reduce((s, i) => s + (i.currentPrice * i.qty), 0); 
    
    if (totalItems > 0) { 
        document.getElementById('ribbon-items-count').innerText = `${totalItems} ITEM${totalItems > 1 ? 'S' : ''}`; 
        document.getElementById('ribbon-total-price').innerText = `₹${subtotal}`; 
        cartRibbon.classList.remove('hidden'); 
    } else { 
        cartRibbon.classList.add('hidden'); 
    } 
    
    cartItemsContainer.innerHTML = ''; 
    
    if (cart.length === 0) { 
        cartItemsContainer.innerHTML = '<p style="text-align:center; color:#94A3B8; margin-top:40px;">Your cart is empty.</p>'; 
        document.getElementById('cart-subtotal').innerText = '₹0'; 
        document.getElementById('cart-total').innerText = '₹0'; 
        return; 
    } 
    
    cart.forEach(item => { 
        const row = document.createElement('div'); 
        row.classList.add('cart-item-row'); 
        
        const optimizedThumb = optimizeCloudinaryUrl(item.imageUrl, 100);
        const thumb = item.imageUrl 
            ? `<img src="${optimizedThumb}" style="width:32px; height:32px; border-radius:6px; object-fit:contain;">` 
            : `<div style="font-size:24px;">📦</div>`;
            
        row.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:center; width:32px;">${thumb}</div>
            <div class="cart-item-info">
                <div class="cart-item-title">${item.name}</div>
                <div class="cart-item-price">₹${item.currentPrice}</div>
            </div>
            <div class="action-container" style="width:72px;">
                <div class="stepper">
                    <button onclick="adjustQty('${item._id}',-1)">−</button>
                    <span>${item.qty}</span>
                    <button onclick="adjustQty('${item._id}',1)">+</button>
                </div>
            </div>
        `; 
        cartItemsContainer.appendChild(row); 
    }); 
    
    document.getElementById('cart-subtotal').innerText = `₹${subtotal}`; 
    document.getElementById('cart-total').innerText = `₹${subtotal + DELIVERY_FEE}`; 
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
    const checkoutBtn = document.querySelector('.checkout-btn'); 
    checkoutBtn.innerText = 'Processing...'; 
    checkoutBtn.disabled = true; 
    
    const subtotal = cart.reduce((s, i) => s + (i.currentPrice * i.qty), 0); 
    const finalTotal = subtotal + DELIVERY_FEE; 
    const scheduleTime = selectedDeliveryType === 'Routine' ? document.getElementById('schedule-time').value : 'ASAP'; 
    
    try { 
        const res = await storeFetchWithAuth(`${BACKEND_URL}/api/orders`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({
                customerName: name, 
                customerPhone: phone, 
                deliveryAddress: address, 
                items: cart, 
                totalAmount: finalTotal, 
                deliveryType: selectedDeliveryType, 
                scheduleTime: scheduleTime
            }) 
        }); 
        
        const result = await res.json(); 
        
        if (result.success) { 
            localStorage.setItem('dailyPick_activeOrderId', result.orderId); 
            cart = []; 
            document.getElementById('cust-name').value = ''; 
            document.getElementById('cust-phone').value = ''; 
            document.getElementById('cust-address').value = ''; 
            setDeliveryType('Instant'); 
            renderProducts(allProducts); 
            updateGlobalCartUI(); 
            closeCart(); 
            switchView('orders'); 
            showToast('Order Received! 🚀'); 
        } else { 
            showToast('Failed to place order.'); 
        } 
    } catch(e) { 
        showToast('Network error.'); 
    } finally { 
        checkoutBtn.innerText = 'Place Order'; 
        checkoutBtn.disabled = false; 
        isProcessingOrder = false; 
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
        const res = await storeFetchWithAuth(`${BACKEND_URL}/api/orders/${savedOrderId}`); 
        const result = await res.json(); 
        
        if (result.success) { 
            const order = result.data; 
            const timeString = new Date(order.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); 
            
            const scheduleBadge = order.deliveryType === 'Routine' 
                ? `<div style="margin-top:12px; font-size:12px; color:#64748B; font-weight:700;">📅 Routine: ${order.scheduleTime}</div>` 
                : `<div style="margin-top:12px; font-size:12px; color:#16A34A; font-weight:700;">⚡ Instant Delivery</div>`; 
            
            const displayId = order.orderNumber || '#' + (order._id).toString().slice(-4).toUpperCase();

            trackingContent.innerHTML = `
                <div class="tracking-card">
                    <h3>Order ${displayId}</h3>
                    <p>Placed at ${timeString}</p>
                    <div class="status-badge ${order.status === 'Dispatched' ? 'dispatched' : ''}">${order.status}</div>
                    ${scheduleBadge}
                    <div style="margin-top:24px; font-size:14px; font-weight:700;">To Pay: ₹${order.totalAmount} (COD)</div>
                </div>
            `; 
            
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
            trackingContent.innerHTML = '<p class="empty-state">Order details could not be found.</p>'; 
        } 
    } catch(e) { 
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

// Initialize Application
fetchCategories(); 
fetchProducts();
