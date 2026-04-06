// ── TYPES ────────────────────────────────────────────────────────────────────

export interface RoofFace {
  panelCount: number
  azimuth: number
  tilt: number
  roofArea: number
}

export interface ExistingSystem {
  projectName: string
  address: string
  panelModel: string
  panelWattage: number
  panelCount: number
  panelVoc: number
  panelVmp: number
  panelIsc: number
  panelImp: number
  inverterModel: string
  inverterCount: number
  inverterAcPower: number
  batteryModel: string
  batteryCount: number
  batteryCapacity: number
  rackingType: string
  roofFaceCount: number
  roofFaces: RoofFace[]
}

export interface TargetSystem {
  panelModel: string
  panelWattage: number
  panelVoc: number
  panelVmp: number
  panelIsc: number
  panelImp: number
  panelLengthMm: number
  panelWidthMm: number
  inverterModel: string
  inverterCount: number
  maxPvPower: number
  maxVoc: number
  mpptMin: number
  mpptMax: number
  mpptsPerInverter: number
  stringsPerMppt: number
  maxCurrentPerMppt: number
  batteryModel: string
  batteryCount: number
  batteryCapacity: number
  batteriesPerStack: number
  rackingModel: string
  rsdModel: string
  designTempLow: number
  vocTempCoeff: number
}

export interface StringConfig {
  mppt: number
  string: number
  modules: number
  vocCold: number
  vmpNominal: number
  current: number
  roofFaceIndex: number
}

export interface Results {
  vocCorrected: number
  maxModulesPerString: number
  minModulesPerString: number
  recommendedStringSize: number
  totalStringInputs: number
  vmpHot: number
  panelFitEstimates: { roofIndex: number; oldCount: number; newCount: number; method: string }[]
  stringConfigs: StringConfig[]
  engineeringNotes: string[]
  newTotalPanels: number
  newSystemDc: number
  existingSystemDc: number
  newTotalAc: number
  existingTotalAc: number
  newTotalStorage: number
  existingTotalStorage: number
}
