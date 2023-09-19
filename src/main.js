import { Telegraf, Markup, session } from "telegraf";
import { message } from 'telegraf/filters';
import { code } from "telegraf/format";
import config from 'config';
import { ogg, saveUploadedFile } from "./ogg.js";
import { openai } from "./openai.js";

const startText = `Привет! Я Telegram-бот для использования ChatGPT.

Вы можете отправлять мне как текстовые, так и голосовые сообщения, а также можете делать это на любом языке.

Я умею запоминать контекст беседы, так что, если вы захотите сменить тему, просто введите команду '/new'.`;

const newText = 'Контекст очищен. Можем теперь поговорить на другую тему';

const INITIAL_SESSION = {
  messages: [],
  mode: null,
}

const MODE_CHAT_TEXT = "MODE_CHAT_TEXT";
const MODE_CHAT_AUDIO = "MODE_CHAT_AUDIO";
const MODE_TRANSCRIPTION = "MODE_TRANSCRIPTION";

const bot = new Telegraf(config.get("TELEGRAM_TOKEN"));

bot.use(session());

// ? нужно, чтобы при открытии бота сразу отображалось меню

const menu = Markup.inlineKeyboard([
  Markup.button.callback('Text chat', MODE_CHAT_TEXT),
  Markup.button.callback('Audio chat', MODE_CHAT_AUDIO),
  Markup.button.callback('Audio transcription', MODE_TRANSCRIPTION)
]);

bot.start(async (ctx) => {
  // Send the menu as a reply to the user when they start a conversation
  ctx.session = INITIAL_SESSION;
  await ctx.reply(code(startText), menu);
});

// bot.command('start', async (ctx) => {
//   ctx.session = INITIAL_SESSION;
//   await ctx.reply(code(startText), menu);
// });

bot.action(MODE_CHAT_TEXT, (ctx) => {
  ctx.session.mode = MODE_CHAT_TEXT;
  ctx.reply("You've selected text chat mode. Please type your message.");
});

bot.action(MODE_CHAT_AUDIO, (ctx) => {
  ctx.session.mode = MODE_CHAT_AUDIO;
  ctx.reply("You've selected audio chat mode. Please send your audio message.");
});

bot.action(MODE_TRANSCRIPTION, (ctx) => {
  ctx.session.mode = MODE_TRANSCRIPTION;
  ctx.reply("You've selected audio transcription mode. Please send your audio message.");
});

bot.command('new', async (ctx) => {
  ctx.session = INITIAL_SESSION;
  await ctx.reply(code(newText));
})

// ? что происходит, когда в бот прилетает текстовое сообщение
// ? по сути, здесь мы имеем дело с обрезанной логикой работы с голосовым сообщением. у нас отсутствует любая работа с аудио-файлами и их конвертация в текст. текст мы имеем сразу, и этот текст хранится в ctx.message.text, который мы напрямую закидываем в messages объекта сессии.
bot.on(message('text'), async (ctx) => {
  if (ctx.session.mode === MODE_CHAT_TEXT) {
    // ? делаем проверку на то, определилась ли сессия. если нет, присваиваем стартовое значение.
    ctx.session ??= INITIAL_SESSION;

    try {
      // ? не даем пользователю заскучать
      await ctx.reply(code('Обрабатываю...'));

      ctx.session.messages.push({ role: openai.roles.USER, content: ctx.message.text });
      console.log(ctx.session.messages);

      // ? немного UX, чтобы пользователь видел прогресс запроса: отображаем его запрос, затем даем понять, что ответ ChatGPT может занять какое-то время
      await ctx.reply(code('Ваш запрос:'));
      await ctx.reply(ctx.message.text);
      await ctx.reply(code('ChatGPT генерирует ответ...'));

      // ? получаем ответ от ChatGPT
      const response = await openai.chat(ctx.session.messages);
      ctx.session.messages.push({ role: openai.roles.ASSISTANT, content: response.content });

      // ? анонс ответа
      await ctx.reply(code('Ответ ChatGPT:'));

      // ? отправляем ответ ChatGPT
      await ctx.reply(response.content);
    } catch (e) {
      // ? если ответ не сгенерирован по какой-то иной причине, выводим ошибку в консоль, а юзеру предлагаем попробовать еще раз
      console.log(`Error: ${e}`);
      console.log(e.response || e);
      await ctx.reply(code('Ошибка! попробуйте еще раз'));
    }
  }
  else {
    ctx.reply("Invalid mode for audio. Please select 'Audio chat' or 'Audio transcription' mode first.");
  }
});

// ? что происходит, когда в бот прилетает голосовое сообщение
bot.on(message('voice'), async (ctx) => {
  if (ctx.session.mode === MODE_CHAT_AUDIO) {
    // ? делаем проверку на то, определилась ли сессия. если нет, присваиваем стартовое значение.
    ctx.session ??= INITIAL_SESSION;

    try {
      // ? не даем пользователю заскучать
      await ctx.reply(code('Обрабатываю...'));

      // ? достаем ссылку на файл голосового сообщения
      const link = await ctx.telegram.getFileLink(ctx.message.voice.file_id);

      // ? достаем айдишник пользователя
      const userId = String(ctx.message.from.id) ;
      console.log(link.href);

      // ? создаем файл ogg, ссылку на него достаем из свойства link.href, присваиваем файлу имя userId. это означает, что файлы не накапливаются, и каждая новая голосовуха пользователя перезаписывает прежнюю
      const oggPath = await ogg.create(link.href, userId);

      // ? конвертируем ogg файл в mp3, назначаем mp3-файлу такое же имя - userId
      const mp3Path = await ogg.toMp3(oggPath, userId);

      // ? преобразовываем mp3 в текст
      const text = await openai.transcription(mp3Path);

      ctx.session.messages.push({ role: openai.roles.USER, content: text });

      // ? немного UX, чтобы пользователь видел прогресс запроса: отображаем его запрос, затем даем понять, что ответ ChatGPT может занять какое-то время
      await ctx.reply(code('Ваш запрос:'));
      await ctx.reply(text);
      await ctx.reply(code('ChatGPT генерирует ответ...'));

      // ? получаем ответ от ChatGPT
      const response = await openai.chat(ctx.session.messages);
      ctx.session.messages.push({ role: openai.roles.ASSISTANT, content: response.content });

      // ? анонс ответа
      await ctx.reply(code('Ответ ChatGPT:'));

      // ? отправляем ответ ChatGPT
      await ctx.reply(response.content);
    } catch (e) {
      // ? если ответ не сгенерирован по какой-то иной причине, выводим ошибку в консоль, а юзеру предлагаем попробовать еще раз
      console.log(`Error: ${e}`);
      await ctx.reply(code('Ошибка! попробуйте еще раз'));
    }
  }
  else if (ctx.session.mode === MODE_TRANSCRIPTION) {
    // ? делаем проверку на то, определилась ли сессия. если нет, присваиваем стартовое значение.
    ctx.session ??= INITIAL_SESSION;

    try {
      // ? не даем пользователю заскучать
      await ctx.reply(code('Обрабатываю...'));

      // ? достаем ссылку на файл голосового сообщения
      let link;
      if (ctx.message.voice) {
        link = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
      } else if (ctx.message.audio) {
        link = await ctx.telegram.getFileLink(ctx.message.audio.file_id);
      }

      const extension = link.pathname.split('.').pop();

      // ? достаем айдишник пользователя
      const userId = String(ctx.message.from.id) ;
      console.log(link.href);

      if (extension === 'ogg' || extension === 'oga') {
        // ? создаем файл ogg, ссылку на него достаем из свойства link.href, присваиваем файлу имя userId. это означает, что файлы не накапливаются, и каждая новая голосовуха пользователя перезаписывает прежнюю
        const oggPath = await ogg.create(link.href, userId);

        // ? конвертируем ogg файл в mp3, назначаем mp3-файлу такое же имя - userId
        const mp3Path = await ogg.toMp3(oggPath, userId);

        // ? преобразовываем mp3 в текст
        const text = await openai.transcription(mp3Path);

        await ctx.reply(code('Ваш запрос:'));
        await ctx.reply(text);
      }
      else {
        const uploadedFilePath = await saveUploadedFile(link.href, `${userId}.${extension}`);
        const text = await openai.transcription(uploadedFilePath);

        await ctx.reply(code('Ваш запрос:'));
        await ctx.reply(text);
      }
    } catch (e) {
      // ? если ответ не сгенерирован по какой-то иной причине, выводим ошибку в консоль, а юзеру предлагаем попробовать еще раз
      console.log(`Error: ${e}`);
      await ctx.reply(code('Ошибка! попробуйте еще раз'));
    }
  }
  else {
    await ctx.reply(code('Этот формат сообщения не является аудио'));
  }
});

bot.on(message('audio'), async (ctx) => {
  if (ctx.session.mode === MODE_TRANSCRIPTION) {
    // ? делаем проверку на то, определилась ли сессия. если нет, присваиваем стартовое значение.
    ctx.session ??= INITIAL_SESSION;

    try {
      // ? не даем пользователю заскучать
      await ctx.reply(code('Обрабатываю...'));

      // ? достаем ссылку на файл голосового сообщения
      let link = await ctx.telegram.getFileLink(ctx.message.audio.file_id);
      console.log(link);

      const extension = link.pathname.split('.').pop();

      // ? достаем айдишник пользователя
      const userId = String(ctx.message.from.id) ;
      console.log(link.href);

      if (extension === 'ogg' || extension === 'oga') {
        // ? создаем файл ogg, ссылку на него достаем из свойства link.href, присваиваем файлу имя userId. это означает, что файлы не накапливаются, и каждая новая голосовуха пользователя перезаписывает прежнюю
        const oggPath = await ogg.create(link.href, userId);

        // ? конвертируем ogg файл в mp3, назначаем mp3-файлу такое же имя - userId
        const mp3Path = await ogg.toMp3(oggPath, userId);

        // ? преобразовываем mp3 в текст
        const text = await openai.transcription(mp3Path);

        await ctx.reply(code('Ваш запрос:'));
        await ctx.reply(text);
      }
      else {
        const uploadedFilePath = await saveUploadedFile(link.href, `${userId}.${extension}`);
        const text = await openai.transcription(uploadedFilePath);

        await ctx.reply(code('Ваш запрос:'));
        await ctx.reply(text);
      }
    } catch (e) {
      // ? если ответ не сгенерирован по какой-то иной причине, выводим ошибку в консоль, а юзеру предлагаем попробовать еще раз
      console.log(`Error: ${e}`);
      await ctx.reply(code('Ошибка! попробуйте еще раз'));
    }
  }
  else {
    await ctx.reply(code('Этот формат сообщения не является аудио'));
  }
})

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));