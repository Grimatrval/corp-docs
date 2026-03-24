require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const userStates = {};

// ========== ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ЭКРАНИРОВАНИЯ ==========
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ========== АДМИН КОМАНДЫ ==========

bot.command('adduser', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const adminCheck = await pool.query('SELECT * FROM users WHERE telegram_id = $1 AND role = \'admin\'', [telegramId]);
  
  if (adminCheck.rows.length === 0) {
    return ctx.reply('❌ Только администратор может добавлять пользователей');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 3) {
    return ctx.reply('❌ Использование: /adduser @username Имя [Фамилия]');
  }
  
  const username = args[1].replace('@', '');
  const firstName = args[2] || '';
  const lastName = args[3] || '';
  
  try {
    const result = await pool.query(
      'INSERT INTO users (telegram_id, first_name, last_name, username, role, is_active) VALUES ($1, $2, $3, $4, \'employee\', true) ON CONFLICT (telegram_id) DO UPDATE SET first_name = $2, last_name = $3, username = $4, is_active = true RETURNING *',
      [username, firstName, lastName, username]
    );
    ctx.reply(`✅ Пользователь добавлен:\n👤 ${firstName} ${lastName}\n@${username}\nID: ${result.rows[0].id}`);
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

bot.command('removeuser', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const adminCheck = await pool.query('SELECT * FROM users WHERE telegram_id = $1 AND role = \'admin\'', [telegramId]);
  
  if (adminCheck.rows.length === 0) {
    return ctx.reply('❌ Только администратор может удалять пользователей');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('❌ Использование: /removeuser @username или ID');
  }
  
  try {
    const identifier = args[1].replace('@', '');
    const result = await pool.query(
      'UPDATE users SET is_active = false WHERE (username = $1 OR id = $2) RETURNING *',
      [identifier, parseInt(identifier) || 0]
    );
    
    if (result.rows.length > 0) {
      ctx.reply(`✅ Пользователь деактивирован: ${result.rows[0].first_name} ${result.rows[0].last_name}`);
    } else {
      ctx.reply('❌ Пользователь не найден');
    }
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

bot.command('listusers', async (ctx) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE is_active = true ORDER BY id');
    
    if (result.rows.length === 0) {
      return ctx.reply('📭 Нет активных пользователей');
    }
    
    let message = '👥 <b>Активные пользователи:</b>\n\n';
    result.rows.forEach((u, i) => {
      message += `${i+1}. ${u.first_name} ${u.last_name} (@${u.username || 'нет'})\n   Роль: ${u.role}\n\n`;
    });
    
    ctx.reply(message, { parse_mode: 'HTML' });
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

// ========== ОСНОВНЫЕ КОМАНДЫ ==========

bot.start(async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  let user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  
  if (user.rows.length === 0) {
    await pool.query(
      'INSERT INTO users (telegram_id, first_name, last_name, username) VALUES ($1, $2, $3, $4)',
      [telegramId, escapeHtml(ctx.from.first_name), escapeHtml(ctx.from.last_name || ''), escapeHtml(ctx.from.username || '')]
    );
  } else {
    await pool.query('UPDATE users SET last_seen = NOW() WHERE telegram_id = $1', [telegramId]);
  }
  
  ctx.reply(
    `👋 <b>Добро пожаловать, ${escapeHtml(ctx.from.first_name)}!</b>

📋 <b>Корпоративный Документооборот</b>

<b>Доступные команды:</b>
/new_approval — 📄 Создать согласование
/new_task — ✅ Создать поручение
/my_tasks — 📋 Мои задачи
/my_approvals — 📊 Мои согласования
/my_errands — 📝 Мои поручения
/help — ℹ️ Помощь

<b>Админ команды:</b>
/adduser — Добавить пользователя
/removeuser — Удалить пользователя
/listusers — Список пользователей

Или отправьте файл с текстом "Согласование: ...", { parse_mode: 'HTML' }
  );
});

bot.help((ctx) => {
  ctx.reply(`📖 <b>Помощь</b>

<b>Создание согласования:</b>
/new_approval — следуйте инструкциям
Или отправьте файл с подписью "Согласование: название"

<b>Создание поручения:</b>
/new_task — следуйте инструкциям

<b>Просмотр:</b>
/my_tasks — ваши активные задачи
/my_approvals — ваши согласования
/my_errands — ваши поручения (как создатель)

<b>Для согласующих:</b>
После согласования можно переслать на оплату бухгалтерии

<b>Для администратора:</b>
/adduser @username Имя Фамилия
/removeuser @username
/listusers`, { parse_mode: 'HTML' });
});

// ========== СОГЛАСОВАНИЯ ==========

bot.command('new_approval', (ctx) => {
  userStates[ctx.from.id] = { step: 'approval_title' };
  ctx.reply('📄 <b>Введите название документа:</b>\n\nНапример: Счёт на оплату от ООО "Поставщик"', {
    parse_mode: 'HTML',
    reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
  });
});

bot.command('my_approvals', async (ctx) => {
  try {
    const telegramId = ctx.from.id.toString();
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    
    if (userResult.rows.length === 0) {
      return ctx.reply('❌ Пользователь не найден. Нажмите /start');
    }
    
    const userId = userResult.rows[0].id;
    const result = await pool.query(
      'SELECT a.*, u1.first_name as approver_name, u2.first_name as payment_to FROM approvals a LEFT JOIN users u1 ON a.approver_id = u1.id LEFT JOIN users u2 ON a.payment_sent_to = u2.id WHERE a.creator_id = $1 ORDER BY a.created_at DESC LIMIT 20',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return ctx.reply('📭 У вас нет согласований');
    }
    
    let message = '📋 <b>Ваши согласования:</b>\n\n';
    result.rows.forEach((a, i) => {
      const emoji = { pending: '🟡', approved: '✅', rejected: '❌', paid: '💰' }[a.status] || '⚪';
      message += `${i+1}. ${emoji} <b>${escapeHtml(a.title)}</b>\n`;
      message += `   💰 ${a.amount} ₽ | ${a.status}\n`;
      message += `   👤 Согласующий: ${a.approver_name || 'Не указан'}\n`;
      if (a.payment_sent_to) {
        message += `   💸 Отправлено на оплату: ${a.payment_to}\n`;
      }
      message += `   📅 ${new Date(a.created_at).toLocaleDateString('ru-RU')}\n\n`;
    });
    
    ctx.reply(message, { parse_mode: 'HTML' });
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

// ========== ПОРУЧЕНИЯ ==========

bot.command('new_task', (ctx) => {
  userStates[ctx.from.id] = { step: 'task_title' };
  ctx.reply('✅ <b>Введите название задачи:</b>\n\nНапример: Подготовить отчёт за март', {
    parse_mode: 'HTML',
    reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
  });
});

bot.command('my_tasks', async (ctx) => {
  try {
    const telegramId = ctx.from.id.toString();
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    
    if (userResult.rows.length === 0) {
      return ctx.reply('❌ Пользователь не найден. Нажмите /start');
    }
    
    const userId = userResult.rows[0].id;
    const result = await pool.query(
      'SELECT t.*, u.first_name as creator_name FROM tasks t LEFT JOIN users u ON t.creator_id = u.id WHERE t.executor_id = $1 AND t.status != \'completed\' ORDER BY t.deadline ASC',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return ctx.reply('📭 У вас нет активных задач');
    }
    
    let message = '📋 <b>Ваши активные задачи:</b>\n\n';
    result.rows.forEach((t, i) => {
      const emoji = { low: '🟢', medium: '🟡', high: '🔴' }[t.priority] || '⚪';
      message += `${i+1}. ${emoji} <b>${escapeHtml(t.title)}</b>\n`;
      message += `   📅 До: ${new Date(t.deadline).toLocaleDateString('ru-RU')}\n`;
      message += `   📌 ${t.status}\n`;
      message += `   👤 От: ${t.creator_name || 'Не указан'}\n\n`;
    });
    
    ctx.reply(message, { parse_mode: 'HTML' });
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

bot.command('my_errands', async (ctx) => {
  try {
    const telegramId = ctx.from.id.toString();
    const userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    
    if (userResult.rows.length === 0) {
      return ctx.reply('❌ Пользователь не найден. Нажмите /start');
    }
    
    const userId = userResult.rows[0].id;
    const result = await pool.query(
      'SELECT t.*, u.first_name as executor_name FROM tasks t LEFT JOIN users u ON t.executor_id = u.id WHERE t.creator_id = $1 ORDER BY t.created_at DESC LIMIT 20',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return ctx.reply('📭 Вы не создавали поручений');
    }
    
    let message = '📝 <b>Ваши поручения (как создатель):</b>\n\n';
    result.rows.forEach((t, i) => {
      const emoji = { low: '🟢', medium: '🟡', high: '🔴' }[t.priority] || '⚪';
      message += `${i+1}. ${emoji} <b>${escapeHtml(t.title)}</b>\n`;
      message += `   👤 Исполнитель: ${t.executor_name || 'Не указан'}\n`;
      message += `   📅 До: ${new Date(t.deadline).toLocaleDateString('ru-RU')}\n`;
      message += `   📌 ${t.status}\n\n`;
    });
    
    ctx.reply(message, { parse_mode: 'HTML' });
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

// ========== ОБРАБОТКА ТЕКСТА ==========

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;
  
  if (text === '❌ Отмена') {
    delete userStates[userId];
    return ctx.reply('❌ Отменено', { reply_markup: Markup.removeKeyboard() });
  }
  
  const state = userStates[userId];
  
  // ========== СОГЛАСОВАНИЕ ==========
  
  if (state?.step === 'approval_title') {
    userStates[userId] = { ...state, title: text, step: 'approval_amount' };
    return ctx.reply('💰 <b>Введите сумму (в рублях):</b>\n\nНапример: 150000 или 0', {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
    });
  }
  
  if (state?.step === 'approval_amount') {
    userStates[userId] = { ...state, amount: parseFloat(text) || 0, step: 'approval_description' };
    return ctx.reply('📝 <b>Введите описание:</b>\n\nОпишите что нужно согласовать', {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
    });
  }
  
  if (state?.step === 'approval_description') {
    userStates[userId] = { ...state, description: text, step: 'approval_file' };
    return ctx.reply('📎 <b>Прикрепить файл?</b>\n\nОтправьте файл или напишите "нет" чтобы пропустить', {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([['❌ Отмена'], ['нет']]).resize().oneTime()
    });
  }
  
  if (state?.step === 'approval_file') {
    if (text.toLowerCase() === 'нет') {
      userStates[userId] = { ...state, file_id: null, file_type: null, step: 'approval_approver_list' };
      return showApproverList(ctx, state);
    }
    userStates[userId] = { ...state, file_id: null, file_type: null, step: 'approval_approver_list' };
    return showApproverList(ctx, state);
  }
  
  // ========== ПОРУЧЕНИЕ ==========
  
  if (state?.step === 'task_title') {
    userStates[userId] = { ...state, title: text, step: 'task_description' };
    return ctx.reply('📝 <b>Введите описание задачи:</b>\n\nПодробно опишите что нужно сделать', {
      parse_mode: 'HTML',
      reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
    });
  }
  
  if (state?.step === 'task_description') {
    userStates[userId] = { ...state, description: text, step: 'task_executor_list' };
    return showExecutorList(ctx, state);
  }
});

// ========== ОБРАБОТКА ФАЙЛОВ ==========

bot.on('document', async (ctx) => {
  const caption = ctx.message.caption || '';
  const fileId = ctx.message.document.file_id;
  const fileName = ctx.message.document.file_name;
  
  if (caption.toLowerCase().includes('согласование:') || caption.toLowerCase().includes('согласуй:')) {
    await createApprovalFromFile(ctx, caption, fileId, fileName, 'document');
    return;
  }
  
  const state = userStates[ctx.from.id];
  if (state?.step === 'approval_file') {
    userStates[ctx.from.id] = { ...state, file_id: fileId, file_type: 'document', file_name: fileName, step: 'approval_approver_list' };
    return showApproverList(ctx, userStates[ctx.from.id]);
  }
});

bot.on('photo', async (ctx) => {
  const caption = ctx.message.caption || '';
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  
  if (caption.toLowerCase().includes('согласование:') || caption.toLowerCase().includes('согласуй:')) {
    await createApprovalFromFile(ctx, caption, fileId, 'photo.jpg', 'photo');
    return;
  }
  
  const state = userStates[ctx.from.id];
  if (state?.step === 'approval_file') {
    userStates[ctx.from.id] = { ...state, file_id: fileId, file_type: 'photo', step: 'approval_approver_list' };
    return showApproverList(ctx, userStates[ctx.from.id]);
  }
});

bot.on('voice', async (ctx) => {
  const caption = ctx.message.caption || '';
  const fileId = ctx.message.voice.file_id;
  
  if (caption.toLowerCase().includes('согласование:') || caption.toLowerCase().includes('согласуй:')) {
    await createApprovalFromFile(ctx, caption, fileId, 'voice.ogg', 'voice');
    return;
  }
  
  const state = userStates[ctx.from.id];
  if (state?.step === 'approval_file') {
    userStates[ctx.from.id] = { ...state, file_id: fileId, file_type: 'voice', step: 'approval_approver_list' };
    return showApproverList(ctx, userStates[ctx.from.id]);
  }
});

bot.on('video_note', async (ctx) => {
  const caption = ctx.message.caption || '';
  const fileId = ctx.message.video_note.file_id;
  
  if (caption.toLowerCase().includes('согласование:') || caption.toLowerCase().includes('согласуй:')) {
    await createApprovalFromFile(ctx, caption, fileId, 'video.mp4', 'video_note');
    return;
  }
  
  const state = userStates[ctx.from.id];
  if (state?.step === 'approval_file') {
    userStates[ctx.from.id] = { ...state, file_id: fileId, file_type: 'video_note', step: 'approval_approver_list' };
    return showApproverList(ctx, userStates[ctx.from.id]);
  }
});

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

async function showApproverList(ctx, state) {
  try {
    const result = await pool.query('SELECT id, first_name, last_name, username FROM users WHERE is_active = true AND role IN (\'admin\', \'director\', \'accountant\') ORDER BY id');
    
    if (result.rows.length === 0) {
      return ctx.reply('❌ Нет доступных согласующих. Обратитесь к администратору.', { reply_markup: Markup.removeKeyboard() });
    }
    
    const keyboard = result.rows.map(u => [Markup.button.callback(`${u.first_name} ${u.last_name} (@${u.username || 'нет'})`, `approver_${u.id}`)]);
    keyboard.push([Markup.button.callback('❌ Отмена', 'cancel')]);
    
    ctx.reply('👤 <b>Выберите согласующего:</b>\n\nНажмите на кнопку:', {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(keyboard)
    });
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
}

async function showExecutorList(ctx, state) {
  try {
    const result = await pool.query('SELECT id, first_name, last_name, username FROM users WHERE is_active = true ORDER BY id');
    
    if (result.rows.length === 0) {
      return ctx.reply('❌ Нет доступных исполнителей. Обратитесь к администратору.', { reply_markup: Markup.removeKeyboard() });
    }
    
    const keyboard = result.rows.map(u => [Markup.button.callback(`${u.first_name} ${u.last_name} (@${u.username || 'нет'})`, `executor_${u.id}`)]);
    keyboard.push([Markup.button.callback('❌ Отмена', 'cancel')]);
    
    ctx.reply('👤 <b>Выберите исполнителя:</b>\n\nНажмите на кнопку:', {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(keyboard)
    });
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
}

async function createApprovalFromFile(ctx, caption, fileId, fileName, fileType) {
  try {
    const title = caption.replace(/согласование:|согласуй:/i, '').trim();
    const telegramId = ctx.from.id.toString();
    
    let userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    let creatorId;
    if (userResult.rows.length === 0) {
      const newUser = await pool.query('INSERT INTO users (telegram_id, first_name, last_name, username) VALUES ($1, $2, $3, $4) RETURNING id', [telegramId, escapeHtml(ctx.from.first_name), escapeHtml(ctx.from.last_name || ''), escapeHtml(ctx.from.username || '')]);
      creatorId = newUser.rows[0].id;
    } else {
      creatorId = userResult.rows[0].id;
    }
    
    const result = await pool.query('INSERT INTO approvals (title, description, creator_id, file_id, file_type, status) VALUES ($1, $2, $3, $4, $5, \'pending\') RETURNING *', [escapeHtml(title), `Файл: ${fileName}`, creatorId, fileId, fileType]);
    
    ctx.reply(`✅ <b>Согласование #${result.rows[0].id} создано!</b>\n\n📄 ${escapeHtml(title)}\n📎 Файл: ${fileName}`, { parse_mode: 'HTML' });
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
}

// ========== CALLBACK QUERY ==========

bot.action(/^approver_(\d+)/, async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates[userId];
  
  if (!state || state.step !== 'approval_approver_list') {
    return ctx.answerCbQuery('Сначала создайте согласование через /new_approval');
  }
  
  const approverId = parseInt(ctx.match[1]);
  
  try {
    let userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [userId.toString()]);
    let creatorId;
    if (userResult.rows.length === 0) {
      const newUser = await pool.query('INSERT INTO users (telegram_id, first_name, last_name, username) VALUES ($1, $2, $3, $4) RETURNING id', [userId.toString(), escapeHtml(ctx.from.first_name), escapeHtml(ctx.from.last_name || ''), escapeHtml(ctx.from.username || '')]);
      creatorId = newUser.rows[0].id;
    } else {
      creatorId = userResult.rows[0].id;
    }
    
    const result = await pool.query('INSERT INTO approvals (title, description, amount, creator_id, approver_id, file_id, file_type, status) VALUES ($1,$2,$3,$4,$5,$6,$7,\'pending\') RETURNING *', [escapeHtml(state.title), escapeHtml(state.description), state.amount, creatorId, approverId, state.file_id, state.file_type]);
    
    delete userStates[userId];
    
    ctx.reply(`✅ <b>Согласование #${result.rows[0].id} создано!</b>\n\n📄 ${escapeHtml(state.title)}\n💰 ${state.amount} ₽\n📎 Файл: ${state.file_name || 'Нет'}`, {
      parse_mode: 'HTML',
      reply_markup: Markup.removeKeyboard()
    });
    
    const approver = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [approverId]);
    if (approver.rows.length > 0) {
      await bot.telegram.sendMessage(approver.rows[0].telegram_id, `🔔 <b>Новое согласование #${result.rows[0].id}</b>\n\n📄 ${escapeHtml(state.title)}\n💰 ${state.amount} ₽\n📝 ${escapeHtml(state.description)}\n\n👤 От: ${escapeHtml(ctx.from.first_name)}`, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Согласовать', `approve_${result.rows[0].id}`)],
          [Markup.button.callback('❌ Отклонить', `reject_${result.rows[0].id}`)]
        ])
      });
    }
    
    ctx.answerCbQuery();
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^executor_(\d+)/, async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates[userId];
  
  if (!state || state.step !== 'task_executor_list') {
    return ctx.answerCbQuery('Сначала создайте поручение через /new_task');
  }
  
  const executorId = parseInt(ctx.match[1]);
  userStates[userId] = { ...state, executor_id: executorId, step: 'task_deadline' };
  
  ctx.reply('📅 <b>Введите срок выполнения:</b>\n\nВ формате: ДД.ММ.ГГГГ\nНапример: 25.03.2026', {
    parse_mode: 'HTML',
    reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
  });
  
  ctx.answerCbQuery();
});

bot.action(/^priority_(\w+)/, async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates[userId];
  
  if (!state || state.step !== 'task_priority') return;
  
  const priority = ctx.match[1];
  
  try {
    let userResult = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [userId.toString()]);
    let creatorId;
    if (userResult.rows.length === 0) {
      const newUser = await pool.query('INSERT INTO users (telegram_id, first_name, last_name, username) VALUES ($1, $2, $3, $4) RETURNING id', [userId.toString(), escapeHtml(ctx.from.first_name), escapeHtml(ctx.from.last_name || ''), escapeHtml(ctx.from.username || '')]);
      creatorId = newUser.rows[0].id;
    } else {
      creatorId = userResult.rows[0].id;
    }
    
    const parts = state.deadline.split('.');
    const deadline = `${parts[2]}-${parts[1]}-${parts[0]}`;
    
    const result = await pool.query('INSERT INTO tasks (title, description, creator_id, executor_id, deadline, priority, status) VALUES ($1,$2,$3,$4,$5,$6,\'pending\') RETURNING *', [escapeHtml(state.title), escapeHtml(state.description), creatorId, state.executor_id, deadline, priority]);
    
    delete userStates[userId];
    
    ctx.reply(`✅ <b>Поручение #${result.rows[0].id} создано!</b>\n\n📋 ${escapeHtml(state.title)}\n📅 Срок: ${state.deadline}\n🔥 Приоритет: ${priority}`, {
      parse_mode: 'HTML',
      reply_markup: Markup.removeKeyboard()
    });
    
    const executor = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [state.executor_id]);
    if (executor.rows.length > 0) {
      await bot.telegram.sendMessage(executor.rows[0].telegram_id, `🔔 <b>Новое поручение #${result.rows[0].id}</b>\n\n📋 ${escapeHtml(state.title)}\n📝 ${escapeHtml(state.description)}\n📅 Срок: ${state.deadline}\n🔥 Приоритет: ${priority}\n\n👤 От: ${escapeHtml(ctx.from.first_name)}`, { parse_mode: 'HTML' });
    }
    
    ctx.answerCbQuery();
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^approve_(\d+)/, async (ctx) => {
  const approvalId = parseInt(ctx.match[1]);
  
  try {
    await pool.query('UPDATE approvals SET status = \'approved\', updated_at = NOW() WHERE id = $1', [approvalId]);
    
    const accountants = await pool.query('SELECT id, first_name, last_name FROM users WHERE is_active = true AND role = \'accountant\'');
    
    let keyboard = [];
    if (accountants.rows.length > 0) {
      keyboard = accountants.rows.map(u => [Markup.button.callback(`💸 ${u.first_name} ${u.last_name} (на оплату)`, `payment_${approvalId}_${u.id}`)]);
      keyboard.push([Markup.button.callback('⏭ Пропустить', 'payment_skip_' + approvalId)]);
    }
    
    ctx.editMessageText(`✅ <b>СОГЛАСОВАНО #${approvalId}</b>\n\nСогласование одобрено!\n\n💸 <b>Отправить на оплату?</b>\n\nВыберите бухгалтера или пропустите:`, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(keyboard)
    });
    
    const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
    const creator = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [approval.rows[0].creator_id]);
    
    if (creator.rows.length > 0) {
      await bot.telegram.sendMessage(creator.rows[0].telegram_id, `✅ Ваше согласование #${approvalId} <b>одобрено!</b>`, { parse_mode: 'HTML' });
    }
  } catch (e) {
    ctx.answerCbQuery('Ошибка при согласовании');
  }
});

bot.action(/^payment_(\d+)_(\d+)/, async (ctx) => {
  const approvalId = parseInt(ctx.match[1]);
  const paymentToId = parseInt(ctx.match[2]);
  
  try {
    await pool.query('UPDATE approvals SET payment_sent_to = $1, payment_status = \'sent\', updated_at = NOW() WHERE id = $2', [paymentToId, approvalId]);
    
    const accountant = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [paymentToId]);
    const approval = await pool.query('SELECT * FROM approvals WHERE id = $1', [approvalId]);
    
    if (accountant.rows.length > 0) {
      await bot.telegram.sendMessage(accountant.rows[0].telegram_id, `💰 <b>Новый счёт на оплату #${approvalId}</b>\n\n📄 ${approval.rows[0].title}\n💰 ${approval.rows[0].amount} ₽\n📝 ${approval.rows[0].description}\n\n✅ Уже согласовано!`, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Оплачено', `paid_${approvalId}`)]
        ])
      });
    }
    
    ctx.editMessageText(`✅ <b>СОГЛАСОВАНО И ОТПРАВЛЕНО НА ОПЛАТУ</b>\n\nСогласование #${approvalId} одобрено и передано бухгалтеру.`, { parse_mode: 'HTML' });
    
    ctx.answerCbQuery();
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^payment_skip_(\d+)/, async (ctx) => {
  const approvalId = parseInt(ctx.match[1]);
  
  await pool.query('UPDATE approvals SET payment_status = \'not_required\' WHERE id = $1', [approvalId]);
  
  ctx.editMessageText(`✅ <b>СОГЛАСОВАНО #${approvalId}</b>\n\nСогласование одобрено (на оплату не отправлено).`, { parse_mode: 'HTML' });
  
  ctx.answerCbQuery();
});

bot.action(/^paid_(\d+)/, async (ctx) => {
  const approvalId = parseInt(ctx.match[1]);
  
  await pool.query('UPDATE approvals SET status = \'paid\', payment_status = \'paid\' WHERE id = $1', [approvalId]);
  
  ctx.editMessageText(`💰 <b>ОПЛАЧЕНО #${approvalId}</b>\n\nСчёт оплачен!`, { parse_mode: 'HTML' });
  
  const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
  const creator = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [approval.rows[0].creator_id]);
  
  if (creator.rows.length > 0) {
    await bot.telegram.sendMessage(creator.rows[0].telegram_id, `💰 Ваше согласование #${approvalId} <b>оплачено!</b>`);
  }
  
  ctx.answerCbQuery();
});

bot.action(/^reject_(\d+)/, async (ctx) => {
  const approvalId = parseInt(ctx.match[1]);
  
  try {
    await pool.query('UPDATE approvals SET status = \'rejected\', updated_at = NOW() WHERE id = $1', [approvalId]);
    
    ctx.editMessageText(`❌ <b>ОТКЛОНЕНО #${approvalId}</b>\n\nСогласование отклонено.`, { parse_mode: 'HTML' });
    
    const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
    const creator = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [approval.rows[0].creator_id]);
    
    if (creator.rows.length > 0) {
      await bot.telegram.sendMessage(creator.rows[0].telegram_id, `❌ Ваше согласование #${approvalId} <b>отклонено.</b>`, { parse_mode: 'HTML' });
    }
  } catch (e) {
    ctx.answerCbQuery('Ошибка при отклонении');
  }
});

bot.action(/^cancel$/, async (ctx) => {
  delete userStates[ctx.from.id];
  ctx.reply('❌ Отменено', { reply_markup: Markup.removeKeyboard() });
  ctx.answerCbQuery();
});

// ========== ЗАПУСК ==========

bot.launch().then(() => {
  console.log('✅ Бот запущен!');
  console.log('📱 Telegram: @Corp_docs_bot');
});

process.on('SIGINT', () => {
  bot.stop('SIGINT');
  console.log('🛑 Бот остановлен');
});

process.on('SIGTERM', () => {
  bot.stop('SIGTERM');
  console.log('🛑 Бот остановлен');
});
