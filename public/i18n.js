/* public/i18n.js — Uzbek / English / Russian for the whole web app, no framework.
 *
 * How it works
 *  - Language = the user's choice (localStorage "sherz_lang": auto | uz | en | ru) or, on "auto", the device language
 *    (navigator.languages → first of uz / ru / en; anything else → en).
 *  - Every UI string lives ONCE in DICT as [en, uz, ru]. A string found anywhere in the page (in ANY of the three languages, the app grew
 *    up mixed) is swapped for the chosen language: text nodes, placeholder / title / aria-label / alt, and text that scripts add later
 *    (a MutationObserver watches the page). Entries may contain {0} {1} slots for numbers / names.
 *  - Chat messages, project names, file names and anything the user or the AI wrote are NOT touched (see skip()).
 *  - Scripts can call SherzI18n.t('Teach a skill') or SherzI18n.t('Show all ({0})', [31]); SherzI18n.lang is sent with every chat request.
 *  - Longer sentences with inline markup use data-i18n-html="<key>" and HTMLD below (static, trusted text only).
 */
(function () {
  'use strict';
  const SUP = ['uz', 'en', 'ru'], KEY = 'sherz_lang', IDX = { en: 0, uz: 1, ru: 2 };

  /* ───────────── dictionary: [English, O‘zbek, Русский] ───────────── */
  const D = [
    // — sidebar / menu —
    ['Menu', 'Menyu', 'Меню'],
    ['Companion', 'Hamroh', 'Компаньон'],
    ['Your personal thread · always here', 'Shaxsiy suhbatingiz · doim shu yerda', 'Ваш личный чат · всегда рядом'],
    ['Open your Companion thread', 'Hamroh suhbatini ochish', 'Открыть чат с компаньоном'],
    ['Companion — your personal thread', 'Hamroh — sizning shaxsiy suhbatingiz', 'Компаньон — ваш личный чат'],
    ['Work', 'Ish', 'Работа'],
    ['Work Spaces', 'Ish maydonlari', 'Рабочие пространства'],
    ['Your Work Spaces', 'Sizning ish maydonlaringiz', 'Ваши рабочие пространства'],
    ['Choose a Work Space', 'Ish maydonini tanlang', 'Выберите рабочее пространство'],
    ['Choose your Work Space', 'Ish maydoningizni tanlang', 'Выберите своё рабочее пространство'],
    ['Create your Work Space', 'Ish maydoningizni yarating', 'Создайте своё рабочее пространство'],
    ['A job profile with its own rules and skills', 'O‘z qoidalari va ko‘nikmalariga ega ish profili', 'Рабочий профиль со своими правилами и навыками'],
    ['Pick a role or describe yours', 'Rolni tanlang yoki o‘zingizniki haqida yozing', 'Выберите роль или опишите свою'],
    ['You have older Spaces — keep one', 'Eski maydonlaringiz bor — bittasini qoldiring', 'У вас есть старые пространства — оставьте одно'],
    ['Keep one…', 'Bittasini qoldirish…', 'Оставить одно…'],
    ['★ Skills', '★ Ko‘nikmalar', '★ Навыки'],
    ['Skills', 'Ko‘nikmalar', 'Навыки'],
    ['Role & Rules', 'Rol va qoidalar', 'Роль и правила'],
    ['+ Add Persona', '+ Persona qo‘shish', '+ Добавить персону'],
    ['No Work Space yet.', 'Hali ish maydoni yo‘q.', 'Рабочего пространства пока нет.'],
    ['Role {0} · active · {1}', '{0}-rol · faol · {1}', 'Роль {0} · активна · {1}'],
    ['Role {0} · {1}', '{0}-rol · {1}', 'Роль {0} · {1}'],
    ['Projects', 'Loyihalar', 'Проекты'],
    ['New Project', 'Yangi loyiha', 'Новый проект'],
    ['New Project (Ctrl+Shift+O)', 'Yangi loyiha (Ctrl+Shift+O)', 'Новый проект (Ctrl+Shift+O)'],
    ['Project name', 'Loyiha nomi', 'Название проекта'],
    ['e.g. E-commerce Backend', 'masalan, Onlayn do‘kon backend', 'например, бэкенд интернет-магазина'],
    ['Goal / stack', 'Maqsad / texnologiyalar', 'Цель / стек'],
    ['optional', 'ixtiyoriy', 'необязательно'],
    ['Node, Postgres, Stripe…', 'Node, Postgres, Stripe…', 'Node, Postgres, Stripe…'],
    ['Create project', 'Loyiha yaratish', 'Создать проект'],
    ['Cancel', 'Bekor qilish', 'Отмена'],
    ['Search projects…', 'Loyihalarni qidirish…', 'Поиск проектов…'],
    ['Search projects', 'Loyihalarni qidirish', 'Поиск проектов'],
    ['Clear search', 'Qidiruvni tozalash', 'Очистить поиск'],
    ['Close', 'Yopish', 'Закрыть'],
    ['Close menu', 'Menyuni yopish', 'Закрыть меню'],
    ['Menu (chats)', 'Menyu (suhbatlar)', 'Меню (чаты)'],
    ['Conversations', 'Suhbatlar', 'Беседы'],
    ['No projects yet', 'Hali loyiha yo‘q', 'Проектов пока нет'],
    ['A project is a focused workspace for code, architecture or strategy. SHERZ switches to Work mode inside it.', 'Loyiha — kod, arxitektura yoki strategiya uchun alohida ish maydoni. Uning ichida SHERZ Ish rejimiga o‘tadi.', 'Проект — отдельное рабочее место для кода, архитектуры или стратегии. Внутри него SHERZ переходит в рабочий режим.'],
    ['Create your first project', 'Birinchi loyihangizni yarating', 'Создайте первый проект'],
    ['Couldn’t load your workspace. Check the connection.', 'Ish maydoningizni yuklab bo‘lmadi. Ulanishni tekshiring.', 'Не удалось загрузить рабочее пространство. Проверьте соединение.'],
    ['Couldn’t switch the role.', 'Rolni almashtirib bo‘lmadi.', 'Не удалось сменить роль.'],
    ['Couldn’t open the Work Space.', 'Ish maydonini ochib bo‘lmadi.', 'Не удалось открыть рабочее пространство.'],
    ['Second role removed.', 'Ikkinchi rol olib tashlandi.', 'Вторая роль удалена.'],
    ['Your Work Space is set.', 'Ish maydoningiz tayyor.', 'Ваше рабочее пространство готово.'],
    ['Couldn’t rename the project.', 'Loyiha nomini o‘zgartirib bo‘lmadi.', 'Не удалось переименовать проект.'],
    ['Project deleted.', 'Loyiha o‘chirildi.', 'Проект удалён.'],
    ['Couldn’t delete the project.', 'Loyihani o‘chirib bo‘lmadi.', 'Не удалось удалить проект.'],
    ['Show all ({0})', 'Hammasini ko‘rsatish ({0})', 'Показать все ({0})'],
    ['Show less', 'Kamroq ko‘rsatish', 'Показать меньше'],
    // — account card / appearance hub —
    ['Account & appearance', 'Hisob va ko‘rinish', 'Аккаунт и оформление'],
    ['Appearance and tools', 'Ko‘rinish va vositalar', 'Оформление и инструменты'],
    ['Guest', 'Mehmon', 'Гость'],
    ['Guest session', 'Mehmon sessiyasi', 'Гостевой сеанс'],
    ['Not signed in', 'Tizimga kirilmagan', 'Вход не выполнен'],
    ['Signed in · active', 'Tizimga kirgan · faol', 'Вы вошли · активно'],
    ['Guest · temporary', 'Mehmon · vaqtinchalik', 'Гость · временно'],
    ['Server · active', 'Server · faol', 'Сервер · работает'],
    ['Server · unreachable', 'Server · ulanib bo‘lmadi', 'Сервер · недоступен'],
    ['Server · checking…', 'Server · tekshirilmoqda…', 'Сервер · проверка…'],
    ['Log out', 'Chiqish', 'Выйти'],
    ['Sign in with Google to keep your chats', 'Suhbatlaringizni saqlash uchun Google orqali kiring', 'Войдите через Google, чтобы сохранить чаты'],
    ['Appearance', 'Ko‘rinish', 'Оформление'],
    ['Theme', 'Mavzu', 'Тема'],
    ['System', 'Tizim', 'Системная'],
    ['Dark', 'Qorong‘i', 'Тёмная'],
    ['Light', 'Yorug‘', 'Светлая'],
    ['Accent glow', 'Urg‘u rangi', 'Цвет акцента'],
    ['Violet', 'Binafsha', 'Фиолетовый'],
    ['Emerald', 'Zumrad', 'Изумрудный'],
    ['Neon Blue', 'Neon ko‘k', 'Неоновый синий'],
    ['Auto', 'Avto', 'Авто'],
    ['Auto: violet for Companion, emerald for projects', 'Avto: Hamroh uchun binafsha, loyihalar uchun zumrad', 'Авто: фиолетовый для компаньона, изумрудный для проектов'],
    ['Language', 'Til', 'Язык'],
    ['🗑 Delete this project', '🗑 Bu loyihani o‘chirish', '🗑 Удалить этот проект'],
    ['↻ Refresh', '↻ Yangilash', '↻ Обновить'],
    // — top bar / status / brain panel —
    ['Here', 'Shu yerda', 'Здесь'],
    ['Thinking', 'O‘ylamoqda', 'Думает'],
    ['Transcribing', 'Matnga aylantirmoqda', 'Расшифровка'],
    ['Listening', 'Tinglamoqda', 'Слушает'],
    ['Replying', 'Javob bermoqda', 'Отвечает'],
    ['Speaking', 'Gapirmoqda', 'Говорит'],
    ['Brain', 'Miya', 'Мозг'],
    ['Brain panel', 'Miya paneli', 'Панель мозга'],
    ['Active Model', 'Faol model', 'Активная модель'],
    ['Thinking Mode', 'Fikrlash rejimi', 'Режим мышления'],
    ['Casual Companion & Long-Term Memory', 'Oddiy hamroh va uzoq muddatli xotira', 'Непринуждённый компаньон и долговременная память'],
    ['Work mode', 'Ish rejimi', 'Рабочий режим'],
    ['SHERZ holati', 'SHERZ holati', 'Состояние SHERZ'],
    // — composer —
    ['Ask anything...', 'Istalgan narsani so‘rang...', 'Спросите что угодно...'],
    ['Describe the task or paste code...', 'Vazifani tasvirlang yoki kodni joylang...', 'Опишите задачу или вставьте код...'],
    ['What’s on your mind?', 'Nima o‘ylayapsan?', 'О чём думаешь?'],
    ['Say what’s inside — I’m listening.', 'Ichingdagini ayt — men tinglayman.', 'Расскажи, что на душе — я слушаю.'],
    ['What happened today?', 'Bugun nimalar bo‘ldi?', 'Что сегодня было?'],
    ['Got a problem? We’ll solve it together.', 'Bir muammo bormi? Birga yechamiz.', 'Есть проблема? Решим вместе.'],
    ['Shall we just talk?', 'Shunchaki gaplashamizmi?', 'Просто поговорим?'],
    ['You are offline. SHERZ will reconnect by itself.', 'Internet yo‘q. SHERZ o‘zi qayta ulanadi.', 'Нет интернета. SHERZ подключится сам.'],
    ['Back online', 'Internet qaytdi', 'Связь восстановлена'],
    ['Desktop app', 'Kompyuter ilovasi', 'Приложение для компьютера'],
    ['Keep running in the tray when closed', 'Yopilganda tray da ishlashda qolsin', 'Работать в трее после закрытия'],
    ['Start with the computer', 'Kompyuter bilan birga ishga tushsin', 'Запускать вместе с компьютером'],
    ['Hotkey: {0}', 'Tezkor tugma: {0}', 'Горячая клавиша: {0}'],
    ['SHERZ is AI and can make mistakes.', 'SHERZ — bu AI. U xato qilishi mumkin.', 'SHERZ — это ИИ. Он может ошибаться.'],
    ['Tap to talk', 'Gapirish uchun bosing', 'Нажмите, чтобы говорить'],
    ['Chat bar', 'Yozish paneli', 'Панель ввода'],
    ['Toggle chat bar', 'Yozish panelini almashtirish', 'Показать/скрыть панель ввода'],
    ['↓ Latest', '↓ Eng so‘nggisi', '↓ К последнему'],
    // — Work Space chat card —
    ['Work Space', 'Ish maydoni', 'Рабочее пространство'],
    ['This Space has its own role, rules and skills, separate from your Companion thread. Teach it procedures and it will use them when your message matches.', 'Bu maydonning o‘z roli, qoidalari va ko‘nikmalari bor — Hamroh suhbatingizdan alohida. Unga tartib-qoidalarni o‘rgating, xabaringizga mos kelganda ulardan foydalanadi.', 'У этого пространства своя роль, правила и навыки — отдельно от вашего чата с компаньоном. Научите его процедурам, и он будет применять их, когда сообщение подойдёт.'],
    ['What can you do here?', 'Bu yerda nima qila olasan?', 'Что ты умеешь здесь?'],
    ['Teach a skill', 'Ko‘nikma o‘rgatish', 'Научить навыку'],
    ['Edit this Space', 'Bu maydonni tahrirlash', 'Изменить это пространство'],
    // — Work Space create / edit sheet —
    ['New Work Space', 'Yangi ish maydoni', 'Новое рабочее пространство'],
    ['Add a second role', 'Ikkinchi rol qo‘shish', 'Добавить вторую роль'],
    ['Profile', 'Profil', 'Профиль'],
    ['Describe your role', 'O‘z rolingizni tasvirlang', 'Опишите свою роль'],
    ['e.g. customs broker, ward nurse, wedding photographer…', 'masalan, bojxona brokeri, hamshira, to‘y fotografi…', 'например, таможенный брокер, медсестра, свадебный фотограф…'],
    ['✨ Generate', '✨ Yaratish', '✨ Сгенерировать'],
    ['or pick a role', 'yoki rolni tanlang', 'или выберите роль'],
    ['Role categories', 'Rol toifalari', 'Категории ролей'],
    ['Name', 'Nomi', 'Название'],
    ['Name of this Work Space', 'Bu ish maydonining nomi', 'Название этого пространства'],
    ['Role', 'Rol', 'Роль'],
    ['what SHERZ acts as', 'SHERZ kim sifatida ishlaydi', 'кем выступает SHERZ'],
    ['e.g. Customs clearance assistant', 'masalan, bojxona rasmiylashtiruvi yordamchisi', 'например, помощник по таможенному оформлению'],
    ['Instructions', 'Ko‘rsatmalar', 'Инструкции'],
    ['your rules for this Space', 'bu maydon uchun qoidalaringiz', 'ваши правила для этого пространства'],
    ['How should SHERZ work here? Formats, rules, things to never do…', 'SHERZ bu yerda qanday ishlashi kerak? Formatlar, qoidalar, hech qachon qilinmaydigan ishlar…', 'Как SHERZ должен здесь работать? Форматы, правила, чего никогда не делать…'],
    ['~{0} tokens added to every message · {1}/{2} characters of instructions', 'Har bir xabarga ~{0} token qo‘shiladi · ko‘rsatmalar {1}/{2} belgi', 'К каждому сообщению добавляется ~{0} токенов · инструкции {1}/{2} символов'],
    ['Work style', 'Ish uslubi', 'Стиль работы'],
    ['Balanced', 'Muvozanatli', 'Сбалансированный'],
    ['Clear all-rounder for everyday work', 'Kundalik ish uchun aniq va ko‘p qirrali', 'Понятный универсал для повседневной работы'],
    ['Analytical', 'Tahliliy', 'Аналитический'],
    ['Structured reasoning, numbers, assumptions, sources', 'Tuzilgan fikrlash, raqamlar, farazlar, manbalar', 'Структурное мышление, цифры, допущения, источники'],
    ['Technical / Code', 'Texnik / Kod', 'Технический / Код'],
    ['Complete code, minimal diffs, edge cases', 'To‘liq kod, minimal o‘zgarishlar, chekka holatlar', 'Полный код, минимальные правки, крайние случаи'],
    ['Fast operational', 'Tezkor operativ', 'Быстрый оперативный'],
    ['Short, action-first, checklists and ready-to-send text', 'Qisqa, harakatga yo‘naltirilgan, cheklistlar va yuborishga tayyor matn', 'Коротко, сразу к делу, чек-листы и готовые к отправке тексты'],
    ['Formal corporate', 'Rasmiy korporativ', 'Официально-деловой'],
    ['Polished, precise, neutral business register', 'Sayqallangan, aniq, neytral ish uslubi', 'Выверенный, точный, нейтральный деловой тон'],
    ['Create Work Space', 'Ish maydonini yaratish', 'Создать пространство'],
    ['Add role', 'Rolni qo‘shish', 'Добавить роль'],
    ['Save', 'Saqlash', 'Сохранить'],
    ['Save changes', 'O‘zgarishlarni saqlash', 'Сохранить изменения'],
    ['Archive', 'Arxivlash', 'В архив'],
    ['Delete forever', 'Butunlay o‘chirish', 'Удалить навсегда'],
    ['Remove this role', 'Bu rolni olib tashlash', 'Убрать эту роль'],
    ['Logistics', 'Logistika', 'Логистика'],
    ['Finance & Economics', 'Moliya va iqtisodiyot', 'Финансы и экономика'],
    ['Software Engineering', 'Dasturiy injiniring', 'Разработка ПО'],
    ['Creative & Marketing', 'Ijod va marketing', 'Творчество и маркетинг'],
    ['Academic', 'Akademik', 'Академическое'],
    // — skills —
    ['Teach a skill', 'Ko‘nikma o‘rgatish', 'Научить навыку'],
    ['Skill name, e.g. Weekly report', 'Ko‘nikma nomi, masalan, Haftalik hisobot', 'Название навыка, например, Еженедельный отчёт'],
    ['One line: when to use it', 'Bir qatorda: qachon ishlatiladi', 'Одной строкой: когда применять'],
    ['Steps, one per line', 'Qadamlar, har bir qatorda bittadan', 'Шаги, по одному в строке'],
    ['Trigger words, comma separated (optional)', 'Ishga tushiruvchi so‘zlar, vergul bilan (ixtiyoriy)', 'Ключевые слова через запятую (необязательно)'],
    ['Save skill', 'Ko‘nikmani saqlash', 'Сохранить навык'],
    ['Cancel edit', 'Tahrirni bekor qilish', 'Отменить правку'],
    // — pick-one dialog —
    ['Keep this Work Space', 'Shu ish maydonini qoldirish', 'Оставить это пространство'],
    ['Optional: add another as your second role', 'Ixtiyoriy: yana birini ikkinchi rol sifatida qo‘shing', 'По желанию: добавьте ещё одно как вторую роль'],
    ['Later', 'Keyinroq', 'Позже'],
    // — files / plan cards / progress —
    ['Approve & Execute', 'Tasdiqlash va bajarish', 'Одобрить и выполнить'],
    ['Reject', 'Rad etish', 'Отклонить'],
    ['Edit', 'Tahrirlash', 'Изменить'],
    ['Running…', 'Bajarilmoqda…', 'Выполняется…'],
    ['✓ Executed', '✓ Bajarildi', '✓ Выполнено'],
    ['✗ Stopped — a step failed', '✗ To‘xtadi — bir qadam bajarilmadi', '✗ Остановлено — шаг не удался'],
    ['Rejected — nothing was run', 'Rad etildi — hech narsa bajarilmadi', 'Отклонено — ничего не выполнялось'],
    ['Expired — nothing was run', 'Muddati o‘tdi — hech narsa bajarilmadi', 'Истекло — ничего не выполнялось'],
    ['✓ Created — you asked for it in this chat', '✓ Yaratildi — buni shu suhbatda so‘ragansiz', '✓ Создано — вы попросили об этом в этом чате'],
    ['✓ Created — you asked for it in this chat · saved to your device', '✓ Yaratildi — buni shu suhbatda so‘ragansiz · qurilmangizga saqlandi', '✓ Создано — вы попросили об этом в этом чате · сохранено на устройство'],
    ['Why didn’t SHERZ ask first?', 'SHERZ nega avval so‘ramadi?', 'Почему SHERZ не спросил сначала?'],
    ['Low risk', 'Past xavf', 'Низкий риск'],
    ['Medium risk', 'O‘rtacha xavf', 'Средний риск'],
    ['High risk', 'Yuqori xavf', 'Высокий риск'],
    ['Runs on your computer', 'Kompyuteringizda bajariladi', 'Выполняется на вашем компьютере'],
    ['⬇ Download {0}', '⬇ {0} yuklab olish', '⬇ Скачать {0}'],
    ['Download failed — it may have been deleted', 'Yuklab bo‘lmadi — o‘chirilgan bo‘lishi mumkin', 'Не удалось скачать — возможно, файл удалён'],
    ['The picture could not be shown — use Download.', 'Rasmni ko‘rsatib bo‘lmadi — «Yuklab olish» dan foydalaning.', 'Не удалось показать картинку — используйте «Скачать».'],
    ['The picture is not available any more (it may have been deleted).', 'Rasm endi mavjud emas (o‘chirilgan bo‘lishi mumkin).', 'Картинка больше недоступна (возможно, удалена).'],
    ['🎨 Generating the picture…', '🎨 Rasm chizilmoqda…', '🎨 Рисую картинку…'],
    ['⏳ Generating {0}…', '⏳ {0} yaratilmoqda…', '⏳ Создаю {0}…'],
    ['⏳ Generating…', '⏳ Yaratilmoqda…', '⏳ Создаю…'],
    ['⏳ Generating your file…', '⏳ Faylingiz yaratilmoqda…', '⏳ Создаю ваш файл…'],
    ['Saved {0} ({1} B)', '{0} saqlandi ({1} B)', 'Сохранено: {0} ({1} Б)'],
    ['Updated {0} ({1} B)', '{0} yangilandi ({1} B)', 'Обновлено: {0} ({1} Б)'],
    ['Deleted {0}', '{0} o‘chirildi', 'Удалено: {0}'],
    ['No files yet', 'Hali fayllar yo‘q', 'Файлов пока нет'],
    ['No reminders', 'Eslatma yo‘q', 'Напоминаний нет'],
    ['Load error', 'Yuklashda xato', 'Ошибка загрузки'],
    ['Not yet', 'Hali yo‘q', 'Пока нет'],
  ];

  /* sentences with inline markup (trusted, static) — used by elements carrying data-i18n-html="key" */
  const HTMLD = {
    pfHint: ['Inside a project SHERZ switches to <b>Work mode</b>: deep problem solving, code and architecture.', 'Loyiha ichida SHERZ <b>Ish rejimiga</b> o‘tadi: chuqur muammo yechish, kod va arxitektura.', 'Внутри проекта SHERZ переходит в <b>рабочий режим</b>: глубокое решение задач, код и архитектура.'],
    pkText: ['SHERZ now keeps <b>one</b> Work Space per person, with up to <b>two roles</b> inside it. Pick the one to keep. Nothing is deleted: the others are archived.', 'SHERZ endi har bir kishiga <b>bitta</b> ish maydonini beradi, uning ichida <b>ikkitagacha rol</b> bo‘ladi. Qoldiradiganini tanlang. Hech narsa o‘chirilmaydi: qolganlari arxivlanadi.', 'Теперь у каждого человека <b>одно</b> рабочее пространство, а внутри него — до <b>двух ролей</b>. Выберите, какое оставить. Ничего не удаляется: остальные уйдут в архив.'],
    spHint: ['Skills are procedures you teach this Space. SHERZ uses the ones that match your message. Levels come from your approvals, never from SHERZ’s own opinion.', 'Ko‘nikmalar — bu maydonga o‘rgatadigan tartib-qoidalaringiz. SHERZ xabaringizga mos keladiganlaridan foydalanadi. Darajalar sizning tasdiqlaringizdan keladi, SHERZ ning o‘z fikridan emas.', 'Навыки — это процедуры, которым вы обучаете это пространство. SHERZ применяет те, что подходят к сообщению. Уровни зависят от ваших одобрений, а не от мнения самого SHERZ.'],
  };
  const LANG_NAME = { uz: 'O‘zbek', en: 'English', ru: 'Русский' };

  /* ───────────── matching ───────────── */
  const norm = (s) => String(s).replace(/[‘’ʻʼ`´]/g, "'").replace(/…/g, '...').replace(/\s+/g, ' ').trim();
  const exact = new Map(), pats = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const entry of D) {
    for (const s of entry) {
      const k = norm(s);
      if (/\{\d\}/.test(k)) {
        const re = new RegExp('^' + esc(k).replace(/\\\{\d\\\}/g, '(.+?)') + '$');
        pats.push({ re, entry });
      } else if (!exact.has(k)) exact.set(k, entry);
    }
  }
  const lookup = (core) => exact.get(core) || null;
  const fill = (tpl, caps, lang) => String(tpl).replace(/\{(\d)\}/g, (_, i) => { const c = caps[+i]; if (c == null) return ''; const e = lookup(norm(c)); return e ? e[IDX[lang]] : c; });

  function translate(str, lang) {
    const raw = String(str);
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw); if (!m || !m[2] || m[2].length > 400) return raw;
    const core = norm(m[2]); if (!/[\p{L}]/u.test(core)) return raw;
    const e = lookup(core);
    if (e) return m[1] + e[IDX[lang]] + m[3];
    for (const p of pats) {
      const x = p.re.exec(core);
      if (x) { const out = fill(p.entry[IDX[lang]], x.slice(1), lang); return m[1] + out + m[3]; }
    }
    return raw;
  }

  /* ───────────── language choice ───────────── */
  const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };
  const readPref = () => { const v = safe(() => localStorage.getItem(KEY), null); return v === 'uz' || v === 'en' || v === 'ru' ? v : 'auto'; };
  function detect() {
    const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']);
    for (const l of list) { const c = String(l || '').toLowerCase().slice(0, 2); if (SUP.includes(c)) return c; }
    return 'en';
  }
  const S = { pref: readPref(), lang: 'en' };
  const resolve = () => (S.pref === 'auto' ? detect() : S.pref);
  S.lang = resolve();
  const listeners = [];

  /* ───────────── applying to the page ───────────── */
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const UI_CARDS = '.space-intro,.project-intro,.plan-card,.gen-progress,.helper-card,.files-card,.agent-notice,.conv-empty';
  function skip(el, attrs) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest(attrs ? '[data-no-i18n]' : 'script,style,textarea,input,select,code,pre,[contenteditable="true"],[data-no-i18n],[data-i18n-html]')) return true;
    const log = el.closest('#log');
    return !!(log && !el.closest(UI_CARDS));                         // chat messages (yours and the AI's) are never translated
  }
  let applying = false;
  function doText(node) {
    const p = node.parentElement; if (!p || skip(p)) return;
    const t = translate(node.nodeValue, S.lang); if (t !== node.nodeValue) node.nodeValue = t;
  }
  function doAttrs(el) {
    if (skip(el, true)) return;
    for (const a of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      const v = el.getAttribute(a), t = translate(v, S.lang); if (t !== v) el.setAttribute(a, t);
    }
  }
  function doHtml(el) {
    const k = el.getAttribute('data-i18n-html'), d = HTMLD[k]; if (!d) return;
    const h = d[IDX[S.lang]]; if (el.getAttribute('data-i18n-done') !== S.lang) { el.innerHTML = h; el.setAttribute('data-i18n-done', S.lang); }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches('[data-i18n-html]')) return doHtml(root);
    doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && n.matches('script,style,[data-no-i18n]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let n; const texts = [], els = [];
    while ((n = tw.nextNode())) (n.nodeType === 3 ? texts : els).push(n);
    els.forEach((e) => { if (e.hasAttribute('data-i18n-html')) doHtml(e); else doAttrs(e); });
    texts.forEach(doText);
  }
  function applyAll() {
    applying = true;
    try {
      document.documentElement.setAttribute('lang', S.lang);
      walk(document.body);
      syncSelector();
    } finally { applying = false; if (mo) mo.takeRecords(); }
  }
  let mo = null, queue = [], scheduled = false;
  function flush() {
    scheduled = false; const q = queue; queue = []; applying = true;
    try {
      for (const r of q) {
        if (r.type === 'childList') r.addedNodes.forEach((n) => { if (n.nodeType === 1 || n.nodeType === 3) walk(n); });
        else if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') doAttrs(r.target);
      }
    } finally { applying = false; if (mo) mo.takeRecords(); }
  }
  function startObserver() {
    if (typeof MutationObserver !== 'function') return;
    mo = new MutationObserver((recs) => {
      if (applying) return;
      queue.push(...recs);
      if (!scheduled) { scheduled = true; (window.queueMicrotask || ((f) => Promise.resolve().then(f)))(flush); }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  /* ───────────── the language picker in the Appearance hub ───────────── */
  function syncSelector() {
    document.querySelectorAll('[data-lang-pref]').forEach((b) => {
      const on = b.getAttribute('data-lang-pref') === S.pref;
      b.setAttribute('aria-checked', on ? 'true' : 'false'); b.classList.toggle('on', on);
    });
  }
  function setLang(pref) {
    S.pref = pref === 'uz' || pref === 'en' || pref === 'ru' ? pref : 'auto';
    safe(() => (S.pref === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, S.pref)));
    const prev = S.lang; S.lang = resolve();
    document.querySelectorAll('[data-i18n-html]').forEach((e) => e.removeAttribute('data-i18n-done'));
    applyAll();
    if (prev !== S.lang) listeners.forEach((f) => safe(() => f(S.lang)));
    return S.lang;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-lang-pref]'); if (!b) return;
    e.preventDefault(); e.stopPropagation(); setLang(b.getAttribute('data-lang-pref'));
  });
  window.addEventListener('languagechange', () => { if (S.pref === 'auto') setLang('auto'); });

  window.SherzI18n = {
    get lang() { return S.lang; }, get pref() { return S.pref; }, supported: SUP.slice(), names: LANG_NAME,
    setLang, detect, translate: (s, l) => translate(s, l || S.lang), onChange: (f) => { if (typeof f === 'function') listeners.push(f); },
    t(key, vars) { const e = lookup(norm(key)); let out = e ? e[IDX[S.lang]] : String(key); if (vars) out = out.replace(/\{(\d)\}/g, (_, i) => (vars[+i] == null ? '' : String(vars[+i]))); return out; },
    _dict: D, _html: HTMLD,
  };

  function boot() { applyAll(); startObserver(); }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
