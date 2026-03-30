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
    
    // ========== СОЗДАНИЕ СОГЛАСОВАНИЯ ==========
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
    
    // ========== СОЗДАНИЕ ПОРУЧЕНИЯ ==========
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
      console.log('⏰ Setting deadline:', text, 'User:', userId);
      userStates[userId] = { ...state, deadline: text, step: 'task_priority' };
      
      try {
        await ctx.telegram.sendMessage(ctx.chat.id, '🔥 Выберите приоритет:', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🟢 Низкий', callback_data: 'priority_low' }],
              [{ text: '🟡 Средний', callback_data: 'priority_medium' }],
              [{ text: '🔴 Высокий', callback_data: 'priority_high' }]
            ]
          }
        });
        console.log('✅ Priority message sent');
      } catch (e) {
        console.error('❌ Error sending priority:', e.message);
        await ctx.reply('🔥 Выберите приоритет текстом:\n\n1 - Низкий\n2 - Средний\n3 - Высокий');
        userStates[userId].step = 'task_priority_text';
      }
      
      return;
    }
    
    // Обработка выбора приоритета текстом
    if (state?.step === 'task_priority_text') {
      let priority = '';
      
      if (text === '1' || text.includes('Низкий')) {
        priority = 'low';
      } else if (text === '2' || text.includes('Средний')) {
        priority = 'medium';
      } else if (text === '3' || text.includes('Высокий')) {
        priority = 'high';
      } else {
        return ctx.reply('❌ Выберите 1, 2 или 3');
      }
      
      try {
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
        
      } catch (e) {
        console.error('task creation error:', e);
        ctx.reply('❌ Ошибка: ' + e.message);
      }
      
      return;
    }
    
    // ========== ОБРАБОТКА КОММЕНТАРИЯ К ОПЛАТЕ ==========
    if (state?.step === 'payment_comment') {
      const approvalId = state.approval_id;
      
      const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
      const creator = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [approval.rows[0].creator_id]);
      
      if (creator.rows.length > 0 && creator.rows[0].telegram_id) {
        await bot.telegram.sendMessage(creator.rows[0].telegram_id, 
          '💬 Комментарий к оплате #' + approvalId + ':\n\n' +
          ctx.message.text + '\n\n' +
          '👤 От бухгалтера'
        );
      }
      
      delete userStates[userId];
      await ctx.reply('✅ Комментарий отправлен!');
      return;
    }
    
    // ========== ОБРАБОТКА УТОЧНЕНИЯ ДЕТАЛЕЙ (вопрос от согласующего) ==========
    if (state?.step === 'clarify_message') {
      const approvalId = state.approval_id;
      
      const approval = await pool.query('SELECT creator_id, approver_id, file_id, file_type, title, amount, description FROM approvals WHERE id = $1', [approvalId]);
      
      if (approval.rows.length > 0) {
        const creatorId = approval.rows[0].creator_id;
        const creator = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [creatorId]);
        
        if (creator.rows.length > 0 && creator.rows[0].telegram_id) {
          const questionText = '❓ Уточнение по согласованию #' + approvalId + ':\n\n' +
            '💬 ' + ctx.message.text + '\n\n' +
            '👤 От согласующего';
          
          const keyboard = {
            inline_keyboard: [
              [{ text: '✏️ Ответить', callback_data: 'clarify_reply_' + approvalId }],
              [{ text: '❌ Отменить согласование', callback_data: 'clarify_cancel_' + approvalId }]
            ]
          };
          
          await bot.telegram.sendMessage(creator.rows[0].telegram_id, questionText, {
            reply_markup: keyboard
          });
        }
      }
      
      delete userStates[userId];
      await ctx.reply('✅ Ваш вопрос отправлен инициатору согласования!');
      return;
    }
    
    // ========== ОБРАБОТКА ОТВЕТА ИНИЦИАТОРА НА УТОЧНЕНИЕ ==========
    if (state?.step === 'clarify_reply_message') {
      const approvalId = state.approval_id;
      
      const approval = await pool.query('SELECT approver_id, file_id, file_type, title, amount, description FROM approvals WHERE id = $1', [approvalId]);
      
      if (approval.rows.length > 0) {
        const approverId = approval.rows[0].approver_id;
        const approver = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [approverId]);
        
        if (approver.rows.length > 0 && approver.rows[0].telegram_id) {
          const telegramId = approver.rows[0].telegram_id;
          
          const replyText = '✏️ Ответ на уточнение #' + approvalId + ':\n\n' +
            '💬 ' + ctx.message.text + '\n\n' +
            '👤 От инициатора\n\n' +
            '📋 Продолжить согласование?';
          
          const inlineKeyboard = {
            inline_keyboard: [
              [{ text: '✅ Согласовать', callback_data: 'approve_' + approvalId }],
              [{ text: '❌ Отклонить', callback_data: 'reject_' + approvalId }],
              [{ text: '❓ Уточнить детали', callback_data: 'clarify_' + approvalId }]
            ]
          };
          
          if (approval.rows[0].file_id && approval.rows[0].file_type) {
            if (approval.rows[0].file_type === 'photo') {
              await bot.telegram.sendPhoto(telegramId, approval.rows[0].file_id, {
                caption: replyText
              });
            } else if (approval.rows[0].file_type === 'document') {
              await bot.telegram.sendDocument(telegramId, approval.rows[0].file_id, {
                caption: replyText
              });
            } else if (approval.rows[0].file_type === 'voice') {
              await bot.telegram.sendVoice(telegramId, approval.rows[0].file_id, {
                caption: replyText
              });
            }
            await bot.telegram.sendMessage(telegramId, '📋 Выберите действие:', {
              reply_markup: inlineKeyboard
            });
          } else {
            await bot.telegram.sendMessage(telegramId, replyText, {
              reply_markup: inlineKeyboard
            });
          }
        }
      }
      
      delete userStates[userId];
      await ctx.reply('✅ Ваш ответ отправлен согласующему!');
      return;
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
    
    // ========== ОТПРАВКА УВЕДОМЛЕНИЯ СОГЛАСУЮЩЕМУ ==========
    const approver = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [approverId]);
    if (approver.rows.length > 0) {
      const telegramId = approver.rows[0].telegram_id;
      
      if (telegramId && !isNaN(parseInt(telegramId))) {
        try {
          const messageText = '🔔 Новое согласование #' + result.rows[0].id + '\n\n' +
            '📄 ' + state.title + '\n' +
            '💰 ' + state.amount + ' ₽\n' +
            '📝 ' + state.description + '\n\n' +
            '👤 От: ' + safeString(ctx.from.first_name);
          
          // Создаём inline keyboard
          const inlineKeyboard = {
            inline_keyboard: [
              [{ text: '✅ Согласовать', callback_data: 'approve_' + result.rows[0].id }],
              [{ text: '❌ Отклонить', callback_data: 'reject_' + result.rows[0].id }],
              [{ text: '❓ Уточнить детали', callback_data: 'clarify_' + result.rows[0].id }]
            ]
          };
          
          // Отправляем файл (если есть)
          if (state.file_id && state.file_type) {
            if (state.file_type === 'photo') {
              await bot.telegram.sendPhoto(telegramId, state.file_id, {
                caption: messageText
              });
            } else if (state.file_type === 'document') {
              await bot.telegram.sendDocument(telegramId, state.file_id, {
                caption: messageText
              });
            } else if (state.file_type === 'voice') {
              await bot.telegram.sendVoice(telegramId, state.file_id, {
                caption: messageText
              });
            } else if (state.file_type === 'video_note') {
              await bot.telegram.sendVideoNote(telegramId, state.file_id);
              await bot.telegram.sendMessage(telegramId, messageText);
            }
            
            // Отправляем кнопки ОТДЕЛЬНЫМ сообщением
            await bot.telegram.sendMessage(telegramId, '📋 Выберите действие:', {
              reply_markup: inlineKeyboard
            });
          } else {
            // Если файла нет — отправляем текст с кнопками
            await bot.telegram.sendMessage(telegramId, messageText, {
              reply_markup: inlineKeyboard
            });
          }
          
          console.log('✅ Notification with file and buttons sent to:', telegramId);
        } catch (e) {
          console.error('❌ Error sending notification:', e.message);
          console.error('Stack:', e.stack);
        }
      }
    }
    // ========== КОНЕЦ ОТПРАВКИ ==========
    
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
// Принятие задачи исполнителем
bot.action(/^task_accept_(\d+)/, async (ctx) => {
  try {
    const taskId = parseInt(ctx.match[1]);
    
    await pool.query('UPDATE tasks SET status = \'in_progress\' WHERE id = $1', [taskId]);
    
    const task = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    const creator = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [task.rows[0].creator_id]);
    
    // Уведомляем создателя
    if (creator.rows.length > 0 && creator.rows[0].telegram_id) {
      await sendNotification(
        creator.rows[0].telegram_id,
        '✅ Задача #' + taskId + ' принята в работу\n\n' +
        '📋 ' + task.rows[0].title + '\n' +
        '👤 Исполнитель начал работу'
      );
    }
    
    // ========== ОТПРАВЛЯЕМ КНОПКУ "ВЫПОЛНЕНО" ИСПОЛНИТЕЛЮ ==========
    const keyboard = {
      inline_keyboard: [
        [{ text: '✅ Выполнено', callback_data: 'task_completed_' + taskId }]
      ]
    };
    
    await ctx.telegram.sendMessage(ctx.from.id, 
      '📋 Задача в работе\n\n' +
      '📋 ' + task.rows[0].title + '\n' +
      '📝 ' + task.rows[0].description + '\n' +
      '📅 Срок: ' + new Date(task.rows[0].deadline).toLocaleDateString('ru-RU') + '\n\n' +
      'Нажмите кнопку когда завершите:',
      { reply_markup: keyboard }
    );
    // ========== КОНЕЦ ==========
    
    await ctx.editMessageText('✅ Задача #' + taskId + ' принята в работу!\n\n📋 ' + task.rows[0].title);
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('task_accept error:', e);
    ctx.answerCbQuery('Ошибка');
  }  
});

// Ответ на уточнение от инициатора
bot.action(/^clarify_reply_(\d+)/, async (ctx) => {
  try {
    const approvalId = parseInt(ctx.match[1]);
    
    await ctx.reply('✏️ Напишите ваш ответ согласующему:');
    userStates[ctx.from.id] = { step: 'clarify_reply_message', approval_id: approvalId };
    
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('clarify_reply error:', e);
    ctx.answerCbQuery('Ошибка');
  }
});

// Отмена согласования инициатором
bot.action(/^clarify_cancel_(\d+)/, async (ctx) => {
  try {
    const approvalId = parseInt(ctx.match[1]);
    
    await pool.query('UPDATE approvals SET status = \'cancelled\' WHERE id = $1', [approvalId]);
    
    const approval = await pool.query('SELECT approver_id FROM approvals WHERE id = $1', [approvalId]);
    const approver = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [approval.rows[0].approver_id]);
    
    if (approver.rows.length > 0 && approver.rows[0].telegram_id) {
      await sendNotification(approver.rows[0].telegram_id, 
        '❌ Согласование #' + approvalId + ' отменено инициатором'
      );
    }
    
    await ctx.editMessageText('❌ Согласование #' + approvalId + ' отменено');
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('clarify_cancel error:', e);
    ctx.answerCbQuery('Ошибка');
  }
});

// Выполнение задачи
bot.action(/^task_completed_(\d+)/, async (ctx) => {
  try {
    const taskId = parseInt(ctx.match[1]);
    
    await pool.query('UPDATE tasks SET status = \'completed\', completed_at = NOW() WHERE id = $1', [taskId]);
    
    const task = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    const creator = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [task.rows[0].creator_id]);
    
    // Рассчитываем время выполнения
    const createdAt = new Date(task.rows[0].created_at);
    const completedAt = new Date();
    const timeDiff = Math.abs(completedAt - createdAt);
    
    const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    
    let timeText = '';
    if (days > 0) timeText += days + ' дн. ';
    if (hours > 0) timeText += hours + ' ч. ';
    timeText += minutes + ' мин.';
    
    if (creator.rows.length > 0 && creator.rows[0].telegram_id) {
      await sendNotification(
        creator.rows[0].telegram_id,
        '✅ Задача #' + taskId + ' выполнена!\n\n' +
        '📋 ' + task.rows[0].title + '\n' +
        '⏱ Время выполнения: ' + timeText + '\n' +
        '👤 Исполнитель завершил работу'
      );
    }
    
    await ctx.editMessageText('✅ Задача #' + taskId + ' выполнена!\n\n📋 ' + task.rows[0].title + '\n⏱ Время: ' + timeText);
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('task_completed error:', e);
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
    
    // ========== ОТПРАВКА УВЕДОМЛЕНИЯ ИСПОЛНИТЕЛЮ С КНОПКАМИ ==========
    const executor = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [state.executor_id]);
    if (executor.rows.length > 0) {
      const telegramId = executor.rows[0].telegram_id;
      
      if (telegramId && !isNaN(parseInt(telegramId))) {
        const taskMessage = '🔔 Новое поручение #' + result.rows[0].id + '\n\n' +
          '📋 ' + state.title + '\n' +
          '📝 ' + state.description + '\n' +
          '📅 Срок: ' + state.deadline + '\n' +
          '🔥 Приоритет: ' + priority + '\n\n' +
          '👤 От: ' + safeString(ctx.from.first_name) + '\n\n' +
          '📋 Выберите действие:';
        
        const taskKeyboard = {
          inline_keyboard: [
            [{ text: '✅ Принять в работу', callback_data: 'task_accept_' + result.rows[0].id }],
            [{ text: '❌ Отклонить', callback_data: 'task_decline_' + result.rows[0].id }]
          ]
        };
        
        try {
          await bot.telegram.sendMessage(telegramId, taskMessage, {
            reply_markup: taskKeyboard
          });
          console.log('✅ Task notification with buttons sent to:', telegramId);
        } catch (e) {
          console.error('❌ Error sending task notification:', e);
        }
      }
    }
    // ========== КОНЕЦ ОТПРАВКИ ==========
    
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
    
    // Получаем всех активных пользователей
    const users = await pool.query('SELECT id, first_name, last_name, telegram_id FROM users WHERE is_active = true ORDER BY id');
    
    console.log('💸 Found users for payment:', users.rows.length);
    
    // Создаём клавиатуру с пользователями - ПРАВИЛЬНЫЙ ФОРМАТ
    const keyboard = [];
    users.rows.forEach(u => {
      const name = safeString(u.first_name) + ' ' + safeString(u.last_name);
      keyboard.push([
        {
          text: '💸 ' + name + ' (на оплату)',
          callback_data: 'payment_' + approvalId + '_' + u.id
        }
      ]);
    });
    keyboard.push([
      {
        text: '⏭ Пропустить',
        callback_data: 'payment_skip_' + approvalId
      }
    ]);
    
    console.log('💸 Created keyboard buttons:', keyboard.length);
    
    // Отправляем сообщение с кнопками - ИСПРАВЛЕННЫЙ ФОРМАТ
    await ctx.editMessageText('✅ СОГЛАСОВАНО #' + approvalId + '\n\nСогласование одобрено!\n\n💸 Отправить на оплату?\n\nВыберите получателя:', {
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
    
    console.log('✅ Payment keyboard sent');
    
    // Уведомляем создателя
    const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
    const creator = await pool.query('SELECT telegram_id, first_name FROM users WHERE id = $1', [approval.rows[0].creator_id]);
    
    if (creator.rows.length > 0 && creator.rows[0].telegram_id && !isNaN(parseInt(creator.rows[0].telegram_id))) {
      await sendNotification(creator.rows[0].telegram_id, '✅ Ваше согласование #' + approvalId + ' одобрено!');
    }
    
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('approve action error:', e);
    console.error('Stack:', e.stack);
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
      const telegramId = accountant.rows[0].telegram_id;
      
      const messageText = '💰 Новый счёт на оплату #' + approvalId + '\n\n' +
        '📄 ' + approval.rows[0].title + '\n' +
        '💰 ' + approval.rows[0].amount + ' ₽\n' +
        '📝 ' + approval.rows[0].description + '\n\n' +
        '✅ Уже согласовано!\n\n' +
        '💬 *Напишите комментарий к оплате* (или пропустите)';
      
      // Отправляем файл (если есть)
      if (approval.rows[0].file_id && approval.rows[0].file_type) {
        if (approval.rows[0].file_type === 'photo') {
          await bot.telegram.sendPhoto(telegramId, approval.rows[0].file_id, {
            caption: messageText
          });
        } else if (approval.rows[0].file_type === 'document') {
          await bot.telegram.sendDocument(telegramId, approval.rows[0].file_id, {
            caption: messageText
          });
        } else if (approval.rows[0].file_type === 'voice') {
          await bot.telegram.sendVoice(telegramId, approval.rows[0].file_id, {
            caption: messageText
          });
        } else if (approval.rows[0].file_type === 'video_note') {
          await bot.telegram.sendVideoNote(telegramId, approval.rows[0].file_id);
          await bot.telegram.sendMessage(telegramId, messageText);
        } else {
          // Для других типов или если ошибка
          await bot.telegram.sendMessage(telegramId, messageText);
        }
      } else {
        // Если файла нет
        await bot.telegram.sendMessage(telegramId, messageText);
      }
      
      // Отправляем кнопки ОТДЕЛЬНЫМ сообщением
      const keyboard = {
        inline_keyboard: [
          [{ text: '✅ Оплачено', callback_data: 'paid_' + approvalId }]
        ]
      };
      
      await bot.telegram.sendMessage(telegramId, '📋 Действия:', {
        reply_markup: keyboard
      });
      
      // Сохраняем состояние для приёма комментария
      userStates[telegramId] = {
        step: 'payment_comment',
        approval_id: approvalId
      };
      
      console.log('✅ Payment notification with file sent to:', telegramId);
    }
    
    await ctx.editMessageText('✅ СОГЛАСОВАНО И ОТПРАВЛЕНО НА ОПЛАТУ\n\nСогласование #' + approvalId + ' одобрено и передано.');
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('payment action error:', e);
    console.error('Stack:', e.stack);
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
    
    // Обновляем статус
    await pool.query('UPDATE approvals SET payment_status = \'paid\' WHERE id = $1', [approvalId]);
    
    // Отправляем кнопку "Выполнено" бухгалтеру
    const keyboard = {
      inline_keyboard: [
        [{ text: '✅ Выполнено', callback_data: 'payment_done_' + approvalId }]
      ]
    };
    
    await ctx.editMessageText('💰 ОПЛАЧЕНО #' + approvalId + '\n\nСчёт оплачен!\n\nНажмите "Выполнено" когда приложите платёжное поручение (опционально):', {
      reply_markup: keyboard
    });
    
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('paid action error:', e);
    ctx.answerCbQuery('Ошибка');
  }
});

// Новый обработчик для "Выполнено" после оплаты
bot.action(/^payment_done_(\d+)/, async (ctx) => {
  try {
    const approvalId = parseInt(ctx.match[1]);
    
    // Обновляем общий статус
    await pool.query('UPDATE approvals SET status = \'paid\' WHERE id = $1', [approvalId]);
    
    // Уведомляем создателя
    const approval = await pool.query('SELECT creator_id FROM approvals WHERE id = $1', [approvalId]);
    const creator = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [approval.rows[0].creator_id]);
    
    if (creator.rows.length > 0 && creator.rows[0].telegram_id) {
      await sendNotification(creator.rows[0].telegram_id, '💰 Согласование #' + approvalId + ' выполнено!\n\nСчёт оплачен, платёжное поручение приложено.');
    }
    
    await ctx.editMessageText('✅ Согласование #' + approvalId + ' выполнено!\n\nСпасибо за работу!');
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('payment_done error:', e);
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

bot.action(/^clarify_(\d+)/, async (ctx) => {
  try {
    const approvalId = parseInt(ctx.match[1]);
    
    await ctx.reply('✏️ Напишите ваш вопрос или комментарий:');
    userStates[ctx.from.id] = { step: 'clarify_message', approval_id: approvalId };
    
    await ctx.answerCbQuery();
  } catch (e) {
    console.error('clarify action error:', e);
    ctx.answerCbQuery('Ошибка');
  }
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
