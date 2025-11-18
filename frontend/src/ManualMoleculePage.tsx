import React from "react";
import { Link } from "react-router-dom";
import { Layers } from "lucide-react";

import ConformerViewer3D from "@/ConformerViewer3D";
import { ThemeModeToggle } from "@/components/ThemeModeToggle";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LabelMode = "none" | "elem" | "index" | "elem+index";
const VIEWER_THEMES = ["jmol", "gaussview", "chemcraft"] as const;
type ViewerTheme = (typeof VIEWER_THEMES)[number];
const VIEWER_STYLES = ["ballstick", "line", "spacefill"] as const;
type ViewerStyle = (typeof VIEWER_STYLES)[number];
type ParsedAtom = { element: string; x: number; y: number; z: number };
type ParseResult = { atoms: ParsedAtom[]; xyz: string | null; error: string | null };
type PickedAtom = { index: number; element: string; x: number; y: number; z: number };

const SAMPLE_GEOMETRY = `C      0.000000    0.000000    0.000000
H      0.000000    0.000000    1.089000
H      1.026719    0.000000   -0.363000
H     -0.513360   -0.889165   -0.363000
H     -0.513360    0.889165   -0.363000`;

const ELEMENT_SYMBOLS = new Set([
  "H",
  "He",
  "Li",
  "Be",
  "B",
  "C",
  "N",
  "O",
  "F",
  "Ne",
  "Na",
  "Mg",
  "Al",
  "Si",
  "P",
  "S",
  "Cl",
  "Ar",
  "K",
  "Ca",
  "Sc",
  "Ti",
  "V",
  "Cr",
  "Mn",
  "Fe",
  "Co",
  "Ni",
  "Cu",
  "Zn",
  "Ga",
  "Ge",
  "As",
  "Se",
  "Br",
  "Kr",
  "Rb",
  "Sr",
  "Y",
  "Zr",
  "Nb",
  "Mo",
  "Tc",
  "Ru",
  "Rh",
  "Pd",
  "Ag",
  "Cd",
  "In",
  "Sn",
  "Sb",
  "Te",
  "I",
  "Xe",
  "Cs",
  "Ba",
  "La",
  "Ce",
  "Pr",
  "Nd",
  "Pm",
  "Sm",
  "Eu",
  "Gd",
  "Tb",
  "Dy",
  "Ho",
  "Er",
  "Tm",
  "Yb",
  "Lu",
  "Hf",
  "Ta",
  "W",
  "Re",
  "Os",
  "Ir",
  "Pt",
  "Au",
  "Hg",
  "Tl",
  "Pb",
  "Bi",
  "Po",
  "At",
  "Rn",
]);

const LABEL_OPTIONS: { value: LabelMode; label: string }[] = [
  { value: "elem+index", label: "Element + atom #" },
  { value: "index", label: "Atom number only" },
  { value: "elem", label: "Element only" },
  { value: "none", label: "Hide labels" },
];
const THEME_OPTIONS: { value: ViewerTheme; label: string; description: string }[] = [
  { value: "chemcraft", label: "Chemcraft (dark)", description: "Neon palette, dark bg" },
  { value: "gaussview", label: "GaussView", description: "Pastel palette, lavender bg" },
  { value: "jmol", label: "Jmol (default)", description: "Classic light viewer" },
];
const STYLE_OPTIONS: { value: ViewerStyle; label: string }[] = [
  { value: "ballstick", label: "Ball & stick" },
  { value: "spacefill", label: "Space fill" },
  { value: "line", label: "Wireframe" },
];

const formatCoordinate = (value: number) => {
  const v = Math.abs(value) < 1e-12 ? 0 : value;
  return v.toFixed(6);
};

const normalizeSymbol = (value: string) => {
  if (!value) return "";
  const first = value.slice(0, 1).toUpperCase();
  const rest = value.slice(1).toLowerCase();
  return `${first}${rest}`;
};

const parseXyzInput = (raw: string): ParseResult => {
  const trimmed = raw.trim();
  if (!trimmed) return { atoms: [], xyz: null, error: null };
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { atoms: [], xyz: null, error: null };

  const atoms: ParsedAtom[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      return {
        atoms: [],
        xyz: null,
        error: `Line ${i + 1}: expected "Element X Y Z", found "${line}"`,
      };
    }
    const symbol = normalizeSymbol(parts[0]);
    if (!ELEMENT_SYMBOLS.has(symbol)) {
      return {
        atoms: [],
        xyz: null,
        error: `Line ${i + 1}: unknown element symbol "${parts[0]}"`,
      };
    }
    const coords = parts.slice(1, 4).map((v) => Number(v));
    if (coords.some((c) => !Number.isFinite(c))) {
      return {
        atoms: [],
        xyz: null,
        error: `Line ${i + 1}: coordinates must be numeric values`,
      };
    }
    atoms.push({ element: symbol, x: coords[0], y: coords[1], z: coords[2] });
  }

  const xyzBody = atoms
    .map(
      (atom) =>
        `${atom.element} ${formatCoordinate(atom.x)} ${formatCoordinate(atom.y)} ${formatCoordinate(atom.z)}`,
    )
    .join("\n");
  const xyz = `${atoms.length}\nManual geometry\n${xyzBody}`;
  return { atoms, xyz, error: null };
};

const distance = (a: PickedAtom, b: PickedAtom) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const angle = (a: PickedAtom, b: PickedAtom, c: PickedAtom) => {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const n1 = Math.hypot(v1.x, v1.y, v1.z);
  const n2 = Math.hypot(v2.x, v2.y, v2.z);
  if (n1 === 0 || n2 === 0) return null;
  const cos = Math.min(Math.max(dot / (n1 * n2), -1), 1);
  return (Math.acos(cos) * 180) / Math.PI;
};

const dihedral = (a: PickedAtom, b: PickedAtom, c: PickedAtom, d: PickedAtom) => {
  const subtract = (u: PickedAtom, v: PickedAtom) => ({
    x: u.x - v.x,
    y: u.y - v.y,
    z: u.z - v.z,
  });
  const v1 = subtract(b, a);
  const v2 = subtract(c, b);
  const v3 = subtract(d, c);
  const cross = (u: typeof v1, v: typeof v1) => ({
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  });
  const n1 = cross(v1, v2);
  const n2 = cross(v2, v3);
  const n1Mag = Math.hypot(n1.x, n1.y, n1.z);
  const n2Mag = Math.hypot(n2.x, n2.y, n2.z);
  const v2Mag = Math.hypot(v2.x, v2.y, v2.z);
  if (n1Mag === 0 || n2Mag === 0 || v2Mag === 0) return null;
  const cosPhi = Math.min(
    Math.max((n1.x * n2.x + n1.y * n2.y + n1.z * n2.z) / (n1Mag * n2Mag), -1),
    1,
  );
  const m1 = cross(n1, v2);
  const y = (m1.x * n2.x + m1.y * n2.y + m1.z * n2.z) / (v2Mag * n2Mag);
  return (Math.atan2(y, cosPhi) * 180) / Math.PI;
};

const ManualMoleculePage: React.FC = () => {
  const [input, setInput] = React.useState(SAMPLE_GEOMETRY);
  const [labelMode, setLabelMode] = React.useState<LabelMode>("elem+index");
  const [labelHydrogens, setLabelHydrogens] = React.useState(true);
  const [viewerTheme, setViewerTheme] = React.useState<ViewerTheme>("chemcraft");
  const [viewerStyle, setViewerStyle] = React.useState<ViewerStyle>("ballstick");
  const [measurementEnabled, setMeasurementEnabled] = React.useState(true);
  const [pickedAtoms, setPickedAtoms] = React.useState<PickedAtom[]>([]);

  const { atoms, xyz, error } = React.useMemo(() => parseXyzInput(input), [input]);
  const hasGeometry = Boolean(xyz && atoms.length && !error);

  const pushPickedAtom = React.useCallback((atom: PickedAtom) => {
    setPickedAtoms((prev) => {
      const next = [...prev, atom];
      return next.length > 4 ? next.slice(next.length - 4) : next;
    });
  }, []);

  const handleAtomPick = React.useCallback(
    (atom: PickedAtom) => {
      if (!measurementEnabled) return;
      pushPickedAtom(atom);
    },
    [measurementEnabled, pushPickedAtom],
  );

  const handleListPick = React.useCallback(
    (idx: number) => {
      if (!measurementEnabled) return;
      const atom = atoms[idx];
      if (!atom) return;
      pushPickedAtom({
        index: idx + 1,
        element: atom.element,
        x: atom.x,
        y: atom.y,
        z: atom.z,
      });
    },
    [atoms, measurementEnabled, pushPickedAtom],
  );

  React.useEffect(() => {
    setPickedAtoms([]);
  }, [xyz]);

  const measurementResult = React.useMemo(() => {
    if (pickedAtoms.length < 2) return null;
    if (pickedAtoms.length === 2) {
      const [a, b] = pickedAtoms;
      return {
        label: `Bond length (#${a.index}–#${b.index})`,
        value: `${distance(a, b).toFixed(3)} Å`,
      };
    }
    if (pickedAtoms.length === 3) {
      const [a, b, c] = pickedAtoms;
      const ang = angle(a, b, c);
      if (ang == null) return null;
      return {
        label: `Angle (#${a.index}–#${b.index}–#${c.index})`,
        value: `${ang.toFixed(2)}°`,
      };
    }
    if (pickedAtoms.length === 4) {
      const [a, b, c, d] = pickedAtoms;
      const dih = dihedral(a, b, c, d);
      if (dih == null) return null;
      return {
        label: `Dihedral (#${a.index}–#${b.index}–#${c.index}–#${d.index})`,
        value: `${dih.toFixed(2)}°`,
      };
    }
    return null;
  }, [pickedAtoms]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 backdrop-blur bg-card/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 text-sm font-medium text-foreground">
            <Layers className="w-5 h-5" />
            Hydrogen Abstraction DB
          </Link>
          <div className="flex items-center gap-3">
            <ThemeModeToggle condensed />
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold">Draw a molecule</h1>
              <p className="text-slate-500 text-sm">
                Paste ELEMENT X Y Z rows and we&apos;ll render it in the same 3D viewer used on the conformer page.
              </p>
            </div>
            <Link
              to="/"
              className="text-sm underline underline-offset-4 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              ← Back to search
            </Link>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(360px,520px)_minmax(520px,1fr)] 2xl:grid-cols-[minmax(380px,560px)_minmax(760px,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Manual XYZ input</CardTitle>
              <CardDescription>
                Each line should be <code className="font-mono">Element X Y Z</code> separated by spaces.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="xyz-input">Coordinates</Label>
                <textarea
                  id="xyz-input"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[220px]"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="C 0.0000 0.0000 0.0000"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setInput(SAMPLE_GEOMETRY)}>
                  Use methane example
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setInput("")}>
                  Clear
                </Button>
              </div>
              {error ? (
                <p className="text-sm text-rose-600">{error}</p>
              ) : (
                <p className="text-sm text-slate-500">
                  Supports pasted Gaussian/NWChem XYZ blocks without the atom-count header; blank lines are ignored.
                </p>
              )}
              <div className="pt-4 border-t border-border space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="label-mode">Atom labels</Label>
                  <Select value={labelMode} onValueChange={(value) => setLabelMode(value as LabelMode)}>
                    <SelectTrigger id="label-mode">
                      <SelectValue placeholder="Choose label style" />
                    </SelectTrigger>
                    <SelectContent>
                      {LABEL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label htmlFor="label-hydrogens">Label hydrogens</Label>
                    <p className="text-xs text-slate-500">
                      Turn off if you only want heavy atoms numbered in the scene.
                    </p>
                  </div>
                  <Switch
                    id="label-hydrogens"
                    checked={labelHydrogens}
                    onCheckedChange={setLabelHydrogens}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="viewer-theme">Viewer palette</Label>
                  <Select value={viewerTheme} onValueChange={(value) => setViewerTheme(value as ViewerTheme)}>
                    <SelectTrigger id="viewer-theme">
                      <SelectValue placeholder="Select palette" />
                    </SelectTrigger>
                    <SelectContent>
                      {THEME_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <div className="flex flex-col text-left">
                            <span>{option.label}</span>
                            <span className="text-[11px] text-muted-foreground">{option.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="viewer-style">Rendering style</Label>
                  <Select value={viewerStyle} onValueChange={(value) => setViewerStyle(value as ViewerStyle)}>
                    <SelectTrigger id="viewer-style">
                      <SelectValue placeholder="Select style" />
                    </SelectTrigger>
                    <SelectContent>
                      {STYLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle>Preview</CardTitle>
              <CardDescription>
                Atom numbers shown directly in the 3D view for quick reference.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-4">
              <div
                className={`rounded-lg border border-border p-3 min-h-[560px] flex items-center justify-center bg-card/40 ${
                  measurementEnabled ? "cursor-crosshair" : ""
                }`}
              >
                {hasGeometry ? (
                  <ConformerViewer3D
                    xyz={xyz ?? undefined}
                    height={560}
                    style={viewerStyle}
                    spin={false}
                    theme={viewerTheme}
                    labelMode={labelMode}
                    labelHydrogens={labelHydrogens}
                    enableMeasurements={measurementEnabled}
                    onPickAtom={handleAtomPick}
                  />
                ) : (
                  <div className="text-sm text-slate-500">
                    Enter at least one line of coordinates to render your molecule.
                  </div>
                )}
              </div>
              <div className="rounded-md border border-border p-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Label htmlFor="measure-toggle">Measure atoms</Label>
                    <p className="text-xs text-slate-500">
                      Click 2 atoms for a bond length, 3 for an angle, 4 for a dihedral.
                    </p>
                  </div>
                  <Switch
                    id="measure-toggle"
                    checked={measurementEnabled}
                    onCheckedChange={setMeasurementEnabled}
                  />
                </div>
                {measurementEnabled ? (
                  measurementResult ? (
                    <div className="rounded-lg border border-dashed border-emerald-500/60 bg-emerald-500/5 px-3 py-2 text-sm">
                      <div className="text-xs uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
                        {measurementResult.label}
                      </div>
                      <div className="text-lg font-medium text-emerald-700 dark:text-emerald-200">
                        {measurementResult.value}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Select atoms in the viewer to start capturing measurements.
                    </p>
                  )
                ) : (
                  <p className="text-sm text-slate-500">
                    Enable measurement mode to capture distances, angles, or dihedrals.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPickedAtoms([])}
                    disabled={!pickedAtoms.length}
                  >
                    Clear selections
                  </Button>
                </div>
                <div className="rounded-md border border-dashed border-border px-3 py-2">
                  {pickedAtoms.length ? (
                    <ol className="text-xs font-mono space-y-1 max-h-32 overflow-auto">
                      {pickedAtoms.map((atom, idx) => (
                        <li key={`${atom.index}-${idx}`}>
                          {idx + 1}. #{atom.index} {atom.element} ({formatCoordinate(atom.x)}, {formatCoordinate(atom.y)},{" "}
                          {formatCoordinate(atom.z)})
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Selections are listed here so you can keep track of atom indices.
                    </p>
                  )}
                </div>
              </div>
              <div className="rounded-md border border-dashed border-border p-3 space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-500">
                  <span>
                    {hasGeometry
                      ? `${atoms.length} atoms detected · tap a row or click in the viewer`
                      : "No atoms yet"}
                  </span>
                  {hasGeometry && (
                    <span className="font-mono text-xs text-slate-500">
                      XYZ ready ({atoms.length} / {atoms.length})
                    </span>
                  )}
                </div>
                {hasGeometry ? (
                  <ol className="font-mono text-xs grid gap-1 sm:grid-cols-2 lg:grid-cols-1 max-h-48 overflow-auto pr-1">
                    {atoms.map((atom, idx) => (
                      <li key={`${atom.element}-${idx}`}>
                        <button
                          type="button"
                          onClick={() => handleListPick(idx)}
                          className={`w-full rounded border px-2 py-1 text-left transition ${
                            measurementEnabled
                              ? "hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                              : "opacity-60 cursor-not-allowed"
                          }`}
                          disabled={!measurementEnabled}
                        >
                          #{idx + 1} {atom.element} · ({formatCoordinate(atom.x)}, {formatCoordinate(atom.y)},{" "}
                          {formatCoordinate(atom.z)})
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-xs text-slate-500">
                    We&apos;ll list the parsed atoms here so you can double-check the numbering.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default ManualMoleculePage;
