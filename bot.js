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
      ctx.reply(
        '❌ ДОСТУП ЗАПРЕЩЁН\n\n' +
        'Вы не зарегистрированы в системе.\n\n' +
        'Обратитесь к администратору для добавления.'
      );
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
    
    const result = await pool.query(
      'INSERT INTO users (telegram_id, first_name, last_name, username, role, is_active) VALUES ($1, $2, $3, $4, \'employee\', true) RETURNING *',
      [username, firstName, lastName, username]
    );
    
    ctx.reply(
      '✅ Пользователь добавлен:\n\n' +
      '👤 ' + firstName + ' ' + lastName + '\n' +
      '@' + username + '\n' +
      'ID: ' + result.rows[0].id + '\n\n' +
      'Пользователь может начать работу с ботом.'
    );
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
        'После подтверждения вы получите доступ.'
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
    
    if (!user.rows[0].is_active) {
      return ctx.reply('⏳ Ваша регистрация ещё не активирована.');
    }
    
    await pool.query('UPDATE users SET last_seen = NOW() WHERE telegram_id = $1', [telegramId]);
    
    ctx.reply(
      '👋 Добро пожаловать, ' + safeString(ctx.from.first_name) + '!\n\n' +
      '📋 Корпоративный Документооборот\n\n' +
      'Команды:\n' +
      '/new_approval — Согласование\n' +
      '/new_task — Поручение\n' +
      '/my_tasks — Мои задачи\n' +
      '/my_approvals — Мои согласования\n' +
      '/my_errands — Мои поручения\n' +
      '/help — Помощь\n\n' +
      'Админ:\n' +
      '/adduser — Добавить\n' +
      '/removeuser — Удалить\n' +
      '/listusers — Список'
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
    '/new_approval — Создать согласование\n' +
    '/new_task — Создать поручение\n' +
    '/my_tasks — Мои задачи\n' +
    '/my_approvals — Мои согласования\n' +
    '/my_errands — Мои поручения'
  );
});

// ========== СОГЛАСОВАНИЯ ==========

bot.command('new_approval', async (ctx) => {
  const user = await checkAccess(ctx);
  if (!user) return;
  
  userStates[ctx.from.id] = { step: 'approval_title' };
  ctx.reply('📄 Введите название документа:', {
    reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
  });
});

bot.command('my_approvals', async (ctx) => {
  const user = await checkAccess(ctx);
  if (!user) return;
  
  try {
    const result = await pool.query(
      'SELECT a.*, u1.first_name as approver_name FROM approvals a LEFT JOIN users u1 ON a.approver_id = u1.id WHERE a.creator_id = $1 ORDER BY a.created_at DESC LIMIT 20',
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
  ctx.reply('✅ Введите название задачи:', {
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
    
    let message = '📋 Ваши задачи:\n\n';
    result.rows.forEach((t, i) => {
      const emoji = { low: '🟢', medium: '🟡', high: '🔴' }[t.priority] || '⚪';
      message += (i+1) + '. ' + emoji + ' ' + t.title + '\n';
      message += '   📅 ' + new Date(t.deadline).toLocaleDateString('ru-RU') + '\n';
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
    
    let message = '📝 Ваши поручения:\n\n';
    result.rows.forEach((t, i) => {
      const emoji = { low: '🟢', medium: '🟡', high: '🔴' }[t.priority] || '⚪';
      message += (i+1) + '. ' + emoji + ' ' + t.title + '\n';
      message += '   👤 ' + safeString(t.executor_name) + '\n';
      message += '   📅 ' + new Date(t.deadline).toLocaleDateString('ru-RU') + '\n';
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
      return ctx.reply('📝 Введите описание:', {
        reply_markup: Markup.keyboard([['❌ Отмена']]).resize().oneTime()
      });
    }
    
    if (state?.step === 'approval_description') {
      userStates[userId] = { ...state, description: text, step: 'approval_file' };
      return ctx.reply('📎 Прикрепить файл?\n\nОтправьте файл или напишите "нет"', {
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
    
    if (state?.step === 'task_title') {
      userStates[userId] = { ...state, title: text, step: 'task_description' };
      return ctx.reply('📝 Введите описание задачи:', {
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

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

async function showApproverList(ctx, state) {
  try {
    console.log('🔍 showApproverList called');
    const result = await pool.query('SELECT id, first_name, last_name, username FROM users WHERE is_active = true ORDER BY id');
    
    console.log('👥 Found users:', result.rows.length);
    
    if (result.rows.length === 0) {
      return ctx.reply('❌ Нет доступных согласующих.\n\nДобавьте пользователей: /adduser');
    }
    
    const keyboard = [];
    result.rows.forEach(u => {
      const name = safeString(u.first_name) + ' ' + safeString(u.last_name);
      const username = u.username ? ' @' + u.username : '';
      keyboard.push([Markup.button.callback(name + username, 'approver_' + u.id)]);
    });
    keyboard.push([Markup.button.callback('❌ Отмена', 'cancel')]);
    
    console.log('⌨️ Keyboard buttons:', keyboard.length);
    
    await ctx.reply('👤 Выберите согласующего:', {
      reply_markup: Markup.inlineKeyboard(keyboard)
    });
    
    console.log('✅ Message sent');
  } catch (e) {
    console.error('❌ showApproverList error:', e);
    ctx.reply('❌ Ошибка при загрузке списка: ' + e.message);
  }
}

async function showExecutorList(ctx, state) {
  try {
    const result = await pool.query('SELECT id, first_name, last_name, username FROM users WHERE is_active = true ORDER BY id');
    
    if (result.rows.length === 0) {
      return ctx.reply('❌ Нет доступных исполнителей.\n\nДобавьте пользователей: /adduser');
    }
    
    const keyboard = [];
    result.rows.forEach(u => {
      const name = safeString(u.first_name) + ' ' + safeString(u.last_name);
      const username = u.username ? ' @' + u.username : '';
      keyboard.push([Markup.button.callback(name + username, 'executor_' + u.id)]);
    });
    keyboard.push([Markup.button.callback('❌ Отмена', 'cancel')]);
    
    await ctx.reply('👤 Выберите исполнителя:', {
      reply_markup: Markup.inlineKeyboard(keyboard)
    });
  } catch (e) {
    console.error('showExecutorList error:', e);
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
    
    ctx.reply('✅ Согласование #' + result.rows[0].id + ' создано!\n\n📄 ' + title);
  } catch (e) {
    console.error('createApprovalFromFile error:', e);
    ctx.reply('❌ Ошибка: ' + e.message);
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
    
    await ctx.reply('✅ Согласование #' + result.rows[0].id + ' создано!', {
      reply_markup: Markup.removeKeyboard()
    });
    
    const approver = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [approverId]);
    if (approver.rows.length > 0) {
      await bot.telegram.sendMessage(
        approver.rows[0].telegram_id,
        '🔔 Новое согласование #' + result.rows[0].id + '\n\n' +
        '📄 ' + state.title + '\n' +
        '💰 ' + state.amount + ' ₽\n\n' +
        '👤 От: ' + safeString(ctx.from.first_name),
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ Согласовать', 'approve_' + result.rows[0].id)],
            [Markup.button.callback('❌ Отклонить', 'reject_' + result.rows[0].id)]
          ])
        }
      );
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
    
    await ctx.reply('📅 Введите срок (ДД.ММ.ГГГГ):\n\nПример: 25.03.2026', {
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
    
    await ctx.reply('✅ Поручение #' + result.rows[0].id + ' создано!', {
      reply_markup: Markup.removeKeyboard()
    });
    
    const executor = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [state.executor_id]);
    if (executor.rows.length > 0) {
      await bot.telegram.sendMessage(
        executor.rows[0].telegram_id,
        '🔔 Новое поручение #' + result.rows[0].id + '\n\n' +
        '📋 ' + state.title + '\n' +
        '📅 Срок: ' + state.deadline + '\n\n' +
        '👤 От: ' + safeString(ctx.from.first_name)
      );
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
    
    await pool.query('UPDATE approvals SET status = \'approved\' WHERE id = $1', [approvalId]);
    
    const users = await pool.query('SELECT id, first_name, last_name FROM users WHERE is_active = true');
    
    const keyboard = users.rows.map(u => 
      [Markup.button.callback('💸 ' + safeString(u.first_name) + ' (на оплату)', 'payment_' + approvalId + '_' + u.id)]
    );
    keyboard.push([Markup.button.callback('⏭ Пропустить', 'payment_skip_' + approvalId)]);
    
    await ctx.editMessageText('✅ СОГЛАСОВАНО #' + approvalId + '\n\nОтправить на оплату?', {
      reply_markup: Markup.inlineKeyboard(keyboard)
    });
    
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
    
    await pool.query('UPDATE approvals SET payment_sent_to = $1, payment_status = \'sent\' WHERE id = $2', [paymentToId, approvalId]);
    
    const accountant = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [paymentToId]);
    if (accountant.rows.length > 0) {
      await bot.telegram.sendMessage(
        accountant.rows[0].telegram_id,
        '💰 Счёт на оплату #' + approvalId + '\n\nТребуется оплата.'
      );
    }
    
    await ctx.editMessageText('✅ Отправлено на оплату');
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('payment action error:', e);
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^payment_skip_(\d+)/, async (ctx) => {
  try {
    const approvalId = parseInt(ctx.match[1]);
    await pool.query('UPDATE approvals SET payment_status = \'not_required\' WHERE id = $1', [approvalId]);
    await ctx.editMessageText('✅ СОГЛАСОВАНО #' + approvalId);
    await ctx.answerCbQuery();
  } catch (e) {
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^reject_(\d+)/, async (ctx) => {
  try {
    const approvalId = parseInt(ctx.match[1]);
    await pool.query('UPDATE approvals SET status = \'rejected\' WHERE id = $1', [approvalId]);
    await ctx.editMessageText('❌ ОТКЛОНЕНО #' + approvalId);
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
}).catch(err => {
  console.error('❌ Ошибка запуска:', err);
});

process.on('SIGINT', () => bot.stop('SIGINT'));
process.on('SIGTERM', () => bot.stop('SIGTERM'));
