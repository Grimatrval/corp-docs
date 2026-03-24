-- ==========================================
-- ПОЛНАЯ МИГРАЦИЯ БАЗЫ ДАННЫХ
-- Корпоративный Документооборот
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

-- ===== ИНДЕКСЫ =====
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_approvals_creator ON approvals(creator_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver ON approvals(approver_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_tasks_executor ON tasks(executor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- ===== УНИКАЛЬНОСТЬ =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_telegram_id_unique'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_telegram_id_unique UNIQUE (telegram_id);
  END IF;
END $$;

-- ===== ОЧИСТКА =====
DELETE FROM users a USING users b 
WHERE a.ctid < b.ctid 
AND a.telegram_id = b.telegram_id;

UPDATE users SET last_name = COALESCE(last_name, '') WHERE last_name IS NULL;
UPDATE users SET username = COALESCE(username, '') WHERE username IS NULL;
UPDATE users SET role = COALESCE(role, 'employee') WHERE role IS NULL;
UPDATE users SET is_active = COALESCE(is_active, true) WHERE is_active IS NULL;

-- ===== ПРОВЕРКА =====
SELECT '✅ Миграция успешно выполнена!' as status;
SELECT 'Users: ' || COUNT(*) FROM users;
SELECT 'Approvals: ' || COUNT(*) FROM approvals;
SELECT 'Tasks: ' || COUNT(*) FROM tasks;
