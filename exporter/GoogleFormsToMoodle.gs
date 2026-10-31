  // Google Forms -> Moodle XML. Исходные формы и ответы участников не изменяются.
  const CONFIG = {
    // Для автоматического экспорта папки список не нужен.
    FORM_IDS: [],
    // Если FORM_IDS пуст: папка с формами (без вложенных папок).
    // Вставьте сюда ID или полную ссылку на папку с формами.
    SOURCE_FOLDER_ID: '',
    AUTO_MAX_ATTEMPTS: 3,
    MAX_FORMS_PER_RUN: 10,
    MAX_RUN_MS: 240000,
    CATEGORY: 'Google Forms',
    ZIP_MAX_FORMS: 100,
    ZIP_MAX_BYTES: 40 * 1024 * 1024,
  };

  function exportBatch() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) throw new Error('Экспорт уже выполняется.');
    try {
      const start = Date.now();
      const props = PropertiesService.getScriptProperties();
      let folder;
      const saved = props.getProperty('OUTPUT_FOLDER');
      if (saved) folder = DriveApp.getFolderById(saved);
      else {
        folder = DriveApp.createFolder('Moodle export ' + new Date().toISOString().replace(/[:.]/g, '-'));
        props.setProperty('OUTPUT_FOLDER', folder.getId());
      }
      console.log('Результаты: ' + folder.getUrl());
      let done = 0;
      let errors = 0;
      for (const id of sourceIds_()) {
        if (Date.now() - start > CONFIG.MAX_RUN_MS || done + errors >= CONFIG.MAX_FORMS_PER_RUN) break;
        // Отчёт записывается последним: его наличие означает завершённый экспорт.
        if (folder.getFilesByName(id + '.report.txt').hasNext()) continue;
        try {
          const form = readForm_(id);
          const result = convert_(form, id);
          put_(folder, id + '.source.json', JSON.stringify(form, null, 2), 'application/json');
          if (result.count) saveNamedXml_(folder, id, germanTestName_(form.info.documentTitle || form.info.title), result.xml);
          put_(folder, id + '.report.txt',
            'Форма: ' + form.info.title + '\nhttps://docs.google.com/forms/d/' + id + '/edit\n' +
            'Вопросов/описаний в XML: ' + result.count + '\n' +
            'Пропущенных вопросов: ' + result.skipped + '\n' +
            'Проверки и ограничения:\n' + result.warnings.join('\n') + '\n' +
            'Настройки теста, ветвления и ответы участников не переносятся.\n', 'text/plain');
          console.log('Готово: ' + form.info.title + '; пропущено: ' + result.skipped);
          done++;
        } catch (e) {
          errors++;
          console.error(id + ': ' + e.message);
          // Общие ошибки настройки останавливают пакет; ошибки доступа к одной форме — нет.
          if (/SERVICE_DISABLED|ACCESS_TOKEN_SCOPE_INSUFFICIENT|HTTP 401|HTTP 429/.test(e.message)) throw e;
        }
      }
      console.log('За запуск: ' + done + ' готово, ' + errors + ' ошибок. Повторите exportBatch для продолжения.');
      console.log('Когда экспорт завершён, запустите buildMoodlePackages: он соберёт ZIP для Moodle.');
    } finally { lock.releaseLock(); }
  }

  function sourceIds_() {
    if (CONFIG.FORM_IDS.length) return [...new Set(CONFIG.FORM_IDS.map(id_))];
    if (!CONFIG.SOURCE_FOLDER_ID) throw new Error('Укажите SOURCE_FOLDER_ID — папку с формами.');
    const it = CONFIG.SOURCE_FOLDER_ID
      ? DriveApp.getFolderById(id_(CONFIG.SOURCE_FOLDER_ID)).getFilesByType('application/vnd.google-apps.form')
      : DriveApp.getFilesByType('application/vnd.google-apps.form');
    const ids = [];
    while (it.hasNext()) ids.push(it.next().getId());
    return ids;
  }

  // Собирает все успешно экспортированные XML текущей папки в пакеты.
  // Отдельная функция оставляет весь лимит времени exportBatch для чтения форм.
  function buildMoodlePackages() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) throw new Error('Экспорт уже выполняется.');
    try {
      const folderId = PropertiesService.getScriptProperties().getProperty('OUTPUT_FOLDER');
      if (!folderId) throw new Error('Сначала запустите exportBatch.');
      const folder = DriveApp.getFolderById(folderId);
      const xmls = [];
      const iterator = folder.getFiles();
      while (iterator.hasNext()) {
        const file = iterator.next();
        const xmlName = file.getName();
        if (xmlName.endsWith('.xml')) xmls.push(file);
      }
      xmls.sort((a,b) => a.getName().localeCompare(b.getName()));
      if (!xmls.length) throw new Error('Нет завершённых XML для упаковки.');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const packageFolder = folder.createFolder('Moodle ZIP ' + timestamp);
      let blobs = [], bytes = 0, number = 0;
      const flush = () => {
        if (!blobs.length) return;
        const name = 'moodle-tests-' + (++number) + '.zip';
        const file = packageFolder.createFile(Utilities.zip(blobs, name));
        console.log(name + ': ' + blobs.length + ' тестов; ' + file.getUrl());
        blobs = []; bytes = 0;
      };
      for (const file of xmls) {
        const size = Number(file.getSize());
        if (size > 25 * 1024 * 1024) throw new Error(file.getName() + ': XML больше лимита Moodle 25 МБ.');
        if (blobs.length && (blobs.length >= CONFIG.ZIP_MAX_FORMS || bytes + size > CONFIG.ZIP_MAX_BYTES)) flush();
        blobs.push(file.getBlob().setName(file.getName())); bytes += size;
      }
      flush();
      console.log('Пакеты готовы: ' + packageFolder.getUrl());
    } finally { lock.releaseLock(); }
  }

  function id_(value) {
    const match = String(value).match(/\/d\/([^/]+)|\/folders\/([^/?]+)/);
    return match ? match[1] || match[2] : String(value).trim();
  }

  function readForm_(id) {
    const res = UrlFetchApp.fetch('https://forms.googleapis.com/v1/forms/' + encodeURIComponent(id), {
      headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode() + ': ' + res.getContentText());
    return JSON.parse(res.getContentText());
  }

  function put_(folder, name, content, mime) {
    const it = folder.getFilesByName(name);
    if (it.hasNext()) it.next().setContent(content);
    else folder.createFile(name, content, mime);
  }

  function saveNamedXml_(folder, id, title, xml) {
    const indexName = '__XML_NAMES.json';
    const iterator = folder.getFilesByName(indexName);
    const names = iterator.hasNext() ? JSON.parse(iterator.next().getBlob().getDataAsString()) : {};
    if (!names[id]) {
      const base = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-');
      let name = base + '.xml', number = 2;
      const used = new Set(Object.values(names));
      while (used.has(name) || folder.getFilesByName(name).hasNext()) name = base + ' (' + number++ + ').xml';
      names[id] = name;
      // Сохраняем имя до XML, чтобы повтор после сбоя использовал тот же файл.
      put_(folder, indexName, JSON.stringify(names), 'application/json');
    }
    put_(folder, names[id], xml, 'application/xml');
  }

  function germanTestName_(title) {
    const source = String(title || '').replace(/[Аа]/g, 'A').replace(/[Вв]/g, 'B').replace(/[Сс]/g, 'C');
    const books = ['Beste Freunde', 'Hallo Nachbarn 1', 'Hallo Nachbarn 2', 'Deutsch Profis',
      'Paul und Lisa', 'Planetino 1', 'Planetino 2', 'Planetino 3', 'Planet 1', 'Planet 2', 'Planet 3',
      'Menschen', 'Schritte', 'Sicher', 'Vielfalt', 'Prima', 'Genial', 'Dabei'];
    const book = books.find(value => source.toLowerCase().includes(value.toLowerCase())) || '';
    const level = (source.match(/(?:^|[^A-Za-z0-9])([ABC][12](?:[.,][12])?\+?)(?=$|[^A-Za-z0-9])/i) || [])[1] || '';
    const ages = [];
    // Возраст берём только из явно указанной группы, не из пометок об отсутствии данных.
    const original = String(title || '');
    if (/взросл|Erwachsene/i.test(original)) ages.push('Erwachsene');
    if (/молод[её]ж|junge Erwachsene/i.test(original)) ages.push('junge Erwachsene');
    if (/подрост|Jugendliche/i.test(original)) ages.push('Jugendliche');
    if (/(?:дети|детей|детск|Kinder)/i.test(original)) ages.push('Kinder');
    const age = [...new Set(ages)].join(' und ');
    const base = [book, level.toUpperCase().replace(',', '.')].filter(Boolean).join(' — ') || 'Allgemeiner Test';
    return [base, age].filter(Boolean).join(' — ');
  }

  function convert_(form, id) {
    const warnings = [];
    const category = CONFIG.CATEGORY + '/' + germanTestName_(form.info.documentTitle || form.info.title) + ' [' + id + ']';
    const parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<quiz>',
      '<question type="category"><category><text>' + esc_('$course$/top/' + category) + '</text></category></question>'];
    let count = 0, skipped = 0;
    if (form.info.description) {
      parts.push(description_('Инструкция', form.info.description)); count++;
    }
    (form.items || []).forEach((item, index) => {
      const name = (index + 1) + '. ' + (item.title || 'Без названия');
      const text = [item.title, item.description].filter(Boolean).join('\n\n');
      const image = (item.questionItem || {}).image || (item.imageItem || {}).image;
      const media = image ? imageMarkup_(image, 'item_' + index) : {html:'', files:''};
      if (item.questionGroupItem) {
        skipped += (item.questionGroupItem.questions || []).length;
        warnings.push(name + ': сетка пропущена; восстановите по оригиналу.'); return;
      }
      if (!item.questionItem) {
        if (item.videoItem) {
          const url = (item.videoItem.video || {}).youtubeUri;
          if (!url || !/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url))
            throw new Error(name + ': неизвестный адрес видео; экспорт остановлен.');
          media.html += '<p><a href="' + esc_(url) + '">Видео</a></p>';
          warnings.push(name + ': видео перенесено ссылкой YouTube, не локальным файлом.');
        }
        if (text || media.html) { parts.push(description_(name, text, media)); count++; }
        return;
      }
      const q = item.questionItem.question;
      const grading = q.grading || {};
      const keys = [...new Set(((grading.correctAnswers || {}).answers || []).map(a => a.value))];
      const originalPoints = Number(grading.pointValue || 0);
      if (originalPoints === 0 && /(?:\bФИО\b|ФИО|фамили[яю]|ваш[еи].{0,15}имя|имя.{0,15}фамили|имя преподавателя)/i.test(item.title || '')) {
        skipped++; warnings.push(name + ': поле имени/ФИО без баллов — пропущено.'); return;
      }
      const points = originalPoints > 0 ? originalPoints : 1;
      if (originalPoints === 0) warnings.push(name + ': учебное задание без баллов сохранено; назначен 1 балл.');
      if (q.choiceQuestion) {
        const c = q.choiceQuestion;
        const options = c.options || [];
        if (options.some(o => o.isOther || o.goToAction || o.goToSectionId))
          warnings.push(name + ': есть «Другое» или переход — проверьте вручную.');
        const values = options.filter(o => !o.isOther).map(o => o.value);
        const multiple = c.type === 'CHECKBOX';
        if (!keys.length || keys.some(k => !values.includes(k)) || (!multiple && keys.length !== 1) || new Set(values).size !== values.length) {
          let answerHtml = '<p>Варианты ответа:</p><ul>';
          let answerFiles = '';
          options.forEach((option, optionIndex) => {
            const optionMedia = option.image ? imageMarkup_(option.image, 'item_' + index + '_answer_' + optionIndex) : {html:'',files:''};
            answerHtml += '<li>' + htmlText_(option.isOther ? 'Другое' : option.value || '') + optionMedia.html + '</li>';
            answerFiles += optionMedia.files;
          });
          parts.push(base_('essay', name, text, points, grading, {html:media.html + answerHtml + '</ul>', files:media.files + answerFiles}) + '<responseformat>editor</responseformat><responserequired>1</responserequired><responsefieldlines>5</responsefieldlines><attachments>0</attachments><attachmentsrequired>0</attachmentsrequired></question>');
          count++; warnings.push(name + ': ключ отсутствует или неоднозначен; сохранены варианты, ответ вводится текстом и проверяется вручную.'); return;
        }
        let xml = base_('multichoice', name, text, points, grading, media);
        xml += '<single>' + (!multiple) + '</single><shuffleanswers>' + !!c.shuffle + '</shuffleanswers><answernumbering>abc</answernumbering>';
        options.filter(o => !o.isOther).forEach((option, optionIndex) => {
          const value = option.value;
          const fraction = keys.includes(value) ? 100 / keys.length : multiple ? -100 : 0;
          const answerMedia = option.image ? imageMarkup_(option.image, 'item_' + index + '_answer_' + optionIndex) : {html:'',files:''};
          xml += '<answer fraction="' + fraction.toFixed(7) + '" format="html"><text>' + esc_(htmlText_(value) + answerMedia.html) + '</text>' + answerMedia.files + '<feedback format="plain_text"><text></text></feedback></answer>';
        });
        if (multiple) warnings.push(name + ': Moodle даёт частичный балл за часть верных ответов; неверный вариант штрафуется. Проверьте отличие от Google Forms.');
        parts.push(xml + '</question>'); count++; return;
      }
      if (q.textQuestion) {
        if (!q.textQuestion.paragraph && keys.length) {
          let xml = base_('shortanswer', name, text, points, grading, media) + '<usecase>0</usecase>';
          keys.forEach(key => {
            // В Moodle звёздочка — шаблон. Экранируем буквальную звёздочку.
            xml += '<answer fraction="100" format="plain_text"><text>' + esc_(key.replace(/\*/g, '\\*')) + '</text></answer>';
          });
          parts.push(xml + '</question>');
          warnings.push(name + ': короткий ответ сравнивается без учёта регистра — проверьте допустимые ответы.');
        } else {
          parts.push(base_('essay', name, text, points, grading, media) + '<responseformat>editor</responseformat><responserequired>1</responserequired><responsefieldlines>10</responsefieldlines><attachments>0</attachments><attachmentsrequired>0</attachmentsrequired></question>');
          warnings.push(name + ': перенесён как эссе с ручной проверкой.');
        }
        count++; return;
      }
      skipped++; warnings.push(name + ': неподдерживаемый тип — пропущен.');
    });
    parts.push('</quiz>');
    return {xml: parts.join('\n'), count, skipped, warnings};
  }

  function base_(type, name, text, points, grading, media) {
    media = media || {html:'', files:''};
    let xml = '<question type="' + type + '"><name><text>' + esc_(name) + '</text></name>' +
      '<questiontext format="html"><text>' + esc_(htmlText_(text) + media.html) + '</text>' + media.files + '</questiontext>' +
      '<defaultgrade>' + points + '</defaultgrade><penalty>0</penalty><hidden>0</hidden>';
    const feedback = (grading.generalFeedback || {}).text || '';
    xml += '<generalfeedback format="plain_text"><text>' + esc_(feedback) + '</text></generalfeedback>';
    if (type === 'multichoice') {
      [['correctfeedback', grading.whenRight], ['incorrectfeedback', grading.whenWrong]].forEach(pair => {
        xml += '<' + pair[0] + ' format="plain_text"><text>' + esc_((pair[1] || {}).text || '') + '</text></' + pair[0] + '>';
      });
      xml += '<partiallycorrectfeedback format="plain_text"><text></text></partiallycorrectfeedback>';
    }
    return xml;
  }
  function description_(name, text, media) {
    return base_('description', name, text, 0, {}, media) + '</question>';
  }
  function htmlText_(text) { return '<p>' + esc_(text).replace(/\r?\n/g, '<br>') + '</p>'; }

  function imageMarkup_(image, stem) {
    const url = image.contentUri;
    if (!url || !/^https:\/\/[^/]+\.googleusercontent\.com\//i.test(url))
      throw new Error('Нет доступного Google contentUri для изображения ' + stem);
    // contentUri уже содержит временный доступ. OAuth-токен сторонним URL не отправляем.
    const response = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
    if (response.getResponseCode() !== 200)
      throw new Error('Изображение ' + stem + ': HTTP ' + response.getResponseCode() + '. Повторите экспорт для свежего contentUri.');
    const blob = response.getBlob();
    const mime = String(blob.getContentType()).split(';')[0].toLowerCase();
    const ext = {'image/png':'png', 'image/jpeg':'jpg', 'image/gif':'gif', 'image/webp':'webp'}[mime];
    if (!ext) throw new Error('Изображение ' + stem + ': неподдерживаемый MIME ' + mime);
    const bytes = blob.getBytes();
    if (!bytes.length || bytes.length > 10 * 1024 * 1024)
      throw new Error('Изображение ' + stem + ': пустое или больше 10 МБ.');
    const filename = stem + '.' + ext;
    const width = Number((image.properties || {}).width || 0);
    return {
      html: '<p><img src="@@PLUGINFILE@@/' + filename + '" alt="' + esc_(image.altText || '') + '"' + (width > 0 ? ' width="' + Math.round(width) + '"' : '') + '></p>',
      files: '<file name="' + filename + '" path="/" encoding="base64">' + Utilities.base64Encode(bytes) + '</file>',
    };
  }
  function esc_(value) {
    return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  // Создаёт новую папку для повторного экспорта; старые файлы сохраняются.
  function startNewExport() {
    stopFolderExport();
    PropertiesService.getScriptProperties().deleteProperty('OUTPUT_FOLDER');
    console.log('Следующий exportBatch создаст новую папку.');
  }

// Запустите ОДИН РАЗ: снимок всех форм непосредственно в SOURCE_FOLDER_ID.
// Автоматические продолжения не требуют открытой вкладки браузера.
function startFolderExport() {
  if (!CONFIG.SOURCE_FOLDER_ID) throw new Error('В начале кода заполните SOURCE_FOLDER_ID ссылкой на папку.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const oldId = props.getProperty('AUTO_JOB_ID');
    if (oldId) {
      const old = JSON.parse(DriveApp.getFileById(oldId).getBlob().getDataAsString());
      if (old.status !== 'complete') throw new Error('Есть незавершённый экспорт. Используйте resumeFolderExport или finishAndStartNewFolderExport.');
    }
    const source = DriveApp.getFolderById(id_(CONFIG.SOURCE_FOLDER_ID));
    const items = [];
    const iterator = source.getFilesByType('application/vnd.google-apps.form');
    while (iterator.hasNext()) {
      const file = iterator.next();
      items.push({id:file.getId(), title:file.getName(), status:'pending', attempts:0, error:''});
    }
    if (!items.length) throw new Error('В этой папке нет Google Forms. Вложенные папки автоматически не обходятся.');
    const folder = DriveApp.createFolder('Moodle XML — ' + source.getName() + ' — ' + new Date().toISOString().replace(/[:.]/g, '-'));
    const job = {status:'running', sourceId:source.getId(), sourceName:source.getName(), outputId:folder.getId(), items};
    const file = folder.createFile('__export_job.json', JSON.stringify(job), 'application/json');
    props.setProperty('AUTO_JOB_ID', file.getId());
    props.setProperty('OUTPUT_FOLDER', folder.getId());
    saveAutoJob_(file, job);
    installAutoTrigger_();
    console.log('Найдено форм: ' + items.length + '. Результаты: ' + folder.getUrl());
  } finally { lock.releaseLock(); }
  continueFolderExport();
}

function continueFolderExport() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // Другой пакет ещё выполняется.
  let jobFile, job;
  try {
    const jobId = PropertiesService.getScriptProperties().getProperty('AUTO_JOB_ID');
    if (!jobId) { removeAutoTriggers_(); return; }
    jobFile = DriveApp.getFileById(jobId);
    job = JSON.parse(jobFile.getBlob().getDataAsString());
    if (job.status !== 'running') { removeAutoTriggers_(); return; }
    const folder = DriveApp.getFolderById(job.outputId);
    const started = Date.now();
    let processed = 0;
    for (const item of job.items) {
      if (!['pending','working'].includes(item.status)) continue;
      if (processed >= CONFIG.MAX_FORMS_PER_RUN || Date.now() - started >= CONFIG.MAX_RUN_MS) break;
      if (folder.getFilesByName(item.id + '.report.txt').hasNext()) {
        item.status = 'done'; item.error = ''; saveAutoJob_(jobFile, job); continue;
      }
      if (item.attempts >= CONFIG.AUTO_MAX_ATTEMPTS) {
        item.status = 'error'; item.error = item.error || 'Исчерпаны попытки (возможен таймаут).';
        saveAutoJob_(jobFile, job); continue;
      }
      item.status = 'working'; item.attempts++;
      saveAutoJob_(jobFile, job); // Если Google прервёт запуск, очередь сохранена.
      processed++;
      try {
        const form = readForm_(item.id);
        const result = convert_(form, item.id);
        if (!result.count) throw new Error('Нет экспортируемых вопросов/описаний.');
        put_(folder, item.id + '.source.json', JSON.stringify(form, null, 2), 'application/json');
        saveNamedXml_(folder, item.id, germanTestName_(item.title || form.info.documentTitle || form.info.title), result.xml);
        put_(folder, item.id + '.report.txt',
          'Форма на Диске: ' + item.title + '\nНазвание внутри формы: ' + form.info.title + '\n' +
          'https://docs.google.com/forms/d/' + item.id + '/edit\n' +
          'Вопросов/описаний: ' + result.count + '\nПропущено: ' + result.skipped + '\n' +
          result.warnings.join('\n') + '\nНастройки теста, ветвления и ответы участников не переносятся.\n', 'text/plain');
        item.status = 'done'; item.error = '';
        console.log('Готово: ' + item.title);
      } catch (error) {
        item.error = String(error.message || error).slice(0, 1500);
        if (/SERVICE_DISABLED|ACCESS_TOKEN_SCOPE_INSUFFICIENT|HTTP 401|Authorization is required|Service invoked too many times|too much computer time/i.test(item.error)) {
          item.status = 'pending'; item.attempts--;
          throw error;
        }
        item.status = item.attempts >= CONFIG.AUTO_MAX_ATTEMPTS ? 'error' : 'pending';
        console.error(item.title + ': ' + item.error);
      }
      saveAutoJob_(jobFile, job);
    }
    if (!job.items.some(item => ['pending','working'].includes(item.status))) {
      job.status = 'complete';
      removeAutoTriggers_();
    }
    saveAutoJob_(jobFile, job);
    console.log(autoSummary_(job));
    console.log('Результаты: ' + folder.getUrl());
  } catch (error) {
    if (job && jobFile) {
      job.status = 'paused'; job.lastError = String(error.message || error).slice(0, 1500);
      try { saveAutoJob_(jobFile, job); } catch (_) {}
    }
    removeAutoTriggers_();
    throw error;
  } finally { lock.releaseLock(); }
}

function saveAutoJob_(file, job) {
  job.updated = new Date().toISOString();
  file.setContent(JSON.stringify(job));
  const errors = job.items.filter(item => item.status === 'error').map(item => item.title + ': ' + item.error);
  put_(DriveApp.getFolderById(job.outputId), '__EXPORT_STATUS.txt',
    autoSummary_(job) + '\nИсточник: ' + job.sourceName + '\nОбновлено (UTC): ' + job.updated + '\n' +
    (job.lastError ? 'Причина остановки: ' + job.lastError + '\n' : '') +
    'Ошибки форм:\n' + (errors.join('\n') || 'Нет окончательных ошибок.') + '\n', 'text/plain');
}

function autoSummary_(job) {
  return 'Статус: ' + job.status + '; всего: ' + job.items.length +
    '; готово: ' + job.items.filter(item => item.status === 'done').length +
    '; ошибок: ' + job.items.filter(item => item.status === 'error').length +
    '; осталось: ' + job.items.filter(item => ['pending','working'].includes(item.status)).length;
}

function installAutoTrigger_() {
  removeAutoTriggers_();
  ScriptApp.newTrigger('continueFolderExport').timeBased().everyMinutes(5).create();
}

function removeAutoTriggers_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'continueFolderExport')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function showFolderExportStatus() {
  const id = PropertiesService.getScriptProperties().getProperty('AUTO_JOB_ID');
  if (!id) throw new Error('Автоматический экспорт ещё не запускался.');
  const job = JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());
  console.log(autoSummary_(job));
  console.log('Результаты: ' + DriveApp.getFolderById(job.outputId).getUrl());
}

function stopFolderExport() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    removeAutoTriggers_();
    const id = PropertiesService.getScriptProperties().getProperty('AUTO_JOB_ID');
    if (!id) return;
    const file = DriveApp.getFileById(id);
    const job = JSON.parse(file.getBlob().getDataAsString());
    if (job.status !== 'complete') { job.status = 'paused'; saveAutoJob_(file, job); }
  } finally { lock.releaseLock(); }
}

function resumeFolderExport() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const id = PropertiesService.getScriptProperties().getProperty('AUTO_JOB_ID');
    if (!id) throw new Error('Сначала запустите startFolderExport.');
    const file = DriveApp.getFileById(id);
    const job = JSON.parse(file.getBlob().getDataAsString());
    job.status = 'running'; delete job.lastError;
    saveAutoJob_(file, job);
    installAutoTrigger_();
  } finally { lock.releaseLock(); }
  continueFolderExport();
}

// Повторяет только формы с окончательной ошибкой; готовые XML не дублируются.
function retryFailedFolderForms() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const id = PropertiesService.getScriptProperties().getProperty('AUTO_JOB_ID');
    if (!id) throw new Error('Нет задания экспорта.');
    const file = DriveApp.getFileById(id);
    const job = JSON.parse(file.getBlob().getDataAsString());
    job.items.filter(item => item.status === 'error').forEach(item => { item.status = 'pending'; item.attempts = 0; item.error = ''; });
    saveAutoJob_(file, job);
  } finally { lock.releaseLock(); }
  resumeFolderExport();
}

// Начинает новый снимок папки, сохраняя все предыдущие файлы.
function finishAndStartNewFolderExport() {
  stopFolderExport();
  PropertiesService.getScriptProperties().deleteProperty('AUTO_JOB_ID');
  startFolderExport();
}
