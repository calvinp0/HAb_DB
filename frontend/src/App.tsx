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
import { Slider } from "@/components/ui/slider";
import { useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

import { ENERGY_KEYS, type EnergyKey } from "@/lib/constants";
import { ThemeModeToggle } from "@/components/ThemeModeToggle";
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
  import.meta.env.VITE_API_BASE ?? "/api/",
  window.location.origin,
);
const DOWNLOAD_URL = new URL("downloads/reactions.zip", API_BASE).toString();
const formatFamilyLabel = (family?: string | null) => {
  if (!family) return "—";
  const normalized = family.toLowerCase().replace(/\s+/g, "");
  if (normalized === "h_abstraction" || normalized === "habstraction") {
    return "Hydrogen Abstraction";
  }
  return family;
};

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

export type RxnSideOut = {
  role: "reactant" | "product" | "ts";
  conformer_id: number | null;
  species_id: number;
  smiles?: string | null;
  smiles_no_h?: string | null;
  lot?: LevelOfTheoryOut | null;
  is_ts?: boolean;
};

export type ReactionSummaryOut = {
  reaction_id: number;
  family: string;
  reaction_name?: string | null;
  participants: RxnSideOut[]; // reactants/products (+ optional TS)
  ksets_count: number; // number of kinetics sets
};

export const FIELD =
  "h-11 w-full rounded-xl border border-zinc-300 bg-card px-3 text-base " +
  "leading-[1.25rem] placeholder:leading-[1.25rem] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 " +
  "dark:border-zinc-700 dark:bg-zinc-900 placeholder:text-zinc-500";

type SearchParams = Record<string, string | number | boolean | undefined>;

const isApiErrorBody = (value: unknown): value is { detail?: string } => {
  if (typeof value !== "object" || value === null || !("detail" in value))
    return false;
  return typeof (value as { detail?: unknown }).detail === "string";
};

const getErrorDetail = (body: unknown, fallback: string) =>
  isApiErrorBody(body) && body.detail ? body.detail : fallback;

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

type Mode = "molecules" | "reactions" | "ts";
type ConformerSortKey =
  | "lot"
  | "well_label"
  | "well_rank"
  | "is_ts"
  | "is_well_representative"
  | EnergyKey;

export default function App({ initialMode = "molecules" as Mode }) {
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

  const [mode, setMode] = useState<Mode>(initialMode);

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
  const [structureMode, setStructureMode] = useState<
    "auto" | "smarts" | "inchi"
  >("auto");
  const [requireStereo, setRequireStereo] = useState(false);
  const [atoms, setAtoms] = useState<string[]>([]); // ["C","N","S"]
  const [elemMode, setElemMode] = useState<"all" | "any">("all");

  // Selection -> Conformers
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confs, setConfs] = useState<ConformerRow[]>([]);
  const [confLoading, setConfLoading] = useState(false);

  //Conformer Filters
  const [repOnly, setRepOnly] = useState(false);
  const [nonTSOnly, setNonTSOnly] = useState(false);
  const [selectedLot, setSelectedLot] = useState<string>("__ALL__");
  const [wellRank, setWellRank] = useState<number | null>(null);
  const [wellRankOptions, setWellRankOptions] = useState<number[]>([]);
  const [confSort, setConfSort] = useState<{
    key: ConformerSortKey;
    dir: "asc" | "desc";
  }>({ key: "lot", dir: "asc" });
  const setSort = (key: ConformerSortKey) => {
    setConfSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "asc" };
    });
  };
  const ENERGY_DESCRIPTIONS: Record<EnergyKey, string> = {
    G298: "Gibbs free energy at 298 K (kJ/mol) when available.",
    H298: "Enthalpy at 298 K (kJ/mol).",
    E0: "E_elec + ZPE (kJ/mol).",
    E_elec: "Electronic energy (kJ/mol).",
    ZPE: "Zero-point energy (kJ/mol).",
    E_TS: "Barrier height reported for TS conformers (kJ/mol).",
  };

  const renderSortHeader = (
    label: string,
    key: ConformerSortKey,
    title?: string,
  ) => (
    <button
      type="button"
      onClick={() => setSort(key)}
      className="flex items-center gap-1 font-semibold uppercase tracking-wide text-xs"
      title={title}
    >
      <span>{label}</span>
      {confSort.key === key && (
        <span aria-hidden>{confSort.dir === "asc" ? "▲" : "▼"}</span>
      )}
    </button>
  );
  const lotOptions = useMemo(
    () =>
      Array.from(
        new Set(confs.map((c) => c.lot?.lot_string).filter(Boolean)),
      ) as string[],
    [confs],
  );

  const shownConfs = useMemo(() => {
    if (selectedLot === "__ALL__") return confs;
    return confs.filter((c) => c.lot?.lot_string === selectedLot);
  }, [confs, selectedLot]);
  const sortedConfs = useMemo(() => {
    const arr = [...shownConfs];
    const isEnergyKey = (k: string): k is EnergyKey =>
      ENERGY_KEYS.includes(k as EnergyKey);
    const getVal = (conf: ConformerRow, key: ConformerSortKey) => {
      switch (key) {
        case "lot":
          return conf.lot?.lot_string ?? "";
        case "well_label": {
          const label = conf.well_label ?? "";
          if (!label) return "";
          if (label === "well") return "well_000";
          const match = label.match(/^(iso\d+)(?:_(\d+))?$/i);
          if (match) {
            const base = match[1].toLowerCase();
            const suffix = match[2] ? match[2].padStart(3, "0") : "000";
            return `${base}_${suffix}`;
          }
          return label;
        }
        case "well_rank":
          return typeof conf.well_rank === "number"
            ? conf.well_rank
            : Number.POSITIVE_INFINITY;
        case "is_ts":
          return conf.is_ts ? 1 : 0;
        case "is_well_representative":
          return conf.is_well_representative ? 1 : 0;
        default:
          if (isEnergyKey(key)) {
            const val = conf[key as keyof ConformerRow];
            return typeof val === "number" ? val : Number.POSITIVE_INFINITY;
          }
          return conf.conformer_id;
      }
    };
    arr.sort((a, b) => {
      const aVal = getVal(a, confSort.key);
      const bVal = getVal(b, confSort.key);
      let cmp = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal === bVal ? 0 : aVal < bVal ? -1 : 1;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return confSort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [shownConfs, confSort]);
  // Energy Column Selections
  const [energyOn, setEnergyOn] = useState<Record<EnergyKey, boolean>>({
    G298: true,
    H298: true,
    E0: true,
    E_elec: true,
    ZPE: true,
    E_TS: true,
  });
  const selectedEnergyKeys = useMemo<EnergyKey[]>(
    () => ENERGY_KEYS.filter((k) => energyOn[k]),
    [energyOn],
  );
  useEffect(() => {
    if (selectedId == null) {
      setWellRankOptions([]);
    }
  }, [selectedId]);

  // Reaction Tab
  const [rxnReactant, setRxnReactant] = useState("");
  const [rxnReactant2, setRxnReactant2] = useState("");
  const [fuzzyReactants, setFuzzyReactants] = useState(false);
  const [rxnProduct, setRxnProduct] = useState("");
  const [reactions, setReactions] = useState<ReactionSummaryOut[]>([]);
  const [rxnLoading, setRxnLoading] = useState(false);
  const [showRxn, setShowRxn] = useState(false);
  const [activeRxn, setActiveRxn] = useState<ReactionSummaryOut | null>(null);

  function openRxnSummary(rxn: ReactionSummaryOut) {
    setActiveRxn(rxn);
    setShowRxn(true);
  }

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
  }, [repOnly, nonTSOnly, selectedId]);

  useEffect(() => {
    setSelectedLot("__ALL__");
    setWellRank(null);
  }, [selectedId]);

  // debounce wellRank for 300ms
  useEffect(() => {
    if (selectedId == null) return;
    const t = setTimeout(() => {
      void loadConformers(selectedId);
    }, 300);
    return () => clearTimeout(t);
  }, [wellRank, selectedId]);

  useEffect(() => {
    // Keep UX consistent: switching tabs resets current results
    setSpecies([]);
    setSelectedId(null);
    setConfs([]);
    setOffset(0);
    setError(null);
    setReactions([]);
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
      const effLimit = overrides?.limit ?? limit;
      const effOffset = overrides?.offset ?? offset;

      if (mode === "reactions") {
        setRxnLoading(true);
        setReactions([]);
        const params: SearchParams = {
          reactant_q: rxnReactant.trim() || undefined,
          reactant_q2: rxnReactant2.trim() || undefined,
          product_q: rxnProduct.trim() || undefined,
          fuzzy_reactants: fuzzyReactants || undefined,
          limit: effLimit,
          offset: effOffset,
        };
        const url = buildUrl("reactions/search", params);
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        const ct = res.headers.get("content-type") || "";
        const body = ct.includes("application/json")
          ? await res.json().catch(() => [])
          : [];
        if (!res.ok)
          throw new Error(
            getErrorDetail(body, `${res.status} ${res.statusText}`),
          );
        setReactions(body as ReactionSummaryOut[]);
        // keep species list empty for this tab
        setSpecies([]);
        return;
      }

      // ----- existing molecules / ts paths unchanged -----
      const params: SearchParams = {
        limit: effLimit,
        offset: effOffset,
      };
      if (mode === "molecules") {
        if (structureMode !== "auto" && !molQ) {
          setSearchLoading(false);
          setError("Provide a query when using SMARTS or InChI mode.");
          return;
        }

        if (molQ) {
          if (structureMode === "smarts") params.smarts = molQ;
          else if (structureMode === "inchi") params.inchi = molQ;
          else params.q = molQ;
          params.require_stereo = requireStereo || undefined;
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

      const url = buildUrl("species/search", params);
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const ct = res.headers.get("content-type") || "";
      const body = ct.includes("application/json")
        ? await res.json().catch(() => [])
        : [];
      if (!res.ok)
        throw new Error(
          getErrorDetail(body, `${res.status} ${res.statusText}`),
        );
      setSpecies(body as SpeciesOut[]);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setSpecies([]);
      setReactions([]);
    } finally {
      setSearchLoading(false);
      setRxnLoading(false);
    }
  }
  async function loadConformers(id: number) {
    setSelectedId(id);
  }

  // This effect actually fetches and handles cleanup.
  useEffect(() => {
    if (selectedId == null) return;

    const ctrl = new AbortController();
    setConfLoading(true);
    setError(null);

    (async () => {
      try {
        const url = buildUrl(`species/${selectedId}/conformers`, {
          representative_only: repOnly || undefined,
          is_ts: nonTSOnly ? false : undefined,
          well_rank: wellRank ?? undefined,
          limit: 500,
        });
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: ctrl.signal,
        });
        const ct = res.headers.get("content-type") || "";
        const body = ct.includes("application/json")
          ? await res.json().catch(() => [])
          : [];
        if (!res.ok)
          throw new Error(
            getErrorDetail(body, `${res.status} ${res.statusText}`),
          );
        const rows = body as ConformerRow[];
        setConfs(rows);
        if (wellRank === null) {
          const ranks = Array.from(
            new Set(
              rows
                .map((c) => c.well_rank)
                .filter((r): r is number => typeof r === "number"),
            ),
          ).sort((a, b) => a - b);
          setWellRankOptions(ranks);
        }
      } catch (e: unknown) {
        if ((e as { name?: string })?.name !== "AbortError") {
          const message = e instanceof Error ? e.message : String(e);
          setError(message);
          setConfs([]);
        }
      } finally {
        setConfLoading(false);
      }
    })();

    // ✅ THIS cleanup runs when deps change/unmount
    return () => ctrl.abort();
  }, [selectedId, repOnly, nonTSOnly, wellRank]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 backdrop-blur bg-card/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6" />
            <h1 className="text-xl font-semibold">Hydrogen Abstraction DB</h1>
            <Badge variant="secondary" className="ml-2">
              alpha
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeModeToggle condensed />
            <Button variant="outline" size="sm" asChild>
              <a href={DOWNLOAD_URL}>Download dataset</a>
            </Button>
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
                {/* Structure query */}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <label className="block text-sm font-medium flex-1">
                      Structure Query
                    </label>
                    <select
                      className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
                      value={structureMode}
                      onChange={(e) =>
                        setStructureMode(e.target.value as typeof structureMode)
                      }
                    >
                      <option value="auto">Name / SMILES</option>
                      <option value="smarts">SMARTS (substructure)</option>
                      <option value="inchi">InChI</option>
                    </select>
                  </div>
                  <Input
                    className={FIELD}
                    placeholder={
                      structureMode === "smarts"
                        ? "e.g. [OH]C=O"
                        : structureMode === "inchi"
                          ? "e.g. InChI=1S/CH4/h1H4"
                          : "e.g. CC(=O)O or acetone"
                    }
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doSearch()}
                  />
                  {structureMode === "smarts" ? (
                    <p className="text-xs text-slate-500">
                      SMARTS search matches substructures within canonical SMILES.
                    </p>
                  ) : structureMode === "inchi" ? (
                    <p className="text-xs text-slate-500">
                      InChI search matches exact structures via InChIKey/SMILES.
                    </p>
                  ) : null}
                  {structureMode !== "smarts" && (
                    <div className="flex items-center gap-2 text-sm pt-1">
                      <input
                        id="require-stereo"
                        type="checkbox"
                        className="h-4 w-4"
                        checked={requireStereo}
                        onChange={(e) => setRequireStereo(e.target.checked)}
                      />
                      <label htmlFor="require-stereo">
                        Require stereochemistry match
                      </label>
                    </div>
                  )}
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
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Reactant (SMILES or name)
                    </label>
                    <Input
                      className={FIELD}
                      placeholder="e.g. CC[O]"
                      value={rxnReactant}
                      onChange={(e) => setRxnReactant(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && doSearch()}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Second Reactant (optional)
                    </label>
                    <Input
                      className={FIELD}
                      placeholder="e.g. O=O"
                      value={rxnReactant2}
                      onChange={(e) => setRxnReactant2(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && doSearch()}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Product (SMILES or name)
                    </label>
                    <Input
                      className={FIELD}
                      placeholder="optional (leave blank to get all reactions for the reactant)"
                      value={rxnProduct}
                      onChange={(e) => setRxnProduct(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && doSearch()}
                    />
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  Provide one reactant, two reactants, a product, or any
                  combination. When both reactants are present the results are
                  limited to reactions that contain both species on the reactant side.
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <input
                    id="fuzzy-reactants"
                    type="checkbox"
                    className="h-4 w-4"
                    checked={fuzzyReactants}
                    onChange={(e) => setFuzzyReactants(e.target.checked)}
                  />
                  <label htmlFor="fuzzy-reactants">
                    Allow fuzzy reactant match (substring, canonical SMILES only)
                  </label>
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
              className="w-full gap-2 rounded-xl bg-black hover:bg-neutral-900 text-white"
            >
              <SearchIcon className="h-5 w-5" />
              {searchLoading ? "Searching…" : "Query"}
            </Button>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* RIGHT: Results + Conformers card */}
        {/* RIGHT: Results card (single card for all modes) */}
        <Card className="flex-1 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              {/* Left: title */}
              <div className="flex items-center gap-3 min-w-0">
                <CardTitle className="text-lg truncate">
                  {mode === "reactions" ? "Reactions" : "Results"}
                </CardTitle>

                {/* Show toggle only on Reactions */}
                {mode === "reactions" && (
                  <label className="inline-flex items-center gap-2 text-sm shrink-0">
                    <input
                      type="checkbox"
                      className="h-4 w-4 align-middle"
                      checked={explicitSmiles}
                      onChange={(e) => setExplicitSmiles(e.target.checked)}
                    />
                    <span className="leading-none">Explicit SMILES</span>
                  </label>
                )}
              </div>

              {/* Right: pager controls */}
              <div className="flex items-center gap-2">
                <select
                  className="w-28 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm
                     dark:border-zinc-700 dark:bg-zinc-900"
                  value={limit}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setLimit(v);
                    const newOffset = 0;
                    setOffset(newOffset);
                    if (reactions.length || species.length || confs.length) {
                      void doSearch({ limit: v, offset: newOffset });
                    }
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
                  disabled={
                    (mode === "reactions" ? reactions.length : species.length) <
                    limit
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          </CardHeader>

          {/* Body switches by mode */}
          {mode === "reactions" ? (
            <CardContent className="space-y-4">
              {rxnLoading && (
                <div className="text-sm text-slate-500">
                  Searching reactions…
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left">ID</th>
                      <th className="px-3 py-2 text-left">Family</th>
                      <th className="px-3 py-2 text-left">Reaction</th>
                      <th className="px-3 py-2 text-left">K sets</th>
                      <th className="px-3 py-2 text-left"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {reactions.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-zinc-500" colSpan={5}>
                          No reactions.
                        </td>
                      </tr>
                    ) : (
                      reactions.map((rxn) => {
                        const reactants = rxn.participants
                          .filter((p) => p.role === "reactant")
                          .map((p) =>
                            explicitSmiles
                              ? (p.smiles ?? `[${p.species_id}]`)
                              : (p.smiles_no_h ??
                                p.smiles ??
                                `[${p.species_id}]`),
                          )
                          .join(" + ");
                        const products = rxn.participants
                          .filter((p) => p.role === "product")
                          .map((p) =>
                            explicitSmiles
                              ? (p.smiles ?? `[${p.species_id}]`)
                              : (p.smiles_no_h ??
                                p.smiles ??
                                `[${p.species_id}]`),
                          )
                          .join(" + ");

                        const familyLabel = formatFamilyLabel(rxn.family);
                        return (
                          <tr
                            key={rxn.reaction_id}
                            className="hover:bg-secondary/30 dark:hover:bg-secondary/15 cursor-pointer transition-colors"
                            onClick={() => openRxnSummary(rxn)}
                          >
                            <td className="px-3 py-2">{rxn.reaction_id}</td>
                            <td className="px-3 py-2">{familyLabel}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2 font-mono text-base md:w-full">
                                <span className="truncate" title={reactants}>
                                  {reactants || "?"}
                                </span>
                                <span
                                  aria-hidden
                                  className="mx-1 select-none text-xl leading-none"
                                >
                                  ⇌
                                </span>
                                <span className="truncate" title={products}>
                                  {products || "?"}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2">{rxn.ksets_count}</td>
                            <td className="px-3 py-2">
                              <Button
                                className="bg-black text-white hover:bg-neutral-900"
                                onClick={(e) => {
                                  e.stopPropagation(); // keep row click from opening the drawer
                                  navigate(`/reactions/${rxn.reaction_id}`);
                                }}
                              >
                                View
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          ) : (
            <>
              {/* molecules / ts extras */}
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
                        <tr
                          key={sp.species_id}
                          className="hover:bg-secondary/30 dark:hover:bg-secondary/15 cursor-pointer"
                        >
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
                          <td className="px-3 py-2">
                            {sp.spin_multiplicity ?? 1}
                          </td>
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

                {confLoading && (
                  <p className="text-sm text-zinc-500">
                    Loading conformers…
                  </p>
                )}

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
                    <span>Level of Theory</span>
                    <select
                      className="w-52 rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                      value={selectedLot}
                      onChange={(e) => setSelectedLot(e.target.value)}
                      disabled={confs.length === 0}
                    >
                      <option value="__ALL__">All LoTs</option>
                      {lotOptions.map((lot) => (
                        <option key={lot} value={lot}>
                          {lot}
                        </option>
                      ))}
                    </select>
                </label>
                <label className="inline-flex items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1"
                    title="Rank 1 is the lowest-energy well for this species/LoT. Energy order: prefer G298, then H298, else E0 (E_elec + ZPE). Higher ranks are additional wells within ~1e-4 kJ/mol of each other."
                  >
                    Well rank
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3 h-3 text-zinc-400"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                  </span>
                  <select
                    className="w-28 rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    value={
                      wellRank != null && wellRankOptions.includes(wellRank)
                        ? wellRank
                        : "__ALL__"
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      setWellRank(val === "__ALL__" ? null : Number(val));
                    }}
                    disabled={wellRankOptions.length === 0}
                  >
                    <option value="__ALL__">All ranks</option>
                    {wellRankOptions.map((rank) => (
                      <option key={rank} value={rank}>
                        {rank}
                      </option>
                    ))}
                  </select>
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
                      <tr className="bg-zinc-50 text-xs uppercase tracking-wide dark:bg-zinc-900">
                        <th
                          className="px-3 py-2 text-left"
                          title="Level of theory used for the conformer geometry (method/basis/solvent)."
                        >
                          {renderSortHeader("LoT", "lot")}
                        </th>
                        {selectedEnergyKeys.map((k) => (
                          <th
                            key={k}
                            className="px-3 py-2 text-left"
                            title={ENERGY_DESCRIPTIONS[k]}
                          >
                            {renderSortHeader(`${k} (kJ/mol)`, k)}
                          </th>
                        ))}
                        <th className="px-3 py-2 text-left">
                          {renderSortHeader(
                            "TS",
                            "is_ts",
                            "Whether the conformer is a transition state.",
                          )}
                        </th>
                        <th
                          className="px-3 py-2 text-left"
                          title="Label assigned to the well/isoenergetic bucket (e.g., well, iso1_a)."
                        >
                          {renderSortHeader("Well", "well_label")}
                        </th>
                        <th
                          className="px-3 py-2 text-left"
                          title="Rank 1 is the lowest-energy well (preferring G298 → H298 → E0). Higher ranks are progressively higher wells within the same species/LoT."
                        >
                          {renderSortHeader("Rank", "well_rank")}
                        </th>
                        <th
                          className="px-3 py-2 text-left"
                          title="Indicates the representative conformer chosen for a well."
                        >
                          {renderSortHeader("Rep", "is_well_representative")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {sortedConfs.length === 0 ? (
                        <tr>
                          <td
                            className="px-3 py-3 text-zinc-500"
                            colSpan={2 + selectedEnergyKeys.length + 4}
                          >
                            {selectedId
                              ? "No conformers."
                              : "Select a species."}
                          </td>
                        </tr>
                      ) : (
                        sortedConfs.map((c) => (
                          <tr
                            key={c.conformer_id}
                            onClick={() =>
                              navigate(`/conformers/${c.conformer_id}`)
                            }
                            className="hover:bg-secondary/30 dark:hover:bg-secondary/15 cursor-pointer"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ")
                                navigate(`/conformers/${c.conformer_id}`);
                            }}
                            role="button"
                            aria-label={`Open conformer ${c.conformer_id}`}
                          >
                            <td className="px-3 py-2 font-medium">
                              {c.lot?.lot_string ?? (
                                <span className="text-zinc-500">—</span>
                              )}
                            </td>
                            {selectedEnergyKeys.map((k) => (
                              <td key={k} className="px-3 py-2">
                                {fmt(c[k as keyof ConformerRow])}
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
            </>
          )}
        </Card>
        <Sheet open={showRxn} onOpenChange={setShowRxn}>
          <SheetContent side="right" className="w-[520px] sm:w-[640px]">
            <SheetHeader>
              <SheetTitle>
                {activeRxn
                  ? `Reaction ${activeRxn.reaction_id} • ${formatFamilyLabel(activeRxn.family)}`
                  : "Reaction"}
              </SheetTitle>
              <SheetDescription>
                {activeRxn?.reaction_name || "Summary"}
              </SheetDescription>
            </SheetHeader>

            {activeRxn && (
              <div className="mt-4 space-y-4">
                {/* Equation */}
                <div className="font-mono text-base">
                  {(() => {
                    const reactants = activeRxn.participants
                      .filter((p) => p.role === "reactant")
                      .map((p) =>
                        explicitSmiles
                          ? (p.smiles ?? `[${p.species_id}]`)
                          : (p.smiles_no_h ?? p.smiles ?? `[${p.species_id}]`),
                      )
                      .join(" + ");
                    const products = activeRxn.participants
                      .filter((p) => p.role === "product")
                      .map((p) =>
                        explicitSmiles
                          ? (p.smiles ?? `[${p.species_id}]`)
                          : (p.smiles_no_h ?? p.smiles ?? `[${p.species_id}]`),
                      )
                      .join(" + ");
                    return (
                      <div className="flex items-center gap-2">
                        <span className="truncate" title={reactants}>
                          {reactants || "?"}
                        </span>
                        <span
                          aria-hidden
                          className="mx-1 select-none text-xl leading-none"
                        >
                          ⇌
                        </span>
                        <span className="truncate" title={products}>
                          {products || "?"}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {/* Participants */}
                <div>
                  <div className="text-sm text-zinc-500 mb-2">Participants</div>
                  <ul className="space-y-1">
                    {activeRxn.participants.map((p) => (
                      <li
                        key={`${p.role}-${p.conformer_id ?? p.species_id}`}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                          {p.role}
                        </span>
                        <span className="font-mono truncate">
                          {explicitSmiles
                            ? (p.smiles ?? `[${p.species_id}]`)
                            : (p.smiles_no_h ??
                              p.smiles ??
                              `[${p.species_id}]`)}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {p.lot?.lot_string ?? "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    className="bg-black text-white hover:bg-neutral-900"
                    onClick={() =>
                      activeRxn &&
                      navigate(`/reactions/${activeRxn.reaction_id}`)
                    }
                  >
                    Open full page
                  </Button>
                  <Button variant="outline" onClick={() => setShowRxn(false)}>
                    Close
                  </Button>
                </div>

                <div className="text-xs text-zinc-500">
                  {activeRxn.ksets_count} kinetics set(s)
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
