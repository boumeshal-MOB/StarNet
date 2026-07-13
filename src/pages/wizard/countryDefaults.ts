import type {
  CountryTemplate, InstrumentProfile, PrismProfile, Station, StationPrismSetup, TargetMapping,
} from '../../types/domain';

export function countryPresetSummary(template: CountryTemplate): string {
  if (template.prismCorrectionPolicy === 'already-applied') {
    return 'Topcon MS05AXII + MPO FR: +25.5 mm is already in the stored distance; BTM applies 0.0 mm. Atmosphere is also considered corrected.';
  }
  if (template.id === 'country-uk') {
    return 'Rob / legacy: raw distances, 0 mm already applied, prism constants 0 / +8.9 / +26.5 / +30.0 mm, cycle T/P.';
  }
  return 'Raw distances: prism correction comes from each target setup and atmosphere uses cycle T/P when available.';
}

export function applyCountryCorrectionPreset(
  stations: Station[],
  targets: TargetMapping[],
  setups: StationPrismSetup[],
  template: CountryTemplate,
  prismProfiles: PrismProfile[],
  instrumentProfiles: InstrumentProfile[],
): { stations: Station[]; targets: TargetMapping[]; setups: StationPrismSetup[] } {
  const allowedProfiles = template.prismSetupTemplateIds
    .map((id) => prismProfiles.find((profile) => profile.id === id))
    .filter((profile): profile is PrismProfile => Boolean(profile));
  const corrected = template.prismCorrectionPolicy === 'already-applied';
  const defaultProfile = prismProfiles.find((profile) =>
    profile.id === template.defaultPrismSetupTemplateId);
  const defaultInstrument = instrumentProfiles.find((instrument) =>
    instrument.id === template.defaultInstrumentTemplateId);

  const resolvedSetups = setups.map((setup) => {
    const matchingProfile = corrected ? defaultProfile : allowedProfiles.find((profile) =>
      Math.abs(profile.effectiveConstantM - setup.effectiveConstantM) < 1e-9);
    const effectiveConstantM = corrected && defaultProfile
      ? defaultProfile.effectiveConstantM
      : setup.effectiveConstantM;
    return {
      ...setup,
      prismProfileId: matchingProfile?.id ?? setup.prismProfileId,
      measurementType: setup.measurementType ?? 'prism' as const,
      edmMode: matchingProfile?.edmMode ?? setup.edmMode ?? defaultInstrument?.edmMode,
      effectiveConstantM,
      // This value describes the stored observation, per station-prism pair.
      // It is deliberately not a general instrument/station constant.
      constantAppliedByStationM: corrected ? effectiveConstantM : 0,
      distanceStdErrMm: setup.distanceStdErrMm ?? defaultInstrument?.distanceStdErrMm,
      distancePpm: setup.distancePpm ?? defaultInstrument?.distancePpm,
    };
  });

  const resolvedTargets = targets.map((target) => {
    const setup = resolvedSetups.find((item) =>
      item.targetKey === target.rawName && target.stationIds.includes(item.stationId));
    return setup ? { ...target, prismProfileId: setup.prismProfileId } : target;
  });

  return {
    stations: stations.map((station) => ({
      ...station,
      instrumentProfileId: template.defaultInstrumentTemplateId,
      edmMode: defaultInstrument?.edmMode ?? station.edmMode,
      instrumentHeightM: defaultInstrument?.defaultInstrumentHeightM ?? station.instrumentHeightM,
      distanceState: corrected ? 'fully-corrected' : 'raw',
      constantAppliedByStationM: 0, // retained only for old snapshots; setups are authoritative
      atmosphericMode: template.defaultAtmosphericMode === 'automatic'
        ? (station.temperatureVariable && station.pressureVariable ? 'automatic' : 'none')
        : template.defaultAtmosphericMode,
      missingEnvPolicy: template.defaultMissingEnvPolicy,
    })),
    targets: resolvedTargets,
    setups: resolvedSetups,
  };
}
