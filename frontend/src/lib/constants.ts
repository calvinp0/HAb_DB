
export const ENERGY_KEYS = ["G298","H298","E0","E_elec","ZPE","E_TS"] as const;
export type EnergyKey = (typeof ENERGY_KEYS)[number];
    