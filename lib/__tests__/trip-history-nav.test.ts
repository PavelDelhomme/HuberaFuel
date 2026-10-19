import { describe, expect, it } from 'vitest';
import {
  collectTripYmds,
  filterTripsByHistory,
  historyDateChipLabel,
  parseHistoryFilter,
  parseVehicleIdParam,
  parseYmdParam,
  tripHistoryNav,
  tripAtOrAfter,
  tripIsToday,
  tripStartedOnYmd,
  tripYmd,
} from '@/lib/tripHistoryNav';
import {
  applyCalendarDayPick,
  monthDayCells,
  WEEKDAYS_FR,
  ymdInInclusiveRange,
} from '@/lib/tripHistoryCalendar';
import { addMonthsYm, nextMonthKey, previousMonthKey } from '@/lib/dates';

describe('tripHistoryNav', () => {
  it('ouvre l’historique du jour pour un véhicule', () => {
    expect(tripHistoryNav({ filter: 'today', vehicleId: 2 })).toEqual({
      pathname: '/(tabs)/trip',
      params: { tab: 'history', filter: 'today', vehicleId: '2' },
    });
  });

  it('passe une plage de dates', () => {
    expect(
      tripHistoryNav({ filter: 'range', from: '2026-09-01', to: '2026-09-12' }).params
    ).toMatchObject({
      tab: 'history',
      filter: 'range',
      from: '2026-09-01',
      to: '2026-09-12',
    });
  });

  it('omet vehicleId invalide', () => {
    expect(tripHistoryNav({ filter: 'all', vehicleId: 0 }).params.vehicleId).toBeUndefined();
  });
});

describe('tripIsToday', () => {
  it('filtre le jour local', () => {
    const now = new Date(2026, 8, 12, 16, 0, 0);
    expect(tripIsToday('2026-09-12T11:55:00+02:00', now)).toBe(true);
    expect(tripIsToday('2026-09-11T22:00:00+02:00', now)).toBe(false);
    const localMorning = new Date(2026, 8, 12, 0, 10, 0);
    expect(tripStartedOnYmd(localMorning.toISOString(), '2026-09-12')).toBe(true);
  });
});

describe('parseHistoryFilter', () => {
  it('lit today / sinceFill / all / date / range', () => {
    expect(parseHistoryFilter('today')).toBe('today');
    expect(parseHistoryFilter(['sinceFill'])).toBe('sinceFill');
    expect(parseHistoryFilter('date')).toBe('date');
    expect(parseHistoryFilter('range')).toBe('range');
    expect(parseHistoryFilter('nope')).toBeNull();
  });

  it('parse vehicleId et ymd', () => {
    expect(parseVehicleIdParam('2')).toBe(2);
    expect(parseVehicleIdParam(['3'])).toBe(3);
    expect(parseVehicleIdParam('x')).toBeNull();
    expect(parseYmdParam('2026-09-12')).toBe('2026-09-12');
    expect(parseYmdParam('12/09/2026')).toBeNull();
  });
});

describe('jour de trajet', () => {
  it('lit un horodatage sans fuseau comme le jour écrit', () => {
    expect(tripYmd('2026-10-19 14:02:00')).toBe('2026-10-19');
    expect(tripIsToday('2026-10-19 14:02:00', new Date(2026, 9, 19, 18, 0, 0))).toBe(true);
    expect(tripAtOrAfter('2026-10-19 08:00:00', '2026-10-18T18:00:00.000Z')).toBe(true);
  });
});

describe('filterTripsByHistory', () => {
  const trips = [
    { id: 1, startTime: '2026-09-12T08:00:00+02:00' },
    { id: 2, startTime: '2026-09-11T18:00:00+02:00' },
    { id: 3, startTime: '2026-09-01T10:00:00+02:00' },
  ];

  it('filtre un jour', () => {
    expect(
      filterTripsByHistory(trips, { filter: 'date', from: '2026-09-12' }).map((t) => t.id)
    ).toEqual([1]);
  });

  it('filtre une plage inclusive', () => {
    expect(
      filterTripsByHistory(trips, {
        filter: 'range',
        from: '2026-09-01',
        to: '2026-09-11',
      }).map((t) => t.id)
    ).toEqual([2, 3]);
  });

  it('marque les jours avec trajet', () => {
    const ymds = collectTripYmds(trips);
    expect(ymds.has('2026-09-12')).toBe(true);
    expect(ymds.has('2026-09-10')).toBe(false);
  });
});

describe('calendrier historique', () => {
  it('grille lundi-premier pour septembre 2026', () => {
    expect(WEEKDAYS_FR[0]).toBe('L');
    const cells = monthDayCells('2026-09');
    expect(cells[0].ymd).toBeNull(); // mardi 1er → un padding lundi
    expect(cells.find((c) => c.ymd === '2026-09-01')).toBeTruthy();
    expect(cells.filter((c) => c.ymd).length).toBe(30);
  });

  it('sélection jour puis plage', () => {
    expect(applyCalendarDayPick({ ymd: '2026-09-12', rangeMode: false, from: null, to: null })).toEqual({
      from: '2026-09-12',
      to: '2026-09-12',
      filter: 'date',
    });
    expect(
      applyCalendarDayPick({
        ymd: '2026-09-15',
        rangeMode: true,
        from: '2026-09-12',
        to: '2026-09-12',
      })
    ).toEqual({ from: '2026-09-12', to: '2026-09-15', filter: 'range' });
  });

  it('plage inclusive', () => {
    expect(ymdInInclusiveRange('2026-09-12', '2026-09-10', '2026-09-12')).toBe(true);
    expect(ymdInInclusiveRange('2026-09-09', '2026-09-10', '2026-09-12')).toBe(false);
  });

  it('libellé chip', () => {
    expect(historyDateChipLabel(null, null)).toBe('Date sélectionnée');
    expect(historyDateChipLabel('2026-09-12', '2026-09-12')).toBe('12/09');
    expect(historyDateChipLabel('2026-09-01', '2026-09-12')).toBe('01/09 → 12/09');
  });

  it('navigation mois', () => {
    expect(previousMonthKey('2026-09')).toBe('2026-08');
    expect(nextMonthKey('2026-12')).toBe('2027-01');
    expect(addMonthsYm('2026-01', -1)).toBe('2025-12');
  });
});
