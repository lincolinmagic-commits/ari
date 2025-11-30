import React, { useState, useEffect } from 'react';
import { ShoppingCart, X, Star, Heart, Plus, Minus } from 'lucide-react';
import HomePageNew from './pages/HomePage';
import StorePageNew from './pages/StorePage';
import BuildPCPageNew from './pages/BuildPCPage';
import CartPageNew from './pages/CartPage';
import LoginPageNew from './pages/LoginPage';
import AdminDashboardNew from './pages/AdminDashboard';

const ARITechnologyStore = () => {
  const [currentPage, setCurrentPage] = useState('home');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [cart, setCart] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [pcBuild, setPcBuild] = useState({ cpu: null, motherboard: null, gpu: null, ram: null, storage: null });

  const [products, setProducts] = useState([
    { id: 1, name: 'Gaming Laptop Pro X1', category: 'laptops', brand: 'TechPro', price: 1299, build_price: 1299, rating: 4.8, reviews: 245, image: 'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=500&h=500&fit=crop', stock: 15, description: 'High-performance gaming laptop with RTX 4060' },
    { id: 2, name: 'UltraWide Monitor 34"', category: 'monitors', brand: 'ViewMax', price: 599, build_price: 599, rating: 4.6, reviews: 189, image: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=500&h=500&fit=crop', stock: 23, description: '34-inch curved ultrawide display' },
    { id: 3, name: 'Mechanical Keyboard RGB', category: 'keyboards', brand: 'KeyMaster', price: 149, build_price: 149, rating: 4.9, reviews: 567, image: 'https://images.unsplash.com/photo-1595225476474-87563907a212?w=500&h=500&fit=crop', stock: 45, description: 'Cherry MX mechanical switches' },
    { id: 4, name: 'Wireless Gaming Mouse', category: 'mouse', brand: 'ClickPro', price: 79, build_price: 79, rating: 4.7, reviews: 423, image: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=500&h=500&fit=crop', stock: 67, description: '25,000 DPI wireless' },
    { id: 5, name: 'Premium Headset 7.1', category: 'headsets', brand: 'SoundWave', price: 199, build_price: 199, rating: 4.5, reviews: 312, image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&h=500&fit=crop', stock: 34, description: 'Virtual 7.1 surround' },
    { id: 6, name: 'Intel Core i9-14900K', category: 'cpu', brand: 'Intel', price: 589, build_price: 589, rating: 4.9, reviews: 178, image: 'https://images.unsplash.com/photo-1555617981-dac3880eac6e?w=500&h=500&fit=crop', stock: 12, description: '24-core flagship processor', socket: 'LGA1700' },
    { id: 7, name: 'RTX 4090 Graphics Card', category: 'gpu', brand: 'NVIDIA', price: 1599, build_price: 1599, rating: 4.8, reviews: 234, image: 'https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?w=500&h=500&fit=crop', stock: 8, description: 'Ultimate gaming graphics card' },
    { id: 8, name: 'DDR5 32GB RAM Kit', category: 'ram', brand: 'Corsair', price: 179, build_price: 179, rating: 4.7, reviews: 456, image: 'https://images.unsplash.com/photo-1541336032412-2048a678540d?w=500&h=500&fit=crop', stock: 56, description: '32GB DDR5-6000MHz kit' },
    { id: 9, name: 'NVMe SSD 2TB', category: 'storage', brand: 'Samsung', price: 199, build_price: 199, rating: 4.8, reviews: 389, image: 'https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?w=500&h=500&fit=crop', stock: 41, description: 'Gen4 NVMe SSD' },
    { id: 10, name: 'Z790 Motherboard', category: 'motherboard', brand: 'ASUS', price: 349, build_price: 349, rating: 4.6, reviews: 167, image: 'https://images.unsplash.com/photo-1591370874773-6702e8f12fd8?w=500&h=500&fit=crop', stock: 19, description: 'ATX gaming motherboard', socket: 'LGA1700' },
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [discountCfg, setDiscountCfg] = useState({ global: { itemCount: 0, percent: 0 }, perItem: {} });

  const handleLogin = (email, password) => {
    // Attempt server-side login
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) {
          if (data && data.error && data.error.toLowerCase().includes('not verified')) {
            // prompt verification flow
            setCurrentPage('login');
            // pass pending verify email via localStorage so UI can pick it up
            try { localStorage.setItem('pendingVerifyEmail', email); } catch(e) {}
            alert('Email not verified. A verification code has been sent. Please verify your email.');
            return;
          }
          alert(data && data.error ? data.error : 'Invalid credentials');
          return;
        }

        // on success data contains user info
        setIsLoggedIn(true);
        setCurrentUser(data);
        setIsAdmin(data.role === 'admin');
        try { localStorage.setItem('currentUser', JSON.stringify(data)); } catch (e) {}
        setCurrentPage(data.role === 'admin' ? 'admin' : 'home');
      } catch (err) {
        console.error('Login failed', err);
        alert('Login failed: ' + err.message);
      }
    })();
    return true;
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setIsAdmin(false);
    setCurrentUser(null);
    try { localStorage.removeItem('currentUser'); } catch (e) {}
    setCurrentPage('home');
  };

  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id);
    if (existing) {
      setCart(cart.map(item => item.id === product.id ? {...item, quantity: item.quantity + 1} : item));
    } else {
      setCart([...cart, {...product, quantity: 1}]);
    }
  };

  // API helpers for wishlist and pc builds
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  // Load products from backend (or demo data) on mount
  useEffect(() => {
    const loadProducts = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/products`);
        if (!res.ok) throw new Error('Failed to fetch products');
        const data = await res.json();
        // Normalize image URLs returned from backend (make absolute if they are relative)
        const normalized = data.map(p => {
          const copy = { ...p };
          if (copy.image_url && copy.image_url.startsWith('/')) copy.image_url = `${API_BASE}${copy.image_url}`;
          if (copy.image && copy.image.startsWith('/')) copy.image = `${API_BASE}${copy.image}`;
          // prefer image field for components that reference it
          if (!copy.image && copy.image_url) copy.image = copy.image_url;
          // ensure build_price exists for builder (fallback to store price)
          if (copy.build_price == null) copy.build_price = copy.price;
          return copy;
        });
        setProducts(normalized);
      } catch (err) {
        console.debug('loadProducts error:', err.message);
      }
    };
    loadProducts();
    // load discounts (per-item overrides)
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/build-discount`);
        if (r.ok) {
          const d = await r.json();
          const per = {};
          if (d && d.perItem) {
            Object.keys(d.perItem).forEach(k => {
              const nk = Number(k);
              if (!Number.isNaN(nk)) per[nk] = d.perItem[k];
            });
          }
          setDiscountCfg({ global: (d && d.global) || { itemCount: 0, percent: 0 }, perItem: per });
        }
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  // Helper: get discount percent for a product id (supports numeric or string keys)
  const getDiscountPct = (productId) => {
    if (!discountCfg || !discountCfg.perItem) return null;
    const per = discountCfg.perItem;
    // direct lookup (handles number keys coerced to strings)
    if (per[productId] != null) return Number(per[productId]);
    const sid = String(productId);
    if (per[sid] != null) return Number(per[sid]);
    return null;
  };
  // Update discount configuration when admin saves new settings (cross-tab/window in same origin)
  useEffect(() => {
    const handler = (e) => {
      try {
        const d = e && e.detail ? e.detail : null;
        if (!d) return;
        const per = {};
        if (d.perItem) {
          Object.keys(d.perItem).forEach(k => {
            const nk = Number(k);
            if (!Number.isNaN(nk)) per[nk] = d.perItem[k];
          });
        }
        setDiscountCfg({ global: (d.global) || { itemCount: 0, percent: 0 }, perItem: per });
      } catch (err) {
        // ignore malformed event
      }
    };
    window.addEventListener('buildDiscountUpdated', handler);
    return () => window.removeEventListener('buildDiscountUpdated', handler);
  }, []);

  const fetchWishlistApi = async (userId) => {
    try {
      const res = await fetch(`${API_BASE}/api/users/${userId}/wishlist`);
      if (!res.ok) throw new Error('Failed to fetch wishlist');
      const data = await res.json();
      setWishlist(data.map(item => ({ id: item.product_id, ...item })));
    } catch (err) {
      console.debug('fetchWishlistApi error:', err.message);
    }
  };

  const addToWishlistApi = async (userId, productId) => {
    try {
      const res = await fetch(`${API_BASE}/api/wishlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, product_id: productId })
      });
      if (res.status === 201) {
        // update local wishlist
        const prod = products.find(p => p.id === productId);
        setWishlist(w => {
          if (w.find(x => x.id === productId)) return w;
          return [...w, { id: productId, product_id: productId, name: prod?.name, price: prod?.price, image_url: prod?.image }];
        });
      }
      return res;
    } catch (err) {
      console.debug('addToWishlistApi error:', err.message);
      throw err;
    }
  };

  const removeFromWishlistApi = async (userId, productId) => {
    try {
      const res = await fetch(`${API_BASE}/api/wishlist`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, product_id: productId })
      });
      if (res.ok) {
        setWishlist(w => w.filter(x => x.id !== productId));
      }
      return res;
    } catch (err) {
      console.debug('removeFromWishlistApi error:', err.message);
      throw err;
    }
  };

  const savePcBuildApi = async (userId, name, components, total_price) => {
    try {
      const res = await fetch(`${API_BASE}/api/pc_builds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, name, components, total_price })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => null);
        return { ok: false, status: res.status, body: text };
      }
      const body = await res.json().catch(() => null);
      return { ok: true, status: res.status, body };
    } catch (err) {
      console.debug('savePcBuildApi error:', err.message);
      return { ok: false, error: err.message };
    }
  };

  // Retry any locally saved builds when backend becomes available
  const flushUnsavedBuilds = async () => {
    const pendingRaw = localStorage.getItem('unsaved_builds');
    if (!pendingRaw) return;
    let pending;
    try { pending = JSON.parse(pendingRaw); } catch(e) { localStorage.removeItem('unsaved_builds'); return; }
    if (!Array.isArray(pending) || pending.length === 0) return;

    const remaining = [];
    for (const b of pending) {
      try {
        const res = await savePcBuildApi(b.user_id, b.name, b.components, b.total_price);
        if (!res || !res.ok) {
          remaining.push(b);
        }
      } catch (e) {
        remaining.push(b);
      }
    }

    if (remaining.length > 0) {
      localStorage.setItem('unsaved_builds', JSON.stringify(remaining));
    } else {
      localStorage.removeItem('unsaved_builds');
    }
  };

  // Attempt to flush pending builds on app start
  useEffect(() => {
    flushUnsavedBuilds().catch(() => {});
  }, []);

  // Toggle wishlist from UI (prefers API, falls back to local)
  const toggleWishlist = async (product) => {
    const uid = currentUser?.id || 1; // fallback to 1 for demo
    const exists = wishlist.find(x => x.id === product.id);
    try {
      if (exists) {
        await removeFromWishlistApi(uid, product.id);
      } else {
        await addToWishlistApi(uid, product.id);
      }
    } catch (err) {
      alert('Could not update wishlist (is backend running?)');
    }
  };

  useEffect(() => {
    if (currentUser && currentUser.id) fetchWishlistApi(currentUser.id);
  }, [currentUser]);

  const ProductCard = ({ product }) => (
    <div className="bg-white rounded-2xl shadow-lg hover:shadow-2xl overflow-hidden group transform hover:-translate-y-1 transition-all">
      <div className="relative h-64 overflow-hidden bg-gray-100">
        {
          (() => {
            let src = product.image || product.image_url || '';
            if (src && src.startsWith('/')) src = `${API_BASE}${src}`;
            return <img src={src} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />;
          })()
        }
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-4">
          <div className="text-white text-sm bg-black/50 px-3 py-1 rounded backdrop-blur">{product.brand}</div>
          <div className="flex gap-2">
            <button onClick={() => addToCart(product)} className="bg-yellow-400 text-black px-3 py-2 rounded-lg font-semibold">Add</button>
            <button onClick={() => toggleWishlist(product)} className="bg-white/90 p-2 rounded-full shadow">
              <Heart className={`w-5 h-5 ${wishlist.find(x => x.id === product.id) ? 'fill-red-500 text-red-500' : 'text-gray-600'}`} />
            </button>
          </div>
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-lg text-black truncate">{product.name}</h3>
            <div className="text-sm font-bold text-blue-900">
              {(() => {
                const pct = getDiscountPct(product.id);
                if (pct != null && pct > 0) {
                  const discounted = (Number(product.price) * (1 - pct / 100)).toFixed(2);
                  return (
                    <div className="flex flex-col items-end">
                      <span className="text-xs text-gray-500 line-through">${Number(product.price).toFixed(2)}</span>
                      <span className="text-sm font-bold text-blue-900">${discounted}</span>
                      <span className="mt-1 bg-red-500 text-white text-xs px-2 py-0.5 rounded">-{pct}%</span>
                    </div>
                  );
                }
                return `$${Number(product.price).toFixed(2)}`;
              })()}
            </div>
        </div>
        <p className="text-sm text-gray-600 mb-3 line-clamp-2">{product.description}</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-yellow-400">
            {Array.from({ length: Math.round(product.rating || 4) }).map((_, i) => <Star key={i} className="w-4 h-4" />)}
            <span className="text-sm text-gray-600">({product.reviews})</span>
          </div>
          <div className="text-sm text-gray-500">{product.stock > 0 ? <span className="text-green-600 font-semibold">In stock</span> : <span className="text-red-500">Out</span>}</div>
        </div>
      </div>
    </div>
  );

  const HomePage = () => (
    <div className="space-y-16">
      <div className="bg-gradient-to-r from-blue-900 to-blue-800 rounded-3xl p-16 text-white" style={{minHeight: '500px'}}>
        <h1 className="text-5xl font-bold mb-6">Build Your Dream Setup</h1>
        <p className="text-xl mb-8">Premium computer components at unbeatable prices</p>
        <div className="flex gap-4">
          <button onClick={() => setCurrentPage('store')} className="bg-white text-blue-900 px-8 py-4 rounded-xl font-bold hover:bg-gray-100">Explore Store</button>
          <button onClick={() => setCurrentPage('buildpc')} className="border-2 border-white text-white px-8 py-4 rounded-xl font-bold hover:bg-white/10">Build Your PC</button>
        </div>
      </div>
      <section>
        <h2 className="text-4xl font-bold mb-8">Featured Products</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {products.slice(0, 4).map(product => <ProductCard key={product.id} product={product} />)}
        </div>
      </section>
    </div>
  );

  const StorePage = () => (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <h1 className="text-4xl font-bold">Our Store</h1>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search products..." className="w-full md:w-80 p-3 border rounded-lg" />
          <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} className="p-3 border rounded-lg">
            <option value="all">All Categories</option>
            {[...new Set(products.map(p => p.category))].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {products.filter(p => (selectedCategory === 'all' || p.category === selectedCategory) && p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(product => <ProductCard key={product.id} product={product} />)}
      </div>
    </div>
  );

  const PCBuilderPage = () => {
    const cpuList = products.filter(p => p.category === 'cpu');
    const gpuList = products.filter(p => p.category === 'gpu');
    const ramList = products.filter(p => p.category === 'ram');
    const storageList = products.filter(p => p.category === 'storage');
    const moboList = products.filter(p => p.category === 'motherboard');
    const total = Object.values(pcBuild).reduce((sum, item) => sum + (item?.price || 0), 0);
    const completeness = Object.values(pcBuild).filter(v => v).length;

    return (
      <div>
        <div className="mb-8">
          <h1 className="text-5xl font-bold text-black mb-2">PC Builder</h1>
          <p className="text-lg text-black mb-4">Build your dream PC with our powerful components</p>
          <div className="w-full bg-gray-300 rounded-full h-3">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 h-3 rounded-full transition-all" style={{width: `${(completeness/5)*100}%`}}></div>
          </div>
          <p className="text-sm text-black mt-2 font-semibold">{completeness}/5 components selected</p>
        </div>
        
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {[
              { name: 'CPU', list: cpuList, key: 'cpu', icon: '⚙️' },
              { name: 'Motherboard', list: moboList, key: 'motherboard', icon: '🖥️' },
              { name: 'GPU', list: gpuList, key: 'gpu', icon: '🎮' },
              { name: 'RAM', list: ramList, key: 'ram', icon: '💾' },
              { name: 'Storage', list: storageList, key: 'storage', icon: '📦' }
            ].map(comp => (
              <div key={comp.key} className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-shadow p-6 border-2 border-gray-100">
                <h3 className="font-bold text-xl mb-4 text-black flex items-center gap-2">{comp.icon} {comp.name}</h3>
                {pcBuild[comp.key] ? (
                  <div className="flex gap-4 items-center bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-xl">
                    <img src={pcBuild[comp.key].image} alt="" className="w-20 h-20 object-cover rounded-lg shadow" />
                    <div className="flex-1">
                      <p className="font-bold text-black">{pcBuild[comp.key].name}</p>
                      <p className="text-sm text-black font-semibold">{pcBuild[comp.key] ? '$' + (Number(pcBuild[comp.key].build_price ?? pcBuild[comp.key].price).toFixed(2)) : ''}</p>
                      <p className="text-xs text-gray-700 mt-1">{pcBuild[comp.key].brand}</p>
                    </div>
                    <button onClick={() => setPcBuild({...pcBuild, [comp.key]: null})} className="text-red-600 hover:bg-red-100 p-2 rounded-lg transition"><X className="w-6 h-6" /></button>
                  </div>
                ) : (
                    <select onChange={(e) => {
                    const p = comp.list.find(x => x.id === parseInt(e.target.value));
                    if (p) setPcBuild({...pcBuild, [comp.key]: p});
                  }} className="w-full p-3 border-2 border-gray-300 rounded-lg text-black bg-white font-medium focus:outline-none focus:border-blue-500">
                    <option className="text-black">Select {comp.name}</option>
                    {comp.list.map(p => <option key={p.id} value={p.id} className="text-black">{p.name} - ${p.price}</option>)}
                  </select>
                )}
              </div>
            ))}
          </div>
          
          <div className="bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl shadow-2xl p-6 h-fit sticky top-24">
            <h3 className="font-bold text-2xl mb-6 text-white">Build Summary</h3>
            
            <div className="space-y-3 mb-6 bg-white bg-opacity-10 p-4 rounded-xl backdrop-blur">
              {['cpu', 'motherboard', 'gpu', 'ram', 'storage'].map(k => (
                <div key={k} className="flex justify-between text-sm items-center">
                  <span className="text-white font-medium capitalize">{k}</span>
                  <span className="bg-white text-black font-bold text-sm text-right max-w-[120px] truncate whitespace-nowrap px-2 py-1 rounded">{pcBuild[k] ? '$' + (Number(pcBuild[k].build_price ?? pcBuild[k].price).toFixed(2)) : '-'}</span>
                </div>
              ))}
            </div>
            
            <div className="border-t-2 border-white border-opacity-30 pt-4 mb-6">
              <div className="flex justify-between items-center">
                <span className="text-white font-bold text-lg">Total Cost</span>
                <span className="text-yellow-300 font-bold text-3xl">${total}</span>
              </div>
              <p className="text-white text-opacity-75 text-xs mt-1">All prices in USD</p>
            </div>
            
            {total > 0 && (
              <button type="button" onClick={async () => {
                const uid = currentUser?.id || 1;
                const name = `Build ${new Date().toISOString()}`;
                const components = {};
                Object.keys(pcBuild).forEach(k => { if (pcBuild[k]) components[k] = { id: pcBuild[k].id, name: pcBuild[k].name, price: pcBuild[k].price }; });
                try {
                  const res = await savePcBuildApi(uid, name, components, total);
                  if (res && res.ok) {
                    Object.values(pcBuild).forEach(item => item && addToCart(item));
                    // try to flush any pending builds now that one succeeded
                    try { await flushUnsavedBuilds(); } catch(e) { /* ignore */ }
                    alert('✓ Build saved and added to cart');
                  } else {
                    // Persist locally for retry and still add items to cart
                    const pendingRaw = localStorage.getItem('unsaved_builds');
                    let pending = [];
                    try { pending = JSON.parse(pendingRaw || '[]'); } catch(e) { pending = []; }
                    pending.push({ user_id: uid, name, components, total_price: total, created_at: new Date().toISOString() });
                    localStorage.setItem('unsaved_builds', JSON.stringify(pending));
                    Object.values(pcBuild).forEach(item => item && addToCart(item));
                    alert('Build added to cart and saved locally (will retry to persist when backend is available)');
                  }
                } catch (err) {
                  // Network or unexpected error — fallback to local save + add to cart
                  const pendingRaw = localStorage.getItem('unsaved_builds');
                  let pending = [];
                  try { pending = JSON.parse(pendingRaw || '[]'); } catch(e) { pending = []; }
                  pending.push({ user_id: uid, name, components, total_price: total, created_at: new Date().toISOString() });
                  localStorage.setItem('unsaved_builds', JSON.stringify(pending));
                  Object.values(pcBuild).forEach(item => item && addToCart(item));
                  alert('Build added to cart and saved locally (could not reach backend)');
                }
              }} className="w-full py-4 bg-yellow-400 text-black rounded-xl font-bold hover:bg-yellow-300 transition-colors shadow-lg text-lg" aria-label="Save and add build to cart">
                💾 Save & Add to Cart
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const CartPage = () => (
    <div>
      <h1 className="text-4xl font-bold mb-8">Shopping Cart</h1>
      {cart.length ? (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {cart.map(item => (
              <div key={item.id} className="bg-white rounded-xl shadow p-6 flex gap-6">
                <img src={item.image} alt={item.name} className="w-24 h-24 object-cover rounded" />
                <div className="flex-1">
                  <h3 className="font-bold">{item.name}</h3>
                  <div className="flex gap-2 items-center mt-2">
                    <button onClick={() => setCart(cart.map(i => i.id === item.id ? {...i, quantity: Math.max(1, i.quantity - 1)} : i))} className="p-2 bg-gray-200"><Minus className="w-4 h-4" /></button>
                    <span>{item.quantity}</span>
                    <button onClick={() => setCart(cart.map(i => i.id === item.id ? {...i, quantity: i.quantity + 1} : i))} className="p-2 bg-gray-200"><Plus className="w-4 h-4" /></button>
                  </div>
                </div>
                <p className="font-bold text-2xl">${item.price * item.quantity}</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="font-bold text-xl mb-6">Total</h3>
            <p className="text-3xl font-bold text-blue-900">${cart.reduce((s, i) => s + i.price * i.quantity, 0)}</p>
          </div>
        </div>
      ) : (
        <p className="text-center text-gray-600">Cart is empty</p>
      )}
    </div>
  );

  const LoginPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-700 to-purple-800 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
        
        <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-md relative z-10">
          <div className="text-center mb-10">
            <div className="text-5xl font-bold text-black mb-2">🔐 ARI TECHNOLOGY</div>
            <p className="text-black font-semibold">Secure Access Portal</p>
          </div>
          
          <div className="space-y-4 mb-8">
            <div>
              <label className="block text-black font-bold mb-2">Email Address</label>
              <input 
                type="email" 
                placeholder="Enter your email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                className="w-full p-4 border-2 border-gray-300 rounded-xl text-black font-medium focus:outline-none focus:border-blue-600 bg-gray-50" 
              />
            </div>
            
            <div>
              <label className="block text-black font-bold mb-2">Password</label>
              <input 
                type="password" 
                placeholder="Enter your password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                className="w-full p-4 border-2 border-gray-300 rounded-xl text-black font-medium focus:outline-none focus:border-blue-600 bg-gray-50" 
              />
            </div>
            
            <button 
              onClick={() => handleLogin(email, password)} 
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-800 text-white rounded-xl font-bold text-lg hover:from-blue-700 hover:to-blue-900 transition-all shadow-lg hover:shadow-xl"
            >
              Sign In
            </button>
          </div>
          
          {/* Demo accounts removed from UI — accounts remain in backend */}
        </div>
      </div>
    );
  };

  const AdminDashboard = () => {
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ name: '', category: '', brand: '', price: '', stock: '', description: '', image_url: '' });

    const startEdit = (p) => {
      setEditing(p);
      setForm({ name: p.name || '', category: p.category || '', brand: p.brand || '', price: p.price || '', stock: p.stock || '', description: p.description || '', image_url: p.image_url || p.image || '' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetForm = () => {
      setEditing(null);
      setForm({ name: '', category: '', brand: '', price: '', stock: '', description: '', image_url: '' });
    };

    const saveProduct = async (e) => {
      e.preventDefault();
      let imageUrl = form.image_url;
      // If a file is selected, upload it first
      if (form.image_file) {
        try {
          // read file as base64
          const file = form.image_file;
          const toBase64 = file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
            reader.readAsDataURL(file);
          });
          const dataUrl = await toBase64(file);
          // dataUrl like 'data:image/png;base64,...'
          const base64 = dataUrl.split(',')[1];
          const up = await fetch(`${API_BASE}/api/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, data: base64 }) });
          if (up.ok) {
            const data = await up.json();
            imageUrl = data.image_url || imageUrl;
          } else {
            console.debug('Image upload failed');
          }
        } catch (err) {
          console.debug('upload error', err.message);
        }
      }

      const payload = { name: form.name, category: form.category, brand: form.brand, price: parseFloat(form.price) || 0, description: form.description, stock: parseInt(form.stock) || 0, image_url: imageUrl, specs: {} };
      try {
        if (editing) {
          const res = await fetch(`${API_BASE}/api/products/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          if (res.ok) {
            setProducts(prev => prev.map(p => p.id === editing.id ? { ...p, ...payload } : p));
            resetForm();
            alert('Product updated');
          } else {
            const data = await res.json();
            console.debug('update failed', data);
            setProducts(prev => prev.map(p => p.id === editing.id ? { ...p, ...payload } : p));
            resetForm();
            alert('Product updated locally (backend unavailable)');
          }
        } else {
          const res = await fetch(`${API_BASE}/api/products`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          if (res.status === 201) {
            const data = await res.json();
            const newId = data.id || (Math.max(0, ...products.map(p => p.id)) + 1);
            setProducts(prev => [{ id: newId, ...payload }, ...prev]);
            resetForm();
            alert('Product added');
          } else {
            // fallback: add locally
            const newId = Math.max(0, ...products.map(p => p.id)) + 1;
            setProducts(prev => [{ id: newId, ...payload }, ...prev]);
            resetForm();
            alert('Product added locally (backend unavailable)');
          }
        }
      } catch (err) {
        console.debug('saveProduct error', err.message);
        const newId = Math.max(0, ...products.map(p => p.id)) + 1;
        setProducts(prev => [{ id: newId, ...payload }, ...prev]);
        resetForm();
        alert('Product added locally (error)');
      }
    };

    const removeProduct = async (id) => {
      if (!confirm('Delete this product?')) return;
      try {
        const res = await fetch(`${API_BASE}/api/products/${id}`, { method: 'DELETE' });
        if (res.ok) {
          setProducts(prev => prev.filter(p => p.id !== id));
          alert('Product deleted');
        } else {
          setProducts(prev => prev.filter(p => p.id !== id));
          alert('Product removed locally (backend unavailable)');
        }
      } catch (err) {
        console.debug('removeProduct error', err.message);
        setProducts(prev => prev.filter(p => p.id !== id));
        alert('Product removed locally (error)');
      }
    };

    return (
      <div>
        <div className="mb-8">
          <h1 className="text-5xl font-bold text-black mb-2">📊 Admin Dashboard</h1>
          <p className="text-black text-lg">Welcome back, Administrator. Manage products below.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-lg p-8 border-2 border-gray-200">
            <h2 className="text-2xl font-bold text-black mb-6">Products Management</h2>
            <div className="space-y-4">
              {products.slice(0, 20).map(p => (
                <div key={p.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                  <div className="flex items-center gap-4">
                    <img src={p.image || p.image_url} alt={p.name} className="w-16 h-16 object-cover rounded" />
                    <div>
                      <p className="font-bold text-black">{p.name}</p>
                      <p className="text-sm text-gray-600">{p.brand} — {p.category}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-lg">${p.price}</p>
                    <button onClick={() => startEdit(p)} className="px-3 py-1 bg-yellow-300 rounded-lg">Edit</button>
                    <button onClick={() => removeProduct(p.id)} className="px-3 py-1 bg-red-500 text-white rounded-lg">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8 border-2 border-gray-200">
            <h2 className="text-2xl font-bold text-black mb-4">{editing ? 'Edit Product' : 'Add Product'}</h2>
            <form onSubmit={saveProduct} className="space-y-3">
              <input className="w-full p-3 border rounded-lg text-black" placeholder="Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
              <input className="w-full p-3 border rounded-lg text-black" placeholder="Category" value={form.category} onChange={e => setForm({...form, category: e.target.value})} required />
              <input className="w-full p-3 border rounded-lg text-black" placeholder="Brand" value={form.brand} onChange={e => setForm({...form, brand: e.target.value})} required />
              <div className="grid grid-cols-2 gap-3">
                <input className="p-3 border rounded-lg text-black" placeholder="Price" type="number" step="0.01" value={form.price} onChange={e => setForm({...form, price: e.target.value})} required />
                <input className="p-3 border rounded-lg text-black" placeholder="Stock" type="number" value={form.stock} onChange={e => setForm({...form, stock: e.target.value})} required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Image (URL or upload)</label>
                <input className="w-full p-3 border rounded-lg text-black mb-2 bg-white" placeholder="Image URL" value={form.image_url} onChange={e => setForm({...form, image_url: e.target.value})} />
                <input type="file" accept="image/*" onChange={e => setForm({...form, image_file: e.target.files && e.target.files[0]})} className="w-full" />
              </div>
              <textarea className="w-full p-3 border rounded-lg text-black" placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={4} />
              <div className="flex gap-3">
                <button type="submit" className="px-6 py-3 bg-blue-600 text-white rounded-lg font-bold">{editing ? 'Save Changes' : 'Add Product'}</button>
                {editing && <button type="button" onClick={resetForm} className="px-6 py-3 bg-gray-200 rounded-lg">Cancel</button>}
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  };

  if (!isLoggedIn && currentPage === 'login') return <LoginPageNew handleLogin={handleLogin} setCurrentPage={setCurrentPage} />;

  if (isAdmin && isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <header className="bg-white shadow-lg sticky top-0 z-40 border-b-4 border-blue-600">
          <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
            <h1 className="text-3xl font-bold text-black">🛡️ ARI TECHNOLOGY Admin Portal</h1>
            <button onClick={handleLogout} className="px-6 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors">Logout</button>
          </div>
        </header>
        <div className="max-w-7xl mx-auto px-4 py-8"><AdminDashboardNew products={products} setProducts={setProducts} API_BASE={API_BASE} wishlist={wishlist} /></div>
      </div>
    );
  }
  const Footer = () => (
    <footer className="mt-16 bg-gradient-to-r from-gray-100 to-white border-t pt-10">
      <div className="max-w-7xl mx-auto px-4 py-8 grid md:grid-cols-3 gap-6">
        <div>
          <h4 className="font-bold text-lg text-blue-900">ARI TECHNOLOGY</h4>
          <p className="text-sm text-gray-600 mt-2">Quality PC components and accessories — curated for builders and gamers.</p>
        </div>
        <div>
          <h5 className="font-semibold mb-2">Explore</h5>
          <ul className="text-sm text-gray-600 space-y-1">
            <li><button onClick={() => setCurrentPage('store')} className="hover:text-blue-900">Store</button></li>
            <li><button onClick={() => setCurrentPage('buildpc')} className="hover:text-blue-900">PC Builder</button></li>
            <li><button onClick={() => setCurrentPage('cart')} className="hover:text-blue-900">Cart</button></li>
          </ul>
        </div>
        <div>
          <h5 className="font-semibold mb-2">Contact</h5>
          <p className="text-sm text-gray-600">aritechnology1@gmail.com</p>
          <p className="text-sm text-gray-600 mt-2">© {new Date().getFullYear()} ARI TECHNOLOGY</p>
        </div>
      </div>
    </footer>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
            <div className="flex items-center gap-4">
            <button onClick={() => { setCurrentPage('home'); window.scrollTo({top:0, behavior:'smooth'}); }} className="text-2xl font-extrabold text-blue-900">ARI TECHNOLOGY</button>
            <nav className="hidden md:flex gap-4 text-sm">
              {['home', 'store', 'buildpc', 'cart'].map(p => (
                <button
                  key={p}
                  onClick={() => setCurrentPage(p)}
                  className={`font-semibold px-3 py-1 rounded-full transition ${currentPage === p ? 'bg-blue-100 text-blue-900 shadow' : 'text-gray-600 hover:text-blue-900'}`}
                >
                  {p === 'buildpc' ? 'Build PC' : p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex-1">
            <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setCurrentPage('store'); }} placeholder="Search components, brands, models..." className="w-full md:w-2/3 p-3 border rounded-lg bg-white text-black" />
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setCurrentPage('cart')} className="relative p-2 rounded-lg bg-gray-100">
              <ShoppingCart className="w-6 h-6 text-gray-700" />
              {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">{cart.reduce((s,i)=>s+i.quantity,0)}</span>}
            </button>

            {isLoggedIn ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-700 hidden sm:inline">{currentUser?.name}</span>
                <button onClick={handleLogout} className="px-4 py-2 bg-gray-200 rounded-lg">Logout</button>
              </div>
            ) : (
              <button onClick={() => setCurrentPage('login')} className="px-4 py-2 bg-blue-900 text-white rounded-lg">Login</button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 flex-1">
        {currentPage === 'home' && <HomePageNew products={products} setCurrentPage={setCurrentPage} wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} />}
        {currentPage === 'store' && <StorePageNew products={products} searchQuery={searchQuery} setSearchQuery={setSearchQuery} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} />}
        {currentPage === 'buildpc' && <BuildPCPageNew products={products} pcBuild={pcBuild} setPcBuild={setPcBuild} savePcBuildApi={savePcBuildApi} addToCart={addToCart} currentUser={currentUser} />}
        {currentPage === 'cart' && <CartPageNew cart={cart} setCart={setCart} currentUser={currentUser} setCurrentPage={setCurrentPage} />}
      </main>

      <Footer />
    </div>
  );
};

export default ARITechnologyStore;