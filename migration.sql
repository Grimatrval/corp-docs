-- Миграция: добавляем новые поля (без потери данных!)

-- Таблица users
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'employee';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT NOW();

-- Таблица approvals
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS file_id VARCHAR(255);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS file_type VARCHAR(50);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS payment_sent_to INTEGER REFERENCES users(id);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'not_required';

-- Таблица tasks (если нет)
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  creator_id INTEGER REFERENCES users(id),
  executor_id INTEGER REFERENCES users(id),
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
