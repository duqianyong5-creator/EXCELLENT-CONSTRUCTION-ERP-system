import React, { useRef, useEffect, useState } from 'react';
import { WebView } from 'react-native-webview';
import type { StyleProp, ViewStyle } from 'react-native';
import { useLang } from './i18n';
import { colors, space, font, weight, radius, hit, shadow } from './theme';

export type MapPos = {
  driverId: string;
  driverName?: string;
  latitude: number;
  longitude: number;
  speed?: number;
  /** Replaces the speed in the pin label (used for "Offline" trackers at their last fix) */
  labelSuffix?: string;
};

// 转义,防止司机昵称把 HTML 注入到 WebView 标记里
function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

// 免费 OpenStreetMap（Leaflet）地图,无需任何 API Key / 付费绑定,与网页端一致。
// topInset/bottomInset 让地图控件（缩放、图层切换）避开手机状态栏/刘海与底部手势条。
type MapLabels = { street: string; satellite: string; speed: string; coords: string };

function buildHtml(topInset: number, bottomInset: number, labels: MapLabels): string {
  // WebView 里的样式写在 CSS 字符串里，拿不到 theme 对象，只能把色板插值进来。
  // 地图上的东西是真的"浮"在瓦片之上，所以这里是少数该用阴影的地方，参数取自 shadow.raised。
  const overlayShadow = `0 ${shadow.raised.shadowOffset.height}px ${shadow.raised.shadowRadius}px rgba(0,0,0,${shadow.raised.shadowOpacity})`;
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style id="insets">.leaflet-top{top:${topInset}px;}.leaflet-bottom{bottom:${bottomInset}px;}</style>
<style>
  html,body,#map{height:100%;width:100%;margin:0;padding:0;background:${colors.bg};}
  /* 控件同时压在卫星影像和街道瓦片上，两种底都得读得清，所以一律给实心底色 + 描边，不用半透明 */
  .leaflet-control-layers,.leaflet-bar,
  .leaflet-touch .leaflet-control-layers,.leaflet-touch .leaflet-bar{
    background:${colors.surface};
    color:${colors.text};
    border:1px solid ${colors.borderStrong};
    border-radius:${radius.md}px;
    box-shadow:${overlayShadow};
    /* leaflet 在触屏上把背景裁到 padding box，半透明描边下面会漏出瓦片 */
    background-clip:border-box;
  }
  /* leaflet 自带的 .leaflet-touch 规则优先级更高，不带这个前缀写的宽高在手机上根本不生效 */
  .leaflet-bar a,.leaflet-touch .leaflet-bar a{
    width:${hit.min}px;
    height:${hit.min}px;
    line-height:${hit.min}px;
    font-size:${font.xl}px;
    background:${colors.surface};
    color:${colors.text};
    border-bottom:1px solid ${colors.border};
  }
  .leaflet-bar a:hover,.leaflet-bar a:focus{background:${colors.surfaceAlt};color:${colors.text};}
  .leaflet-bar a.leaflet-disabled{background:${colors.surfaceAlt};color:${colors.textFaint};}
  .leaflet-control-layers-toggle,.leaflet-touch .leaflet-control-layers-toggle{
    width:${hit.min}px;
    height:${hit.min}px;
    background-color:transparent;
  }
  .leaflet-control-layers-expanded{padding:${space.sm}px ${space.md}px;background:${colors.surface};color:${colors.text};}
  .leaflet-control-layers label{
    margin:0;
    min-height:${hit.min}px;
    line-height:${hit.min}px;
    font-size:${font.sm}px;
  }
  .leaflet-control-layers-separator{border-top:1px solid ${colors.border};}
  /* 版权行也是压在瓦片上的文字，给实底才读得出来 */
  .leaflet-control-attribution{
    background:${colors.surface};
    color:${colors.textFaint};
    padding:${space.xs}px ${space.sm}px;
    font-size:${font.xs}px;
    border-radius:${radius.sm}px;
  }
  .leaflet-control-attribution a{color:${colors.textMuted};}
  .leaflet-popup-content-wrapper,.leaflet-popup-tip{
    background:${colors.surface};
    color:${colors.text};
    box-shadow:${overlayShadow};
  }
  .leaflet-popup-content-wrapper{border:1px solid ${colors.borderStrong};border-radius:${radius.md}px;}
  .leaflet-popup-content{
    margin:${space.md}px ${space.xxl}px ${space.md}px ${space.lg}px;
    font-size:${font.sm}px;
  }
  .leaflet-container a.leaflet-popup-close-button{
    width:${hit.compact}px;
    height:${hit.compact}px;
    line-height:${hit.compact}px;
    padding:0;
    font-size:${font.lg}px;
    color:${colors.textMuted};
  }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  var LBL = ${JSON.stringify(labels)};
  // 车队在奥克兰。原来是 [35,105] 缩放 4——中国地理中心；
  // 还没有车辆上报位置时，调度员打开定位页看到的就是整个中国
  var map = L.map('map', { zoomControl: false }).setView([-36.8485, 174.7633], 11);
  // Zoom bottom-left, layers top-right: the floating header owns the top-left, the refresh button the bottom-right
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  // The screen measures its floating header and pushes the controls below it without reloading the map
  window.rnSetInsets = function (top, bottom) {
    var s = document.getElementById('insets');
    if (s) s.textContent = '.leaflet-top{top:' + top + 'px;}.leaflet-bottom{bottom:' + bottom + 'px;}';
  };
  // 免费底图：街道(OSM) + 卫星(Esri)，右上角可切换，均无需 API Key
  var street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  });
  var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Tiles © Esri'
  });
  street.addTo(map);
  var baseLayers = {};
  baseLayers[LBL.street] = street;
  baseLayers[LBL.satellite] = satellite;
  L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
  var markers = {};
  var focusedId = null;
  function fitAll(pts) {
    if (pts.length === 1) { map.setView(pts[0], 13); }
    else if (pts.length > 1) { map.fitBounds(pts, { padding: [60, 60] }); }
  }
  window.rnRender = function (list) {
    for (var k in markers) { map.removeLayer(markers[k]); }
    markers = {};
    var pts = [];
    list.forEach(function (p) {
      var text = p.suffix ? p.name + ' · ' + p.suffix : (p.speed != null ? p.name + ' · ' + p.speed + ' km/h' : p.name);
      // 卡车图标原来只靠 drop-shadow 撑在瓦片上，亮底影像里几乎糊掉，改成实心圆底盘
      var label = '<div style="display:flex;flex-direction:column;align-items:center">'
        + '<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:${font.xl}px;line-height:1;border-radius:${radius.pill}px;background:${colors.surface};border:1px solid ${colors.borderStrong};box-shadow:${overlayShadow}">🚛</div>'
        + '<div style="margin-top:${space.xs}px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:${colors.surface};color:${colors.text};border:1px solid ${colors.borderStrong};border-radius:${radius.sm}px;padding:${space.xs}px ${space.sm}px;font-size:${font.xs}px;font-weight:${weight.semibold};box-shadow:${overlayShadow}">' + text + '</div>'
        + '</div>';
      var m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: label, iconSize: [180, 48], iconAnchor: [90, 16] }) });
      m.bindPopup(
        '<div style="font-weight:${weight.bold};font-size:${font.sm}px;margin-bottom:${space.xs}px;color:${colors.text}">' + p.name + '</div>'
        + '<div style="font-size:${font.xs}px;color:${colors.textMuted}">' + LBL.speed + ' <b style="color:${colors.accent}">' + (p.speed != null ? p.speed : 0) + ' km/h</b></div>'
        + '<div style="font-size:${font.xs}px;color:${colors.textFaint};margin-top:${space.xs}px">' + LBL.coords + ' ' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) + '</div>'
      );
      m.addTo(map);
      markers[p.id] = m;
      pts.push([p.lat, p.lng]);
    });
    // A followed vehicle keeps the camera; otherwise every refresh shows the whole fleet
    if (focusedId && markers[focusedId]) { map.panTo(markers[focusedId].getLatLng()); }
    else { focusedId = null; fitAll(pts); }
  };
  window.rnFocus = function (id) {
    var m = markers[id];
    focusedId = id;
    if (m) { map.setView(m.getLatLng(), 15); m.openPopup(); }
  };
  window.rnFitAll = function () {
    focusedId = null;
    map.closePopup();
    var pts = [];
    for (var k in markers) { pts.push(markers[k].getLatLng()); }
    fitAll(pts);
  };
</script>
</body>
</html>`;
}

export default function LeafletMap({ positions, focusId, style, topInset = 0, bottomInset = 0 }: {
  positions: MapPos[];
  focusId?: string | null;
  style?: StyleProp<ViewStyle>;
  topInset?: number;
  bottomInset?: number;
}) {
  const ref = useRef<WebView>(null);
  const { t } = useLang();
  const [ready, setReady] = useState(false);
  // The HTML is built once per language; inset changes are injected so the map never reloads mid-use.
  const initialInsets = useRef({ top: topInset, bottom: bottomInset });
  const html = React.useMemo(
    () => buildHtml(initialInsets.current.top, initialInsets.current.bottom, {
      street: t('map.street'),
      satellite: t('map.satellite'),
      speed: t('map.speed'),
      coords: t('map.coords'),
    }),
    [t],
  );

  useEffect(() => {
    if (!ready || !ref.current) return;
    ref.current.injectJavaScript(`window.rnSetInsets && window.rnSetInsets(${Math.round(topInset)}, ${Math.round(bottomInset)}); true;`);
  }, [ready, topInset, bottomInset]);

  useEffect(() => {
    if (!ready || !ref.current) return;
    const data = positions
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map((p) => ({
        id: p.driverId,
        lat: p.latitude,
        lng: p.longitude,
        name: esc(p.driverName || t('d.driverFallback')),
        speed: p.speed != null ? Math.round(p.speed) : null,
        suffix: p.labelSuffix ? esc(p.labelSuffix) : null,
      }));
    ref.current.injectJavaScript(`window.rnRender && window.rnRender(${JSON.stringify(data)}); true;`);
  }, [ready, positions, t]);

  useEffect(() => {
    if (!ready || !ref.current) return;
    if (focusId) ref.current.injectJavaScript(`window.rnFocus && window.rnFocus(${JSON.stringify(focusId)}); true;`);
    else ref.current.injectJavaScript('window.rnFitAll && window.rnFitAll(); true;');
  }, [ready, focusId]);

  return (
    <WebView
      ref={ref}
      source={{ html }}
      style={style}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      onLoadStart={() => setReady(false)}
      onLoadEnd={() => setReady(true)}
    />
  );
}
