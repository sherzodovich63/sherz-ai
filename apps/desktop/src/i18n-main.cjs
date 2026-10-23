// Words the desktop shell itself shows (tray menu, notifications). The page tells us the language through SherzNativeHost.setLanguage().
const T = {
  open:     { en: 'Open SHERZ', uz: 'SHERZ ni ochish', ru: 'Открыть SHERZ' },
  hotkey:   { en: 'Hotkey: {0}', uz: 'Tezkor tugma: {0}', ru: 'Горячая клавиша: {0}' },
  tray:     { en: 'Keep running in the tray when closed', uz: 'Yopilganda tray da ishlashda qolsin', ru: 'Работать в трее после закрытия' },
  login:    { en: 'Start with the computer', uz: 'Kompyuter bilan birga ishga tushsin', ru: 'Запускать вместе с компьютером' },
  quit:     { en: 'Quit SHERZ', uz: 'SHERZ dan chiqish', ru: 'Выйти из SHERZ' },
  saved:    { en: 'Saved to Downloads', uz: 'Yuklamalar papkasiga saqlandi', ru: 'Сохранено в «Загрузки»' },
  tip:      { en: 'SHERZ', uz: 'SHERZ', ru: 'SHERZ' },
};
function pick(lang) { const l = String(lang || '').toLowerCase().slice(0, 2); return l === 'uz' || l === 'ru' ? l : 'en'; }
function t(key, lang, ...vars) { const e = T[key]; const s = (e && (e[pick(lang)] || e.en)) || key; return s.replace(/\{(\d)\}/g, (_, i) => (vars[+i] == null ? '' : String(vars[+i]))); }
module.exports = { t, pick };
