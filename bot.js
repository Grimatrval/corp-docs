require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const userStates = {};

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function safeString(str) {
  return str ? String(str) : '';
}

async function checkAccess(ctx) {
  const telegramId = ctx.from.id.toString();
  try {
    const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1 AND is_active = true', [telegramId]);
    if (user.rows.length === 0) {
      ctx.reply('❌ ДОСТУП ЗАПРЕЩЁН\n\nВы не зарегистрированы в системе.\n\nОбратитесь к администратору.');
      return false;
    }
    return user.rows[0];
  } catch (e) {
    console.error('checkAccess error:', e);
    return false;
  }
}

// ========== АДМИН КОМАНДЫ ==========

bot.command('adduser', async (ctx) => {
  try {
    const user = await checkAccess(ctx);
    if (!user) return;
    
    if (user.role !== 'admin') {
      return ctx.reply('❌ Только администратор может добавлять пользователей');
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 4) {
      return ctx.reply('❌ Использование: /adduser @username Имя Фамилия\n\nПример: /adduser @ivanov Иван Иванов');
    }
    
    const username = args[1].replace('@', '');
    const firstName = args[2];
    const lastName = args[3];
    
    // Пробуем получить chat_id по username
    try {
      const chat = await bot.telegram.getChat('@' + username);
      const telegramId = chat.id.toString();
      
      const result = await pool.query(
        'INSERT INTO users (telegram_id, first_name, last_name, username, role, is_active) VALUES ($1, $2, $3, $4, \'employee\', true) ON CONFLICT (telegram_id) DO UPDATE SET first_name = $2, last_name = $3, username = $4, is_active = true RETURNING *',
        [telegramId, firstName, lastName, username]
      );
      
      ctx.reply(
        '✅ Пользователь добавлен:\n\n' +
        '👤 ' + firstName + ' ' + lastName + '\n' +
        '@' + username + '\n' +
        'ID: ' + result.rows[0].id + '\n' +
        'Telegram ID: ' + telegramId + '\n\n' +
        'Пользователь может начать работу с ботом.'
      );
    } catch (e) {
      ctx.reply(
        '⚠️ Пользователь добавлен без Telegram ID\n\n' +
        '👤 ' + firstName + ' ' + lastName + '\n' +
        '@' + username + '\n\n' +
        '❗ Не удалось получить Telegram ID.\n' +
        'Пользователь должен написать боту /start для активации.'
      );
      
      await pool.query(
        'INSERT INTO users (telegram_id, first_name, last_name, username, role, is_active) VALUES ($1, $2, $3, $4, \'employee\', false) ON CONFLICT (telegram_id) DO UPDATE SET first_name = $2, last_name = $3, username = $4 RETURNING *',
        [username, firstName, lastName, username]
      );
    }
  } catch (e) {
    console.error('adduser error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

bot.command('removeuser', async (ctx) => {
  try {
    const user = await checkAccess(ctx);
    if (!user) return;
    
    if (user.role !== 'admin') {
      return ctx.reply('❌ Только администратор может удалять пользователей');
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('❌ Использование: /removeuser @username или ID');
    }
    
    const identifier = args[1].replace('@', '');
    const result = await pool.query(
      'UPDATE users SET is_active = false WHERE (username = $1 OR id = $2) AND role != \'admin\' RETURNING *',
      [identifier, parseInt(identifier) || 0]
    );
    
    if (result.rows.length > 0) {
      ctx.reply('✅ Пользователь деактивирован:\n' + safeString(result.rows[0].first_name) + ' ' + safeString(result.rows[0].last_name));
    } else {
      ctx.reply('❌ Пользователь не найден или это администратор');
    }
  } catch (e) {
    console.error('removeuser error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

bot.command('listusers', async (ctx) => {
  try {
    const user = await checkAccess(ctx);
    if (!user) return;
    
    const result = await pool.query('SELECT * FROM users WHERE is_active = true ORDER BY role, id');
    
    if (result.rows.length === 0) {
      return ctx.reply('📭 Нет активных пользователей');
    }
    
    let message = '👥 Активные пользователи:\n\n';
    result.rows.forEach((u, i) => {
      const roleEmoji = { admin: '👑', director: '👔', accountant: '💰', employee: '👤' }[u.role] || '👤';
      message += (i+1) + '. ' + roleEmoji + ' ' + safeString(u.first_name) + ' ' + safeString(u.last_name) + ' (@' + (u.username || 'нет') + ')\n';
      message += '   Роль: ' + u.role + '\n\n';
    });
    
    ctx.reply(message);
  } catch (e) {
    console.error('listusers error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

// ========== ОСНОВНЫЕ КОМАНДЫ ==========

bot.start(async (ctx) => {
  try {
    const telegramId = ctx.from.id.toString();
    const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
    
    if (user.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (telegram_id, first_name, last_name, username, role, is_active) VALUES ($1, $2, $3, $4, \'employee\', false)',
        [telegramId, safeString(ctx.from.first_name), safeString(ctx.from.last_name), safeString(ctx.from.username)]
      );
      
      ctx.reply(
        '👋 Добро пожаловать, ' + safeString(ctx.from.first_name) + '!\n\n' +
        '⚠️ ВАША РЕГИСТРАЦИЯ НА РАССМОТРЕНИИ\n\n' +
        'Администратор получит уведомление.\n' +
        'После подтверждения вы получите доступ.\n\n' +
        'Команда /help — помощь'
      );
      
      const admins = await pool.query('SELECT telegram_id FROM users WHERE role = \'admin\' AND is_active = true');
      admins.rows.forEach(async admin => {
        try {
          await bot.telegram.sendMessage(
            admin.telegram_id,
            '🔔 Новый пользователь:\n\n' +
            '👤 ' + safeString(ctx.from.first_name) + '\n' +
            'ID: ' + telegramId
          );
        } catch (e) { /* ignore */ }
      });
      return;
    }
    
    // Активируем пользователя если был неактивен
    if (!user.rows[0].is_active) {
      await pool.query('UPDATE users SET is_active = true WHERE telegram_id = $1', [telegramId]);
    }
    
    await pool.query('UPDATE users SET last_seen = NOW() WHERE telegram_id = $1', [telegramId]);
    
    ctx.reply(
      '👋 Добро пожаловать, ' + safeString(ctx.from.first_name) + '!\n\n' +
      '📋 Корпоративный Документооборот\n\n' +
      'Команды:\n' +
      '/new_approval — Создать согласование\n' +
      '/new_task — Создать поручение\n' +
      '/my_tasks — Мои задачи\n' +
      '/my_approvals — Мои согласования\n' +
      '/my_errands — Мои поручения\n' +
      '/help — Помощь\n\n' +
      'Админ:\n' +
      '/adduser — Добавить пользователя\n' +
      '/removeuser — Удалить пользователя\n' +
      '/listusers — Список пользователей'
    );
  } catch (e) {
    console.error('start error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

bot.help(async (ctx) => {
  const user = await checkAccess(ctx);
  if (!user) return;
  
  ctx.reply(
    '📖 Помощь\n\n' +
    'СОЗДАНИЕ СОГЛАСОВАНИЯ:\n' +
    '/new_approval — следуйте инструкциям\n' +
    'Или отправьте файл с подписью "Согласование: название"\n\n' +
    'СОЗДАНИЕ ПОРУЧЕНИЯ:\n' +
    '/new_task — следуйте инструкциям\n\n' +
    'ПРОСМОТР:\n' +
    '/my_tasks — ваши активные задачи\n' +
    '/my_approvals — ваши согласования\n' +
    '/my_errands — ваши поручения (как создатель)\n\n' +
    'Для согласующих:\n' +
    'После согласования можно переслать на оплату\n\n' +
    'Для администратора:\n' +
    '/adduser @username Имя Фамилия\n' +
    '/removeuser @username\n' +
    '/listusers — список всех'
  );
});

// ========== СОГЛАСОВАНИЯ ==========

bot.command('new_approval', async (ctx) => {
  const user = await checkAccess(ctx);
  if (!user) return;
  
  userStates[ctx.from.id] = { step: 'approval_title' };
  ctx.reply('📄 Введите название документа:\n\nНапример: Счёт на оплату от ООО Поставщик', {
    reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
  });
});

bot.command('my_approvals', async (ctx) => {
  const user = await checkAccess(ctx);
  if (!user) return;
  
  try {
    const result = await pool.query(
      'SELECT a.*, u1.first_name as approver_name, u2.first_name as payment_to FROM approvals a LEFT JOIN users u1 ON a.approver_id = u1.id LEFT JOIN users u2 ON a.payment_sent_to = u2.id WHERE a.creator_id = $1 ORDER BY a.created_at DESC LIMIT 20',
      [user.id]
    );
    
    if (result.rows.length === 0) {
      return ctx.reply('📭 У вас нет согласований');
    }
    
    let message = '📋 Ваши согласования:\n\n';
    result.rows.forEach((a, i) => {
      const emoji = { pending: '🟡', approved: '✅', rejected: '❌', paid: '💰' }[a.status] || '⚪';
      message += (i+1) + '. ' + emoji + ' ' + a.title + '\n';
      message += '   💰 ' + a.amount + ' ₽ | ' + a.status + '\n';
      message += '   👤 ' + safeString(a.approver_name) + '\n';
      if (a.payment_sent_to) {
        message += '   💸 Отправлено на оплату: ' + safeString(a.payment_to) + '\n';
      }
      message += '   📅 ' + new Date(a.created_at).toLocaleDateString('ru-RU') + '\n\n';
    });
    
    ctx.reply(message);
  } catch (e) {
    console.error('my_approvals error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

// ========== ПОРУЧЕНИЯ ==========

bot.command('new_task', async (ctx) => {
  const user = await checkAccess(ctx);
  if (!user) return;
  
  userStates[ctx.from.id] = { step: 'task_title' };
  ctx.reply('✅ Введите название задачи:\n\nНапример: Подготовить отчёт за март', {
    reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
  });
});

bot.command('my_tasks', async (ctx) => {
  const user = await checkAccess(ctx);
  if (!user) return;
  
  try {
    const result = await pool.query(
      'SELECT t.*, u.first_name as creator_name FROM tasks t LEFT JOIN users u ON t.creator_id = u.id WHERE t.executor_id = $1 AND t.status != \'completed\' ORDER BY t.deadline ASC',
      [user.id]
    );
    
    if (result.rows.length === 0) {
      return ctx.reply('📭 У вас нет активных задач');
    }
    
    let message = '📋 Ваши активные задачи:\n\n';
    result.rows.forEach((t, i) => {
      const emoji = { low: '🟢', medium: '🟡', high: '🔴' }[t.priority] || '⚪';
      message += (i+1) + '. ' + emoji + ' ' + t.title + '\n';
      message += '   📅 До: ' + new Date(t.deadline).toLocaleDateString('ru-RU') + '\n';
      message += '   📌 ' + t.status + '\n';
      message += '   👤 ' + safeString(t.creator_name) + '\n\n';
    });
    
    ctx.reply(message);
  } catch (e) {
    console.error('my_tasks error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

bot.command('my_errands', async (ctx) => {
  const user = await checkAccess(ctx);
  if (!user) return;
  
  try {
    const result = await pool.query(
      'SELECT t.*, u.first_name as executor_name FROM tasks t LEFT JOIN users u ON t.executor_id = u.id WHERE t.creator_id = $1 ORDER BY t.created_at DESC LIMIT 20',
      [user.id]
    );
    
    if (result.rows.length === 0) {
      return ctx.reply('📭 Вы не создавали поручений');
    }
    
    let message = '📝 Ваши поручения (как создатель):\n\n';
    result.rows.forEach((t, i) => {
      const emoji = { low: '🟢', medium: '🟡', high: '🔴' }[t.priority] || '⚪';
      message += (i+1) + '. ' + emoji + ' ' + t.title + '\n';
      message += '   👤 ' + safeString(t.executor_name) + '\n';
      message += '   📅 До: ' + new Date(t.deadline).toLocaleDateString('ru-RU') + '\n';
      message += '   📌 ' + t.status + '\n\n';
    });
    
    ctx.reply(message);
  } catch (e) {
    console.error('my_errands error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

// ========== ОБРАБОТКА ТЕКСТА ==========

bot.on('text', async (ctx) => {
  try {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    
    if (text === '❌ Отмена') {
      delete userStates[userId];
      return ctx.reply('❌ Отменено', { reply_markup: Markup.removeKeyboard() });
    }
    
    const user = await checkAccess(ctx);
    if (!user) return;
    
    const state = userStates[userId];
    
    if (state?.step === 'approval_title') {
      userStates[userId] = { ...state, title: text, step: 'approval_amount' };
      return ctx.reply('💰 Введите сумму (в рублях):\n\nНапример: 150000 или 0', {
        reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
      });
    }
    
    if (state?.step === 'approval_amount') {
      userStates[userId] = { ...state, amount: parseFloat(text) || 0, step: 'approval_description' };
      return ctx.reply('📝 Введите описание:\n\nОпишите что нужно согласовать', {
        reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
      });
    }
    
    if (state?.step === 'approval_description') {
      userStates[userId] = { ...state, description: text, step: 'approval_file' };
      return ctx.reply('📎 Прикрепить файл?\n\nОтправьте файл или напишите "нет" чтобы пропустить', {
        reply_markup: Markup.keyboard([['❌ Отмена'], ['нет']]).resize().oneTime()
      });
    }
    
    if (state?.step === 'approval_file') {
      if (text.toLowerCase() === 'нет') {
        userStates[userId] = { ...state, file_id: null, file_type: null, step: 'approval_approver_list' };
        return showApproverList(ctx, state);
      }
      return;
    }
    
    if (state?.step === 'task_title') {
      userStates[userId] = { ...state, title: text, step: 'task_description' };
      return ctx.reply('📝 Введите описание задачи:\n\nПодробно опишите что нужно сделать', {
        reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
      });
    }
    
    if (state?.step === 'task_description') {
      userStates[userId] = { ...state, description: text, step: 'task_executor_list' };
      return showExecutorList(ctx, state);
    }
    
    if (state?.step === 'task_deadline') {
      userStates[userId] = { ...state, deadline: text, step: 'task_priority' };
      return ctx.reply('🔥 Выберите приоритет:', {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🟢 Низкий', 'priority_low')],
          [Markup.button.callback('🟡 Средний', 'priority_medium')],
          [Markup.button.callback('🔴 Высокий', 'priority_high')]
        ])
      });
    }
  } catch (e) {
    console.error('text handler error:', e);
  }
});

// ========== ОБРАБОТКА ФАЙЛОВ ==========

bot.on('document', async (ctx) => {
  const user = await checkAccess(ctx);
  if (!user) return;
  
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
  const user = await checkAccess(ctx);
  if (!user) return;
  
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
  const user = await checkAccess(ctx);
  if (!user) return;
  
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
  const user = await checkAccess(ctx);
  if (!user) return;
  
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
    console.log('🔍 showApproverList called for user:', ctx.from.id);
    
    const result = await pool.query('SELECT id, first_name, last_name, username FROM users WHERE is_active = true ORDER BY id');
    
    console.log('👥 Found users:', result.rows.length);
    
    if (result.rows.length === 0) {
      return ctx.reply('❌ Нет доступных согласующих.\n\nДобавьте пользователей: /adduser');
    }
    
    const buttons = [];
    result.rows.forEach(u => {
      const name = safeString(u.first_name) + ' ' + safeString(u.last_name);
      const username = u.username ? ' @' + u.username : '';
      buttons.push([Markup.button.callback(name + username, 'approver_' + u.id)]);
    });
    buttons.push([Markup.button.callback('❌ Отмена', 'cancel')]);
    
    console.log('⌨️ Created buttons:', buttons.length);
    
    await ctx.telegram.sendMessage(
      ctx.chat.id,
      '👤 Выберите согласующего:\n\nНажмите на пользователя:',
      {
        reply_markup: {
          inline_keyboard: buttons
        }
      }
    );
    
    console.log('✅ Message sent successfully');
  } catch (e) {
    console.error('❌ showApproverList error:', e);
    ctx.reply('❌ Ошибка при загрузке списка: ' + e.message);
  }
}

async function showExecutorList(ctx, state) {
  try {
    console.log('🔍 showExecutorList called for user:', ctx.from.id);
    
    const result = await pool.query('SELECT id, first_name, last_name, username FROM users WHERE is_active = true ORDER BY id');
    
    console.log('👥 Found users:', result.rows.length);
    
    if (result.rows.length === 0) {
      return ctx.reply('❌ Нет доступных исполнителей.\n\nДобавьте пользователей: /adduser');
    }
    
    const buttons = [];
    result.rows.forEach(u => {
      const name = safeString(u.first_name) + ' ' + safeString(u.last_name);
      const username = u.username ? ' @' + u.username : '';
      buttons.push([Markup.button.callback(name + username, 'executor_' + u.id)]);
    });
    buttons.push([Markup.button.callback('❌ Отмена', 'cancel')]);
    
    console.log('⌨️ Created buttons:', buttons.length);
    
    await ctx.telegram.sendMessage(
      ctx.chat.id,
      '👤 Выберите исполнителя:\n\nНажмите на пользователя:',
      {
        reply_markup: {
          inline_keyboard: buttons
        }
      }
    );
    
    console.log('✅ Message sent successfully');
  } catch (e) {
    console.error('❌ showExecutorList error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
  }
}

async function createApprovalFromFile(ctx, caption, fileId, fileName, fileType) {
  try {
    const user = await checkAccess(ctx);
    if (!user) return;
    
    const title = caption.replace(/согласование:|согласуй:/i, '').trim();
    
    const result = await pool.query(
      'INSERT INTO approvals (title, description, creator_id, file_id, file_type, status) VALUES ($1, $2, $3, $4, $5, \'pending\') RETURNING *',
      [title, 'Файл: ' + fileName, user.id, fileId, fileType]
    );
    
    ctx.reply('✅ Согласование #' + result.rows[0].id + ' создано!\n\n📄 ' + title + '\n📎 Файл: ' + fileName);
  } catch (e) {
    console.error('createApprovalFromFile error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
  }
}

// ========== ОТПРАВКА УВЕДОМЛЕНИЙ ==========

async function sendNotification(telegramId, message, keyboard = null) {
  try {
    // Проверяем что telegramId это число
    if (!telegramId || isNaN(parseInt(telegramId))) {
      console.log('⚠️ Invalid telegram_id:', telegramId);
      return false;
    }
    
    await bot.telegram.sendMessage(
      telegramId.toString(),
      message,
      keyboard ? { reply_markup: keyboard } : {}
    );
    
    console.log('✅ Notification sent to:', telegramId);
    return true;
  } catch (e) {
    console.error('❌ sendNotification error:', e.message);
    return false;
  }
}

// ========== CALLBACK QUERY ==========

bot.action(/^approver_(\d+)/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const state = userStates[userId];
    
    console.log('approver callback:', ctx.match[1], 'state:', state);
    
    if (!state || state.step !== 'approval_approver_list') {
      return ctx.answerCbQuery('Сначала создайте согласование: /new_approval');
    }
    
    const user = await checkAccess(ctx);
    if (!user) return;
    
    const approverId = parseInt(ctx.match[1]);
    
    const result = await pool.query(
      'INSERT INTO approvals (title, description, amount, creator_id, approver_id, file_id, file_type, status) VALUES ($1,$2,$3,$4,$5,$6,$7,\'pending\') RETURNING *',
      [state.title, state.description, state.amount, user.id, approverId, state.file_id, state.file_type]
    );
    
    delete userStates[userId];
    
    await ctx.reply('✅ Согласование #' + result.rows[0].id + ' создано!\n\n📄 ' + state.title + '\n💰 ' + state.amount + ' ₽', {
      reply_markup: Markup.removeKeyboard()
    });
    
    // Отправляем уведомление согласующему
    const approver = await pool.query('SELECT telegram_id, first_name, username FROM users WHERE id = $1', [approverId]);
    if (approver.rows.length > 0) {
      const telegramId = approver.rows[0].telegram_id;
      
      // Проверяем что telegram_id это число
      if (telegramId && !isNaN(parseInt(telegramId))) {
        await sendNotification(
          telegramId,
          '🔔 Новое согласование #' + result.rows[0].id + '\n\n' +
          '📄 ' + state.title + '\n' +
          '💰 ' + state.amount + ' ₽\n' +
          '📝 ' + state.description + '\n\n' +
          '👤 От: ' + safeString(ctx.from.first_name),
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Согласовать', 'approve_' + result.rows[0].id)],
            [Markup.button.callback('❌ Отклонить', 'reject_' + result.rows[0].id)]
          ])
        );
      } else {
        console.log('⚠️ Cannot notify approver - invalid telegram_id:', telegramId);
      }
    }
    
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('approver action error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^executor_(\d+)/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const state = userStates[userId];
    
    if (!state || state.step !== 'task_executor_list') {
      return ctx.answerCbQuery('Сначала создайте поручение: /new_task');
    }
    
    const executorId = parseInt(ctx.match[1]);
    userStates[userId] = { ...state, executor_id: executorId, step: 'task_deadline' };
    
    await ctx.reply('📅 Введите срок выполнения:\n\nВ формате: ДД.ММ.ГГГГ\nНапример: 25.03.2026', {
      reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
    });
    
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('executor action error:', e);
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^priority_(\w+)/, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const state = userStates[userId];
    
    if (!state || state.step !== 'task_priority') return;
    
    const priority = ctx.match[1];
    const user = await checkAccess(ctx);
    if (!user) return;
    
    const parts = state.deadline.split('.');
    const deadline = parts[2] + '-' + parts[1] + '-' + parts[0];
    
    const result = await pool.query(
      'INSERT INTO tasks (title, description, creator_id, executor_id, deadline, priority, status) VALUES ($1,$2,$3,$4,$5,$6,\'pending\') RETURNING *',
      [state.title, state.description, user.id, state.executor_id, deadline, priority]
    );
    
    delete userStates[userId];
    
    await ctx.reply('✅ Поручение #' + result.rows[0].id + ' создано!\n\n📋 ' + state.title + '\n📅 Срок: ' + state.deadline + '\n🔥 Приоритет: ' + priority, {
      reply_markup: Markup.removeKeyboard()
    });
    
    const executor = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [state.executor_id]);
    if (executor.rows.length > 0) {
      const telegramId = executor.rows[0].telegram_id;
      
      if (telegramId && !isNaN(parseInt(telegramId))) {
        await sendNotification(
          telegramId,
          '🔔 Новое поручение #' + result.rows[0].id + '\n\n' +
          '📋 ' + state.title + '\n' +
          '📝 ' + state.description + '\n' +
          '📅 Срок: ' + state.deadline + '\n' +
          '🔥 Приоритет: ' + priority + '\n\n' +
          '👤 От: ' + safeString(ctx.from.first_name)
        );
      }
    }
    
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('priority action error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^approve_(\d+)/, async (ctx) => {
  try {
    const approvalId = parseInt(ctx.match[1]);
    
    await pool.query('UPDATE approvals SET status = \'approved\', updated_at = NOW() WHERE id = $1', [approvalId]);
    
    const users = await pool.query('SELECT id, first_name, last_name, telegram_id FROM users WHERE is_active = true ORDER BY id');
    
    const keyboard = users.rows.map(u => 
      [Markup.button.callback('💸 ' + safeString(u.first_name) + ' ' + safeString(u.last_name) + ' (на оплату)', 'payment_' + approvalId + '_' + u.id)]
    );
    keyboard.push([Markup.button.callback('⏭ Пропустить', 'payment_skip_' + approvalId)]);
    
    await ctx.editMessageText('✅ СОГЛАСОВАНО #' + approvalId + '\n\nСогласование одобрено!\n\n💸 Отправить на оплату?\n\nВыберите получателя:', {
      reply_markup: Markup.inlineKeyboard(keyboard)
    });
    
    const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
    const creator = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [approval.rows[0].creator_id]);
    
    if (creator.rows.length > 0 && creator.rows[0].telegram_id && !isNaN(parseInt(creator.rows[0].telegram_id))) {
      await sendNotification(creator.rows[0].telegram_id, '✅ Ваше согласование #' + approvalId + ' одобрено!');
    }
    
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('approve action error:', e);
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^payment_(\d+)_(\d+)/, async (ctx) => {
  try {
    const approvalId = parseInt(ctx.match[1]);
    const paymentToId = parseInt(ctx.match[2]);
    
    await pool.query('UPDATE approvals SET payment_sent_to = $1, payment_status = \'sent\', updated_at = NOW() WHERE id = $2', [paymentToId, approvalId]);
    
    const accountant = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [paymentToId]);
    const approval = await pool.query('SELECT * FROM approvals WHERE id = $1', [approvalId]);
    
    if (accountant.rows.length > 0 && accountant.rows[0].telegram_id && !isNaN(parseInt(accountant.rows[0].telegram_id))) {
      await sendNotification(
        accountant.rows[0].telegram_id,
        '💰 Новый счёт на оплату #' + approvalId + '\n\n' +
        '📄 ' + approval.rows[0].title + '\n' +
        '💰 ' + approval.rows[0].amount + ' ₽\n' +
        '📝 ' + approval.rows[0].description + '\n\n' +
        '✅ Уже согласовано!',
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Оплачено', 'paid_' + approvalId)]
        ])
      );
    }
    
    await ctx.editMessageText('✅ СОГЛАСОВАНО И ОТПРАВЛЕНО НА ОПЛАТУ\n\nСогласование #' + approvalId + ' одобрено и передано.');
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('payment action error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^payment_skip_(\d+)/, async (ctx) => {
  try {
    const approvalId = parseInt(ctx.match[1]);
    await pool.query('UPDATE approvals SET payment_status = \'not_required\' WHERE id = $1', [approvalId]);
    await ctx.editMessageText('✅ СОГЛАСОВАНО #' + approvalId + '\n\nСогласование одобрено (на оплату не отправлено).');
    await ctx.answerCbQuery();
  } catch (e) {
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^paid_(\d+)/, async (ctx) => {
  try {
    const approvalId = parseInt(ctx.match[1]);
    await pool.query('UPDATE approvals SET status = \'paid\', payment_status = \'paid\' WHERE id = $1', [approvalId]);
    await ctx.editMessageText('💰 ОПЛАЧЕНО #' + approvalId + '\n\nСчёт оплачен!');
    
    const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
    const creator = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [approval.rows[0].creator_id]);
    
    if (creator.rows.length > 0 && creator.rows[0].telegram_id && !isNaN(parseInt(creator.rows[0].telegram_id))) {
      await sendNotification(creator.rows[0].telegram_id, '💰 Ваше согласование #' + approvalId + ' оплачено!');
    }
    
    await ctx.answerCbQuery();
  } catch (e) {
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^reject_(\d+)/, async (ctx) => {
  try {
    const approvalId = parseInt(ctx.match[1]);
    await pool.query('UPDATE approvals SET status = \'rejected\', updated_at = NOW() WHERE id = $1', [approvalId]);
    await ctx.editMessageText('❌ ОТКЛОНЕНО #' + approvalId + '\n\nСогласование отклонено.');
    
    const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
    const creator = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [approval.rows[0].creator_id]);
    
    if (creator.rows.length > 0 && creator.rows[0].telegram_id && !isNaN(parseInt(creator.rows[0].telegram_id))) {
      await sendNotification(creator.rows[0].telegram_id, '❌ Ваше согласование #' + approvalId + ' отклонено.');
    }
    
    await ctx.answerCbQuery();
  } catch (e) {
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^cancel$/, async (ctx) => {
  delete userStates[ctx.from.id];
  await ctx.reply('❌ Отменено', { reply_markup: Markup.removeKeyboard() });
  await ctx.answerCbQuery();
});

// ========== ЗАПУСК ==========

bot.launch().then(() => {
  console.log('✅ Бот запущен!');
  console.log('📱 Telegram: @Corp_docs_bot');
  console.log('⏹  Для остановки: pm2 stop corp-docs-bot');
}).catch(err => {
  console.error('❌ Ошибка запуска:', err);
});

process.on('SIGINT', () => {
  bot.stop('SIGINT');
  console.log('🛑 Бот остановлен (SIGINT)');
});

process.on('SIGTERM', () => {
  bot.stop('SIGTERM');
  console.log('🛑 Бот остановлен (SIGTERM)');
});
