const Database = require("better-sqlite3")
const { faker } = require("@faker-js/faker")
const path = require("path")

const db = new Database(path.join(__dirname, "database.db"));

//--Helpers

const randInt = (min, max) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

const randItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

const fmtDate = (date) => date.toISOString().split("T")[0];

// --- Clear existing data

db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM order_items;
    DELETE FROM orders;
    DELETE FROM products;
    DELETE FROM customers;
    DELETE FROM categories;
    DELETE FROM employees;
    DELETE FROM departments;
    PRAGMA foreign_keys = ON;
    `);

const departmentNames = [
    "Sales",
    "Engineering", 
    "Marketing",
    "Support",
    "Finance",
    "HR",
    "Operations",
    "Legal"
];

const insertDept = db.prepare(
    `INSERT INTO departments (name) VALUES (@name)`
);

const deptInsertMany = db.transaction((depts) => {
    for (const d of depts) insertDept.run(d);
});

deptInsertMany(departmentNames.map((name) => ({ name })));

const departments = db.prepare("SELECT id FROM departments").all();
console.log(`✅ Inserted ${departments.length} departments`);

// ── 4. Products (80 rows) ──────────────────────────────────────────────────
 
const insertProduct = db.prepare(`
  INSERT INTO products (name, sku, category_id, unit_price, stock_quantity, is_active)
  VALUES (@name, @sku, @category_id, @unit_price, @stock_quantity, @is_active)
`);
 
const insertProducts = db.transaction(() => {
  const skus = new Set();
  for (let i = 0; i < 80; i++) {
    let sku;
    do {
      sku = faker.string.alphanumeric({ length: 8, casing: "upper" });
    } while (skus.has(sku));
    skus.add(sku);
 
    insertProduct.run({
      name: faker.commerce.productName(),
      sku,
      category_id: randItem(categories).id,
      unit_price: parseFloat(faker.commerce.price({ min: 9.99, max: 2499.99 })),
      stock_quantity: randInt(0, 500),
      is_active: Math.random() > 0.08 ? 1 : 0,
    });
  }
});
 
insertProducts();
const products = db.prepare("SELECT id, unit_price FROM products").all();
console.log(`✅ Inserted ${products.length} products`);
 
// ── 5. Customers (100 rows) ────────────────────────────────────────────────
 
const insertCustomer = db.prepare(`
  INSERT INTO customers (first_name, last_name, email, company, city, state, country, created_at)
  VALUES (@first_name, @last_name, @email, @company, @city, @state, @country, @created_at)
`);
 
const insertCustomers = db.transaction(() => {
  const emails = new Set();
  for (let i = 0; i < 100; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    let email;
    do {
      email = faker.internet.email({ firstName, lastName }).toLowerCase();
    } while (emails.has(email));
    emails.add(email);
 
    insertCustomer.run({
      first_name: firstName,
      last_name: lastName,
      email,
      company: Math.random() > 0.3 ? faker.company.name() : null,
      city: faker.location.city(),
      state: faker.location.state({ abbreviated: true }),
      country: Math.random() > 0.15 ? "US" : faker.location.countryCode(),
      created_at: fmtDate(
        faker.date.between({ from: "2020-01-01", to: "2024-12-31" })
      ),
    });
  }
});
 
insertCustomers();
const customers = db.prepare("SELECT id FROM customers").all();
console.log(`✅ Inserted ${customers.length} customers`);
 
// ── 6. Orders + Order Items (~270 orders, ~500+ items) ─────────────────────
 
const statuses = ["pending", "processing", "shipped", "delivered", "cancelled"];
 
const insertOrder = db.prepare(`
  INSERT INTO orders (customer_id, employee_id, status, order_date, shipped_date, total_amount)
  VALUES (@customer_id, @employee_id, @status, @order_date, @shipped_date, @total_amount)
`);
 
const insertItem = db.prepare(`
  INSERT INTO order_items (order_id, product_id, quantity, unit_price, discount)
  VALUES (@order_id, @product_id, @quantity, @unit_price, @discount)
`);
 
const insertOrders = db.transaction(() => {
  for (let i = 0; i < 270; i++) {
    const orderDate = faker.date.between({ from: "2022-01-01", to: "2025-03-01" });
    const status = randItem(statuses);
 
    let shippedDate = null;
    if (status === "shipped" || status === "delivered") {
      const d = new Date(orderDate);
      d.setDate(d.getDate() + randInt(1, 7));
      shippedDate = fmtDate(d);
    }
 
    // Insert order with placeholder total; we'll compute after items
    const orderResult = insertOrder.run({
      customer_id: randItem(customers).id,
      employee_id: Math.random() > 0.1 ? randItem(employees).id : null,
      status,
      order_date: fmtDate(orderDate),
      shipped_date: shippedDate,
      total_amount: 0,
    });
 
    const orderId = orderResult.lastInsertRowid;
    const itemCount = randInt(1, 6);
    const usedProducts = new Set();
    let total = 0;
 
    for (let j = 0; j < itemCount; j++) {
      let product;
      // Avoid duplicate product on same order
      let attempts = 0;
      do {
        product = randItem(products);
        attempts++;
      } while (usedProducts.has(product.id) && attempts < 20);
 
      usedProducts.add(product.id);
 
      const qty = randInt(1, 10);
      const price = product.unit_price;
      const discount = randItem([0, 0, 0, 0.05, 0.1, 0.15, 0.2]);
 
      insertItem.run({
        order_id: orderId,
        product_id: product.id,
        quantity: qty,
        unit_price: price,
        discount,
      });
 
      total += qty * price * (1 - discount);
    }
 
    // Update order total
    db.prepare("UPDATE orders SET total_amount = ? WHERE id = ?").run(
      parseFloat(total.toFixed(2)),
      orderId
    );
  }
});
 
insertOrders();
 
const orderCount = db.prepare("SELECT COUNT(*) as c FROM orders").get().c;
const itemCount = db.prepare("SELECT COUNT(*) as c FROM order_items").get().c;
console.log(`✅ Inserted ${orderCount} orders with ${itemCount} order items`);
 
// ── Summary ────────────────────────────────────────────────────────────────
 
console.log("\n📊 Final row counts:");
const tables = [
  "departments",
  "employees",
  "categories",
  "products",
  "customers",
  "orders",
  "order_items",
];
for (const t of tables) {
  const { c } = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get();
  console.log(`   ${t.padEnd(15)} ${c} rows`);
}
 
console.log("\n🎉 Seed complete!");
db.close();