import React, { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import { addBaseLayers, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from './mapLayers';

/** One recorded fix of a job's route. */
export type TrackPoint = { lat: number; lng: number; time?: string | null; speed?: number | null };

// Trip replay: the job's route as a blue line with start / finish / current-position markers.
// Clicking the line opens the nearest recorded point (time, speed, time since the start), and a summary
// row above the map gives the start and end times, the duration and the distance covered.
// Marker and popup text is built from numbers and fixed strings only, never from user data.
export default function TrackMap({ track, points, driverPos, status, height = 360 }: {
  /** Route as [lat, lng] pairs (still accepted; `points` is preferred because it carries time and speed). */
  track?: [number, number][];
  points?: TrackPoint[];
  driverPos?: { lat: number; lng: number } | null;
  status?: string;
  height?: number;
}) {
  const { t, i18n } = useTranslation();
  const divRef = useRef<HTMLDivElement>(null);

  const pts: TrackPoint[] = useMemo(() => {
    if (points && points.length) return points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    return (track || []).map(([lat, lng]) => ({ lat, lng }));
  }, [points, track]);

  const locale = i18n.language === 'en' ? 'en-NZ' : 'zh-CN';
  const fmtTime = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  const fmtDateTime = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const fmtDuration = (ms: number) => {
    const min = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
  };

  // Summary of the route: first and last timestamps, duration, distance along the line, top speed.
  const summary = useMemo(() => {
    const timed = pts.filter((p) => p.time);
    const first = timed[0]?.time ?? null;
    const last = timed[timed.length - 1]?.time ?? null;
    const startMs = first ? new Date(first).getTime() : NaN;
    const endMs = last ? new Date(last).getTime() : NaN;
    let distanceM = 0;
    for (let i = 1; i < pts.length; i++) {
      distanceM += L.latLng(pts[i - 1].lat, pts[i - 1].lng).distanceTo(L.latLng(pts[i].lat, pts[i].lng));
    }
    const maxSpeed = pts.reduce((m, p) => Math.max(m, Number(p.speed) || 0), 0);
    return {
      start: first, end: last,
      durationMs: Number.isFinite(startMs) && Number.isFinite(endMs) ? endMs - startMs : NaN,
      distanceKm: distanceM / 1000, maxSpeed, count: pts.length, startMs,
    };
  }, [pts]);

  useEffect(() => {
    if (!divRef.current) return;
    const map = L.map(divRef.current, { center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM });
    addBaseLayers(map);
    const latlngs = pts.map((p) => [p.lat, p.lng] as [number, number]);

    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: '#1677ff', weight: 3, opacity: 0.8, interactive: false }).addTo(map);
      // A wide, invisible line on top takes the clicks: a 3px line is too thin to hit reliably.
      const hit = L.polyline(latlngs, { color: '#1677ff', weight: 18, opacity: 0.001 }).addTo(map);
      hit.on('click', (e: L.LeafletMouseEvent) => {
        let best = 0;
        let bestD = Infinity;
        pts.forEach((p, i) => {
          const d = e.latlng.distanceTo(L.latLng(p.lat, p.lng));
          if (d < bestD) { bestD = d; best = i; }
        });
        const p = pts[best];
        const elapsed = p.time && Number.isFinite(summary.startMs) ? new Date(p.time).getTime() - summary.startMs : NaN;
        const rows = [
          p.time ? `<div><span style="color:#888">${t('layout.track_time')}</span> <b>${fmtDateTime(p.time)}</b></div>` : '',
          `<div><span style="color:#888">${t('layout.track_speed')}</span> <b style="color:#F59E0B">${Math.round(Number(p.speed) || 0)} km/h</b></div>`,
          Number.isFinite(elapsed) ? `<div><span style="color:#888">${t('layout.track_elapsed')}</span> <b>${fmtDuration(elapsed)}</b></div>` : '',
          `<div style="color:#999;font-size:11px;margin-top:4px">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>`,
        ].join('');
        L.popup({ offset: [0, -4] }).setLatLng([p.lat, p.lng]).setContent(`<div style="font-size:12px;line-height:1.7">${rows}</div>`).openOn(map);
      });
    }
    const dot = (color: string) => L.divIcon({ className: '', html: `<div style="width:14px;height:14px;background:${color};border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
    if (pts.length > 0) {
      const first = pts[0];
      L.marker([first.lat, first.lng], { icon: dot('#22c55e') }).addTo(map)
        .bindPopup(`<b>${t('layout.track_start')}</b>${first.time ? `<br>${fmtDateTime(first.time)}` : ''}`);
    }
    if (pts.length > 0 && status === 'completed') {
      const last = pts[pts.length - 1];
      L.marker([last.lat, last.lng], { icon: dot('#ef4444') }).addTo(map)
        .bindPopup(`<b>${t('layout.track_end')}</b>${last.time ? `<br>${fmtDateTime(last.time)}` : ''}`);
    }
    if (driverPos && status === 'in_progress') {
      L.marker([driverPos.lat, driverPos.lng], { icon: L.divIcon({ className: '', html: `<div style="background:#F59E0B;color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff">🚛</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }) }).addTo(map).bindPopup(t('layout.track_driver_position'));
    }

    const allPoints: [number, number][] = [...latlngs];
    if (driverPos) allPoints.push([driverPos.lat, driverPos.lng]);
    if (allPoints.length > 1) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [30, 30] });
    } else if (allPoints.length === 1) {
      map.setView(allPoints[0], 13);
    }

    return () => { map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasTimes = !!summary.start;
  const item = (label: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 90 }}>
      <span style={{ fontSize: 11, color: '#8c8c8c' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{value}</span>
    </div>
  );

  return (
    <div>
      {pts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end', padding: '10px 14px', marginBottom: 10, background: '#f6f8fb', borderRadius: 12 }} data-testid="track-summary">
          {hasTimes && item(t('layout.track_summary_from'), fmtDateTime(summary.start))}
          {hasTimes && item(t('layout.track_summary_to'), fmtDateTime(summary.end))}
          {Number.isFinite(summary.durationMs) && item(t('layout.track_summary_duration'), fmtDuration(summary.durationMs))}
          {item(t('layout.track_summary_distance'), `${summary.distanceKm.toFixed(1)} km`)}
          {item(t('layout.track_summary_top_speed'), `${Math.round(summary.maxSpeed)} km/h`)}
          {item(t('layout.track_summary_points'), String(summary.count))}
          <span style={{ fontSize: 11, color: '#8c8c8c', marginLeft: 'auto' }}>{t('layout.track_click_hint')}</span>
        </div>
      )}
      <div ref={divRef} style={{ width: '100%', height, borderRadius: 12 }} />
    </div>
  );
}
