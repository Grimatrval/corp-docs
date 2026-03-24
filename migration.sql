-- ==========================================
-- ПОЛНАЯ МИГРАЦИЯ БАЗЫ ДАННЫХ
-- Корпоративный Документооборот
-- Версия: 2.0 (с Telegram ID)
-- ==========================================

-- ===== ТАБЛИЦА USERS =====
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  username VARCHAR(255),
  role VARCHAR(50) DEFAULT 'employee',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP DEFAULT NOW()
);

-- Добавляем колонки если их нет
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'employee';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT NOW();

-- ===== ТАБЛИЦА APPROVALS =====
CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  amount DECIMAL(10,2) DEFAULT 0,
  creator_id INTEGER,
  approver_id INTEGER,
  status VARCHAR(50) DEFAULT 'pending',
  file_id VARCHAR(255),
  file_type VARCHAR(50),
  payment_sent_to INTEGER,
  payment_status VARCHAR(50) DEFAULT 'not_required',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Добавляем ВСЕ колонки
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS creator_id INTEGER;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS approver_id INTEGER;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS file_id VARCHAR(255);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS file_type VARCHAR(50);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS payment_sent_to INTEGER;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'not_required';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- ===== ТАБЛИЦА TASKS =====
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  creator_id INTEGER,
  executor_id INTEGER,
  deadline DATE,
  priority VARCHAR(50) DEFAULT 'medium',
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Добавляем ВСЕ колонки
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS creator_id INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS executor_id INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(50) DEFAULT 'medium';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- ===== ВНЕШНИЕ КЛЮЧИ =====
-- Для approvals
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'approvals_creator_id_fkey'
  ) THEN
    ALTER TABLE approvals ADD CONSTRAINT approvals_creator_id_fkey 
    FOREIGN KEY (creator_id) REFERENCES users(id);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'approvals_approver_id_fkey'
  ) THEN
    ALTER TABLE approvals ADD CONSTRAINT approvals_approver_id_fkey 
    FOREIGN KEY (approver_id) REFERENCES users(id);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'approvals_payment_sent_to_fkey'
  ) THEN
    ALTER TABLE approvals ADD CONSTRAINT approvals_payment_sent_to_fkey 
    FOREIGN KEY (payment_sent_to) REFERENCES users(id);
  END IF;
END $$;

-- Для tasks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'tasks_creator_id_fkey'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_creator_id_fkey 
    FOREIGN KEY (creator_id) REFERENCES users(id);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'tasks_executor_id_fkey'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_executor_id_fkey 
    FOREIGN KEY (executor_id) REFERENCES users(id);
  END IF;
END $$;

-- ===== ИНДЕКСЫ =====
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_approvals_creator ON approvals(creator_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver ON approvals(approver_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_tasks_executor ON tasks(executor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);

-- ===== УНИКАЛЬНОСТЬ =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_telegram_id_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_telegram_id_unique UNIQUE (telegram_id);
  END IF;
END $$;

-- ===== ОЧИСТКА ДАННЫХ =====
-- Удаляем дубликаты (оставляем первого)
DELETE FROM users a USING users b 
WHERE a.ctid < b.ctid 
AND a.telegram_id = b.telegram_id;

-- Удаляем пользователей с НЕчисловым telegram_id (кроме админов)
-- Они должны будут зарегистрироваться заново
DELETE FROM users WHERE telegram_id !~ '^[0-9]+$' AND role != 'admin';

-- Обновляем NULL значения
UPDATE users SET first_name = COALESCE(first_name, '') WHERE first_name IS NULL;
UPDATE users SET last_name = COALESCE(last_name, '') WHERE last_name IS NULL;
UPDATE users SET username = COALESCE(username, '') WHERE username IS NULL;
UPDATE users SET role = COALESCE(role, 'employee') WHERE role IS NULL;
UPDATE users SET is_active = COALESCE(is_active, true) WHERE is_active IS NULL;

-- ===== ПРОВЕРКА =====
SELECT '✅ Миграция успешно выполнена!' as status;
SELECT 'Users: ' || COUNT(*) as users_count FROM users;
SELECT 'Approvals: ' || COUNT(*) as approvals_count FROM approvals;
SELECT 'Tasks: ' || COUNT(*) as tasks_count FROM tasks;

-- Показываем структуру
SELECT '=== USERS ===' as table_name;
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY ordinal_position;

SELECT '=== APPROVALS ===' as table_name;
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'approvals' 
ORDER BY ordinal_position;

SELECT '=== TASKS ===' as table_name;
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'tasks' 
ORDER BY ordinal_position;

-- Показываем пользователей
SELECT '=== ACTIVE USERS ===' as info;
SELECT id, telegram_id, first_name, last_name, username, role, is_active 
FROM users 
ORDER BY id;
