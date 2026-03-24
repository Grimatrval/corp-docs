sudo -u postgres psql -d corp_docs_db << 'ENDSQL'
-- Таблица users
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

-- Таблица approvals
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

-- Таблица tasks
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

-- Индексы
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_approvals_creator ON approvals(creator_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver ON approvals(approver_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_tasks_executor ON tasks(executor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Очистка
DELETE FROM users a USING users b WHERE a.ctid < b.ctid AND a.telegram_id = b.telegram_id;
UPDATE users SET last_name = COALESCE(last_name, ''), username = COALESCE(username, '') WHERE last_name IS NULL OR username IS NULL;

SELECT '✅ Готово!' as status;
ENDSQL

# Перезапуск
pm2 restart corp-docs-bot
