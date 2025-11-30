const express = require('express');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const bodyParser = require('body-parser');
// Stripe (optional) - only used when STRIPE_SECRET_KEY is set in env
const StripeLib = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
require('dotenv').config();
// Note: file uploads handled via JSON base64 payload to avoid extra deps

const app = express();

// Middleware
app.use(cors());
// Increase body parser limits to allow base64 image uploads
app.use(bodyParser.json({ limit: '8mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '8mb' }));

// Serve uploaded files
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Upload endpoint: accepts JSON { filename, data } where data is base64 (without data: prefix)
app.post('/api/upload', express.json({ limit: '8mb' }), (req, res) => {
  try {
    const { filename, data } = req.body || {};
    if (!filename || !data) return res.status(400).json({ error: 'Missing filename or data' });
    // Simple sanitize
    const safeName = filename.replace(/[^a-z0-9.\-_%(), \[\]]+/gi, '_');
    const outName = Date.now() + '_' + safeName;
    const outPath = path.join(uploadsDir, outName);
    let buffer;
    try {
      buffer = Buffer.from(data, 'base64');
    } catch (e) {
      console.error('Invalid base64 data for upload:', e.message);
      return res.status(400).json({ error: 'Invalid base64 data' });
    }
    try {
      fs.writeFileSync(outPath, buffer);
    } catch (e) {
      console.error('Failed to write upload file:', e.message);
      return res.status(500).json({ error: 'Failed to save file' });
    }
    const host = req.get('host');
    const proto = req.protocol || 'http';
    const urlPath = `${proto}://${host}/uploads/${outName}`;
    console.log('File uploaded:', urlPath);
    res.json({ image_url: urlPath });
  } catch (err) {
    console.error('Upload handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Database connection pool
let pool;

// Initialize database connection
async function initDB() {
  try {
    // Support multiple env var shapes (local DB_*, Railway's MYSQL_* vars, or a MYSQL_URL)
    const parseMysqlUrl = (mysqlUrl) => {
      if (!mysqlUrl) return {};
      try {
        // Replace protocol so URL parser accepts it
        const u = new URL(mysqlUrl.replace(/^mysql:\/\//i, 'http://'));
        return {
          host: u.hostname,
          port: u.port || '3306',
          user: decodeURIComponent(u.username || ''),
          password: decodeURIComponent(u.password || ''),
          database: u.pathname ? u.pathname.replace(/^\//, '') : undefined
        };
      } catch (e) {
        return {};
      }
    };

    const parsed = parseMysqlUrl(process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL || process.env.MYSQLURL);

    const DB_HOST = process.env.DB_HOST || process.env.MYSQLHOST || process.env.MYSQL_HOST || parsed.host || '127.0.0.1';
    const DB_PORT = process.env.DB_PORT ? parseInt(process.env.DB_PORT) : (parsed.port ? parseInt(parsed.port) : 3306);
    const DB_USER = process.env.DB_USER || process.env.MYSQLUSER || process.env.MYSQL_USER || parsed.user || 'root';
    const DB_PASSWORD = process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || parsed.password || '';
    const DB_NAME = process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || parsed.database || 'aritechnology';
    
    const poolConfig = {
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      // Do not set database yet - we may need to create it first
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    };

    // Only include password if it is explicitly set (prevents sending empty password)
    if (DB_PASSWORD && DB_PASSWORD.length > 0) {
      poolConfig.password = DB_PASSWORD;
    }

    // Try to ensure the database exists. Connect without a database first to create it if needed.
    try {
      const tempPool = mysql.createPool({
        host: poolConfig.host,
        port: poolConfig.port,
        user: poolConfig.user,
        password: poolConfig.password,
        waitForConnections: true,
        connectionLimit: 2,
        queueLimit: 0
      });

      const tempConn = await tempPool.getConnection();
      if (DB_NAME) {
        await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
      }
      tempConn.release();
      // close temp pool
      try { await tempPool.end(); } catch (e) {}
    } catch (err) {
      // If we cannot create the database, keep going — the next connection attempt will show a clearer error.
      try { /* ignore */ } catch(e) {}
    }

    // Now create the real pool including the database name
    pool = mysql.createPool(Object.assign({}, poolConfig, { database: DB_NAME }));

    const connection = await pool.getConnection();
    console.log('✓ Database connected successfully!');
    connection.release();

    await createTables();
    await seedDatabase();
    // Try to import any locally persisted builds now that DB is connected
    try {
      if (typeof importLocalBuilds === 'function') {
        const importResult = await importLocalBuilds();
        if (importResult && importResult.imported) {
          console.log(`Imported ${importResult.imported} local pc_build(s) into the database.`);
        }
      }
    } catch (e) {
      console.warn('Failed to import local builds automatically:', e.message);
    }
  } catch (error) {
    console.warn('⚠️  Database connection failed. Running in demo mode (data not persisted).');
    console.warn('   Error:', error.message);
    console.warn('   To fix: Update DB_PASSWORD in .env and ensure MySQL is running.');
    pool = null; // Set pool to null to indicate DB is unavailable
  }
}

// Create all tables
async function createTables() {
  const queries = [
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      verified BOOLEAN DEFAULT FALSE,
      role ENUM('user', 'admin') DEFAULT 'user',
      verify_token VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100) NOT NULL,
      brand VARCHAR(100) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      build_price DECIMAL(10,2) DEFAULT NULL,
      description TEXT,
      stock INT DEFAULT 0,
      rating DECIMAL(3,2) DEFAULT 0,
      reviews INT DEFAULT 0,
      image_url TEXT,
      specs JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_category (category),
      INDEX idx_brand (brand)
    )`,
    `CREATE TABLE IF NOT EXISTS product_images (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      image_url TEXT NOT NULL,
      is_primary BOOLEAN DEFAULT FALSE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL,
      status ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled') DEFAULT 'pending',
      shipping_address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`,
    `CREATE TABLE IF NOT EXISTS reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      user_id INT NOT NULL,
      rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS wishlist (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE KEY unique_wishlist (user_id, product_id)
    )`,
    `CREATE TABLE IF NOT EXISTS pc_builds (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      components JSON NOT NULL,
      total_price DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS offers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      discount_percentage DECIMAL(5,2) NOT NULL,
      product_ids TEXT,
      start_date DATETIME NOT NULL,
      end_date DATETIME NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_active_dates (is_active, start_date, end_date)
    )`
      ,`CREATE TABLE IF NOT EXISTS build_discounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        global_item_count INT DEFAULT 0,
        global_percent DECIMAL(5,2) DEFAULT 0,
        per_item JSON,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`
  ];

  const connection = await pool.getConnection();
  try {
    for (const query of queries) {
      try {
        await connection.execute(query);
      } catch (error) {
        console.log('Table creation info:', error.message);
      }
    }
    console.log('All tables created successfully!');
  } finally {
    connection.release();
  }
}

// Seed database with initial data
async function seedDatabase() {
  const connection = await pool.getConnection();
  try {
    const [users] = await connection.execute('SELECT COUNT(*) as count FROM users WHERE role = "admin"');
    
    if (users[0].count === 0) {
      const hashedPassword = await bcrypt.hash('ahmadf8808', 10);
      await connection.execute(
        'INSERT INTO users (email, password, name, verified, role) VALUES (?, ?, ?, TRUE, "admin")',
        ['ahmadfh', hashedPassword, 'Admin']
      );
      console.log('Admin user created successfully!');
    }

    const [products] = await connection.execute('SELECT COUNT(*) as count FROM products');
    
    if (products[0].count === 0) {
      const productData = [
        {
          name: "Gaming Laptop Pro X1",
          category: "laptops",
          brand: "TechPro",
          price: 1299.99,
          description: "High-performance gaming laptop with RTX 4060",
          stock: 15,
          rating: 4.8,
          reviews: 245,
          image_url: "https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=500&h=500&fit=crop",
          specs: JSON.stringify({"cpu":"Intel i7-13700H","ram":"16GB DDR5","storage":"1TB NVMe SSD","gpu":"RTX 4060"})
        },
        {
          name: "UltraWide Monitor 34\"",
          category: "monitors",
          brand: "ViewMax",
          price: 599.99,
          description: "34-inch curved ultrawide display with 144Hz",
          stock: 23,
          rating: 4.6,
          reviews: 189,
          image_url: "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=500&h=500&fit=crop",
          specs: "{}"
        },
        {
          name: "Mechanical Keyboard RGB",
          category: "keyboards",
          brand: "KeyMaster",
          price: 149.99,
          description: "Cherry MX mechanical switches with RGB",
          stock: 45,
          rating: 4.9,
          reviews: 567,
          image_url: "https://images.unsplash.com/photo-1595225476474-87563907a212?w=500&h=500&fit=crop",
          specs: "{}"
        },
        {
          name: "Wireless Gaming Mouse",
          category: "mouse",
          brand: "ClickPro",
          price: 79.99,
          description: "25,000 DPI wireless gaming mouse",
          stock: 67,
          rating: 4.7,
          reviews: 423,
          image_url: "https://images.unsplash.com/photo-1527814050087-3793815479db?w=500&h=500&fit=crop",
          specs: "{}"
        },
        {
          name: "Premium Headset 7.1",
          category: "headsets",
          brand: "SoundWave",
          price: 199.99,
          description: "Virtual 7.1 surround sound headset",
          stock: 34,
          rating: 4.5,
          reviews: 312,
          image_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&h=500&fit=crop",
          specs: "{}"
        },
        {
          name: "Intel Core i9-14900K",
          category: "cpu",
          brand: "Intel",
          price: 589.99,
          description: "24-core flagship processor",
          stock: 12,
          rating: 4.9,
          reviews: 178,
          image_url: "https://images.unsplash.com/photo-1555617981-dac3880eac6e?w=500&h=500&fit=crop",
          specs: JSON.stringify({"socket":"LGA1700","cores":24,"threads":32})
        },
        {
          name: "RTX 4090 Graphics Card",
          category: "gpu",
          brand: "NVIDIA",
          price: 1599.99,
          description: "Ultimate gaming graphics card",
          stock: 8,
          rating: 4.8,
          reviews: 234,
          image_url: "https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?w=500&h=500&fit=crop",
          specs: JSON.stringify({"vram":"24GB GDDR6X","power":"450W"})
        },
        {
          name: "DDR5 32GB RAM Kit",
          category: "ram",
          brand: "Corsair",
          price: 179.99,
          description: "32GB DDR5-6000MHz kit",
          stock: 56,
          rating: 4.7,
          reviews: 456,
          image_url: "https://images.unsplash.com/photo-1541336032412-2048a678540d?w=500&h=500&fit=crop",
          specs: JSON.stringify({"type":"DDR5","speed":"6000MHz","capacity":"32GB"})
        },
        {
          name: "NVMe SSD 2TB",
          category: "storage",
          brand: "Samsung",
          price: 199.99,
          description: "Gen4 NVMe SSD with 7000MB/s read",
          stock: 41,
          rating: 4.8,
          reviews: 389,
          image_url: "https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?w=500&h=500&fit=crop",
          specs: "{}"
        },
        {
          name: "Z790 Motherboard",
          category: "motherboard",
          brand: "ASUS",
          price: 349.99,
          description: "ATX gaming motherboard",
          stock: 19,
          rating: 4.6,
          reviews: 167,
          image_url: "https://images.unsplash.com/photo-1591370874773-6702e8f12fd8?w=500&h=500&fit=crop",
          specs: JSON.stringify({"socket":"LGA1700","formFactor":"ATX","ramSlots":4})
        }
      ];

      for (const p of productData) {
        try {
          // Try to insert including build_price (newer schema)
          await connection.execute(
            'INSERT INTO products (name, category, brand, price, build_price, description, stock, rating, reviews, image_url, specs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [p.name, p.category, p.brand, p.price, p.build_price || p.price, p.description, p.stock, p.rating, p.reviews, p.image_url, p.specs]
          );
        } catch (error) {
          // Fallback to older schema without build_price
          try {
            await connection.execute(
              'INSERT INTO products (name, category, brand, price, description, stock, rating, reviews, image_url, specs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [p.name, p.category, p.brand, p.price, p.description, p.stock, p.rating, p.reviews, p.image_url, p.specs]
            );
          } catch (err) {
            console.log('Product insert info:', err.message);
          }
        }
      }
      console.log('Products seeded successfully!');
    }
  } finally {
    connection.release();
  }
}

// ============= PRODUCTS HANDLERS =============

// Demo products for when DB is unavailable
const demoProducts = [
  { id: 1, name: 'Gaming Laptop Pro X1', category: 'laptops', brand: 'TechPro', price: 1299.99, build_price: 1299.99, description: 'High-performance gaming laptop with RTX 4060', stock: 15, rating: 4.8, reviews: 245, image_url: 'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=500&h=500&fit=crop' },
  { id: 2, name: 'UltraWide Monitor 34"', category: 'monitors', brand: 'ViewMax', price: 599.99, build_price: 599.99, description: '34-inch curved ultrawide display with 144Hz', stock: 23, rating: 4.6, reviews: 189, image_url: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=500&h=500&fit=crop' },
  { id: 3, name: 'Mechanical Keyboard RGB', category: 'keyboards', brand: 'KeyMaster', price: 149.99, build_price: 149.99, description: 'Cherry MX mechanical switches with RGB', stock: 45, rating: 4.9, reviews: 567, image_url: 'https://images.unsplash.com/photo-1595225476474-87563907a212?w=500&h=500&fit=crop' },
  { id: 4, name: 'Wireless Gaming Mouse', category: 'mouse', brand: 'ClickPro', price: 79.99, build_price: 79.99, description: '25,000 DPI wireless gaming mouse', stock: 67, rating: 4.7, reviews: 423, image_url: 'https://images.unsplash.com/photo-1527814050087-3793815479db?w=500&h=500&fit=crop' },
  { id: 5, name: 'Premium Headset 7.1', category: 'headsets', brand: 'SoundWave', price: 199.99, build_price: 199.99, description: 'Virtual 7.1 surround sound headset', stock: 34, rating: 4.5, reviews: 312, image_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500&h=500&fit=crop' },
  { id: 6, name: 'Intel Core i9-14900K', category: 'cpu', brand: 'Intel', price: 589.99, build_price: 589.99, description: '24-core flagship processor', stock: 12, rating: 4.9, reviews: 178, image_url: 'https://images.unsplash.com/photo-1555617981-dac3880eac6e?w=500&h=500&fit=crop' },
  { id: 7, name: 'RTX 4090 Graphics Card', category: 'gpu', brand: 'NVIDIA', price: 1599.99, build_price: 1599.99, description: 'Ultimate gaming graphics card', stock: 8, rating: 4.8, reviews: 234, image_url: 'https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?w=500&h=500&fit=crop' },
  { id: 8, name: 'DDR5 32GB RAM Kit', category: 'ram', brand: 'Corsair', price: 179.99, build_price: 179.99, description: '32GB DDR5-6000MHz kit', stock: 56, rating: 4.7, reviews: 456, image_url: 'https://images.unsplash.com/photo-1541336032412-2048a678540d?w=500&h=500&fit=crop' },
  { id: 9, name: 'NVMe SSD 2TB', category: 'storage', brand: 'Samsung', price: 199.99, build_price: 199.99, description: 'Gen4 NVMe SSD with 7000MB/s read', stock: 41, rating: 4.8, reviews: 389, image_url: 'https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?w=500&h=500&fit=crop' },
  { id: 10, name: 'Z790 Motherboard', category: 'motherboard', brand: 'ASUS', price: 349.99, build_price: 349.99, description: 'ATX gaming motherboard', stock: 19, rating: 4.6, reviews: 167, image_url: 'https://images.unsplash.com/photo-1591370874773-6702e8f12fd8?w=500&h=500&fit=crop' }
];

app.get('/api/products', async (req, res) => {
  try {
    if (!pool) {
      return res.json(demoProducts);
    }
    const connection = await pool.getConnection();
    const [products] = await connection.execute('SELECT id, name, category, brand, price, build_price, description, stock, rating, reviews, image_url, specs, created_at, updated_at FROM products');
    connection.release();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    if (!pool) {
      const product = demoProducts.find(p => p.id === parseInt(req.params.id));
      return product ? res.json(product) : res.status(404).json({ error: 'Product not found' });
    }
    const connection = await pool.getConnection();
    const [products] = await connection.execute('SELECT id, name, category, brand, price, build_price, description, stock, rating, reviews, image_url, specs, created_at, updated_at FROM products WHERE id = ?', [req.params.id]);
    connection.release();
    
    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json(products[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, category, brand, price, build_price, description, stock, image_url, specs } = req.body;
    // Demo-mode: return a created response without persisting
    if (!pool) {
      const newId = Math.max(0, ...demoProducts.map(p => p.id)) + 1;
      const item = { id: newId, name, category, brand, price, build_price: build_price || price, description, stock, image_url, specs };
      demoProducts.unshift(item);
      return res.status(201).json({ id: newId, ...item, message: 'Created in demo mode (not persisted)' });
    }
    const connection = await pool.getConnection();
    const [result] = await connection.execute(
      'INSERT INTO products (name, category, brand, price, build_price, description, stock, image_url, specs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, category, brand, price, build_price || price, description, stock, image_url, JSON.stringify(specs || {})]
    );
    connection.release();

    res.status(201).json({
      id: result.insertId,
      name, category, brand, price, build_price: build_price || price, description, stock, image_url, specs
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, category, brand, price, build_price, description, stock, image_url, specs } = req.body;
    // Demo-mode: update in-memory demoProducts if DB unavailable
    if (!pool) {
      const id = parseInt(req.params.id);
      const idx = demoProducts.findIndex(p => p.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Product not found (demo)' });
      demoProducts[idx] = { ...demoProducts[idx], name, category, brand, price, build_price: build_price || price, description, stock, image_url, specs };
      return res.json({ message: 'Product updated (demo mode - not persisted)', product: demoProducts[idx] });
    }
    const connection = await pool.getConnection();
    await connection.execute(
      'UPDATE products SET name=?, category=?, brand=?, price=?, build_price=?, description=?, stock=?, image_url=?, specs=? WHERE id=?',
      [name, category, brand, price, build_price || price, description, stock, image_url, JSON.stringify(specs || {}), req.params.id]
    );
    connection.release();

    res.json({ message: 'Product updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!pool) {
      const idx = demoProducts.findIndex(p => p.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Product not found (demo)' });
      demoProducts.splice(idx, 1);
      return res.json({ message: 'Product deleted (demo mode - not persisted)' });
    }
    const connection = await pool.getConnection();
    await connection.execute('DELETE FROM products WHERE id=?', [req.params.id]);
    connection.release();

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= OFFERS HANDLERS =============

app.get('/api/offers', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [offers] = await connection.execute('SELECT id, title, description, discount_percentage, product_ids, start_date, end_date, is_active, created_at FROM offers WHERE is_active = TRUE');
    connection.release();
    res.json(offers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/offers', async (req, res) => {
  try {
    const { title, description, discount_percentage, product_ids, start_date, end_date, is_active } = req.body;
    const connection = await pool.getConnection();
    const [result] = await connection.execute(
      'INSERT INTO offers (title, description, discount_percentage, product_ids, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [title, description, discount_percentage, product_ids, start_date, end_date, is_active]
    );
    connection.release();
    
    res.status(201).json({
      id: result.insertId,
      title, description, discount_percentage, product_ids, start_date, end_date, is_active
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/offers/:id', async (req, res) => {
  try {
    const { title, description, discount_percentage, product_ids, start_date, end_date, is_active } = req.body;
    const connection = await pool.getConnection();
    await connection.execute(
      'UPDATE offers SET title=?, description=?, discount_percentage=?, product_ids=?, start_date=?, end_date=?, is_active=? WHERE id=?',
      [title, description, discount_percentage, product_ids, start_date, end_date, is_active, req.params.id]
    );
    connection.release();
    
    res.json({ message: 'Offer updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/offers/:id', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.execute('DELETE FROM offers WHERE id=?', [req.params.id]);
    connection.release();
    
    res.json({ message: 'Offer deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= ORDERS HANDLERS =============

// Simple in-memory rate limiter per user (reset on server restart)
const orderRate = new Map(); // userId -> [timestamps]

app.post('/api/orders', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable - orders not supported in demo mode' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { user_id, items, shipping_address, payment } = req.body;

    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No items provided' });

    // Verify user exists and is verified
    const [urows] = await connection.execute('SELECT id, verified FROM users WHERE id = ?', [user_id]);
    if (!urows || urows.length === 0) {
      await connection.rollback();
      return res.status(403).json({ error: 'Invalid user' });
    }
    if (!urows[0].verified) {
      await connection.rollback();
      return res.status(403).json({ error: 'User email not verified' });
    }

    // Rate limiting: allow max 5 orders per minute and at least 3 seconds between orders
    try {
      const now = Date.now();
      const uid = String(user_id);
      const windowMs = 60 * 1000;
      const timestamps = orderRate.get(uid) || [];
      // prune old
      const recent = timestamps.filter(t => now - t < windowMs);
      if (recent.length >= 5) {
        await connection.rollback();
        return res.status(429).json({ error: 'Too many orders recently. Please wait and try again.' });
      }
      if (recent.length > 0 && now - recent[recent.length - 1] < 3000) {
        await connection.rollback();
        return res.status(429).json({ error: 'Orders are being submitted too quickly. Please wait a few seconds.' });
      }
      recent.push(now);
      orderRate.set(uid, recent);
    } catch (e) {
      // ignore rate limiter errors
    }

    // Collect product ids and fetch authoritative prices/stocks
    const productIds = items.map(i => Number(i.product_id)).filter(Boolean);
    if (productIds.length === 0) return res.status(400).json({ error: 'No valid product ids' });

    const placeholders = productIds.map(() => '?').join(',');
    const [products] = await connection.execute(
      `SELECT id, price, build_price, stock FROM products WHERE id IN (${placeholders})`,
      productIds
    );

    const prodMap = new Map(products.map(p => [p.id, p]));

    // Compute server-side total and validate items
    let serverTotal = 0;
    for (const item of items) {
      const pid = Number(item.product_id);
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'Invalid quantity for product ' + pid });
      }
      const prod = prodMap.get(pid);
      if (!prod) {
        await connection.rollback();
        return res.status(400).json({ error: 'Product not found: ' + pid });
      }
      // Determine authoritative price: if order item has `type: 'build'` prefer build_price when available
      const isBuild = !!item.is_build;
      let unitPrice = isBuild && prod.build_price != null ? Number(prod.build_price) : Number(prod.price);
      if (Number(unitPrice) < 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'Invalid product price for ' + pid });
      }
      if (prod.stock != null && Number(prod.stock) < qty) {
        await connection.rollback();
        return res.status(400).json({ error: `Not enough stock for product ${pid}` });
      }
      serverTotal += unitPrice * qty;
      // annotate item with verified price for insertion
      item._verified_price = unitPrice;
    }

    // If client supplied an amount, ensure it matches server total within small tolerance
    if (typeof req.body.amount !== 'undefined') {
      const claimed = Number(req.body.amount) || 0;
      if (Math.abs(claimed - serverTotal) > 0.01) {
        await connection.rollback();
        return res.status(400).json({ error: 'Order total mismatch', serverTotal, claimed });
      }
    }

    // Payment token validation
      if (!payment) {
        await connection.rollback();
        return res.status(400).json({ error: 'Missing payment information' });
      }

      // If using Stripe, verify the PaymentIntent on the server
      if (payment.method === 'stripe') {
        if (!StripeLib) {
          await connection.rollback();
          return res.status(500).json({ error: 'Server payment gateway not configured' });
        }
        if (!payment.id) {
          await connection.rollback();
          return res.status(400).json({ error: 'Missing payment id' });
        }
        try {
          const pi = await StripeLib.paymentIntents.retrieve(payment.id);
          if (!pi) {
            await connection.rollback();
            return res.status(400).json({ error: 'Payment intent not found' });
          }
          // verify amount matches server total (in cents)
          const amountCents = Math.round(serverTotal * 100);
          if (Number(pi.amount) !== amountCents) {
            await connection.rollback();
            return res.status(400).json({ error: 'Payment amount mismatch', piAmount: pi.amount, expected: amountCents });
          }
          if (pi.status !== 'succeeded') {
            await connection.rollback();
            return res.status(400).json({ error: 'Payment not completed', status: pi.status });
          }
        } catch (e) {
          await connection.rollback();
          return res.status(400).json({ error: 'Failed to verify payment intent', details: e.message });
        }
      } else {
        // Fallback simulated token behavior
        if (!payment.token) {
          await connection.rollback();
          return res.status(400).json({ error: 'Missing payment token' });
        }
        const token = payment.token;
        if (!token.startsWith('tok_sim_')) {
          await connection.rollback();
          return res.status(400).json({ error: 'Invalid or unverified payment token' });
        }
      }

      // Amount validation
      if (typeof req.body.amount === 'undefined' || Number(req.body.amount) <= 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'Invalid order amount' });
      }

    // Amount validation
    if (typeof req.body.amount === 'undefined' || Number(req.body.amount) <= 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Invalid order amount' });
    }

    // Insert order with authoritative total
    const [orderResult] = await connection.execute(
      'INSERT INTO orders (user_id, total_amount, shipping_address) VALUES (?, ?, ?)',
      [user_id, serverTotal.toFixed(2), shipping_address || null]
    );

    const orderId = orderResult.insertId;

    for (const item of items) {
      const pid = Number(item.product_id);
      const qty = Number(item.quantity) || 0;
      const price = Number(item._verified_price || 0).toFixed(2);
      await connection.execute(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
        [orderId, pid, qty, price]
      );

      // decrement stock
      await connection.execute(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [qty, pid]
      );
    }

    await connection.commit();
    res.status(201).json({ order_id: orderId, message: 'Order created successfully', total: serverTotal.toFixed(2) });
  } catch (error) {
    await connection.rollback();
    console.error('Order creation failed:', error);
    res.status(500).json({ error: 'Order creation failed', details: error.message });
  } finally {
    connection.release();
  }
});

// ============= REVIEWS HANDLERS =============

app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [reviews] = await connection.execute(
      'SELECT r.id, r.product_id, r.user_id, r.rating, r.comment, u.name as user_name, r.created_at FROM reviews r JOIN users u ON r.user_id = u.id WHERE r.product_id = ? ORDER BY r.created_at DESC',
      [req.params.id]
    );
    connection.release();
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reviews', async (req, res) => {
  try {
    const { product_id, user_id, rating, comment } = req.body;
    const connection = await pool.getConnection();
    
    await connection.execute(
      'INSERT INTO reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)',
      [product_id, user_id, rating, comment]
    );

    await connection.execute(
      'UPDATE products SET rating = (SELECT AVG(rating) FROM reviews WHERE product_id = ?), reviews = (SELECT COUNT(*) FROM reviews WHERE product_id = ?) WHERE id = ?',
      [product_id, product_id, product_id]
    );

    connection.release();
    res.status(201).json({ message: 'Review created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= WISHLIST HANDLERS =============

// Get wishlist for a user
app.get('/api/users/:id/wishlist', async (req, res) => {
  try {
    if (!pool) {
      return res.json([]); // Return empty wishlist in demo mode
    }
    const connection = await pool.getConnection();
    const [rows] = await connection.execute(
      `SELECT w.id, w.user_id, w.product_id, p.name, p.price, p.image_url
       FROM wishlist w
       JOIN products p ON w.product_id = p.id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`,
      [req.params.id]
    );
    connection.release();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add item to wishlist
app.post('/api/wishlist', async (req, res) => {
  try {
    if (!pool) {
      return res.status(201).json({ message: 'Added to wishlist (demo mode - not persisted)' });
    }
    const { user_id, product_id } = req.body;
    const connection = await pool.getConnection();
    try {
      await connection.execute(
        'INSERT INTO wishlist (user_id, product_id) VALUES (?, ?)',
        [user_id, product_id]
      );
      connection.release();
      res.status(201).json({ message: 'Added to wishlist' });
    } catch (err) {
      connection.release();
      if (err && err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ message: 'Item already in wishlist' });
      }
      throw err;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove item from wishlist
app.delete('/api/wishlist', async (req, res) => {
  try {
    if (!pool) {
      return res.json({ message: 'Removed from wishlist (demo mode)' });
    }
    const { user_id, product_id } = req.body;
    const connection = await pool.getConnection();
    await connection.execute('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?', [user_id, product_id]);
    connection.release();
    res.json({ message: 'Removed from wishlist' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= PC BUILDS HANDLERS =============

// Save a pc build for a user
app.post('/api/pc_builds', async (req, res) => {
  try {
    const { user_id, name, components, total_price } = req.body;

    // If DB is not available, persist builds to a local file so they are not lost
    if (!pool) {
      try {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const file = path.join(dataDir, 'pc_builds.json');
        let arr = [];
        try { arr = JSON.parse(fs.readFileSync(file, 'utf8') || '[]'); } catch (e) { arr = []; }
        const id = Date.now() + Math.floor(Math.random() * 1000);
        const entry = { id, user_id, name, components: components || {}, total_price, created_at: new Date().toISOString() };
        arr.push(entry);
        fs.writeFileSync(file, JSON.stringify(arr, null, 2), 'utf8');
        return res.status(201).json({ id, message: 'PC build saved locally (no DB available)' });
      } catch (err) {
        console.error('Failed to save build locally:', err.message);
        return res.status(500).json({ error: 'Failed to save build locally' });
      }
    }

    const connection = await pool.getConnection();
    const [result] = await connection.execute(
      'INSERT INTO pc_builds (user_id, name, components, total_price) VALUES (?, ?, ?, ?)',
      [user_id, name, JSON.stringify(components || {}), total_price]
    );
    connection.release();
    res.status(201).json({ id: result.insertId, message: 'PC build saved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get saved pc builds for a user
app.get('/api/users/:id/pc_builds', async (req, res) => {
  try {
    if (!pool) {
      // read local persisted builds if DB is unavailable
      try {
        const file = path.join(__dirname, 'data', 'pc_builds.json');
        let arr = [];
        try { arr = JSON.parse(fs.readFileSync(file, 'utf8') || '[]'); } catch (e) { arr = []; }
        const builds = arr.filter(r => String(r.user_id) === String(req.params.id));
        return res.json(builds);
      } catch (err) {
        return res.json([]);
      }
    }
    const connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT id, user_id, name, components, total_price, created_at FROM pc_builds WHERE user_id = ? ORDER BY created_at DESC', [req.params.id]);
    connection.release();
    const builds = rows.map(r => {
      let comps = r.components;
      try {
        if (typeof comps === 'string') comps = JSON.parse(comps);
      } catch (e) {
        comps = {};
      }
      return { ...r, components: comps };
    });
    res.json(builds);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a saved build
app.delete('/api/pc_builds/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!pool) {
      // delete from local persisted file
      try {
        const file = path.join(__dirname, 'data', 'pc_builds.json');
        let arr = [];
        try { arr = JSON.parse(fs.readFileSync(file, 'utf8') || '[]'); } catch (e) { arr = []; }
        const filtered = arr.filter(r => String(r.id) !== String(id));
        fs.writeFileSync(file, JSON.stringify(filtered, null, 2), 'utf8');
        return res.json({ message: 'PC build deleted (local storage)' });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to delete local build' });
      }
    }
    const connection = await pool.getConnection();
    await connection.execute('DELETE FROM pc_builds WHERE id = ?', [req.params.id]);
    connection.release();
    res.json({ message: 'PC build deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= AUTHENTICATION HANDLERS =============

// ============= ADMIN / LOCAL BUILD HELPERS =============
// Return locally persisted builds (if any)
app.get('/api/admin/local_builds', (req, res) => {
  try {
    const file = path.join(__dirname, 'data', 'pc_builds.json');
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(file, 'utf8') || '[]'); } catch (e) { arr = []; }
    return res.json(arr);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============= BUILD DISCOUNT CONFIG =============
const buildDiscountFile = path.join(__dirname, 'data', 'build_discount.json');

function readBuildDiscount() {
  try {
    if (!fs.existsSync(path.dirname(buildDiscountFile))) fs.mkdirSync(path.dirname(buildDiscountFile), { recursive: true });
    if (!fs.existsSync(buildDiscountFile)) {
      const def = { global: { itemCount: 3, percent: 20 }, perItem: {} };
      fs.writeFileSync(buildDiscountFile, JSON.stringify(def, null, 2), 'utf8');
      return def;
    }
    const raw = fs.readFileSync(buildDiscountFile, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    console.warn('Failed to read build discount file:', e.message);
    return { global: { itemCount: 3, percent: 20 }, perItem: {} };
  }
}

// Async helper: try to read build discount from DB if available, otherwise fall back to file
async function readBuildDiscountFromDB() {
  if (!pool) return readBuildDiscount();
  try {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute('SELECT id, global_item_count, global_percent, per_item FROM build_discounts ORDER BY id DESC LIMIT 1');
      conn.release();
      if (!rows || rows.length === 0) return readBuildDiscount();
      const r = rows[0];
      let perItem = {};
      try { perItem = r.per_item ? JSON.parse(typeof r.per_item === 'string' ? r.per_item : JSON.stringify(r.per_item)) : {}; } catch (e) { perItem = r.per_item || {}; }
      return { global: { itemCount: Number(r.global_item_count) || 0, percent: Number(r.global_percent) || 0 }, perItem };
    } catch (e) {
      try { conn.release(); } catch(_) {}
      console.warn('Failed to read build_discounts from DB:', e.message);
      return readBuildDiscount();
    }
  } catch (e) {
    // pool may have become unavailable
    return readBuildDiscount();
  }
}

app.get('/api/build-discount', async (req, res) => {
  try {
    const cfg = await readBuildDiscountFromDB();
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/build-discount', async (req, res) => {
  try {
    const body = req.body || {};
    const cfg = {
      global: (body.global && typeof body.global === 'object') ? body.global : { itemCount: 0, percent: 0 },
      perItem: (body.perItem && typeof body.perItem === 'object') ? body.perItem : {}
    };

    // Persist to DB if available
    if (pool) {
      try {
        const conn = await pool.getConnection();
        try {
          // Upsert: if a row exists insert new row (we keep a single latest row)
          const perItemJson = JSON.stringify(cfg.perItem || {});
          await conn.execute('INSERT INTO build_discounts (global_item_count, global_percent, per_item) VALUES (?, ?, ?)', [Number(cfg.global.itemCount) || 0, Number(cfg.global.percent) || 0, perItemJson]);
          conn.release();
        } catch (e) {
          try { conn.release(); } catch(_) {}
          console.warn('Failed to write build_discounts to DB:', e.message);
          // fallback to file below
          if (!fs.existsSync(path.dirname(buildDiscountFile))) fs.mkdirSync(path.dirname(buildDiscountFile), { recursive: true });
          fs.writeFileSync(buildDiscountFile, JSON.stringify(cfg, null, 2), 'utf8');
        }
      } catch (e) {
        // pool error, fallback to file
        if (!fs.existsSync(path.dirname(buildDiscountFile))) fs.mkdirSync(path.dirname(buildDiscountFile), { recursive: true });
        fs.writeFileSync(buildDiscountFile, JSON.stringify(cfg, null, 2), 'utf8');
      }
    } else {
      // no db: persist to file
      if (!fs.existsSync(path.dirname(buildDiscountFile))) fs.mkdirSync(path.dirname(buildDiscountFile), { recursive: true });
      fs.writeFileSync(buildDiscountFile, JSON.stringify(cfg, null, 2), 'utf8');
    }

    // Return the saved configuration so callers can update immediately
    res.status(201).json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import local builds into the DB. Returns { imported, remaining }
async function importLocalBuilds() {
  const file = path.join(__dirname, 'data', 'pc_builds.json');
  if (!fs.existsSync(file)) return { imported: 0, remaining: 0 };

  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(file, 'utf8') || '[]'); } catch (e) { arr = []; }
  if (!Array.isArray(arr) || arr.length === 0) return { imported: 0, remaining: 0 };
  if (!pool) throw new Error('Database not available');

  const connection = await pool.getConnection();
  const imported = [];
  const remaining = [];
  try {
    for (const entry of arr) {
      try {
        const { user_id, name, components, total_price } = entry;
        const [result] = await connection.execute(
          'INSERT INTO pc_builds (user_id, name, components, total_price) VALUES (?, ?, ?, ?)',
          [user_id, name, JSON.stringify(components || {}), total_price]
        );
        imported.push({ localId: entry.id, insertedId: result.insertId });
      } catch (e) {
        // keep the entry for a later retry
        remaining.push(entry);
      }
    }
  } finally {
    connection.release();
  }

  try {
    if (remaining.length > 0) {
      fs.writeFileSync(file, JSON.stringify(remaining, null, 2), 'utf8');
    } else {
      // all imported, remove file
      try { fs.unlinkSync(file); } catch (e) {}
    }
  } catch (e) {
    console.warn('Failed to update local build file after import:', e.message);
  }

  return { imported: imported.length, remaining: remaining.length, details: imported };
}

// Endpoint to flush local builds into DB (admin use)
app.post('/api/admin/flush_local_builds', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: 'Database not available' });
    const result = await importLocalBuilds();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    if (!pool) {
      return res.status(201).json({ message: 'User registered (demo mode - not persisted)' });
    }
    const { email, password, name } = req.body;

    // Basic validation
    if (!email || !password || !name) return res.status(400).json({ error: 'Missing name, email or password' });
    const emailNorm = String(email).trim().toLowerCase();
    // Require a Gmail address to reduce fake emails (configurable later)
    if (!/^[^@\s]+@gmail\.com$/i.test(emailNorm)) {
      return res.status(400).json({ error: 'Please register with a valid Gmail address (example@gmail.com)' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit

    const connection = await pool.getConnection();
    try {
      await connection.execute(
        'INSERT INTO users (email, password, name, verified, verify_token) VALUES (?, ?, ?, FALSE, ?)',
        [emailNorm, hashedPassword, name, verificationCode]
      );

      // attempt to send verification email (best-effort)
      try {
        await sendVerificationEmail(emailNorm, verificationCode);
      } catch (e) {
        console.warn('Failed to send verification email:', e.message);
      }

      res.status(201).json({ message: 'User registered successfully. A verification code was sent to your email.' , test_code: process.env.SMTP_HOST ? undefined : verificationCode});
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(400).json({ error: 'Email already exists or registration failed' });
  }
});

// Send or resend verification code
app.post('/api/send-verification', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });
    const emailNorm = String(email).trim().toLowerCase();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute('SELECT id FROM users WHERE email = ?', [emailNorm]);
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'User not found' });
      await connection.execute('UPDATE users SET verify_token = ?, verified = FALSE WHERE email = ?', [code, emailNorm]);
      try { await sendVerificationEmail(emailNorm, code); } catch (e) { console.warn('sendVerificationEmail failed', e.message); }
      res.json({ message: 'Verification code sent', test_code: process.env.SMTP_HOST ? undefined : code });
    } finally { connection.release(); }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Verify code endpoint
app.post('/api/verify', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: 'Database unavailable' });
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Missing email or code' });
    const emailNorm = String(email).trim().toLowerCase();
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.execute('SELECT id, verify_token FROM users WHERE email = ?', [emailNorm]);
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'User not found' });
      const user = rows[0];
      if (!user.verify_token) return res.status(400).json({ error: 'No verification requested' });
      if (String(user.verify_token) !== String(code)) return res.status(400).json({ error: 'Invalid verification code' });
      await connection.execute('UPDATE users SET verified = TRUE, verify_token = NULL WHERE id = ?', [user.id]);
      res.json({ message: 'Email verified successfully' });
    } finally { connection.release(); }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Expose lightweight config (publishable keys) to frontend
app.get('/api/config', (req, res) => {
  res.json({ stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null });
});

// Create a Stripe PaymentIntent for an order (server-side amount calculation + validation)
app.post('/api/create-payment-intent', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Database unavailable - payments not supported in demo mode' });
  if (!StripeLib) return res.status(400).json({ error: 'Payment provider not configured on server' });

  const connection = await pool.getConnection();
  try {
    const { user_id, items, shipping_address } = req.body;
    if (!user_id) return res.status(400).json({ error: 'Missing user_id' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No items provided' });

    // Verify user exists and is verified
    const [urows] = await connection.execute('SELECT id, email, verified FROM users WHERE id = ?', [user_id]);
    if (!urows || urows.length === 0) return res.status(403).json({ error: 'Invalid user' });
    if (!urows[0].verified) return res.status(403).json({ error: 'User email not verified' });

    // Validate and compute total similar to /api/orders
    const productIds = items.map(i => Number(i.product_id)).filter(Boolean);
    if (productIds.length === 0) return res.status(400).json({ error: 'No valid product ids' });
    const placeholders = productIds.map(() => '?').join(',');
    const [products] = await connection.execute(
      `SELECT id, price, build_price, stock FROM products WHERE id IN (${placeholders})`,
      productIds
    );
    const prodMap = new Map(products.map(p => [p.id, p]));

    let serverTotal = 0;
    for (const item of items) {
      const pid = Number(item.product_id);
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) return res.status(400).json({ error: 'Invalid quantity for product ' + pid });
      const prod = prodMap.get(pid);
      if (!prod) return res.status(400).json({ error: 'Product not found: ' + pid });
      const isBuild = !!item.is_build;
      let unitPrice = isBuild && prod.build_price != null ? Number(prod.build_price) : Number(prod.price);
      if (Number(unitPrice) < 0) return res.status(400).json({ error: 'Invalid product price for ' + pid });
      if (prod.stock != null && Number(prod.stock) < qty) return res.status(400).json({ error: `Not enough stock for product ${pid}` });
      serverTotal += unitPrice * qty;
    }

    // Create PaymentIntent with Stripe
    const amountCents = Math.round(serverTotal * 100);
    const intent = await StripeLib.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      metadata: { user_id: String(user_id), items: JSON.stringify(items) },
      receipt_email: urows[0].email || undefined
    });

    res.json({ clientSecret: intent.client_secret, paymentIntentId: intent.id, amount: serverTotal.toFixed(2) });
  } catch (e) {
    console.error('create-payment-intent error', e);
    res.status(500).json({ error: 'Failed to create payment intent', details: e.message });
  } finally {
    connection.release();
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const connection = await pool.getConnection();
    
    const [users] = await connection.execute(
      'SELECT id, email, password, name, verified, role FROM users WHERE email = ?',
      [email]
    );
    
    if (users.length === 0) {
      connection.release();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      connection.release();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.verified && user.role !== 'admin') {
      connection.release();
      return res.status(401).json({ error: 'Email not verified' });
    }

    connection.release();
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const dbStatus = pool ? 'connected' : 'demo mode (no database)';
  res.json({ status: 'OK', message: 'API is healthy', database: dbStatus });
});

// Start server
const PORT = process.env.PORT || 5000;

// Initialize DB without blocking server startup
initDB().catch(err => {
  console.warn('DB init completed with warnings (see above)');
});

app.listen(PORT, () => {
  console.log(`\n✓ Server running on http://localhost:${PORT}`);
  console.log(`✓ Frontend running on http://localhost:3000`);
  console.log(`✓ Database connection: ${pool ? 'Active' : 'Demo mode (local data only)'}\n`);
});

// Helper: send verification email (best-effort). Uses nodemailer if SMTP env provided.
async function sendVerificationEmail(toEmail, code) {
  const SMTP_HOST = process.env.SMTP_HOST;
  if (!SMTP_HOST) {
    console.log(`Verification code for ${toEmail}: ${code} (SMTP not configured)`);
    return;
  }
  // Lazy require nodemailer to avoid hard dependency in demo mode
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch (e) { console.warn('nodemailer not installed, cannot send email'); console.log(`Verification code for ${toEmail}: ${code}`); return; }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@example.com';
  const info = await transporter.sendMail({
    from,
    to: toEmail,
    subject: 'Your verification code',
    text: `Your verification code for ARI TECHNOLOGY is: ${code}`,
    html: `<p>Your verification code for <strong>ARI TECHNOLOGY</strong> is: <strong>${code}</strong></p>`
  });
  console.log('Verification email sent:', info && info.messageId ? info.messageId : '(no messageId)');
}
