import React, { useEffect, useMemo, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { Layers } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useNavigate } from "react-router-dom";
/**
 * Minimal React + TypeScript single-file app
 * - Search species by name / InChIKey / SMILES
 * - View conformers for a selected species
 * - Toggle which energy columns to display (G298, H298, E0, E_elec, ZPE, E_TS)
 * - Shows Level of Theory (lot.lot_string) instead of raw IDs
 *
 * API BASE
 * -------
 * By default we call the API mounted under the same origin at "/api/".
 * If you run the React dev server on a different port, set VITE_API_BASE to
 * - an absolute URL (e.g., http://localhost:8000/api/), or
 * - keep "/api/" and add a proxy in vite.config.ts to the FastAPI server.
 */

const API_BASE = new URL(
  (import.meta as any).env?.VITE_API_BASE ?? "/api/",
  window.location.origin,
);

// ----- Types that mirror your FastAPI response models -----
export interface SpeciesOut {
  species_id: number;
  smiles?: string | null;
  smiles_no_h?: string | null;
  inchikey?: string | null;
  charge?: number | null;
  spin_multiplicity?: number | null;
  mw?: number | null;
}

export interface LevelOfTheoryOut {
  lot_string: string;
  method: string;
  basis?: string | null;
  solvent?: string | null;
}

export const ENERGY_KEYS = [
  "G298",
  "H298",
  "E0",
  "E_elec",
  "ZPE",
  "E_TS",
] as const;
export type EnergyKey = (typeof ENERGY_KEYS)[number];

export interface ConformerRow {
  conformer_id: number; // <-- add this
  lot: LevelOfTheoryOut;
  is_ts: boolean;
  well_label?: string | null;
  well_rank?: number | null;
  is_well_representative: boolean;
  G298?: number | null;
  H298?: number | null;
  E_elec?: number | null;
  ZPE?: number | null;
  E0?: number | null;
  E_TS?: number | null;
}

export const FIELD =
  "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base " +
  "leading-[1.25rem] placeholder:leading-[1.25rem] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 " +
  "dark:border-zinc-700 dark:bg-zinc-900 placeholder:text-zinc-500";

function buildUrl(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
) {
  /**
   * Build a URL for the API endpoint.
   * @param path - The API endpoint path.
   * @param params - Query parameters to include in the URL.
   * @returns The full URL for the API endpoint.
   *
   * First the base URL is constructed using the API_BASE constant.
   * Then if `params` are provided, they are added to the URL as query parameters.
   * Params is an object where each key-value pair corresponds to a query parameter.
   * u.searchParams.set is used to add each parameter to the URL.
   */
  const u = new URL(path, API_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && String(v).length > 0)
        u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

function fmt(x: number | null | undefined, digits = 3) {
  /**
   * Format a number for display.
   * @param x - The number to format.
   * @param digits - The number of decimal places to include.
   * @returns The formatted number as a string.
   *
   * If the number is null or undefined, a dash is returned.
   * If the number is not a finite number, a dash is returned.
   * Otherwise, the number is formatted to the specified number of decimal places.
   */
  return x == null || x == undefined || !isFinite(x)
    ? "-"
    : Number(x).toFixed(digits);
}

function looksLikeInchiKey(s: string) {
  return /^[A-Z]{14}-[A-Z]{10}-[A-Z]$/i.test(s.trim());
}
function looksLikeSmiles(s: string) {
  // crude but effective: characters common to SMILES or atom symbols/digits
  return /[=#\[\]\(\)@+\-\d]/.test(s) || /^[BCNOPSFclBrI]+/i.test(s.trim());
}

function ElementPicker({
  atoms,
  setAtoms,
  elemMode,
  setElemMode,
  common = ["C", "N", "O", "S", "P", "F", "Cl", "Br", "I", "Si", "B"],
  radioName = "elem-mode",
}: {
  atoms: string[];
  setAtoms: React.Dispatch<React.SetStateAction<string[]>>;
  elemMode: "all" | "any";
  setElemMode: (m: "all" | "any") => void;
  common?: string[];
  radioName?: string;
}) {
  const VALID_ELEM =
    /^(H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|Sc|Ti|V|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Y|Zr|Nb|Mo|Tc|Ru|Rh|Pd|Ag|Cd|In|Sn|Sb|Te|I|Xe|Cs|Ba|La|Ce|Pr|Nd|Pm|Sm|Eu|Gd|Tb|Dy|Ho|Er|Tm|Yb|Lu|Hf|Ta|W|Re|Os|Ir|Pt|Au|Hg|Tl|Pb|Bi|Po|At|Rn)$/;

  const [atomInput, setAtomInput] = React.useState("");

  return (
    <div className="space-y-2">
      {/* chips */}
      <div className="flex flex-wrap gap-2">
        {atoms.map((sym) => (
          <span
            key={sym}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-sm"
          >
            {sym}
            <button
              type="button"
              className="text-slate-500 hover:text-slate-700"
              onClick={() => setAtoms((a) => a.filter((x) => x !== sym))}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* input + quick picks */}
      <div className="flex flex-col gap-2">
        <Input
          value={atomInput}
          onChange={(e) => setAtomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const t = atomInput.trim();
              if (!t) return;
              const sym =
                t.slice(0, 1).toUpperCase() + t.slice(1).toLowerCase();
              if (VALID_ELEM.test(sym))
                setAtoms((a) => (a.includes(sym) ? a : [...a, sym]));
              setAtomInput("");
            }
          }}
          placeholder="Type symbol + Enter (e.g. C)"
          className={FIELD}
        />
        <div className="flex flex-wrap gap-3">
          {common.map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() =>
                setAtoms((a) => (a.includes(sym) ? a : [...a, sym]))
              }
              className="rounded-full border px-2 py-0.5 text-xs hover:bg-slate-50"
            >
              {sym}
            </button>
          ))}
        </div>
      </div>

      {/* mode */}
      <div className="flex items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name={radioName}
            checked={elemMode === "all"}
            onChange={() => setElemMode("all")}
          />
          <span>Must include all</span>
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name={radioName}
            checked={elemMode === "any"}
            onChange={() => setElemMode("any")}
          />
          <span>Include any</span>
        </label>
      </div>
    </div>
  );
}

export default function App() {
  /**
   * Main application component.
   *
   * For Search State
   *  - These useState calls create state variabls
   *  - q: search query string
   *  - limit: how many results to fetch per page
   *  - offset: index for pagination (where to start from)
   *  - species: an array of search results, typed as SpeciesOut[]
   *  - searchLoading: a boolean to indicate if a search request is in progress
   *  - error: an error message, if any (string or null)
   *
   * For Conformer State
   *  - selectedId: the ID of the currently selected conformer (number or null)
   *  - confs: an array of conformer data, typed as ConformerRow[]
   *  - confLoading: a boolean to indicate if conformer data is being loaded
   *
   * For Conformer Filters
   *  - repOnly: a boolean to filter for representative conformers only
   *  - nonTSOnly: a boolean to filter for non-transition state conformers only
   *  - lotId: the ID of the level of theory to filter by (string or null)
   *  - wellRank: the rank of the well to filter by (number or null)
   *
   * For Energy Column Selections
   *  - energyOn: a record of energy keys and their visibility (boolean)
   *  - selectedEnergyKeys: an array of currently selected energy keys
   *
   * Derived State with useMemo
   * useMemo caches a computed value unless dependencies change. ENERGY_KEYS is an array of energy key strings.
   * It filters that list to return only the keys where energyOn[key] is true.
   * So selectedEnergyKeys will only include the keys that are currently visible.
   */
  const navigate = useNavigate();

  type Mode = "molecules" | "reactions" | "ts";
  const [mode, setMode] = useState<Mode>("molecules");

  // TS Tab State
  const [tsSmiles, setTSSmiles] = useState("");
  const [tsRequireImaginary, setTSRequireImaginary] = useState(true);
  const [tsEnergyWindow, setTsEnergyWindow] = useState<[number, number]>([
    10, 18,
  ]); // kcal/mol
  const [tsAtoms, setTsAtoms] = useState<string[]>([]);
  const [tsElemMode, setTsElemMode] = useState<"all" | "any">("all");

  // Search State
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [species, setSpecies] = useState<SpeciesOut[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const HEAVY_ATOM_CAP = 80;
  const [maxHeavy, setMaxHeavy] = useState<number>(HEAVY_ATOM_CAP);
  const [explicitSmiles, setExplicitSmiles] = useState(false);
  const COMMON_ELEMENTS = [
    "C",
    "N",
    "O",
    "S",
    "P",
    "F",
    "Cl",
    "Br",
    "I",
    "Si",
    "B",
  ]; // feel free to add
  const VALID_ELEM =
    /^(H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|Sc|Ti|V|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Y|Zr|Nb|Mo|Tc|Ru|Rh|Pd|Ag|Cd|In|Sn|Sb|Te|I|Xe|Cs|Ba|La|Ce|Pr|Nd|Pm|Sm|Eu|Gd|Tb|Dy|Ho|Er|Tm|Yb|Lu|Hf|Ta|W|Re|Os|Ir|Pt|Au|Hg|Tl|Pb|Bi|Po|At|Rn)$/;

  const [atoms, setAtoms] = useState<string[]>([]); // ["C","N","S"]
  const [elemMode, setElemMode] = useState<"all" | "any">("all");
  const [atomInput, setAtomInput] = useState("");

  // Selection -> Conformers
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confs, setConfs] = useState<ConformerRow[]>([]);
  const [confLoading, setConfLoading] = useState(false);

  //Conformer Filters
  const [repOnly, setRepOnly] = useState(false);
  const [nonTSOnly, setNonTSOnly] = useState(false);
  const [lotId, setLotId] = useState<string | null>(null);
  const [wellRank, setWellRank] = useState<number | null>(null);

  // Energy Column Selections
  const [energyOn, setEnergyOn] = useState<Record<EnergyKey, boolean>>({
    G298: true,
    H298: true,
    E0: true,
    E_elec: true,
    ZPE: true,
    E_TS: true,
  });
  const selectedEnergyKeys = useMemo(
    () => ENERGY_KEYS.filter((k) => energyOn[k]),
    [energyOn],
  );

  // debounce for search typing
  /**
   * Debounce the search input to avoid excessive API calls.
   * This will only trigger a search after the user has stopped typing for 300ms.
   * The search query will be trimmed of whitespace before being sent.
   * void doSearch(); ensures any Promise is ignored (so TS doesn't warn about unhandled Promises)
   * Only runs when q, limit, or offset change.
   */
  // useEffect(() => {
  //   if (!q) return; // don't search empty - auto-run on empty
  //   const t = setTimeout(() => {
  //     void doSearch();
  //   }, 300);
  //   return () => clearTimeout(t);
  // }, [q, limit, offset]);
  // auto-reload on checkboxes immediately
  useEffect(() => {
    if (selectedId != null) void loadConformers(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repOnly, nonTSOnly, selectedId]);

  // debounce lotId / wellRank for 300ms
  useEffect(() => {
    if (selectedId == null) return;
    const t = setTimeout(() => {
      void loadConformers(selectedId);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId, wellRank, selectedId]);

  useEffect(() => {
    // Keep UX consistent: switching tabs resets current results
    setSpecies([]);
    setSelectedId(null);
    setConfs([]);
    setOffset(0);
    setError(null);
  }, [mode]);

  async function doSearch(
    overrides?: Partial<{ limit: number; offset: number }>,
  ) {
    setSelectedId(null);
    setConfs([]);
    setConfLoading(false);

    const molQ = q.trim();
    const tsQ = tsSmiles.trim();

    if (molQ && looksLikeInchiKey(molQ)) {
      setError("This field expects a SMILES, not an InChIKey.");
      return;
    }

    setSearchLoading(true);
    setError(null);

    try {
      // use overrides when provided (for Next/Prev or size changes)
      const effLimit = overrides?.limit ?? limit;
      const effOffset = overrides?.offset ?? offset;

      const params: Record<string, any> = {
        limit: effLimit,
        offset: effOffset,
      };

      if (mode === "molecules") {
        if (molQ) {
          params.q = molQ;
        } else {
          if (atoms.length) {
            params.elements = atoms.join(",");
            params.elem_mode = elemMode;
          }
          if (maxHeavy !== HEAVY_ATOM_CAP) params.max_heavy_atoms = maxHeavy;
        }
        params.include_ts = false;
      }

      if (mode === "ts") {
        params.ts_only = true;
        if (tsQ) params.q = tsQ;
        else if (tsAtoms.length) {
          params.elements = tsAtoms.join(",");
          params.elem_mode = tsElemMode;
        }
        if (tsRequireImaginary) params.require_imag = true;
        params.de_min_kcal = tsEnergyWindow[0];
        params.de_max_kcal = tsEnergyWindow[1];
      }

      if (mode === "reactions") {
        if (molQ) params.q = molQ;
      }

      const url = buildUrl("species/search", params);
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const ct = res.headers.get("content-type") || "";
      const body = ct.includes("application/json")
        ? await res.json().catch(() => [])
        : [];
      if (!res.ok)
        throw new Error(
          (body as any)?.detail || `${res.status} ${res.statusText}`,
        );
      setSpecies(body as SpeciesOut[]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setSpecies([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function loadConformers(id: number) {
    setSelectedId(id);
    setConfLoading(true);
    setError(null);
    try {
      const url = buildUrl(`species/${id}/conformers`, {
        representative_only: repOnly || undefined,
        is_ts: nonTSOnly ? false : undefined,
        lot_id: lotId || undefined,
        well_rank: wellRank ?? undefined,
        limit: 500,
      });
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const ct = res.headers.get("content-type") || "";
      const body = ct.includes("application/json")
        ? await res.json().catch(() => [])
        : [];
      if (!res.ok)
        throw new Error(
          (body as any)?.detail || `${res.status} ${res.statusText}`,
        );
      setConfs(body as ConformerRow[]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setConfs([]);
    } finally {
      setConfLoading(false);
    }
  }
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 backdrop-blur bg-white/70 border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6" />
            <h1 className="text-xl font-semibold">Hydrogen Abstraction DB</h1>
            <Badge variant="secondary" className="ml-2">
              alpha
            </Badge>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-2 grid grid-cols-1 lg:grid-cols-12 gap-1"></main>
      {/* Two-column layout: left fixed card, right flexible card */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* LEFT: Query card */}
        <Card className="w-full shrink-0 shadow-sm lg:w-[360px]">
          <CardHeader>
            <CardTitle className="text-lg">Query</CardTitle>
            <CardDescription>
              Build a search across molecules, reactions, or TSs.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Tabs */}
            {/* <div className="flex items-center gap-1">
            <button className="rounded-lg px-3 py-1.5 text-sm font-medium bg-zinc-100 dark:bg-zinc-800">
              Molecules
            </button>
            <button className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              Reactions
            </button>
            <button className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              TS
            </button>
          </div> */}
            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              className="w-full"
            >
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="molecules" className="w-full">
                  Molecules
                </TabsTrigger>
                <TabsTrigger value="reactions" className="w-full">
                  Reactions
                </TabsTrigger>
                <TabsTrigger value="ts" className="w-full">
                  TS
                </TabsTrigger>
              </TabsList>

              <TabsContent value="molecules" className="mt-4 space-y-3">
                {/* SMILES */}
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    SMILES
                  </label>
                  <Input
                    className={FIELD}
                    placeholder="e.g. CC(=O)O"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doSearch()}
                  />
                </div>

                {/* SMARTS placeholder — not used yet */}
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    SMARTS substructure (placeholder)
                  </label>
                  <Input className={FIELD} placeholder="e.g. [OH]C=O" />
                </div>

                {/* Chips */}
                <div>
                  <label className="mb-0 block text-sm font-medium">
                    Atoms
                  </label>
                  <ElementPicker
                    atoms={atoms}
                    setAtoms={setAtoms}
                    elemMode={elemMode}
                    setElemMode={setElemMode}
                    radioName="mol-elem-mode"
                  />
                </div>
                {/* <div className="flex flex-wrap gap-2 mb-2">
              {atoms.map(sym => (
                <span key={sym}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-sm">
                  {sym}
                  <button
                    onClick={() => setAtoms(a => a.filter(x => x !== sym))}
                    className="text-slate-500 hover:text-slate-700">×</button>
                </span>
              ))}
              <input
                value={atomInput}
                onChange={(e) => setAtomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const t = atomInput.trim();
                    const sym = t.slice(0,1).toUpperCase() + t.slice(1).toLowerCase();
                    if (VALID_ELEM.test(sym) && !atoms.includes(sym)) setAtoms([...atoms, sym]);
                    setAtomInput("");
                  }
                }}
                placeholder="Type symbol + Enter (e.g. C)"
                className="flex-1 min-w-[140px] rounded-xl border border-zinc-300 px-3 py-2"
              />
            </div>

            {/* Quick picks */}
                {/* <div className="flex flex-wrap gap-2 mb-2">
              {COMMON_ELEMENTS.map(sym => (
                <button key={sym}
                  onClick={() => setAtoms(a => a.includes(sym) ? a : [...a, sym])}
                  className="rounded-full border px-2 py-0.5 text-sm hover:bg-slate-50">
                  {sym}
                </button>
              ))}
            </div>

            {/* Mode */}
                {/* <div className="flex items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="elem-mode" checked={elemMode==="all"} onChange={() => setElemMode("all")} />
                <span>Must include all</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="elem-mode" checked={elemMode==="any"} onChange={() => setElemMode("any")} />
                <span>Include any</span>
              </label>
            </div> */}

                {/* Max heavy atoms slider */}
                <label className="label">
                  Max heavy atoms{" "}
                  {maxHeavy === HEAVY_ATOM_CAP ? "(no limit)" : `(${maxHeavy})`}
                </label>
                <input
                  type="range"
                  min={0}
                  max={HEAVY_ATOM_CAP}
                  step={1}
                  className="w-full"
                  value={maxHeavy}
                  onChange={(e) => setMaxHeavy(Number(e.target.value))}
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>0</span>
                  <span>∞</span>
                </div>
              </TabsContent>
              {/* Reactions tab (placeholder / your UI) */}
              <TabsContent value="reactions" className="mt-4 space-y-3">
                {/* TODO: reactant/product/family inputs */}
                <div className="text-sm text-slate-500">
                  Reaction search coming soon.
                </div>
              </TabsContent>

              {/* TS tab*/}
              <TabsContent value="ts" className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    TS SMILES
                  </label>
                  <input
                    className={FIELD}
                    placeholder="Optional; if known"
                    value={tsSmiles}
                    onChange={(e) => setTSSmiles(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doSearch()}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="ts-imag"
                    type="checkbox"
                    className="h-4 w-4"
                    checked={tsRequireImaginary}
                    onChange={(e) => setTSRequireImaginary(e.target.checked)}
                  />
                  <label htmlFor="ts-imag" className="text-sm">
                    Require ≥1 imaginary frequency
                  </label>
                </div>

                <div>
                  <Label>ΔE window (kcal/mol)</Label>
                  <Slider
                    value={tsEnergyWindow}
                    min={0}
                    max={50}
                    step={1}
                    onValueChange={(v) =>
                      setTsEnergyWindow(v as [number, number])
                    }
                    className="mt-2"
                  />
                  <div className="text-xs text-muted-foreground mt-1">
                    {tsEnergyWindow[0]} – {tsEnergyWindow[1]} kcal/mol
                  </div>
                </div>

                <div className="mb-0">
                  <Label>Atoms</Label>
                  <ElementPicker
                    atoms={tsAtoms}
                    setAtoms={setTsAtoms}
                    elemMode={tsElemMode}
                    setElemMode={setTsElemMode}
                    radioName="ts-elem-mode"
                  />
                </div>
              </TabsContent>
            </Tabs>

            {/* Black action button with magnifier */}
            <Button
              onClick={doSearch}
              disabled={searchLoading}
              className="w-full gap-2 rounded-xl bg-black hover:bg-neutral-900"
            >
              <SearchIcon className="h-5 w-5" />
              {searchLoading ? "Searching…" : "Query"}
            </Button>
          </CardContent>
        </Card>

        {/* RIGHT: Results + Conformers card */}
        <Card className="flex-1 shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Results</CardTitle>
              <div className="flex items-center gap-2">
                <select
                  className="w-28 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm
                            dark:border-zinc-700 dark:bg-zinc-900"
                  value={limit}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setLimit(v);
                    setOffset(0);
                    void doSearch({ limit: v, offset: 0 }); // <-- fetch with new page size NOW
                  }}
                >
                  <option value={10}>10 / page</option>
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                </select>

                <Button
                  variant="ghost"
                  className="px-2"
                  onClick={() => {
                    const newOffset = Math.max(0, offset - limit);
                    setOffset(newOffset);
                    void doSearch({ offset: newOffset });
                  }}
                  disabled={offset === 0}
                >
                  Prev
                </Button>

                <Button
                  variant="ghost"
                  className="px-2"
                  onClick={() => {
                    const newOffset = offset + limit;
                    setOffset(newOffset);
                    void doSearch({ offset: newOffset });
                  }}
                  disabled={species.length < limit} // likely last page
                >
                  Next
                </Button>
              </div>
            </div>
            {error ? (
              <div className="px-3 pb-2">
                <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/10">
                  {error}
                </span>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={explicitSmiles}
                onChange={(e) => setExplicitSmiles(e.target.checked)}
              />
              <span>Explicit SMILES</span>
            </label>
          </CardContent>

          <CardContent className="space-y-6">
            {/* SPECIES TABLE */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                {" "}
                {/* no border-collapse */}
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">SMILES</th>
                    <th className="px-3 py-2 text-left">InChIKey</th>
                    <th className="px-3 py-2 text-left">Charge</th>
                    <th className="px-3 py-2 text-left">Spin</th>
                    <th className="px-3 py-2 text-left">MW</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {species.map((sp) => (
                    <tr key={sp.species_id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">{sp.species_id}</td>
                      <td className="px-3 py-2">
                        {(explicitSmiles
                          ? sp.smiles
                          : (sp.smiles_no_h ?? sp.smiles)) ?? (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{sp.inchikey}</td>
                      <td className="px-3 py-2">{sp.charge ?? 0}</td>
                      <td className="px-3 py-2">{sp.spin_multiplicity ?? 1}</td>
                      <td className="px-3 py-2">
                        {sp.mw != null ? (
                          sp.mw.toFixed(3)
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          onClick={() => loadConformers(sp.species_id)}
                          className="w-full bg-black text-white hover:bg-neutral-900"
                        >
                          View conformers
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* CONFORMERS */}
            <h2 className="text-2xl font-semibold">Conformers</h2>

            <div className="mb-2 flex flex-wrap items-center gap-6 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={repOnly}
                  onChange={(e) => setRepOnly(e.target.checked)}
                />
                <span>Representatives only</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={nonTSOnly}
                  onChange={(e) => setNonTSOnly(e.target.checked)}
                />
                <span>Non-TS only</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <span>LoT ID</span>
                <input
                  className="w-28 rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  value={lotId ?? ""}
                  onChange={(e) => setLotId(e.target.value)}
                />
              </label>
              <label className="inline-flex items-center gap-2">
                <span>Well rank</span>
                <input
                  type="number"
                  className="w-28 rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  value={wellRank ?? ""}
                  onChange={(e) =>
                    setWellRank(e.target.value ? Number(e.target.value) : null)
                  }
                />
              </label>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
              <span className="mr-1 font-medium text-zinc-500">
                Show energies:
              </span>
              {ENERGY_KEYS.map((k) => (
                <label key={k} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={energyOn[k]}
                    onChange={(e) =>
                      setEnergyOn((s) => ({ ...s, [k]: e.target.checked }))
                    }
                  />
                  <span>
                    {k}
                    {k === "E_TS" ? " (TS)" : ""}
                  </span>
                </label>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide dark:bg-zinc-900">
                    <th className="px-3 py-2 text-left">LoT</th>
                    {selectedEnergyKeys.map((k) => (
                      <th key={k} className="px-3 py-2 text-left">
                        {k} (kJ/mol)
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left">TS</th>
                    <th className="px-3 py-2 text-left">Well</th>
                    <th className="px-3 py-2 text-left">Rank</th>
                    <th className="px-3 py-2 text-left">Rep</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {confs.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-3 text-zinc-500"
                        colSpan={2 + selectedEnergyKeys.length + 4}
                      >
                        {selectedId ? "No conformers." : "Select a species."}
                      </td>
                    </tr>
                  ) : (
                    confs.map((c) => (
                      <tr
                        key={c.conformer_id}
                        onClick={() =>
                          navigate(`/conformers/${c.conformer_id}`)
                        }
                        className="hover:bg-slate-50 cursor-pointer"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            navigate(`/conformers/${c.conformer_id}`);
                        }}
                        role="button"
                        aria-label={`Open conformer ${c.conformer_id}`}
                      >
                        <td className="px-3 py-2">
                          {c.lot?.lot_string ?? (
                            <span className="text-zinc-500">—</span>
                          )}
                        </td>
                        {selectedEnergyKeys.map((k) => (
                          <td key={k} className="px-3 py-2">
                            {fmt((c as any)[k])}
                          </td>
                        ))}
                        <td className="px-3 py-2">{c.is_ts ? "TS" : ""}</td>
                        <td className="px-3 py-2">
                          {c.well_label ?? (
                            <span className="text-zinc-500">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {c.well_rank ?? (
                            <span className="text-zinc-500">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {c.is_well_representative ? "✔" : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
