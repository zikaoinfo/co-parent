import {
  CustodyOverrides,
  FamilyConfig,
  Handover,
  custodianFor,
  dateKey,
  daysBetween,
  handoverPickup,
  handoversFor,
  isValidTime,
  lastMonday,
  parseKey,
  weekdayOf,
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

describe('isoWeek', () => {
  it('numérote les semaines ISO (lundi premier jour)', () => {
    // Le 1er janvier 2026 est un jeudi : la semaine du 29/12/2025 au 04/01/2026
    // est la semaine 1 de l'année ISO 2026.
    expect(isoWeek('2025-12-29')).toEqual({ week: 1, year: 2026 });
    expect(isoWeek('2026-01-04')).toEqual({ week: 1, year: 2026 });
    expect(isoWeek('2026-01-05')).toEqual({ week: 2, year: 2026 });
    expect(isoWeek('2026-01-11')).toEqual({ week: 2, year: 2026 });
  });

  it("gère les années ISO à 53 semaines et le rattachement d'année", () => {
    // 2026 est une année ISO à 53 semaines (1er janvier un jeudi).
    expect(isoWeek('2026-12-28')).toEqual({ week: 53, year: 2026 });
    expect(isoWeek('2027-01-03')).toEqual({ week: 53, year: 2026 });
    expect(isoWeek('2027-01-04')).toEqual({ week: 1, year: 2027 });
    // Le 30/12/2024 (lundi) appartient déjà à la semaine 1 de 2025.
    expect(isoWeek('2024-12-30')).toEqual({ week: 1, year: 2025 });
  });
});

describe('custodianFor — rotation weekParity (semaines paires / impaires)', () => {
  function parityConfig(evenWeeksParent: 0 | 1, alternateYearly = false): FamilyConfig {
    return {
      parents: ['Alice', 'Bruno'],
      children: ['Léa'],
      rotation: { type: 'weekParity', anchor: ANCHOR, start: 0, evenWeeksParent, alternateYearly },
    };
  }

  it('attribue les semaines paires au parent choisi, les impaires à l’autre', () => {
    const cfg = parityConfig(0);
    // Semaine 2 (paire) : 05/01 au 11/01/2026.
    expect(custodianFor('2026-01-05', cfg)).toBe(0);
    expect(custodianFor('2026-01-11', cfg)).toBe(0);
    // Semaine 3 (impaire).
    expect(custodianFor('2026-01-12', cfg)).toBe(1);
    // Semaine 1 (impaire), à cheval sur le changement d'année civile.
    expect(custodianFor('2025-12-29', cfg)).toBe(1);
    expect(custodianFor('2026-01-04', cfg)).toBe(1);
  });

  it('respecte evenWeeksParent = 1', () => {
    const cfg = parityConfig(1);
    expect(custodianFor('2026-01-05', cfg)).toBe(1); // semaine 2, paire
    expect(custodianFor('2026-01-12', cfg)).toBe(0); // semaine 3, impaire
  });

  it("inverse l'attribution les années ISO impaires quand alternateYearly est actif", () => {
    const cfg = parityConfig(0, true);
    // 2026 (paire) : parent 0 a les semaines paires.
    expect(custodianFor('2026-01-05', cfg)).toBe(0); // semaine 2
    expect(custodianFor('2026-01-12', cfg)).toBe(1); // semaine 3
    // 2027 (impaire) : inversé, parent 1 a les semaines paires.
    expect(custodianFor('2027-01-04', cfg)).toBe(0); // semaine 1, impaire
    expect(custodianFor('2027-01-11', cfg)).toBe(1); // semaine 2, paire
  });

  it("sans alternance annuelle, la semaine 53 puis la semaine 1 donnent deux semaines impaires consécutives", () => {
    const cfg = parityConfig(0);
    expect(custodianFor('2026-12-28', cfg)).toBe(1); // semaine 53 de 2026
    expect(custodianFor('2027-01-04', cfg)).toBe(1); // semaine 1 de 2027
  });

  it("l'échange ponctuel prime sur la parité", () => {
    const cfg = parityConfig(0);
    const overrides: CustodyOverrides = { '2026-01-05': 1 };
    expect(custodianFor('2026-01-05', cfg, overrides)).toBe(1);
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

describe('weekdayOf', () => {
  it('numérote les jours en ISO (1 = lundi … 7 = dimanche)', () => {
    // Semaine du lundi 5 janvier 2026.
    expect(weekdayOf('2026-01-05')).toBe(1);
    expect(weekdayOf('2026-01-09')).toBe(5);
    expect(weekdayOf('2026-01-11')).toBe(7);
  });
});

describe('isValidTime', () => {
  it('accepte une heure HH:MM valide', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('18:30')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
  });

  it('refuse une saisie vide ou hors bornes', () => {
    expect(isValidTime('')).toBe(false);
    expect(isValidTime('8:30')).toBe(false);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('12:60')).toBe(false);
  });
});

describe('handoversFor / handoverPickup (passations)', () => {
  const vendrediSoir: Handover = { weekday: 5, time: '18:00', pickup: 'custodian' };
  const mercrediMidi: Handover = { weekday: 3, time: '12:00', pickup: 1 };

  function withHandovers(handovers: Handover[]): FamilyConfig {
    return { ...config('week', ANCHOR, 0), handovers };
  }

  it('ne retient que les passations du bon jour de la semaine', () => {
    const cfg = withHandovers([vendrediSoir, mercrediMidi]);
    expect(handoversFor('2026-01-09', cfg)).toEqual([vendrediSoir]); // vendredi
    expect(handoversFor('2026-01-07', cfg)).toEqual([mercrediMidi]); // mercredi
    expect(handoversFor('2026-01-05', cfg)).toEqual([]); // lundi
  });

  it('trie les passations du jour par heure croissante', () => {
    const soir: Handover = { weekday: 5, time: '19:30', pickup: 0 };
    const matin: Handover = { weekday: 5, time: '08:15', pickup: 1 };
    expect(handoversFor('2026-01-09', withHandovers([soir, matin]))).toEqual([matin, soir]);
  });

  it('config sans passations : tableau vide', () => {
    expect(handoversFor('2026-01-09', config('week', ANCHOR, 0))).toEqual([]);
  });

  it('un parent fixe vient chercher quel que soit le gardien', () => {
    const cfg = withHandovers([mercrediMidi]);
    expect(handoverPickup(mercrediMidi, '2026-01-07', cfg)).toBe(1);
    expect(handoverPickup(mercrediMidi, '2026-01-14', cfg)).toBe(1);
  });

  it("« custodian » désigne le gardien du jour (échanges compris)", () => {
    const cfg = withHandovers([vendrediSoir]);
    // Semaine ancre : parent 0 ; semaine suivante : parent 1.
    expect(handoverPickup(vendrediSoir, '2026-01-09', cfg)).toBe(0);
    expect(handoverPickup(vendrediSoir, '2026-01-16', cfg)).toBe(1);
    // Jour échangé : c'est le nouveau gardien qui vient chercher.
    expect(handoverPickup(vendrediSoir, '2026-01-09', cfg, { '2026-01-09': 1 })).toBe(1);
  });

  it('rotation manuelle sans échange : gardien non attribué (-1)', () => {
    const cfg: FamilyConfig = { ...config('manual', ANCHOR, 0), handovers: [vendrediSoir] };
    expect(handoverPickup(vendrediSoir, '2026-01-09', cfg)).toBe(-1);
  });
});
