import {
  CustodyOverrides,
  FamilyConfig,
  custodianFor,
  dateKey,
  daysBetween,
  lastMonday,
  parseKey,
} from './custody';

function config(
  type: FamilyConfig['rotation']['type'],
  anchor: string,
  start: 0 | 1 = 0,
): FamilyConfig {
  return {
    parents: ['Alice', 'Bruno'],
    children: ['Léa'],
    rotation: { type, anchor, start },
  };
}

// L'ancre de référence des tests : lundi 5 janvier 2026.
const ANCHOR = '2026-01-05';

describe('dateKey / parseKey', () => {
  it('formate en YYYY-MM-DD avec zéros initiaux', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dateKey(new Date(2026, 8, 9))).toBe('2026-09-09');
  });

  it('parse une clé en date locale à minuit', () => {
    const d = parseKey('2026-03-29');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(29);
    expect(d.getHours()).toBe(0);
  });

  it('parseKey et dateKey sont inverses, y compris autour de minuit local', () => {
    for (const key of ['2026-01-01', '2025-12-31', '2026-02-28', '2024-02-29']) {
      expect(dateKey(parseKey(key))).toBe(key);
    }
  });
});

describe('lastMonday', () => {
  it("retourne le lundi de la semaine (semaine commençant le lundi)", () => {
    // Jeudi 8 janvier 2026 -> lundi 5 janvier.
    expect(dateKey(lastMonday(new Date(2026, 0, 8)))).toBe('2026-01-05');
    // Un lundi reste lui-même.
    expect(dateKey(lastMonday(new Date(2026, 0, 5)))).toBe('2026-01-05');
    // Dimanche 11 janvier -> lundi 5 janvier (pas le 12).
    expect(dateKey(lastMonday(new Date(2026, 0, 11)))).toBe('2026-01-05');
  });

  it("franchit un changement de mois et d'année", () => {
    // Jeudi 1er janvier 2026 -> lundi 29 décembre 2025.
    expect(dateKey(lastMonday(new Date(2026, 0, 1)))).toBe('2025-12-29');
  });
});

describe('daysBetween', () => {
  it('compte les jours signés entre deux clés', () => {
    expect(daysBetween('2026-01-05', '2026-01-05')).toBe(0);
    expect(daysBetween('2026-01-05', '2026-01-12')).toBe(7);
    expect(daysBetween('2026-01-05', '2026-01-01')).toBe(-4);
  });

  it("franchit les années et les années bissextiles", () => {
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // 2024 bissextile
    expect(daysBetween('2025-02-28', '2025-03-01')).toBe(1);
  });

  it("retourne des jours entiers même à travers les changements d'heure", () => {
    // Fin mars et fin octobre encadrent les DST européennes.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('custodianFor — rotation week (semaines alternées)', () => {
  const cfg = config('week', ANCHOR, 0);

  it('attribue toute la semaine ancre au parent de départ', () => {
    expect(custodianFor('2026-01-05', cfg)).toBe(0); // lundi
    expect(custodianFor('2026-01-08', cfg)).toBe(0); // jeudi
    expect(custodianFor('2026-01-11', cfg)).toBe(0); // dimanche
  });

  it('alterne chaque semaine suivante', () => {
    expect(custodianFor('2026-01-12', cfg)).toBe(1);
    expect(custodianFor('2026-01-18', cfg)).toBe(1);
    expect(custodianFor('2026-01-19', cfg)).toBe(0);
  });

  it("alterne aussi avant l'ancre (diff négatif)", () => {
    expect(custodianFor('2026-01-04', cfg)).toBe(1); // dimanche précédent
    expect(custodianFor('2025-12-29', cfg)).toBe(1); // lundi précédent
    expect(custodianFor('2025-12-28', cfg)).toBe(0); // semaine encore avant
    expect(custodianFor('2025-12-22', cfg)).toBe(0);
  });

  it('respecte start = 1', () => {
    const cfg1 = config('week', ANCHOR, 1);
    expect(custodianFor('2026-01-05', cfg1)).toBe(1);
    expect(custodianFor('2026-01-12', cfg1)).toBe(0);
    expect(custodianFor('2026-01-04', cfg1)).toBe(0);
  });

  it("reste cohérent loin dans le futur et le passé (changements d'année)", () => {
    // 2026-01-05 + 52 semaines = 2027-01-04, même parité qu'à l'ancre... non :
    // 52 semaines = parité paire -> parent 0.
    expect(custodianFor('2027-01-04', cfg)).toBe(0);
    expect(custodianFor('2027-01-11', cfg)).toBe(1);
    expect(custodianFor('2025-01-06', cfg)).toBe(0); // 52 semaines avant
  });
});

describe('custodianFor — rotation 2-2-3', () => {
  const cfg = config('223', ANCHOR, 0);
  const PATTERN = [0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1];

  it('suit le pattern de 14 jours depuis le lundi ancre', () => {
    for (let i = 0; i < 14; i++) {
      const d = new Date(2026, 0, 5 + i);
      expect(custodianFor(dateKey(d), cfg)).toBe(PATTERN[i]);
    }
  });

  it('répète le cycle après 14 jours', () => {
    expect(custodianFor('2026-01-19', cfg)).toBe(0); // jour 14 = index 0
    expect(custodianFor('2026-01-21', cfg)).toBe(1); // jour 16 = index 2
  });

  it("applique le pattern avant l'ancre (diff négatif, modulo positif)", () => {
    // 2026-01-04 : diff = -1 -> index 13 -> parent 1.
    expect(custodianFor('2026-01-04', cfg)).toBe(1);
    // 2025-12-22 : diff = -14 -> index 0 -> parent 0.
    expect(custodianFor('2025-12-22', cfg)).toBe(0);
    // 2025-12-29 : diff = -7 -> index 7 -> parent 1.
    expect(custodianFor('2025-12-29', cfg)).toBe(1);
  });

  it('inverse le pattern quand start = 1', () => {
    const cfg1 = config('223', ANCHOR, 1);
    for (let i = 0; i < 14; i++) {
      const d = new Date(2026, 0, 5 + i);
      expect(custodianFor(dateKey(d), cfg1)).toBe(1 - PATTERN[i]);
    }
  });

  it("traverse un changement d'année sans rupture du cycle", () => {
    // Ancre 2026-01-05, jour 2025-12-31 : diff = -5 -> index 9 -> parent 0.
    expect(custodianFor('2025-12-31', cfg)).toBe(0);
    // 2027-01-04 : diff = 364 = 26 cycles de 14 -> index 0 -> parent 0.
    expect(custodianFor('2027-01-04', cfg)).toBe(0);
  });
});

describe('custodianFor — rotation manual', () => {
  const cfg = config('manual', ANCHOR, 0);

  it('retourne -1 (non attribué) sans override', () => {
    expect(custodianFor('2026-01-05', cfg)).toBe(-1);
    expect(custodianFor('2030-06-15', cfg)).toBe(-1);
  });

  it("retourne l'override quand il existe", () => {
    const overrides: CustodyOverrides = { '2026-01-05': 1 };
    expect(custodianFor('2026-01-05', cfg, overrides)).toBe(1);
    expect(custodianFor('2026-01-06', cfg, overrides)).toBe(-1);
  });
});

describe('custodianFor — overrides (échanges ponctuels)', () => {
  const cfg = config('week', ANCHOR, 0);

  it("l'override prime sur la rotation, y compris la valeur 0", () => {
    const overrides: CustodyOverrides = {
      '2026-01-05': 1, // semaine du parent 0, échangée
      '2026-01-12': 0, // semaine du parent 1, échangée (valeur 0 falsy : ne pas la perdre)
    };
    expect(custodianFor('2026-01-05', cfg, overrides)).toBe(1);
    expect(custodianFor('2026-01-12', cfg, overrides)).toBe(0);
  });

  it('ne touche pas aux jours voisins', () => {
    const overrides: CustodyOverrides = { '2026-01-07': 1 };
    expect(custodianFor('2026-01-06', cfg, overrides)).toBe(0);
    expect(custodianFor('2026-01-07', cfg, overrides)).toBe(1);
    expect(custodianFor('2026-01-08', cfg, overrides)).toBe(0);
  });
});
