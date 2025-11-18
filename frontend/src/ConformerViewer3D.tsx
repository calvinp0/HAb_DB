import React from "react";

type SpinAxis = "x" | "y" | "z";
type ViewerAtom = {
  elem?: string;
  element?: string;
  serial?: number;
  x: number;
  y: number;
  z: number;
};
type ViewerAtomWithIndex = ViewerAtom & { _idx1?: number };
type LabelOptions = {
  position: { x: number; y: number; z: number };
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
  showBackground?: boolean;
  inFront?: boolean;
  alignment?: "center" | "left" | "right";
  screenOffset?: { x: number; y: number };
};
type GLModel = {
  setBonding?(flag: boolean): void;
  assignBonds?(): void;
  setStyle(selector: Record<string, unknown>, style: Record<string, unknown>): void;
  selectedAtoms(selector: Record<string, unknown>): ViewerAtomWithIndex[];
};
type GLViewer = {
  setBackgroundColor(color: string): void;
  addModel(xyz: string, format: string): GLModel;
  removeAllModels(): void;
  zoomTo(): void;
  render(): void;
  resize(): void;
  spin(axis: SpinAxis | false, speed?: number): void;
  removeAllLabels?(): void;
  addLabel(text: string, options: LabelOptions): void;
  clear?(): void;
  pickAtom?(
    opts: { x: number; y: number },
    callback?: (atom: ViewerAtomWithIndex | null) => void,
  ): ViewerAtomWithIndex | null;
  setClickable?(
    selection: Record<string, unknown>,
    enable: boolean,
    callback?: (atom: ViewerAtomWithIndex | null) => void,
    context?: unknown,
  ): void;
};
type ThreeDMol = {
  GLViewer: new (
    element: Element,
    options?: { backgroundColor?: string; antialias?: boolean },
  ) => GLViewer;
  JmolColors?: Record<string, number>;
};

declare global {
  interface Window {
    $3Dmol?: ThreeDMol;
  }
}

function load3Dmol(): Promise<ThreeDMol | null> {
  if (window.$3Dmol) return Promise.resolve(window.$3Dmol);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://3dmol.csb.pitt.edu/build/3Dmol-min.js";
    s.async = true;
    s.onload = () => resolve(window.$3Dmol ?? null);
    s.onerror = () => reject(new Error("3Dmol load failed"));
    document.head.appendChild(s);
  });
}

type LabelMode = "none" | "elem" | "index" | "elem+index";

const logViewerError = (context: string, error: unknown) => {
  console.debug(`[3Dmol] ${context}`, error);
};

function ensureXYZHeader(xyz: string) {
  const lines = xyz.trim().split(/\r?\n/);
  const n = parseInt(lines[0]?.trim() || "", 10);
  if (Number.isFinite(n)) return xyz;
  const atoms = lines.filter(Boolean).length;
  return `${atoms}\nconformer\n${lines.join("\n")}\n`;
}
const CHEMCRAFT_COLORS: Record<string, number> = {
  H: 0x00e9ff, // neon cyan
  C: 0xff39ff, // hot magenta
  N: 0xff8b2e, // vivid orange (your N-as-orange choice)
  O: 0xff3a3a, // vivid red
  F: 0x2bff88, // neon green
  Cl: 0x39ff9d, // mint neon
  Br: 0xff6a6a, // bright coral red
  I: 0x8e5bff, // electric violet
  S: 0xffb33b, // glowing orange
  P: 0xffa335, // bright amber
  Si: 0xcfcfcf, // glossy light gray
  B: 0xff9e70, // warm neon peach
};

function chemcraftColor(atom: ViewerAtom): number {
  const sym = (atom.elem || atom.element || "").toString();
  if (CHEMCRAFT_COLORS[sym]) return CHEMCRAFT_COLORS[sym];
  // fallback: Jmol default if unknown element
  return window.$3Dmol?.JmolColors?.[sym] ?? 0xcccccc;
}

type Props = {
  xyz?: string | null;
  height?: number;
  style?: "ballstick" | "line" | "spacefill";
  spin?: boolean;
  background?: string;
  active?: boolean;
  theme?: "jmol" | "gaussview" | "chemcraft";
  labelMode?: LabelMode;
  labelHydrogens?: boolean;
  enableMeasurements?: boolean;
  onPickAtom?: (atom: {
    index: number;
    element: string;
    x: number;
    y: number;
    z: number;
  }) => void;
};

const ConformerViewer3D: React.FC<Props> = ({
  xyz,
  height = 420,
  style = "ballstick",
  spin = false,
  background = "white",
  active = true,
  theme = "jmol",
  labelMode = "none",
  labelHydrogens = true,
  enableMeasurements = false,
  onPickAtom,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewerRef = React.useRef<GLViewer | null>(null);
  const modelRef = React.useRef<GLModel | null>(null);
  const [ready, setReady] = React.useState(false);

  // Create viewer once (first time tab becomes active + element is mounted)
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!active || !containerRef.current) return;
      const el = containerRef.current;
      const $3Dmol = await load3Dmol().catch(() => null);
      if (cancelled || !$3Dmol || !el) return;

      const bg =
        theme === "gaussview"
          ? "#8686B6"
          : theme === "chemcraft"
            ? "#000000"
            : background;

      if (!viewerRef.current) {
        viewerRef.current = new $3Dmol.GLViewer(el, {
          backgroundColor: bg,
          antialias: true,
        });
        setReady(true);
      } else {
        viewerRef.current.setBackgroundColor(bg);
      }

      const v = viewerRef.current;
      const nudge = () => {
        try {
          v.resize();
          v.render();
        } catch (error) {
          logViewerError("nudge render", error);
        }
      };
      requestAnimationFrame(nudge);
      setTimeout(nudge, 0);
      setTimeout(nudge, 60);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, background, theme]);

  // apply style / colors
  const applyStyle = React.useCallback(() => {
    const v = viewerRef.current;
    const m = modelRef.current;
    if (!v || !m) return;

    // GaussView-ish sizing
    const gvStickRadius = 0.1;
    const gvSphereScale = 0.2;

    // Chemcraft-ish sizing
    const ccStickRadius = 0.1;
    const ccSphereScale = 0.2;

    m.setStyle({}, {}); // clear previous

    const useChemcraft = theme === "chemcraft";
    const useJmol = theme === "jmol";
    const useGV = theme === "gaussview";

    const sphereScale = useChemcraft
      ? ccSphereScale
      : useGV
        ? gvSphereScale
        : 0.23;
    const stickRadius = useChemcraft
      ? ccStickRadius
      : useGV
        ? gvStickRadius
        : 0.18;

    const colorfunc = useChemcraft ? chemcraftColor : undefined;
    const gvStickColor = useGV ? "#7a7a7a" : undefined;

    if (style === "line") {
      const lineStyle: Record<string, unknown> = {
        line: {
          linewidth: 3.0,
          colorfunc,
          colorscheme: useJmol ? "Jmol" : undefined,
        },
      };
      m.setStyle({}, lineStyle);
    } else if (style === "spacefill") {
      const sphereStyle: Record<string, unknown> = {
        sphere: {
          scale: sphereScale,
          colorfunc,
          colorscheme: useJmol ? "Jmol" : undefined,
        },
      };
      m.setStyle({}, sphereStyle);
    } else {
      // ball & stick
      const styleSpec: Record<string, unknown> = {
        stick: {
          radius: stickRadius,
          color: gvStickColor,
          colorfunc,
          colorscheme: useJmol ? "Jmol" : undefined,
        },
        sphere: {
          scale: sphereScale,
          colorfunc,
          colorscheme: useJmol ? "Jmol" : undefined,
        },
      };
      m.setStyle({}, styleSpec);
    }

    v.render();
  }, [style, theme]);

  // (re)load model
  React.useEffect(() => {
    const v = viewerRef.current;
    if (!v || !xyz) return;
    try {
      v.removeAllModels();
      const m = v.addModel(ensureXYZHeader(xyz), "xyz");
      modelRef.current = m;
      // ensure bonds exist so "line" shows
      m.setBonding?.(true);
      m.assignBonds?.();
      v.zoomTo();
      applyStyle();
    } catch (error) {
      logViewerError("set model", error);
    }
  }, [xyz, ready, applyStyle]);

  React.useEffect(() => {
    const canvas = containerRef.current?.querySelector(
      "canvas",
    ) as HTMLCanvasElement | null;
    if (!canvas) return;
    if (theme === "chemcraft") {
      canvas.style.filter = "saturate(155%) contrast(105%) brightness(100%)";
      canvas.style.background = "#000"; // insurance if theme switching
    } else if (theme === "gaussview") {
      canvas.style.filter = "saturate(120%)";
    } else {
      canvas.style.filter = ""; // normal
    }
  }, [theme, ready]);

  React.useEffect(() => {
    applyStyle();
  }, [applyStyle, ready]);

  // spin
  React.useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    try {
      if (spin) v.spin("y", 1.2);
      else v.spin(false);
      v.render();
    } catch (error) {
      logViewerError("spin", error);
    }
  }, [spin, ready]);

  // show labels
  const rebuildLabels = React.useCallback(() => {
    const v = viewerRef.current;
    const m = modelRef.current;
    if (!v || !m) return;

    v.removeAllLabels?.();

    if (labelMode === "none" || style === "line") {
      v.render();
      return;
    }

    // atoms available from model
    const atoms = m.selectedAtoms({}) ?? [];
    // Ensure we have a stable 1-based index (serial sometimes starts at 0)
    atoms.forEach((atom, i) => {
      atom._idx1 = (atom.serial ?? i) + 1;
    });

    for (const atom of atoms) {
      const element = atom.elem ?? atom.element ?? "";
      if (!labelHydrogens && element === "H") continue;

      let text = "";
      if (labelMode === "elem") text = element;
      else if (labelMode === "index") text = String(atom._idx1 ?? "");
      else text = `${element}${atom._idx1 ?? ""}`;

      // place the label at atom position
      v.addLabel(text, {
        position: { x: atom.x, y: atom.y, z: atom.z },
        fontSize: 12,
        fontColor: "white",
        backgroundColor: "rgba(0,0,0,0.55)",
        showBackground: true,
        inFront: true, // draw in front of geometry
        alignment: "center",
        // A tiny screen offset helps readability
        screenOffset: { x: 0, y: -8 },
      });
    }
    v.render();
  }, [labelMode, labelHydrogens, style]);

  React.useEffect(() => {
    rebuildLabels();
  }, [rebuildLabels, ready, xyz, style]);

  // show tab -> resize
  React.useEffect(() => {
    if (active && viewerRef.current) {
      try {
        viewerRef.current.resize();
        viewerRef.current.render();
      } catch (error) {
        logViewerError("resize", error);
      }
    }
  }, [active]);

  // keep canvas sized
  React.useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      const v = viewerRef.current;
      if (!v) return;
      try {
        v.resize();
        v.render();
      } catch (error) {
        logViewerError("observer resize", error);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // measurement picking
  React.useEffect(() => {
    if (!enableMeasurements || !onPickAtom) return;
    const el = containerRef.current;
    if (!el) return;
    const handlePointerUp = (event: PointerEvent) => {
      const v = viewerRef.current;
      if (!v || !enableMeasurements || !onPickAtom) return;
      const pickOpts = { x: event.clientX, y: event.clientY };
      const handleAtom = (atom: ViewerAtomWithIndex | null) => {
        if (!atom) return;
        onPickAtom({
          index: (atom.serial ?? 0) + 1,
          element: atom.elem ?? atom.element ?? "",
          x: atom.x,
          y: atom.y,
          z: atom.z,
        });
      };
      try {
        const result = v.pickAtom?.(pickOpts, handleAtom) ?? null;
        if (result) handleAtom(result);
      } catch (error) {
        logViewerError("pick atom", error);
      }
    };
    el.addEventListener("pointerup", handlePointerUp, true);
    return () => {
      el.removeEventListener("pointerup", handlePointerUp, true);
    };
  }, [enableMeasurements, onPickAtom, ready, xyz, style, theme]);

  React.useEffect(() => {
    if (!enableMeasurements || !onPickAtom) return;
    const v = viewerRef.current;
    if (!v || typeof v.setClickable !== "function") return;
    const handleAtom = (atom: ViewerAtomWithIndex | null) => {
      if (!atom) return;
      onPickAtom({
        index: (atom.serial ?? 0) + 1,
        element: atom.elem ?? atom.element ?? "",
        x: atom.x,
        y: atom.y,
        z: atom.z,
      });
    };
    try {
      v.setClickable({}, true, handleAtom);
    } catch (error) {
      logViewerError("enable clickable", error);
    }
    return () => {
      try {
        v.setClickable?.({}, false);
      } catch (error) {
        logViewerError("disable clickable", error);
      }
    };
  }, [enableMeasurements, onPickAtom, ready, xyz]);

  // cleanup
  React.useEffect(
    () => () => {
      if (viewerRef.current) {
        try {
          viewerRef.current.clear?.();
        } catch (error) {
          logViewerError("cleanup", error);
        }
        viewerRef.current = null;
      }
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="relative border rounded-md"
      style={{ width: "100%", height, overflow: "hidden" }}
    />
  );
};

export default ConformerViewer3D;
