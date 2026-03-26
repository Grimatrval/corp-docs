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
