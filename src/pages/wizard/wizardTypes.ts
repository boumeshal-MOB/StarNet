import type {
  AdjustmentTemplate, OutputTemplate, PhysicalPoint, ProvisionalCoordinate,
  ReferenceSet, RunTemplate, Station, StationPrismSetup, TargetMapping,
} from '../../types/domain';
import { DEFAULT_ADJUSTMENT, DEFAULT_OUTPUT, DEFAULT_RUN } from '../../data/templates';
import type { StationOrientation } from '../../engine/initial';
import { FIXTURE_START } from '../../data/fixture';

export const WIZARD_STEPS = [
  'General', 'Data & Network', 'Instruments', 'Targets & Prisms', 'References',
  'Initial Coordinates', 'Adjustment', 'Run', 'Output', 'Review & Create',
];

export interface WizardDraft {
  step: number;
  maxReached: number;
  // 1 - general
  name: string;
  project: string;
  site: string;
  description: string;
  countryTemplateId: string;
  mode: 'standard' | 'expert';
  activeAfterCreation: boolean;
  // 2 - data source & network
  networkKind: 'single-station' | 'multi-station';
  stationIds: string[];
  // 3 - instruments
  stations: Station[];
  // 4 - targets & point identity
  targets: TargetMapping[];
  setups: StationPrismSetup[];
  physicalPoints: PhysicalPoint[];
  // 5 - references
  refSets: ReferenceSet[];
  selectedRefSetId: string;
  // 6 - initial coordinates
  provisional: ProvisionalCoordinate[];
  orientations: StationOrientation[];
  initFailures: { targetId: string; reason: string }[];
  initWindowFrom: string;
  initWindowTo: string;
  initMode: 'known-references' | 'local-anchor';
  initAnchorStationId: string;
  initAnchorOrientationDeg: number;
  provisionalSaved: boolean;
  // 7/8/9
  adjustment: AdjustmentTemplate;
  runPolicy: RunTemplate;
  outputPolicy: OutputTemplate;
}

export function defaultDraft(): WizardDraft {
  return {
    step: 0,
    maxReached: 0,
    name: '',
    project: '',
    site: '',
    description: '',
    countryTemplateId: 'country-fr',
    mode: 'standard',
    activeAfterCreation: true,
    networkKind: 'multi-station',
    stationIds: [],
    stations: [],
    targets: [],
    setups: [],
    physicalPoints: [],
    refSets: [],
    selectedRefSetId: '',
    provisional: [],
    orientations: [],
    initFailures: [],
    initWindowFrom: new Date(FIXTURE_START).toISOString().slice(0, 16),
    initWindowTo: new Date(FIXTURE_START + 2 * 3600000).toISOString().slice(0, 16),
    initMode: 'known-references',
    initAnchorStationId: '',
    initAnchorOrientationDeg: 0,
    provisionalSaved: false,
    adjustment: { ...DEFAULT_ADJUSTMENT },
    runPolicy: { ...DEFAULT_RUN },
    outputPolicy: { ...DEFAULT_OUTPUT },
  };
}

const KEY = 'btm-wizard-draft-v1';

export function loadDraft(): WizardDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaultDraft(), ...JSON.parse(raw) } : null;
  } catch { return null; }
}

export function saveDraft(d: WizardDraft): void {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* best effort */ }
}

export function clearDraft(): void {
  try { localStorage.removeItem(KEY); } catch { /* best effort */ }
}

/** Star*Net-compatible engine name validation (nomenclature controller) */
export function nomenclatureIssues(adjName: string, allNames: string[]): string[] {
  const issues: string[] = [];
  if (!adjName) issues.push('Empty adjustment name');
  if (adjName.length > 15) issues.push('Name longer than 15 characters (engine limit)');
  if (/[^A-Za-z0-9_-]/.test(adjName)) issues.push('Forbidden characters for the engine (allowed: A-Z a-z 0-9 _ -)');
  if (allNames.filter((n) => n === adjName).length > 1) issues.push('Collision: same adjustment name mapped twice');
  return issues;
}
