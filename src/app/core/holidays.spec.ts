import { FamilyConfig, custodianFor, holidayCustodian } from './custody';
import { holidayFor } from './holidays';

function config(extra: Partial<FamilyConfig> = {}): FamilyConfig {
  return {
    parents: ['Alice', 'Bruno'],
    children: ['Léa'],
    rotation: { type: 'week', anchor: '2026-01-05', start: 0 },
    ...extra,
  };
}

describe('holidayFor', () => {
  it('trouve une période commune à toutes les zones', () => {
    expect(holidayFor('2026-12-25', 'A')?.name).toBe('Vacances de Noël');
    expect(holidayFor('2026-12-25', 'C')?.name).toBe('Vacances de Noël');
  });

  it('respecte les zones pour hiver/printemps', () => {
    // Hiver 2027 : zone C du 6 au 21 février, zone B du 20 février au 7 mars.
    expect(holidayFor('2027-02-07', 'C')?.name).toBe("Vacances d'hiver");
    expect(holidayFor('2027-02-07', 'B')).toBeNull();
    expect(holidayFor('2027-03-06', 'B')?.name).toBe("Vacances d'hiver");
    expect(holidayFor('2027-03-06', 'C')).toBeNull();
  });

  it('retourne null hors vacances', () => {
    expect(holidayFor('2026-09-15', 'A')).toBeNull();
    expect(holidayFor('2027-06-01', 'B')).toBeNull();
  });

  it('inclut les bornes de la période', () => {
    expect(holidayFor('2026-10-17', 'A')).not.toBeNull(); // 1er jour Toussaint
    expect(holidayFor('2026-11-01', 'A')).not.toBeNull(); // dernier jour
    expect(holidayFor('2026-11-02', 'A')).toBeNull(); // reprise
  });
});

describe('holidayCustodian — partage moitié-moitié', () => {
  // Toussaint 2026 : 17 oct -> 1er nov = 16 jours, moitié = 8 jours.
  // Année paire (2026) : première moitié au parent désigné firstHalfEvenYears.
  const cfg = config({ holidays: { zone: 'B', split: true, firstHalfEvenYears: 0 } });

  it('attribue la première moitié au parent des années paires', () => {
    expect(holidayCustodian('2026-10-17', cfg)).toBe(0); // jour 1
    expect(holidayCustodian('2026-10-24', cfg)).toBe(0); // jour 8, dernier de la 1re moitié
  });

  it('attribue la seconde moitié à l’autre parent', () => {
    expect(holidayCustodian('2026-10-25', cfg)).toBe(1); // jour 9
    expect(holidayCustodian('2026-11-01', cfg)).toBe(1); // dernier jour
  });

  it("inverse l'attribution les années impaires", () => {
    // Printemps zone B 2027 : 17 avril -> 2 mai (16 jours), année impaire.
    expect(holidayCustodian('2027-04-17', cfg)).toBe(1);
    expect(holidayCustodian('2027-05-02', cfg)).toBe(0);
  });

  it('gère une période impaire (première moitié arrondie au supérieur)', () => {
    // Noël 2026 : 19 déc -> 3 janv = 16 jours... utilisons l'été 2026 :
    // 4 juil -> 31 août = 59 jours, 1re moitié = 30 jours (4 juil -> 2 août).
    expect(holidayCustodian('2026-08-02', cfg)).toBe(0); // jour 30
    expect(holidayCustodian('2026-08-03', cfg)).toBe(1); // jour 31
  });

  it('retourne null hors vacances, si split désactivé ou sans config', () => {
    expect(holidayCustodian('2026-09-15', cfg)).toBeNull();
    const noSplit = config({ holidays: { zone: 'B', split: false, firstHalfEvenYears: 0 } });
    expect(holidayCustodian('2026-10-20', noSplit)).toBeNull();
    expect(holidayCustodian('2026-10-20', config())).toBeNull();
  });
});

describe('custodianFor — priorités avec vacances', () => {
  const cfg = config({ holidays: { zone: 'B', split: true, firstHalfEvenYears: 0 } });

  it('le partage vacances prime sur la rotation', () => {
    // 2026-10-26 : lundi, semaine du 26 oct. Rotation week depuis 2026-01-05
    // (parent 0) -> semaine 42 -> parent 0. Mais 2e moitié de Toussaint -> 1.
    expect(custodianFor('2026-10-26', cfg)).toBe(1);
  });

  it("l'échange ponctuel prime sur le partage vacances", () => {
    expect(custodianFor('2026-10-26', cfg, { '2026-10-26': 0 })).toBe(0);
  });

  it('la rotation reprend hors vacances', () => {
    expect(custodianFor('2026-11-02', cfg)).toBe(
      custodianFor('2026-11-02', config()), // identique sans config vacances
    );
  });

  it('le partage vacances s’applique aussi en rotation manuelle', () => {
    const manual = config({
      rotation: { type: 'manual', anchor: '2026-01-05', start: 0 },
      holidays: { zone: 'B', split: true, firstHalfEvenYears: 0 },
    });
    expect(custodianFor('2026-10-17', manual)).toBe(0); // vacances : attribué
    expect(custodianFor('2026-09-15', manual)).toBe(-1); // hors vacances : non attribué
  });
});
