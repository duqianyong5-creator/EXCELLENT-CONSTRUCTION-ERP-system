import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import { addBaseLayers, DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from './mapLayers';

// 历史轨迹回放：画出任务的行驶路线（蓝线）+ 起点/终点/当前位置。
// 标记内容是固定文案，无用户数据，无注入风险。
export default function TrackMap({ track, driverPos, status, height = 360 }: {
  track: [number, number][];
  driverPos?: { lat: number; lng: number } | null;
  status?: string;
  height?: number;
}) {
  const { t } = useTranslation();
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!divRef.current) return;
    const map = L.map(divRef.current, { center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM });
    addBaseLayers(map);

    if (track.length > 1) {
      L.polyline(track, { color: '#1677ff', weight: 3, opacity: 0.8 }).addTo(map);
    }
    if (track.length > 0) {
      L.marker(track[0], { icon: L.divIcon({ className: '', html: `<div style="width:14px;height:14px;background:#22c55e;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(map).bindPopup(t('layout.track_start'));
    }
    if (track.length > 0 && status === 'completed') {
      L.marker(track[track.length - 1], { icon: L.divIcon({ className: '', html: `<div style="width:14px;height:14px;background:#ef4444;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(map).bindPopup(t('layout.track_end'));
    }
    if (driverPos && status === 'in_progress') {
      L.marker([driverPos.lat, driverPos.lng], { icon: L.divIcon({ className: '', html: `<div style="background:#F59E0B;color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff">🚛</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }) }).addTo(map).bindPopup(t('layout.track_driver_position'));
    }

    const allPoints: [number, number][] = [...track];
    if (driverPos) allPoints.push([driverPos.lat, driverPos.lng]);
    if (allPoints.length > 1) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [30, 30] });
    } else if (allPoints.length === 1) {
      map.setView(allPoints[0], 13);
    }

    return () => { map.remove(); };
  }, []);

  return <div ref={divRef} style={{ width: '100%', height, borderRadius: 12 }} />;
}
