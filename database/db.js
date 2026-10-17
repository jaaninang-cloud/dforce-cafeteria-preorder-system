'use strict';
// Opens the SQLite database (built into Node.js), creates the tables on first run and loads the initial menu.
// Older databases (v1.0) are upgraded automatically: new user roles/fields and menu photos.
const{DatabaseSync}=require('node:sqlite'),fs=require('fs'),path=require('path');
const db=new DatabaseSync(process.env.DB_FILE||path.join(__dirname,'cafeteria.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

const cols=t=>db.prepare('PRAGMA table_info('+t+')').all().map(c=>c.name);
if(cols('users').length&&!cols('users').includes('user_type')){            // upgrade v1.0 users table
  db.exec('PRAGMA foreign_keys=OFF; BEGIN');
  db.exec(`CREATE TABLE users_new(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,id_number TEXT NOT NULL UNIQUE COLLATE NOCASE,email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      role TEXT NOT NULL CHECK(role IN('customer','staff')),user_type TEXT NOT NULL DEFAULT 'student' CHECK(user_type IN('student','employee','instructor','administrator','staff')),
      department TEXT NOT NULL DEFAULT '',contact TEXT NOT NULL DEFAULT '',password_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')));
    INSERT INTO users_new(id,name,id_number,email,role,user_type,password_hash,created_at)
      SELECT id,name,student_id,email,CASE role WHEN 'staff' THEN 'staff' ELSE 'customer' END,CASE role WHEN 'staff' THEN 'staff' ELSE 'student' END,password_hash,created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;`);
  db.exec('COMMIT; PRAGMA foreign_keys=ON');
}
if(cols('menu_items').length&&!cols('menu_items').includes('image'))db.exec("ALTER TABLE menu_items ADD COLUMN image TEXT NOT NULL DEFAULT ''");

db.exec(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
if(!db.prepare('SELECT 1 FROM menu_items LIMIT 1').get())db.exec(fs.readFileSync(path.join(__dirname,'seed.sql'),'utf8'));
// give the original menu items their photo path if they have none yet
const IMG={'Chicken Adobo':'chicken-adobo','Pork Sinigang':'pork-sinigang','Spaghetti':'spaghetti','Pancit Canton':'pancit-canton','Iced Tea':'iced-tea','Rice':'rice','Eggs':'fried-egg','Leche Flan':'leche-flan'};
for(const[n,f]of Object.entries(IMG))db.prepare("UPDATE menu_items SET image=? WHERE name=? AND image=''").run('/img/food/'+f+'.jpg',n);

// 25 extra dishes (balanced across the 4 categories). Added only when a dish with the same name is missing,
// so it works for new and existing databases and never duplicates.
{const add=JSON.parse(fs.readFileSync(path.join(__dirname,'menu-add.json'),'utf8')),has=db.prepare('SELECT 1 FROM menu_items WHERE name=?'),
  ins=db.prepare('INSERT INTO menu_items(name,category,price,stock,prep_minutes,description,ingredients,allergens,rating,image) VALUES(?,?,?,?,?,?,?,?,?,?)');
 // the old Halo-Halo item became Chocolate Cupcake: rename it in existing databases (order history keeps its own copy of the name)
 {const cc=add.find(x=>x.name==='Chocolate Cupcake');if(cc&&has.get('Halo-Halo')&&!has.get('Chocolate Cupcake'))db.prepare('UPDATE menu_items SET name=?,price=?,description=?,ingredients=?,allergens=?,rating=?,prep_minutes=?,image=? WHERE name=?').run(cc.name,cc.price,cc.description,cc.ingredients,cc.allergens,cc.rating,cc.prep_minutes,cc.image,'Halo-Halo')}
 for(const m of add){if(!has.get(m.name))ins.run(m.name,m.category,m.price,m.stock,m.prep_minutes,m.description,m.ingredients,m.allergens,m.rating,m.image);
  // existing databases: fill in a missing photo path (never overwrites a photo that is already set)
  if(m.image)db.prepare("UPDATE menu_items SET image=? WHERE name=? AND (image IS NULL OR image='')").run(m.image,m.name)}}

// All-or-nothing transaction wrapper; nested calls join the outer transaction.
let depth=0;
db.transaction=fn=>(...a)=>{if(depth)return fn(...a);depth=1;db.exec('BEGIN');try{const r=fn(...a);db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}finally{depth=0}};
module.exports=db;
