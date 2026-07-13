import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_TEMPLATES, COUNTRY_TEMPLATES, FR_ADJUSTMENT, UK_ADJUSTMENT,
} from '../../../data/templates';
import { repository } from '../../../data/repository';
import { buildStations, buildTargetsAndSetups } from '../../../store/seed';
import { applyCountryCorrectionPreset } from '../countryDefaults';

function preset(countryId: string) {
  const country = COUNTRY_TEMPLATES.find((item) => item.id === countryId)!;
  const built = buildTargetsAndSetups(['ATS34']);
  return applyCountryCorrectionPreset(
    buildStations(['ATS34']), built.targets, built.setups,
    country, repository.prismProfiles(), repository.instrumentProfiles(),
  );
}

describe('country distance correction presets', () => {
  it('France defaults every target to MPO FR +25.5 mm already applied', () => {
    const result = preset('country-fr');
    expect(result.stations[0].instrumentProfileId).toBe('inst-topcon-ms05axii');
    expect(result.stations[0].edmMode).toBe('Fine + Prism');
    expect(result.stations[0].atmosphericMode).toBe('station-corrected');
    expect(result.setups.every((setup) => setup.prismProfileId === 'prism-mpo-fr')).toBe(true);
    expect(result.setups.every((setup) => setup.effectiveConstantM === 0.0255)).toBe(true);
    expect(result.setups.every((setup) =>
      setup.constantAppliedByStationM === setup.effectiveConstantM)).toBe(true);
  });

  it('UK uses the supplied Leica lookup constants once on raw slope distances', () => {
    const result = preset('country-uk');
    const constants = [...new Set(result.setups.map((setup) => setup.effectiveConstantM))].sort();
    expect(constants).toEqual([0.0089, 0.0265]);
    const uk = COUNTRY_TEMPLATES.find((item) => item.id === 'country-uk')!;
    const catalogConstants = uk.prismSetupTemplateIds.map((id) =>
      repository.prismProfiles().find((profile) => profile.id === id)!.effectiveConstantM).sort();
    expect(catalogConstants).toEqual([0, 0.0089, 0.0265, 0.03]);
    expect(result.setups.every((setup) => setup.constantAppliedByStationM === 0)).toBe(true);
    expect(result.stations[0].instrumentProfileId).toBe('inst-tm50-uk-legacy');
    expect(result.setups.every((setup) => setup.prismProfileId.startsWith('prism-uk-'))).toBe(true);
    expect(result.stations[0].atmosphericMode).toBe('automatic');
  });
});

describe('country STAR*NET adjustment templates', () => {
  it('links France to the FR STAR*NET template', () => {
    const country = COUNTRY_TEMPLATES.find((item) => item.id === 'country-fr')!;
    expect(country.defaultAdjustmentTemplateId).toBe(FR_ADJUSTMENT.id);
    expect(FR_ADJUSTMENT.angleOutputFormat).toBe('Gons');
    expect(FR_ADJUSTMENT.starNetConvergenceLimit).toBe(0.01);
    expect(FR_ADJUSTMENT.maxIterations).toBe(30);
    expect(FR_ADJUSTMENT.starNetAutoAdjustMaxIterations).toBe(20);
  });

  it('links UK to the supplied HS2/NTE STAR*NET template', () => {
    const country = COUNTRY_TEMPLATES.find((item) => item.id === 'country-uk')!;
    expect(country.defaultAdjustmentTemplateId).toBe(UK_ADJUSTMENT.id);
    expect(UK_ADJUSTMENT.angleOutputFormat).toBe('DMS');
    expect(UK_ADJUSTMENT.starNetConvergenceLimit).toBe(0.01);
    expect(UK_ADJUSTMENT.maxIterations).toBe(10);
    expect(UK_ADJUSTMENT.refractionCoefficient).toBe(0.07);
    expect(UK_ADJUSTMENT.earthRadiusM).toBe(6372000);
    expect(ADJUSTMENT_TEMPLATES).toHaveLength(2);
  });
});
