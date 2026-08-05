import { monthGrid } from './calendar';

describe('monthGrid', () => {
  it('produit des semaines complètes lundi -> dimanche couvrant le mois', () => {
    // Janvier 2026 : le 1er est un jeudi -> la grille démarre lundi 29 déc.
    const weeks = monthGrid(2026, 0);
    expect(weeks[0][0]).toBe('2025-12-29');
    expect(weeks[0][6]).toBe('2026-01-04');
    expect(weeks.at(-1)![6]).toBe('2026-02-01'); // le 31 janv. est un samedi
    for (const week of weeks) expect(week.length).toBe(7);
    expect(weeks.flat()).toContain('2026-01-31');
  });

  it("gère février d'une année bissextile", () => {
    const weeks = monthGrid(2024, 1);
    expect(weeks.flat()).toContain('2024-02-29');
  });

  it('un mois commençant un lundi ne déborde pas sur la semaine précédente', () => {
    // Juin 2026 commence un lundi.
    const weeks = monthGrid(2026, 5);
    expect(weeks[0][0]).toBe('2026-06-01');
  });
});
