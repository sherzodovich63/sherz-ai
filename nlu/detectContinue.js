export function detectContinue(text = "") {
  const normalized = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/oxrgi/g, 'oxirgi')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    // aniq
    'davom et',
    'davom ettir',
    'continue',

    // klassik
    'qayerda qolgandik',
    'qayerdan qolgandik',
    'nimadan qolgandik',
    'oxirgi marta nimadan qolgandik',

    // joy
    'qolgan joyimizdan',
    'oxirgi qolgan joy',
    'oxirgidan davom',

    // kontekstli
    'oshadan davom',
    'osha yerdan davom',
    'osha joydan davom',
    'oshadan davom et',
  ];

  return patterns.some(p => normalized.includes(p));
}
