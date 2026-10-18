// Mensajes de error que ve el jugador. El `code` es estable y lo usan las pruebas.
export const ERRORS = {
  BAD_REQUEST: 'Mensaje inválido.',
  NICK_INVALID: 'Tu apodo debe tener de 2 a 14 caracteres, vos.',
  NICK_TAKEN: 'Ya hay alguien con ese apodo en la sala.',
  TOPIC_INVALID: 'El tema debe tener de 1 a 80 caracteres.',
  CODE_INVALID: 'Ese código no es válido. Son 5 letras.',
  ROOM_NOT_FOUND: 'Esa sala no existe, revisá el código.',
  ROOM_FULL: 'La sala está llena, ya no caben más cuchilleros.',
  ROOM_BUSY: 'Ya se están peleando. Esperá la revancha.',
  NOT_IN_ROOM: 'No estás en ninguna sala.',
  CHARACTER_INVALID: 'Ese personaje no existe.',
  OPTION_INVALID: 'La opción debe tener de 1 a 40 caracteres.',
  OPTION_DUPLICATE: 'Esa opción ya existe. ¡Unite a ella!',
  OPTION_LIMIT: 'Ya hay 8 opciones, no cabe ni una más.',
  OPTION_NOT_FOUND: 'Esa opción no existe.',
  OPTION_IN_USE: 'Alguien todavía defiende esa opción.',
  NOT_HOST: 'Solo el anfitrión puede hacer eso.',
  NOT_ENOUGH_PLAYERS: 'Se necesitan al menos 2 para pelear.',
  NOT_READY: 'Todavía hay gente eligiendo...',
  SAME_OPTION: 'Ustedes sí son de la misma opinión, hermanos. No hay pelea.',
  NOT_ENOUGH_OPTIONS: 'Poné al menos 2 respuestas para que se agarren.',
  MODE_INVALID: 'Ese modo de juego no existe.',
  AUTO_MODE: 'En modo automático solo se mira: los luchadores pelean solos.',
  WRONG_STATE: 'Eso no se puede hacer ahorita.',
  RATE_LIMIT: 'Calmate, vas muy rápido.',
  INTERNAL: 'Algo se arruinó en el servidor.',
};

export function fail(code) {
  return { ok: false, code, error: ERRORS[code] || ERRORS.INTERNAL };
}
