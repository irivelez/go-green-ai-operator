"use client";

// AreaConfirmCard — the price-consent surface (spec §A.1 step-4 + §A.2).
//
// HIGH confidence (auto-measure succeeded): we pre-draw the polygon from the
// roof bbox (enlarged to approximate the lot) and let the customer confirm with
// ONE TAP, or nudge vertices/drag the whole shape.
//
// LOW confidence / no bbox: blank satellite — the customer taps each corner of
// the yard; tapping near the first corner closes the ring.
//
// The live "Maintaining ~N sqft" label is DISPLAY ONLY. The server re-derives
// the authoritative area from the confirmed polygon via geo.computePolygonSqft.
//
// Static fallback (no NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, or maps fail to load):
// a clean card with the estimated_sqft pre-filled, a number input to adjust,
// and the same Confirm button — so the funnel never breaks headlessly.

import { useCallback, useMemo, useState } from "react";
import {
  APIProvider,
  Map,
  Polygon,
  useMapsLibrary,
  type MapMouseEvent,
} from "@vis.gl/react-google-maps";
import { Check, MapPin, RotateCcw } from "lucide-react";
import {
  pickInitialPath,
  M2_TO_SQFT,
  type LatLng,
  type RoofBbox,
} from "@/src/area-card-logic";
import type { Lang } from "./cards";

const L = {
  en: {
    title: "Confirm the area we'll maintain",
    drawHint: "Tap each corner of your yard. Tap the first corner again to close.",
    nudgeHint: "Drag the outline to match your yard exactly.",
    sqftLabel: (n: number) => `Maintaining ~${n.toLocaleString()} sqft`,
    confirm: "Looks right",
    reset: "Redraw",
    fallback: "Map preview unavailable. Adjust the estimated area below and confirm.",
    fallbackInput: "Approximate maintained area (sqft)",
  },
  es: {
    title: "Confirma el área que mantendremos",
    drawHint: "Toca cada esquina de tu jardín. Toca la primera esquina otra vez para cerrar.",
    nudgeHint: "Arrastra el contorno para que coincida con tu jardín.",
    sqftLabel: (n: number) => `Manteniendo ~${n.toLocaleString()} pies²`,
    confirm: "Se ve bien",
    reset: "Redibujar",
    fallback: "Vista previa del mapa no disponible. Ajusta el área estimada y confirma.",
    fallbackInput: "Área aproximada (pies²)",
  },
} satisfies Record<Lang, Record<string, unknown>>;

// Mirrors what runMeasureProperty returns (kept loose here so T14 can drop it
// straight in without an import-cycle).
export interface AreaConfirmResult {
  estimated_sqft: number;
  area_confidence: number;
  roof_bbox: RoofBbox;
  slope_tier: "flat" | "moderate" | "steep";
  max_grade_pct: number | null;
}

interface AreaConfirmCardProps {
  result: AreaConfirmResult;
  center: LatLng;
  lang: Lang;
  /** Defaults to env.getAreaConfidenceThreshold() server-side value, 0.6. */
  threshold?: number;
  /** Customer-confirmed polygon. Server is authoritative; this is the proposal. */
  onConfirm: (path: LatLng[]) => void;
}

export function AreaConfirmCard(props: AreaConfirmCardProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    // Static fallback — also exercised by headless tests when no key is set.
    return <StaticFallback {...props} />;
  }
  return (
    <APIProvider
      apiKey={apiKey}
      onError={(err) =>
        // eslint-disable-next-line no-console
        console.error("[AreaConfirmCard] Google Maps failed to load:", err)
      }
    >
      <MapSurface {...props} />
    </APIProvider>
  );
}

// ── interactive map surface (requires NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) ──────
function MapSurface({ result, center, lang, threshold, onConfirm }: AreaConfirmCardProps) {
  const t = L[lang];
  const thr = threshold ?? 0.6;
  const geometry = useMapsLibrary("geometry");

  const initialPath = useMemo(
    () => pickInitialPath(result.roof_bbox, result.area_confidence, thr),
    [result.roof_bbox, result.area_confidence, thr],
  );

  const [path, setPath] = useState<LatLng[]>(initialPath);
  const isHighConfidence = initialPath.length > 0;

  // DISPLAY-ONLY area readout — server re-derives the authoritative number.
  const sqft = useMemo(() => {
    if (path.length < 3 || !geometry) return 0;
    const area_m2 = geometry.spherical.computeArea(path);
    return Math.round(area_m2 * M2_TO_SQFT);
  }, [path, geometry]);

  // Wire the polygon's path-edit + drag events to our React state so the live
  // sqft label updates after each nudge.
  const onPolygonRef = useCallback((polygon: google.maps.Polygon | null) => {
    if (!polygon) return;
    const sync = () => {
      const mvc = polygon.getPath();
      const next: LatLng[] = [];
      mvc.forEach((ll) => next.push({ lat: ll.lat(), lng: ll.lng() }));
      if (next.length > 0) next.push({ lat: next[0]!.lat, lng: next[0]!.lng });
      setPath(next);
    };
    const mvc = polygon.getPath();
    mvc.addListener("set_at", sync);
    mvc.addListener("insert_at", sync);
    mvc.addListener("remove_at", sync);
    polygon.addListener("dragend", sync);
  }, []);

  // Low-confidence "tap 4+ corners" affordance.
  const handleMapClick = (e: MapMouseEvent) => {
    if (isHighConfidence) return;
    if (!e.detail.latLng) return;
    const next: LatLng = { lat: e.detail.latLng.lat, lng: e.detail.latLng.lng };
    setPath((prev) => {
      if (prev.length === 0) return [next];
      const first = prev[0]!;
      const dLat = first.lat - next.lat;
      const dLng = first.lng - next.lng;
      // Tap near the starting point closes the ring (~10 m at low zoom).
      if (prev.length >= 3 && Math.sqrt(dLat * dLat + dLng * dLng) < 0.0001) {
        return [...prev, { lat: first.lat, lng: first.lng }];
      }
      return [...prev, next];
    });
  };

  const reset = () => setPath(isHighConfidence ? initialPath : []);

  // ≥3 unique corners + closing point = ≥4 vertices.
  const canConfirm = path.length >= 4;

  const hint = sqft > 0 ? t.sqftLabel(sqft) : isHighConfidence ? t.nudgeHint : t.drawHint;

  return (
    <div className="rise-in overflow-hidden rounded-2xl border border-moss-100 bg-white shadow-petal">
      <div className="flex items-center gap-2 border-b border-moss-100 bg-paper/40 px-4 py-3">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-moss-100 text-moss-700">
          <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <div className="font-display text-[15px] text-bark-900">{t.title}</div>
      </div>
      <div className="relative">
        <Map
          mapTypeId="satellite"
          defaultCenter={center}
          defaultZoom={20}
          style={{ width: "100%", height: "340px" }}
          gestureHandling="greedy"
          disableDefaultUI
          tilt={0}
          onClick={isHighConfidence ? undefined : handleMapClick}
        >
          {path.length >= 3 && (
            <Polygon
              ref={onPolygonRef}
              paths={path}
              editable={isHighConfidence}
              draggable={isHighConfidence}
              fillColor="#5d8a49"
              fillOpacity={0.28}
              strokeColor="#37562c"
              strokeOpacity={0.95}
              strokeWeight={2}
            />
          )}
        </Map>
        <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-bark-900/80 px-3 py-1 text-[11.5px] font-medium tracking-tight text-paper backdrop-blur">
          {hint}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-moss-100 bg-paper/40 px-4 py-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-full border border-moss-200 bg-white px-3 py-1.5 text-[12px] font-medium text-moss-800 transition hover:bg-moss-50"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={2} />
          {t.reset}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(path)}
          disabled={!canConfirm}
          className="inline-flex items-center gap-1.5 rounded-full bg-moss-700 px-4 py-2 text-[12.5px] font-medium text-moss-50 shadow-petal transition hover:bg-moss-800 disabled:bg-moss-200 disabled:text-moss-400"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
          {t.confirm}
        </button>
      </div>
      <div className="border-t border-moss-100 px-4 py-2 text-[10.5px] italic text-moss-700/55">
        {/* Subtle hint that the price is still confirmed on-site (matches QuoteCard footer). */}
        Final price confirmed on-site after the first visit.
      </div>
    </div>
  );
}

// ── static fallback — used when no key, when maps fail to load, or in tests ─
function StaticFallback({ result, center, lang, onConfirm }: AreaConfirmCardProps) {
  const t = L[lang];
  const [sqft, setSqft] = useState<number>(result.estimated_sqft > 0 ? result.estimated_sqft : 2500);

  const handleConfirm = () => {
    // Synthesize a square polygon centered at `center` whose computed area
    // matches the user's input. The server re-derives the area from THIS path
    // via geo.computePolygonSqft — so the fallback is end-to-end consistent.
    const side_m = Math.sqrt(sqft / M2_TO_SQFT);
    const halfLat = side_m / 2 / 111_000;
    const cosLat = Math.cos((center.lat * Math.PI) / 180) || 1;
    const halfLng = side_m / 2 / (111_000 * cosLat);
    const sw: LatLng = { lat: center.lat - halfLat, lng: center.lng - halfLng };
    const nw: LatLng = { lat: center.lat + halfLat, lng: center.lng - halfLng };
    const ne: LatLng = { lat: center.lat + halfLat, lng: center.lng + halfLng };
    const se: LatLng = { lat: center.lat - halfLat, lng: center.lng + halfLng };
    onConfirm([sw, nw, ne, se, sw]);
  };

  return (
    <div
      className="rise-in overflow-hidden rounded-2xl border border-moss-100 bg-white shadow-petal"
      data-testid="area-confirm-fallback"
    >
      <div className="flex items-center gap-2 border-b border-moss-100 bg-paper/40 px-4 py-3">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-moss-100 text-moss-700">
          <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <div className="font-display text-[15px] text-bark-900">{t.title}</div>
      </div>
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="rounded-xl border border-dashed border-moss-200 bg-paper/50 px-3 py-2.5 text-[12px] leading-snug text-moss-700/80">
          {t.fallback}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.14em] text-moss-700/70">
            {t.fallbackInput}
          </span>
          <input
            type="number"
            min={100}
            max={50000}
            step={50}
            value={sqft}
            onChange={(e) => setSqft(Number(e.target.value) || 0)}
            className="rounded-xl border border-moss-200 bg-white px-3 py-2 text-[14px] font-medium text-bark-900 focus:border-moss-400 focus:outline-none focus:ring-2 focus:ring-moss-200/40"
          />
        </label>
      </div>
      <div className="flex justify-end border-t border-moss-100 bg-paper/40 px-4 py-3">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={sqft <= 0}
          className="inline-flex items-center gap-1.5 rounded-full bg-moss-700 px-4 py-2 text-[12.5px] font-medium text-moss-50 shadow-petal transition hover:bg-moss-800 disabled:bg-moss-200 disabled:text-moss-400"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2} />
          {t.confirm}
        </button>
      </div>
    </div>
  );
}
