import L from 'leaflet';
import i18n from '../i18n';

/**
 * 地图没有任何车辆位置时的默认视野。
 *
 * 车队在新西兰奥克兰。这里原先三处地图都各自写死了香港坐标（22.3193, 114.1694），
 * 打开仪表盘看到的是深圳湾。常量放这里，免得以后又在某个新页面里复制一份旧坐标。
 */
export const DEFAULT_MAP_CENTER: [number, number] = [-36.8485, 174.7633];
export const DEFAULT_MAP_ZOOM = 11;

// 给 Leaflet 地图加「街道 / 卫星」两个免费底图 + 右上角切换控件。
// 街道：OpenStreetMap；卫星：Esri World Imagery。两者均免费、无需 API Key。
export function addBaseLayers(map: L.Map) {
  const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  });
  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri', maxZoom: 19 },
  );
  street.addTo(map); // 默认街道
  // 不是 React 组件，拿不到 useTranslation，直接用 i18n 实例
  L.control.layers(
    { [i18n.t('layout.map_street')]: street, [i18n.t('layout.map_satellite')]: satellite },
    undefined,
    { position: 'topright' },
  ).addTo(map);
}
