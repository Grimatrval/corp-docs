require('dotenv').config({ path: '/opt/corp-docs/backend/.env' });

const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');
console.log('BOT_TOKEN loaded:', process.env.BOT_TOKEN ? 'YES' : 'NO');

const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const userStates = {};

// ========== ПРОВЕРКА ДОСТУПА ==========
async function checkAccess(ctx) {
  const userId = ctx.from.id.toString();
  let user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
  
  if (user.rows.length === 0) {
    await pool.query('INSERT INTO users (telegram_id, username, first_name, is_active) VALUES ($1, $2, $3, false)', [userId, ctx.from.username, ctx.from.first_name]);
    return true;
  }
  return user.rows[0].is_active;
}

async function getUser(ctx) {
  const userId = ctx.from.id.toString();
  const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
  return result.rows[0];
}

// ========== КОМАНДЫ ==========
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  let user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
  
  if (user.rows.length === 0) {
    await pool.query('INSERT INTO users (telegram_id, username, first_name, is_active) VALUES ($1, $2, $3, false)', [userId, ctx.from.username, ctx.from.first_name]);
  }
  
  const access = user.rows.length > 0 && user.rows[0].is_active;
  ctx.reply(`👋 Добро пожаловать, ${ctx.from.first_name}!\n\n📋 Корпоративный Документооборот\n\n${access ? '✅ Вы зарегистрированы в системе' : '⚠️ Ожидается регистрация администратором'}`);
  ctx.reply('*Ваши команды:*');
  ctx.reply(`/new_approval — 📄 Создать согласование`);
  ctx.reply(`/new_task — ✅ Создать поручение`);
  ctx.reply(`/my_tasks — 📋 Мои задачи`);
  ctx.reply(`/my_errands — 📝 Мои поручения`);
  ctx.reply(`/my_approvals — 📊 Мои согласования`);
  ctx.reply(`/help — ℹ️ Помощь`);
});

bot.command('new_approval', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1 AND is_active = true', [userId]);
    
    if (!user || user.rows.length === 0) {
      return ctx.reply('❌ Доступ запрещён! Вы не зарегистрированы в системе.');
    }
    
    await ctx.reply('Введите название согласования:');
    userStates[userId] = { step: 'approval_title' };
    ctx.reply('После названия — отправьте описание документа.');
  } catch (err) {
    console.error('Ошибка в new_approval:', err.message);
    await ctx.reply('⚠️ Система временно недоступна. Обратитесь к администратору.');
  }
});

bot.command('new_task', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1 AND is_active = true', [userId]);
    
    if (!user || user.rows.length === 0) {
      return ctx.reply('❌ Доступ запрещён! Вы не зарегистрированы в системе.');
    }
    
    await ctx.reply('Введите название поручения:');
    userStates[userId] = { step: 'task_title' };
  } catch (err) {
    console.error('Ошибка в new_task:', err.message);
    await ctx.reply('⚠️ Система временно недоступна. Обратитесь к администратору.');
  }
});

bot.command('help', async (ctx) => {
  ctx.reply('ℹ️ *Доступные команды*\n\n' +
    `/start — Приветствие и список команд\n` +
    `/new_approval — 📄 Создать согласование\n` +
    `/new_task — ✅ Создать поручение\n` +
    `/my_tasks — 📋 Мои задачи\n` +
    `/my_errands — 📝 Мои поручения\n` +
    `/my_approvals — 📊 Мои согласования\n` +
    `/help — Эта справка`);
});

// ========== ЗАПУСК БОТА ==========
bot.launch().then(() => {
  console.log('Бот запущен!');
}).catch(err => {
  console.error('Ошибка запуска бота:', err);
  process.exit(1);
});

// Обработка Ctrl+C для остановки
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
