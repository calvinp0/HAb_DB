import React from "react";

declare global {
  interface Window {
    $3Dmol?: any;
  }
}

function load3Dmol(): Promise<any> {
  if (window.$3Dmol) return Promise.resolve(window.$3Dmol);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://3dmol.csb.pitt.edu/build/3Dmol-min.js";
    s.async = true;
    s.onload = () => resolve(window.$3Dmol);
    s.onerror = () => reject(new Error("3Dmol load failed"));
    document.head.appendChild(s);
  });
}

function ensureXYZHeader(xyz: string) {
  const lines = xyz.trim().split(/\r?\n/);
  const n = parseInt(lines[0]?.trim() || "", 10);
  if (Number.isFinite(n)) return xyz;
  const atoms = lines.filter(Boolean).length;
  return `${atoms}\nconformer\n${lines.join("\n")}\n`;
}

type Props = {
  xyz?: string | null;
  height?: number;
  style?: "ballstick" | "line" | "spacefill";
  spin?: boolean;
  background?: string;
  active?: boolean; // tab visibility
};

const ConformerViewer3D: React.FC<Props> = ({
  xyz,
  height = 420,
  style = "ballstick",
  spin = false,
  background = "white",
  active = true,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewerRef = React.useRef<any>(null);
  const [ready, setReady] = React.useState(false);

  // Create viewer once (first time tab becomes active + element is mounted)
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!active || !containerRef.current) return;

      const el = containerRef.current;
      const $3Dmol = await load3Dmol().catch(() => null);
      if (cancelled || !$3Dmol || !el) return;

      if (!viewerRef.current) {
        try {
          viewerRef.current = new $3Dmol.GLViewer(el, {
            backgroundColor: background,
            antialias: true,
          });
        } catch (e) {
          console.error("3Dmol viewer init failed:", e);
          return;
        }
        setReady(true);
      } else {
        // if already exists, just apply background
        viewerRef.current.setBackgroundColor?.(background);
      }

      // nudge the canvas a few times in case the element sizes-in after first paint
      const v = viewerRef.current;
      const nudge = () => {
        try {
          v.resize();
          v.render();
        } catch {}
      };
      requestAnimationFrame(nudge);
      setTimeout(nudge, 0);
      setTimeout(nudge, 60);
    })();

    return () => {
      cancelled = true;
    };
  }, [active, background]);

  // Apply style on the current model
  const applyStyle = React.useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    const styleMap =
      style === "line"
        ? { line: { linewidth: 1 } }
        : style === "spacefill"
          ? { sphere: { scale: 0.28 } }
          : { stick: { radius: 0.18 }, sphere: { scale: 0.23 } }; // ball & stick
    v.setStyle({}, styleMap);
    v.render();
  }, [style]);

  // Load/Reload model on xyz change (or after first ready)
  React.useEffect(() => {
    const v = viewerRef.current;
    if (!v || !xyz) return;
    try {
      v.removeAllModels();
      v.addModel(ensureXYZHeader(xyz), "xyz");
      applyStyle();
      v.zoomTo();
      v.render();
    } catch (e) {
      console.error("3Dmol set model failed:", e);
    }
  }, [xyz, ready, applyStyle]);

  // Style changes
  React.useEffect(() => {
    if (!ready || !viewerRef.current) return;
    applyStyle();
  }, [style, ready, applyStyle]);

  // Spin changes
  React.useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    try {
      v.setSpin(!!spin);
      v.render();
    } catch {}
  }, [spin, ready]);

  // When tab becomes active, ensure proper size & repaint
  React.useEffect(() => {
    if (active && viewerRef.current) {
      try {
        viewerRef.current.resize();
        viewerRef.current.render();
      } catch {}
    }
  }, [active]);

  // Resize on container changes
  React.useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      const v = viewerRef.current;
      if (!v) return;
      try {
        v.resize();
        v.render();
      } catch {}
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Clean up on unmount
  React.useEffect(() => {
    return () => {
      if (viewerRef.current) {
        try {
          viewerRef.current.clear?.();
        } catch {}
        viewerRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative border rounded-md"
      style={{ width: "100%", height, overflow: "hidden" }}
    />
  );
};

export default ConformerViewer3D;
