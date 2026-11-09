/**
 * Compteur d’écritures métier locales (trajets / pleins).
 * Sert de garde-fou à la synchro cloud : si le local a changé entre la lecture du
 * snapshot et l’application d’un pull (`replaceAllData` = DELETE + INSERT), on
 * annule le pull plutôt que d’écraser un trajet / plein tout juste enregistré.
 */
let seq = 0;

export function bumpLocalWriteSeq(): void {
  seq += 1;
}

export function getLocalWriteSeq(): number {
  return seq;
}
