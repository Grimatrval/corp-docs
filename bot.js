require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const userStates = {};

bot.start((ctx) => {
  ctx.reply(
    `👋 Добро пожаловать, ${ctx.from.first_name}!

📋 *Корпоративный Документооборот*

*Доступные команды:*
/new_approval — Создать согласование
/new_task — Создать поручение
/my_tasks — Мои задачи
/my_approvals — Мои согласования
/help — Помощь`,
    { parse_mode: 'Markdown' }
  );
});

bot.help((ctx) => {
  ctx.reply('📖 Отправьте /new_approval или /new_task для начала работы');
});

bot.command('new_approval', (ctx) => {
  userStates[ctx.from.id] = { step: 'approval_title' };
  ctx.reply('📄 *Введите название документа:*', {
    parse_mode: 'Markdown',
    reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
  });
});

bot.command('new_task', (ctx) => {
  userStates[ctx.from.id] = { step: 'task_title' };
  ctx.reply('✅ *Введите название задачи:*', {
    parse_mode: 'Markdown',
    reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
  });
});

bot.command('my_tasks', async (ctx) => {
  try {
    const telegramId = ctx.from.id.toString();
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return ctx.reply('❌ Пользователь не найден');
    
    const userId = userResult.rows[0].id;
    const result = await pool.query('SELECT * FROM tasks WHERE executor_id = $1 AND status != \'completed\' ORDER BY deadline ASC', [userId]);
    
    if (result.rows.length === 0) return ctx.reply('📭 У вас нет активных задач');
    
    let message = '📋 *Ваши активные задачи:*\n\n';
    result.rows.forEach((task, i) => {
      message += `${i + 1}. *${task.title}*\n📅 До: ${new Date(task.deadline).toLocaleDateString('ru-RU')}\n\n`;
    });
    ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    ctx.reply('❌ Ошибка: ' + error.message);
  }
});

bot.command('my_approvals', async (ctx) => {
  try {
    const telegramId = ctx.from.id.toString();
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userResult.rows.length === 0) return ctx.reply('❌ Пользователь не найден');
    
    const userId = userResult.rows[0].id;
    const result = await pool.query('SELECT * FROM approvals WHERE creator_id = $1 ORDER BY created_at DESC LIMIT 10', [userId]);
    
    if (result.rows.length === 0) return ctx.reply('📭 У вас нет согласований');
    
    let message = '📋 *Ваши согласования:*\n\n';
    result.rows.forEach((approval, i) => {
      message += `${i + 1}. *${approval.title}* - ${approval.status}\n`;
    });
    ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    ctx.reply('❌ Ошибка: ' + error.message);
  }
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;
  
  if (text === '❌ Отмена') {
    delete userStates[userId];
    return ctx.reply('❌ Отменено', { reply_markup: Markup.removeKeyboard() });
  }
  
  const state = userStates[userId];
  
  if (state?.step === 'approval_title') {
    userStates[userId] = { ...state, title: text, step: 'approval_amount' };
    return ctx.reply('💰 *Введите сумму (в рублях):*', { parse_mode: 'Markdown' });
  }
  
  if (state?.step === 'approval_amount') {
    userStates[userId] = { ...state, amount: parseFloat(text) || 0, step: 'approval_description' };
    return ctx.reply('📝 *Введите описание:*', { parse_mode: 'Markdown' });
  }
  
  if (state?.step === 'approval_description') {
    userStates[userId] = { ...state, description: text, step: 'approval_approver' };
    return ctx.reply('👤 *Выберите согласующего:*', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('👔 Директор', 'approver_1')],
        [Markup.button.callback('💰 Бухгалтер', 'approver_2')]
      ])
    });
  }
  
  if (state?.step === 'task_title') {
    userStates[userId] = { ...state, title: text, step: 'task_description' };
    return ctx.reply('📝 *Введите описание задачи:*', { parse_mode: 'Markdown' });
  }
  
  if (state?.step === 'task_description') {
    userStates[userId] = { ...state, description: text, step: 'task_executor' };
    return ctx.reply('👤 *Выберите исполнителя:*', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('Иванов И.И.', 'executor_1')],
        [Markup.button.callback('Петров П.П.', 'executor_2')]
      ])
    });
  }
  
  if (state?.step === 'task_deadline') {
    userStates[userId] = { ...state, deadline: text, step: 'task_priority' };
    return ctx.reply('🔥 *Выберите приоритет:*', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Низкий', 'priority_low')],
        [Markup.button.callback('🟡 Средний', 'priority_medium')],
        [Markup.button.callback('🔴 Высокий', 'priority_high')]
      ])
    });
  }
});

bot.action(/^approver_/, async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates[userId];
  if (!state || state.step !== 'approval_approver') return;
  
  const approverId = parseInt(ctx.match[0].split('_')[1]);
  
  try {
    let userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [userId.toString()]);
    let creatorId;
    if (userResult.rows.length === 0) {
      const newUser = await pool.query('INSERT INTO users (telegram_id, first_name, username) VALUES ($1, $2, $3) RETURNING id', [userId.toString(), ctx.from.first_name, ctx.from.username]);
      creatorId = newUser.rows[0].id;
    } else {
      creatorId = userResult.rows[0].id;
    }
    
    const result = await pool.query('INSERT INTO approvals (title, description, amount, creator_id, approver_id, status) VALUES ($1, $2, $3, $4, $5, \'pending\') RETURNING *', [state.title, state.description, state.amount, creatorId, approverId]);
    
    delete userStates[userId];
    ctx.reply(`✅ *Согласование #${result.rows[0].id} создано!*`, { parse_mode: 'Markdown', reply_markup: Markup.removeKeyboard() });
    
  } catch (error) {
    ctx.reply('❌ Ошибка: ' + error.message);
  }
});

bot.action(/^executor_/, async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates[userId];
  if (!state || state.step !== 'task_executor') return;
  
  const executorId = parseInt(ctx.match[0].split('_')[1]);
  userStates[userId] = { ...state, executor_id: executorId, step: 'task_deadline' };
  ctx.reply('📅 *Введите срок выполнения (ДД.ММ.ГГГГ):*', { parse_mode: 'Markdown' });
});

bot.action(/^priority_/, async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates[userId];
  if (!state || state.step !== 'task_priority') return;
  
  const priority = ctx.match[0].split('_')[1];
  
  try {
    let userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [userId.toString()]);
    let creatorId;
    if (userResult.rows.length === 0) {
      const newUser = await pool.query('INSERT INTO users (telegram_id, first_name, username) VALUES ($1, $2, $3) RETURNING id', [userId.toString(), ctx.from.first_name, ctx.from.username]);
      creatorId = newUser.rows[0].id;
    } else {
      creatorId = userResult.rows[0].id;
    }
    
    const dateParts = state.deadline.split('.');
    const deadline = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
    
    const result = await pool.query('INSERT INTO tasks (title, description, creator_id, executor_id, deadline, priority, status) VALUES ($1, $2, $3, $4, $5, $6, \'pending\') RETURNING *', [state.title, state.description, creatorId, state.executor_id, deadline, priority]);
    
    delete userStates[userId];
    ctx.reply(`✅ *Поручение #${result.rows[0].id} создано!*`, { parse_mode: 'Markdown', reply_markup: Markup.removeKeyboard() });
    
  } catch (error) {
    ctx.reply('❌ Ошибка: ' + error.message);
  }
});

bot.launch().then(() => {
  console.log('✅ Бот запущен!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));