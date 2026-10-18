-- Initial menu items (user accounts are created by server.js so passwords are hashed)
INSERT INTO menu_items (name, category, price, stock, prep_minutes, description, ingredients, allergens, rating, image)
VALUES
  ('Chicken Adobo','Main Dish',60,18,12,'Tender chicken in soy sauce and vinegar.','Chicken, Soy Sauce, Vinegar, Garlic, Pepper, Bay Leaves','Contains soy. May contain traces of nuts.',4.8,'/img/food/chicken-adobo.jpg'),
  ('Pork Sinigang','Main Dish',55,12,12,'Sour soup with pork and vegetables.','Pork, Tamarind, Radish, Kangkong, Tomato','None known.',4.6,'/img/food/pork-sinigang.jpg'),
  ('Spaghetti','Main Dish',50,8,10,'Classic spaghetti with meat sauce.','Pasta, Tomato Sauce, Ground Meat, Cheese','Contains wheat, dairy.',4.5,'/img/food/spaghetti.jpg'),
  ('Pancit Canton','Snacks',45,8,10,'Stir-fried noodles with vegetables.','Noodles, Cabbage, Carrot, Soy Sauce','Contains wheat, soy.',4.4,'/img/food/pancit-canton.jpg'),
  ('Iced Tea','Drinks',20,20,3,'Refreshing iced tea.','Tea, Sugar, Ice','None known.',4.3,'/img/food/iced-tea.jpg'),
  ('Rice','Main Dish',10,5,2,'Steamed rice.','Rice','None known.',4.7,'/img/food/rice.jpg'),
  ('Eggs','Snacks',15,0,5,'Fried egg.','Egg, Oil','Contains egg.',4.2,'/img/food/fried-egg.jpg'),
  ('Leche Flan','Dessert',25,10,2,'Creamy caramel custard.','Egg, Milk, Sugar','Contains egg, dairy.',4.9,'/img/food/leche-flan.jpg');
