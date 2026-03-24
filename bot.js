require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const userStates = {};

// ========== ПРОВЕРКА ДОСТУПА ==========
async function checkAccess(ctx) {
  const telegramId = ctx.from.id.toString();
  const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1 AND is_active = true', [telegramId]);
  
  if (user.rows.length === 0) {
    ctx.reply('❌ ДОСТУП ЗАПРЕЩЁН\n\nВы не зарегистрированы в системе.\n\nОбратитесь к администратору для добавления в систему.\n\nПосле регистрации вы сможете:\n- Создавать согласования\n- Создавать поручения\n- Просматривать задачи');
    return false;
  }
  
  return user.rows[0];
}

// ========== АДМИН КОМАНДЫ ==========

bot.command('adduser', async (ctx) => {
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
  
  try {
    const result = await pool.query(
      'INSERT INTO users (telegram_id, first_name, last_name, username, role, is_active) VALUES ($1, $2, $3, $4, \'employee\', true) ON CONFLICT (telegram_id) DO UPDATE SET first_name = $2, last_name = $3, username = $4, is_active = true RETURNING *',
      [username, firstName, lastName, username]
    );
    
    ctx.reply('✅ Пользователь добавлен:\n\n👤 ' + firstName + ' ' + lastName + '\n@' + username + '\nID: ' + result.rows[0].id + '\n\nПользователь может начать работу с ботом.');
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

bot.command('removeuser', async (ctx) => {
  const user = await checkAccess(ctx);
  if (!user) return;
  
  if (user.role !== 'admin') {
    return ctx.reply('❌ Только администратор может удалять пользователей');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('❌ Использование: /removeuser @username или ID');
  }
  
  try {
    const identifier = args[1].replace('@', '');
    const result = await pool.query(
      'UPDATE users SET is_active = false WHERE (username = $1 OR id = $2) AND role != \'admin\' RETURNING *',
      [identifier, parseInt(identifier) || 0]
    );
    
    if (result.rows.length > 0) {
      ctx.reply('✅ Пользователь деактивирован:\n' + result.rows[0].first_name + ' ' + result.rows[0].last_name);
    } else {
      ctx.reply('❌ Пользователь не найден или это администратор');
    }
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

bot.command('listusers', async (ctx) => {
  const user = await checkAccess(ctx);
  if (!user) return;
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE is_active = true ORDER BY role, id');
    
    if (result.rows.length === 0) {
      return ctx.reply('📭 Нет активных пользователей');
    }
    
    let message = '👥 Активные пользователи:\n\n';
    result.rows.forEach((u, i) => {
      const roleEmoji = { admin: '👑', director: '👔', accountant: '💰', employee: '👤' }[u.role] || '👤';
      message += (i+1) + '. ' + roleEmoji + ' ' + u.first_name + ' ' + u.last_name + ' (@' + (u.username || 'нет') + ')\n   Роль: ' + u.role + '\n\n';
    });
    
    ctx.reply(message);
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
});

// ========== ОСНОВНЫЕ КОМАНДЫ ==========

bot.start(async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  const user = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  
  if (user.rows.length === 0) {
    await pool.query(
      'INSERT INTO users (telegram_id, first_name, last_name, username, role, is_active) VALUES ($1, $2, $3, $4, \'employee\', false)',
      [telegramId, ctx.from.first_name, ctx.from.last_name || '', ctx.from.username || '']
    );
    
    ctx.reply(
      '👋 Добро пожаловать, ' + ctx.from.first_name + '!\n\n' +
      '⚠️ ВАША РЕГИСТРАЦИЯ НА РАССМОТРЕНИИ\n\n' +
      'Администратор получит уведомление о вашей регистрации.\nПосле подтверждения вы получите доступ к системе.\n\n' +
      'Что вы сможете делать:\n' +
      '• Создавать согласования документов\n' +
      '• Создавать поручения сотрудникам\n' +
      '• Просматривать свои задачи\n' +
      '• Отслеживать статус согласований\n\n' +
      'Команда /help — помощь'
    );
    
    // Уведомить админов
    const admins = await pool.query('SELECT telegram_id FROM users WHERE role = \'admin\' AND is_active = true');
    admins.rows.forEach(async admin => {
      try {
        await bot.telegram.sendMessage(admin.telegram_id, 
          '🔔 Новый пользователь ожидает активации:\n\n' +
          '👤 ' + ctx.from.first_name + ' ' + (ctx.from.last_name || '') + '\n' +
          '@' + (ctx.from.username || 'нет username') + '\n' +
          'ID: ' + telegramId + '\n\n' +
          'Для активации:\n' +
          '/adduser @' + (ctx.from.username || '') + ' ' + ctx.from.first_name + ' ' + (ctx.from.last_name || '')
        );
      } catch (e) { /* ignore */ }
    });
    
    return;
  }
  
  if (!user.rows[0].is_active) {
    return ctx.reply('⏳ Ваша регистрация ещё не активирована администратором.\n\nПожалуйста, дождитесь подтверждения.');
  }
  
  await pool.query('UPDATE users SET last_seen = NOW() WHERE telegram_id = $1', [telegramId]);
  
  ctx.reply(
    '👋 Добро пожаловать, ' + ctx.from.first_name + '!\n\n' +
    '📋 Корпоративный Документооборот\n\n' +
    'Доступные команды:\n' +
    '/new_approval — Создать согласование\n' +
    '/new_task — Создать поручение\n' +
    '/my_tasks — Мои задачи\n' +
    '/my_approvals — Мои согласования\n' +
    '/my_errands — Мои поручения\n' +
    '/help — Помощь\n\n' +
    'Админ команды:\n' +
    '/adduser — Добавить пользователя\n' +
    '/removeuser — Удалить пользователя\n' +
    '/listusers — Список пользователей\n\n' +
    'Или отправьте файл с текстом "Согласование: ..."'
  );
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
    'После согласования можно переслать на оплату бухгалтерии\n\n' +
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
      message += '   👤 Согласующий: ' + (a.approver_name || 'Не указан') + '\n';
      if (a.payment_sent_to) {
        message += '   💸 Отправлено на оплату: ' + a.payment_to + '\n';
      }
      message += '   📅 ' + new Date(a.created_at).toLocaleDateString('ru-RU') + '\n\n';
    });
    
    ctx.reply(message);
  } catch (e) {
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
      message += '   👤 От: ' + (t.creator_name || 'Не указан') + '\n\n';
    });
    
    ctx.reply(message);
  } catch (e) {
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
      message += '   👤 Исполнитель: ' + (t.executor_name || 'Не указан') + '\n';
      message += '   📅 До: ' + new Date(t.deadline).toLocaleDateString('ru-RU') + '\n';
      message += '   📌 ' + t.status + '\n\n';
    });
    
    ctx.reply(message);
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
  
  const user = await checkAccess(ctx);
  if (!user) return;
  
  const state = userStates[userId];
  
  // ========== СОГЛАСОВАНИЕ ==========
  
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
    userStates[userId] = { ...state, file_id: null, file_type: null, step: 'approval_approver_list' };
    return showApproverList(ctx, state);
  }
  
  // ========== ПОРУЧЕНИЕ ==========
  
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
    return ctx.reply('🔥 Выберите приоритет:\n\nНажмите на кнопку:', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Низкий', 'priority_low')],
        [Markup.button.callback('🟡 Средний', 'priority_medium')],
        [Markup.button.callback('🔴 Высокий', 'priority_high')]
      ])
    });
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
    const result = await pool.query('SELECT id, first_name, last_name, username FROM users WHERE is_active = true ORDER BY id');
    
    if (result.rows.length === 0) {
      return ctx.reply('❌ Нет доступных согласующих. Обратитесь к администратору.', { reply_markup: Markup.removeKeyboard() });
    }
    
    const keyboard = result.rows.map(u => [Markup.button.callback(u.first_name + ' ' + u.last_name + ' (@' + (u.username || 'нет') + ')', 'approver_' + u.id)]);
    keyboard.push([Markup.button.callback('❌ Отмена', 'cancel')]);
    
    ctx.reply('👤 Выберите согласующего:\n\nНажмите на пользователя:', {
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
    
    const keyboard = result.rows.map(u => [Markup.button.callback(u.first_name + ' ' + u.last_name + ' (@' + (u.username || 'нет') + ')', 'executor_' + u.id)]);
    keyboard.push([Markup.button.callback('❌ Отмена', 'cancel')]);
    
    ctx.reply('👤 Выберите исполнителя:\n\nНажмите на пользователя:', {
      reply_markup: Markup.inlineKeyboard(keyboard)
    });
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
  }
}

async function createApprovalFromFile(ctx, caption, fileId, fileName, fileType) {
  try {
    const user = await checkAccess(ctx);
    if (!user) return;
    
    const title = caption.replace(/согласование:|согласуй:/i, '').trim();
    
    const result = await pool.query('INSERT INTO approvals (title, description, creator_id, file_id, file_type, status) VALUES ($1, $2, $3, $4, $5, \'pending\') RETURNING *', [title, 'Файл: ' + fileName, user.id, fileId, fileType]);
    
    ctx.reply('✅ Согласование #' + result.rows[0].id + ' создано!\n\n📄 ' + title + '\n📎 Файл: ' + fileName);
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
    const user = await checkAccess(ctx);
    if (!user) return;
    
    const result = await pool.query('INSERT INTO approvals (title, description, amount, creator_id, approver_id, file_id, file_type, status) VALUES ($1,$2,$3,$4,$5,$6,$7,\'pending\') RETURNING *', [state.title, state.description, state.amount, user.id, approverId, state.file_id, state.file_type]);
    
    delete userStates[userId];
    
    ctx.reply('✅ Согласование #' + result.rows[0].id + ' создано!\n\n📄 ' + state.title + '\n💰 ' + state.amount + ' ₽\n📎 Файл: ' + (state.file_name || 'Нет'), {
      reply_markup: Markup.removeKeyboard()
    });
    
    const approver = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [approverId]);
    if (approver.rows.length > 0) {
      await bot.telegram.sendMessage(approver.rows[0].telegram_id, '🔔 Новое согласование #' + result.rows[0].id + '\n\n📄 ' + state.title + '\n💰 ' + state.amount + ' ₽\n📝 ' + state.description + '\n\n👤 От: ' + ctx.from.first_name, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Согласовать', 'approve_' + result.rows[0].id)],
          [Markup.button.callback('❌ Отклонить', 'reject_' + result.rows[0].id)]
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
  
  ctx.reply('📅 Введите срок выполнения:\n\nВ формате: ДД.ММ.ГГГГ\nНапример: 25.03.2026', {
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
    const user = await checkAccess(ctx);
    if (!user) return;
    
    const parts = state.deadline.split('.');
    const deadline = parts[2] + '-' + parts[1] + '-' + parts[0];
    
    const result = await pool.query('INSERT INTO tasks (title, description, creator_id, executor_id, deadline, priority, status) VALUES ($1,$2,$3,$4,$5,$6,\'pending\') RETURNING *', [state.title, state.description, user.id, state.executor_id, deadline, priority]);
    
    delete userStates[userId];
    
    ctx.reply('✅ Поручение #' + result.rows[0].id + ' создано!\n\n📋 ' + state.title + '\n📅 Срок: ' + state.deadline + '\n🔥 Приоритет: ' + priority, {
      reply_markup: Markup.removeKeyboard()
    });
    
    const executor = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [state.executor_id]);
    if (executor.rows.length > 0) {
      await bot.telegram.sendMessage(executor.rows[0].telegram_id, '🔔 Новое поручение #' + result.rows[0].id + '\n\n📋 ' + state.title + '\n📝 ' + state.description + '\n📅 Срок: ' + state.deadline + '\n🔥 Приоритет: ' + priority + '\n\n👤 От: ' + ctx.from.first_name);
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
    
    const accountants = await pool.query('SELECT id, first_name, last_name FROM users WHERE is_active = true ORDER BY id');
    
    let keyboard = [];
    if (accountants.rows.length > 0) {
      keyboard = accountants.rows.map(u => [Markup.button.callback('💸 ' + u.first_name + ' ' + u.last_name + ' (на оплату)', 'payment_' + approvalId + '_' + u.id)]);
      keyboard.push([Markup.button.callback('⏭ Пропустить', 'payment_skip_' + approvalId)]);
    }
    
    ctx.editMessageText('✅ СОГЛАСОВАНО #' + approvalId + '\n\nСогласование одобрено!\n\n💸 Отправить на оплату?\n\nВыберите получателя:', {
      reply_markup: Markup.inlineKeyboard(keyboard)
    });
    
    const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
    const creator = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [approval.rows[0].creator_id]);
    
    if (creator.rows.length > 0) {
      await bot.telegram.sendMessage(creator.rows[0].telegram_id, '✅ Ваше согласование #' + approvalId + ' одобрено!');
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
      await bot.telegram.sendMessage(accountant.rows[0].telegram_id, '💰 Новый счёт на оплату #' + approvalId + '\n\n📄 ' + approval.rows[0].title + '\n💰 ' + approval.rows[0].amount + ' ₽\n📝 ' + approval.rows[0].description + '\n\n✅ Уже согласовано!', {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Оплачено', 'paid_' + approvalId)]
        ])
      });
    }
    
    ctx.editMessageText('✅ СОГЛАСОВАНО И ОТПРАВЛЕНО НА ОПЛАТУ\n\nСогласование #' + approvalId + ' одобрено и передано.');
    
    ctx.answerCbQuery();
  } catch (e) {
    ctx.reply('❌ Ошибка: ' + e.message);
    ctx.answerCbQuery('Ошибка');
  }
});

bot.action(/^payment_skip_(\d+)/, async (ctx) => {
  const approvalId = parseInt(ctx.match[1]);
  
  await pool.query('UPDATE approvals SET payment_status = \'not_required\' WHERE id = $1', [approvalId]);
  
  ctx.editMessageText('✅ СОГЛАСОВАНО #' + approvalId + '\n\nСогласование одобрено (на оплату не отправлено).');
  
  ctx.answerCbQuery();
});

bot.action(/^paid_(\d+)/, async (ctx) => {
  const approvalId = parseInt(ctx.match[1]);
  
  await pool.query('UPDATE approvals SET status = \'paid\', payment_status = \'paid\' WHERE id = $1', [approvalId]);
  
  ctx.editMessageText('💰 ОПЛАЧЕНО #' + approvalId + '\n\nСчёт оплачен!');
  
  const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
  const creator = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [approval.rows[0].creator_id]);
  
  if (creator.rows.length > 0) {
    await bot.telegram.sendMessage(creator.rows[0].telegram_id, '💰 Ваше согласование #' + approvalId + ' оплачено!');
  }
  
  ctx.answerCbQuery();
});

bot.action(/^reject_(\d+)/, async (ctx) => {
  const approvalId = parseInt(ctx.match[1]);
  
  try {
    await pool.query('UPDATE approvals SET status = \'rejected\', updated_at = NOW() WHERE id = $1', [approvalId]);
    
    ctx.editMessageText('❌ ОТКЛОНЕНО #' + approvalId + '\n\nСогласование отклонено.');
    
    const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
    const creator = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [approval.rows[0].creator_id]);
    
    if (creator.rows.length > 0) {
      await bot.telegram.sendMessage(creator.rows[0].telegram_id, '❌ Ваше согласование #' + approvalId + ' отклонено.');
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
