// Words the desktop shell itself shows (tray menu, notifications). The page tells us the language through SherzNativeHost.setLanguage().
const T = {
  open:     { en: 'Open SHERZ', uz: 'SHERZ ni ochish', ru: 'Открыть SHERZ' },
  hotkey:   { en: 'Hotkey: {0}', uz: 'Tezkor tugma: {0}', ru: 'Горячая клавиша: {0}' },
  tray:     { en: 'Keep running in the tray when closed', uz: 'Yopilganda tray da ishlashda qolsin', ru: 'Работать в трее после закрытия' },
  login:    { en: 'Start with the computer', uz: 'Kompyuter bilan birga ishga tushsin', ru: 'Запускать вместе с компьютером' },
  quit:     { en: 'Quit SHERZ', uz: 'SHERZ dan chiqish', ru: 'Выйти из SHERZ' },
  saved:    { en: 'Saved to Downloads', uz: 'Yuklamalar papkasiga saqlandi', ru: 'Сохранено в «Загрузки»' },
  upd:      { en: 'Check for updates', uz: 'Yangilanishni tekshirish', ru: 'Проверить обновления' },
  updReady: { en: 'SHERZ {0} is ready', uz: 'SHERZ {0} tayyor', ru: 'SHERZ {0} готов' },
  updText:  { en: 'The new version is downloaded. Restart to finish updating.', uz: 'Yangi versiya yuklab olindi. Yangilashni tugatish uchun qayta ishga tushiring.', ru: 'Новая версия загружена. Перезапустите, чтобы завершить обновление.' },
  updNow:   { en: 'Restart now', uz: 'Hozir qayta ishga tushirish', ru: 'Перезапустить сейчас' },
  updLater: { en: 'Later', uz: 'Keyinroq', ru: 'Позже' },
  updNone:  { en: 'You have the latest version ({0}).', uz: 'Sizda eng so‘nggi versiya ({0}).', ru: 'У вас последняя версия ({0}).' },
  updFail:  { en: 'Could not check for updates right now.', uz: 'Hozir yangilanishni tekshirib bo‘lmadi.', ru: 'Сейчас не удалось проверить обновления.' },
  tip:      { en: 'SHERZ', uz: 'SHERZ', ru: 'SHERZ' },
};
function pick(lang) { const l = String(lang || '').toLowerCase().slice(0, 2); return l === 'uz' || l === 'ru' ? l : 'en'; }
function t(key, lang, ...vars) { const e = T[key]; const s = (e && (e[pick(lang)] || e.en)) || key; return s.replace(/\{(\d)\}/g, (_, i) => (vars[+i] == null ? '' : String(vars[+i]))); }
module.exports = { t, pick };
