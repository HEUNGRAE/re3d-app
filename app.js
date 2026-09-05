'use strict';
// 글로벌 부동산 3D 시각화 — 44개국 (deck.gl/WebGL + MapLibre)
// 지표: 평단가 / 거래량 / 전세가율. API: 같은 서버(FastAPI)의 /api/*.

const API = '';
const $ = (id) => document.getElementById(id);

// ── 지표 정의 ──
const METRICS = {
  ppm2:   { label: '평단가', unit: '만원/㎡', fmt: (v) => Math.round(v).toLocaleString() },
  count:  { label: '거래량', unit: '건',     fmt: (v) => Math.round(v).toLocaleString() },
  jeonse: { label: '전세가율', unit: '%',     fmt: (v) => v.toFixed(1) },
};
let UNIT_BY_TYPE = {}, VIEWS = [];
// 거래종류는 자산유형에서 자동 결정 (유형이 매매/전월세로 분리돼 있음)
function effDeal(p) {
  if (p === 'us_zhvi') return 'index';
  if (p === 'us_zori') return 'rent';
  if (p === 'mx_home') return 'sale';
  if (p.endsWith('_rent')) return 'rent';   // apt_rent, villa_rent, officetel_rent
  return 'trade';                            // apt_trade, villa, officetel
}
// 현재 (지표×자산유형)의 표시 라벨/단위/포맷 (텍사스 $ 등 동적 단위)
function curMeta() {
  if (CUBE && CUBE.isGlobal)
    return { label: '주택가격', unit: 'USD/㎡', fmt: (v) => Math.round(v).toLocaleString() };
  if (METRIC !== 'ppm2') return METRICS[METRIC];
  const p = $('ptype').value, u = UNIT_BY_TYPE[p] || '만원/㎡';
  let label = u === '만원/㎡' ? '평단가'
    : (p.indexOf('zhvi') >= 0 ? '주택가치' : (p.indexOf('zori') >= 0 ? '임대지수'
      : (p.indexOf('mx_') === 0 ? '주택가격' : '값')));
  if (RENTF !== 1) { label = '월임대료'; return { label, unit: u + '·월', fmt: (v) => Math.round(v).toLocaleString() }; }
  return { label, unit: u, fmt: (v) => Math.round(v).toLocaleString() };
}

// ── 컬러맵 ──
const STOPS = [
  [0.00, [33, 102, 172]], [0.22, [70, 170, 200]], [0.45, [120, 200, 120]],
  [0.68, [240, 222, 80]], [0.85, [245, 150, 50]], [1.00, [220, 50, 47]],
];
function ramp(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const f = (t - a) / (b - a);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * f));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
let domainLo = 0, domainHi = 1;
function norm(v) {  // sqrt 스케일 (skew 완화)
  const a = Math.sqrt(Math.max(v, 0)), lo = Math.sqrt(Math.max(domainLo, 0)), hi = Math.sqrt(Math.max(domainHi, 0));
  return hi > lo ? (a - lo) / (hi - lo) : 0;
}
const colorFor = (v) => [...ramp(norm(v)), 220];

// ── 상태 ──
let META = null, CUBE = null, FRAME = 0, PLAYING = false, timer = null, METRIC = 'ppm2';
let RENT = false, RENTF = 1, YIELDS = {};   // 렌탈 모드: 월임대료 = 매매가 × 수익률/1200
let SIZES = [], SIZEIDX = 0, SIZEF = 1;     // 평형: ㎡당 값 × factor, 총액 = ×m2
let POI = null, SHOWTOUR = true, SHOWEDU = true, SHOWHOSP = true, SHOWMALL = true, SHOWJOBS = true, SHOWCLUB = true;
let SHOWAIR = true;                                        // ✈️ 공항·노선(허브 앤 스포크)
let SHOWBIKE = false;                                      // 🚲 자전거 루트(멕시코시티)
let BIKE = null;                                           // GeoJSON — 첫 토글 시 지연 로드
let WSCALE = 1;                             // 부동산 막대 굵기 배율(슬라이더)
let JDH = 1;                                // 💼 JD 막대 높이 배율(슬라이더)
let JDW = 1;                                // 💼 JD 막대 굵기 배율(슬라이더)
let TOKEN = localStorage.getItem('re3d_token') || '', USERNAME = localStorage.getItem('re3d_user') || '';
let AB = {};                                // 실험명→변형
const authHdr = () => TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {};
function track(type, detail) {              // 행동 이력(익명 포함)
  fetch(`${API}/api/track`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr() },
    body: JSON.stringify({ type, detail: String(detail || '') }) }).catch(() => {});
}
function abConvert(exp) {
  if (AB[exp]) fetch(`${API}/api/ab/convert?exp=${exp}&variant=${AB[exp]}`,
    { method: 'POST', headers: authHdr() }).catch(() => {});
}
const TUITION_MAX = 135000;                 // 학비 정규화 분모(Le Rosey 기준)
const RADIUS = { dong: 380, sigungu: 1400, sido: 6000, county: 16000, usstate: 70000,
                 mxstate: 38000, mxmuni: 9000, alcaldia: 1600, colonia: 450,
                 caprov: 60000, cacity: 14000, ukregion: 16000, ukcity: 6000,
                 destate: 22000, decity: 7000, esregion: 28000, escity: 7000,
                 jpref: 16000, jpcity: 6000, cnprov: 48000, cncity: 16000,
                 codept: 24000, cocity: 10000,
                 ptdist: 18000, austate: 90000, nzregion: 22000, sgreg: 6000,
                 twcounty: 12000, brstate: 70000, arprov: 70000,
                 ptcity: 9000, aucity: 30000, brcity: 22000, arcity: 30000,
                 instate: 42000, rufed: 80000, aeemirate: 16000,
                 saregion: 50000, trprov: 16000, itprov: 9000, secounty: 28000,
                 chcanton: 8000, frdept: 9000, ildistrict: 14000,
                 mystate: 28000, guam: 9000, cnmi: 9000,
                 nlprov: 12000, idprov: 30000, thprov: 14000, phprov: 12000,
                 plprov: 16000, atstate: 12000, nocounty: 28000, zaprov: 40000,
                 clregion: 40000, clcity: 7000, peregion: 40000, pecity: 12000,
                 ecregion: 18000, boregion: 45000, pyregion: 28000, uyregion: 16000 };

// ── 지도 + deck ──
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  center: [127.7, 36.2], zoom: 6.6, pitch: 55, bearing: -12, antialias: true,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
// interleaved=true는 maplibre GL 상태(컬링) 누수로 기둥이 반원형으로 깨짐(실측) → 캔버스 분리
const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
map.addControl(overlay);

// ── 🌐 3D 글로브(실험적, deck._GlobeView) — 평면 maplibre ↔ 구면 지구 토글 ──
// 전용 deck 캔버스(지연 생성). 레이어는 render()가 만드는 배열을 그대로 재사용해
// 부동산 막대·JD·공항·노선·POI가 전부 자동으로 구면에 매핑된다(네이티브 gwarp와 동일 철학).
// GlobeView 줌은 화면 중심에서 MapView와 동일 스케일 정의라 시점 승계는 줌 1:1.
let GLOBE = false, globeDeck = null, worldGeo = null;
let globeVS = { longitude: 127.7, latitude: 30, zoom: 0.9, minZoom: 0.4, maxZoom: 8 };
// GlobeView 줌은 구 지름 ≈ 512·2^zoom px (실측). 메르카토르 세계폭 512·2^z px와 맞추면 g ≈ z − log2(π).
const m2g = (z) => Math.min(Math.max(z - 1.65, 0.5), 8);   // 메르카토르 줌 → 글로브 줌
// GlobeView는 pitch·베이스맵 타일 미지원(항상 천저) → 이 줌 이상 확대하면 상세 내비는
// 평면 MapLibre 지도(도로·지명·pitch·OSM 타일)가 담당하므로 같은 위치로 자동 전환.
const GLOBE_MAX_ZOOM = 4.2;
const WORLD_GEO_URL = 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_scale_rank.geojson';

function geoPaths(geo, alt) {               // GeoJSON 폴리곤 링 → [lon,lat,alt] 경로(살짝 띄워 배경 구와 z-파이팅 방지)
  const P = [];
  for (const f of geo.features || []) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) P.push(ring.map((c) => [c[0], c[1], alt]));
  }
  return P;
}
function graticulePaths(alt) {              // 위경도 격자: 경도선 15°(양극 수렴) + 위도선 15°(닫힌 고리)
  const P = [];
  for (let lo = -180; lo < 180; lo += 15) {
    const p = []; for (let la = -90; la <= 90; la += 4) p.push([lo, la, alt]); P.push(p);
  }
  for (let la = -75; la <= 75; la += 15) {
    const p = []; for (let lo = -180; lo <= 180; lo += 4) p.push([lo, la, alt]); P.push(p);
  }
  return P;
}
function globeBaseLayers() {                // 불투명 배경 구(뒷면 지오메트리 깊이 가림, 공식 패턴) + 격자 + 국경
  const L = [
    new deck.SolidPolygonLayer({
      id: 'globe-bg',
      data: [[[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]]],
      getPolygon: (d) => d, stroked: false, filled: true, getFillColor: [7, 13, 28],
    }),
    new deck.PathLayer({
      id: 'globe-grat', data: graticulePaths(18000), getPath: (d) => d,
      getColor: [64, 96, 141, 115], getWidth: 1, widthUnits: 'pixels', widthMinPixels: 1,
    }),
  ];
  if (worldGeo) L.push(new deck.PathLayer({
    id: 'globe-borders', data: worldGeo, getPath: (d) => d,
    getColor: [118, 155, 196, 160], getWidth: 1, widthUnits: 'pixels', widthMinPixels: 1,
  }));
  return L;
}
function setGlobe(on) {
  if (on && !deck._GlobeView) { setStatus('이 deck.gl 번들은 GlobeView를 지원하지 않습니다'); return; }
  GLOBE = on;
  $('globeBtn').classList.toggle('on', on);
  $('globe').classList.toggle('hidden', !on);
  $('map').style.visibility = on ? 'hidden' : '';
  if (on) {
    if (!globeDeck) {
      globeDeck = new deck.DeckGL({
        container: 'globe', map: false,
        views: new deck._GlobeView({ id: 'globe', controller: true }),
        initialViewState: globeVS,
        onViewStateChange: ({ viewState }) => {
          globeVS = viewState;
          // 임계 줌 초과 → 상세 내비게이션은 평면 지도가 담당(구글어스식 지구→지표 전환)
          if (GLOBE && viewState.zoom > GLOBE_MAX_ZOOM) {
            setStatus('상세 지도(평면)로 전환 — 🌐로 지구 뷰 복귀');
            setGlobe(false);
          }
        },
        layers: [],
      });
      fetch(WORLD_GEO_URL).then((r) => r.json())
        .then((g) => { worldGeo = geoPaths(g, 26000); if (GLOBE) render(); })
        .catch(() => {});                   // 국경 로드 실패해도 격자+데이터만으로 동작
    }
    // 네이티브 [0]→[0]과 동일 시맨틱: 글로브 = 글로벌 뷰 기준(다른 뷰였으면 전환 후 진입).
    // GlobeView는 pitch 미지원(항상 천저 시점)이라 국가 정밀 분석은 평면 모드가 적합.
    if ($('view').value !== 'global') { $('view').value = 'global'; applyView('global'); }
    else globeGoTo(-172, 27, 0.9);          // 데이터 반구(태평양: 한·미·멕) 프레이밍
  } else {
    const z = Math.min(Math.max(globeVS.zoom + 1.65, 1.2), 16);   // 글로브 줌 → 메르카토르 줌
    map.jumpTo({ center: [globeVS.longitude, globeVS.latitude],    // 글로브 시점을 평면에 반영(역매핑)
                 zoom: z, pitch: z > 4 ? 55 : 35, bearing: -12 }); // 상세 줌이면 표준 기울기 내비 뷰
  }
  track('globe', on);
  render();
}
function globeGoTo(lon, lat, zoom) {        // 글로브 모드에서 권역 점프(구 맥락이 보이게 줌 상한)
  globeVS = { ...globeVS, longitude: lon, latitude: lat, zoom: Math.min(Math.max(zoom, 0.5), 3.4) };
  if (globeDeck) globeDeck.setProps({ initialViewState: { ...globeVS } });
}

// ── 깊은 줌 자동 축소(내비 지도 우선 — 네이티브 shrink 대응) ──
// ColumnLayer는 radiusMaxPixels가 없어 줌인하면 km급 마커(학교 5.2km 등)가 화면을 덮음 →
// 미터 반경(rcap)·높이(ecap)를 줌 연동 픽셀 상한으로 클램프. 구글맵식 상세 줌에서
// 지도(도로·건물)가 주인공이 되고 마커는 작은 표식으로 남는다.
let MPP = 100, RPX = 1, HPX = 1e9;           // m/px · 반경 px 계수 · 높이 px 캡
function zoomAdapt() {
  const z = map.getZoom(), lat = map.getCenter().lat;
  MPP = 78271.517 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
  const f = z <= 9 ? 1 : Math.pow(0.72, z - 9);   // z9부터 마커 존재감 연속 축소(조망 모습 보존)
  RPX = Math.max(0.18, f);
  HPX = Math.max(500 * f, 26);
}
const rcap = (m, px) => Math.min(m, px * RPX * MPP);   // 반경 m → 화면 px 상한(줌 연동)
const ecap = (es) => Math.min(es, HPX * MPP);          // 높이 스케일 px 캡(화면 관통 기둥 방지)
let zraf = 0;
map.on('zoom', () => {                        // 줌 변경 시 마커 재계산(rAF 스로틀)
  if (!GLOBE && !zraf) zraf = requestAnimationFrame(() => { zraf = 0; render(); });
});

function frameData(idx) {
  if (!CUBE) return [];
  const out = [];
  for (const r of CUBE.regions) {
    let v = CUBE.value[r.region_code] ? CUBE.value[r.region_code][idx] : null;
    if (v != null) v *= RENTF * SIZEF;         // 렌탈 + 평형 환산
    if (v == null) continue;
    out.push({
      position: [r.lon, r.lat], value: v, name: r.name,
      region_code: r.region_code, level: r.level,
      ppm2: CUBE.ppm2 && CUBE.ppm2[r.region_code] ? CUBE.ppm2[r.region_code][idx] : null,
      count: CUBE.count && CUBE.count[r.region_code] ? CUBE.count[r.region_code][idx] : null,
      avgPrice: CUBE.avg_price && CUBE.avg_price[r.region_code] ? CUBE.avg_price[r.region_code][idx] : null,
    });
  }
  return out;
}

function render() {
  if (!CUBE) return;
  const hs = +$('hscale').value;
  const data = frameData(FRAME);
  const isG = CUBE.isGlobal;
  if (GLOBE) { MPP = 1e9; RPX = 1; HPX = 1e9; } else zoomAdapt();   // 글로브: 자체 줌 상한 → 캡 비활성
  // ColumnLayer에 getRadius accessor는 없음(deck 소스 확인 — uniform radius만 유효).
  // 종전 radius:1+getRadius 조합은 실효 폭 1m(비가시·픽 불가)였음 → 뷰 레벨 기준 uniform 복원.
  const colR = (isG ? 70000 : (RADIUS[(CUBE.regions[0] || {}).level] || 600)) * WSCALE;
  const layer = new deck.ColumnLayer({
    id: 'cols', data, diskResolution: 16, radius: rcap(colR, 40),
    getElevation: (d) => norm(d.value),         // 정규화 높이(지표 간 비교 가능)
    elevationScale: ecap(hs * (isG ? 40000 : 3000)),  // 세계 줌은 훨씬 크게 · 깊은 줌은 px 캡(줌 연동)
    getPosition: (d) => d.position,
    getFillColor: (d) => colorFor(d.value),
    radiusUnits: 'meters', extruded: true, pickable: true,
    material: { ambient: 0.5, diffuse: 0.6, shininess: 32 },
    // transitions 금지: deck 9.0.36 ColumnLayer는 attribute transition 중 지오메트리가 절단됨
    // (기둥이 반원통/뚜껑 소실 — 실측 bisect로 확정). 월 전환 페이드보다 형태 정확성 우선.
    onHover, onClick,
    updateTriggers: { getFillColor: [domainLo, domainHi, METRIC], getElevation: [domainLo, domainHi, METRIC] },
  });
  const layers = [layer];
  // 학교 학비 막대: 본체(실부담, 대학=보라/사립중고=핑크) + 전체높이 반투명 녹색(윗부분=장학금 캡처럼 보임)
  if (SHOWEDU && POI) {
    const rad = rcap(isG ? 36000 : 5200, 26), es = ecap(hs * (isG ? 40000 : 3000));
    layers.push(new deck.ColumnLayer({
      id: 'edu-net', data: POI.schools, diskResolution: 4, angle: 45,
      getPosition: (d) => [d.lon, d.lat],
      getElevation: (d) => Math.max(0.015, (d.tuition - d.schol) / TUITION_MAX),
      elevationScale: es, radius: rad, radiusUnits: 'meters',
      getFillColor: (d) => d.stype === 'k' ? [236, 110, 190, 235] : [150, 105, 245, 235],
      extruded: true, pickable: true, onHover: onHoverPoi, onClick: onClickSchool,
    }));
    layers.push(new deck.ColumnLayer({
      id: 'edu-schol', data: POI.schools.filter((d) => d.schol > 0), diskResolution: 4, angle: 45,
      getPosition: (d) => [d.lon, d.lat],
      getElevation: (d) => Math.max(0.02, d.tuition / TUITION_MAX),
      elevationScale: es, radius: rad * 1.12, radiusUnits: 'meters',
      getFillColor: [72, 226, 130, 110], extruded: true, pickable: false,
    }));
  }
  if (SHOWCLUB && POI && POI.clubs) {
    layers.push(new deck.ColumnLayer({
      id: 'clubs', data: POI.clubs, diskResolution: 8,
      getPosition: (d) => [d.lon, d.lat],
      getElevation: (d) => 0.02 + Math.sqrt(Math.max(1, d.init)) / 9000,
      elevationScale: ecap(hs * (isG ? 40000 : 3000)),
      radius: rcap(isG ? 26000 : 3400, 20), radiusUnits: 'meters',
      getFillColor: (d) => d.kind === 'tc' ? [199, 102, 71, 235] : [61, 153, 76, 235],
      extruded: true, pickable: true, onHover: onHoverPoi, onClick: onClickPlace,
    }));
  }
  if (SHOWBIKE && BIKE && BIKE.features) {                 // 🚲 자전거: 상시=청록 / 일요일 통제=주황
    const seg = (lay) => BIKE.features.filter((f) => f.properties.layer === lay)
      .map((f) => ({ path: f.geometry.coordinates, name: f.properties.name, layer: lay }));
    layers.push(new deck.PathLayer({
      id: 'bike-perm', data: seg('permanent'),
      getPath: (d) => d.path, widthUnits: 'meters', getWidth: isG ? 900 : 26,
      widthMinPixels: 1.2, widthMaxPixels: 5,
      getColor: [72, 214, 200, 190], capRounded: true, jointRounded: true,
      pickable: true, onHover: onHoverBike,
    }));
    layers.push(new deck.PathLayer({                       // 일요일 축은 위에·굵게(주인공)
      id: 'bike-sun', data: seg('sunday'),
      getPath: (d) => d.path, widthUnits: 'meters', getWidth: isG ? 1600 : 46,
      widthMinPixels: 2.4, widthMaxPixels: 11,
      getColor: [255, 150, 40, 225], capRounded: true, jointRounded: true,
      pickable: true, onHover: onHoverBike,
    }));
  }
  if (SHOWAIR && POI && POI.routes) {                      // ✈️ 노선(허브 앤 스포크): 간선=금 / 스포크=시안
    layers.push(new deck.ArcLayer({
      id: 'airroutes', data: POI.routes,
      getSourcePosition: (d) => [d.slon, d.slat],
      getTargetPosition: (d) => [d.dlon, d.dlat],
      getSourceColor: (d) => d.kind === 'trunk' ? [255, 184, 77, 150] : [107, 204, 255, 130],
      getTargetColor: (d) => d.kind === 'trunk' ? [255, 184, 77, 150] : [107, 204, 255, 130],
      getWidth: (d) => d.kind === 'trunk' ? 1.8 : 1.1, widthUnits: 'pixels',
      // 글로브: 평면용 0.35는 장거리 노선 apex가 구 반지름급으로 치솟아 헤어볼化 → 낮게(네이티브 hArc 교훈)
      getHeight: GLOBE ? 0.10 : 0.35, greatCircle: true,
      updateTriggers: { getHeight: [GLOBE] },
      pickable: true, onHover: onHoverPoi, onClick: onClickRoute,
      autoHighlight: true, highlightColor: [255, 225, 130, 235],   // 호버 아크 하이라이트
    }));
  }
  if (SHOWAIR && POI && POI.airports) {                    // 공항 마커(rank별 크기·색)
    layers.push(new deck.ScatterplotLayer({
      id: 'airports', data: POI.airports,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => (d.rank === 0 ? 2.4 : d.rank === 1 ? 1.7 : 1.2) * (isG ? 16000 : 2600),
      radiusUnits: 'meters', radiusMinPixels: 3, radiusMaxPixels: 14,
      getFillColor: (d) => d.rank === 0 ? [90, 190, 255, 235]
        : d.rank === 1 ? [130, 175, 235, 220] : [150, 165, 195, 200],
      stroked: true, getLineColor: [235, 245, 255, 220], lineWidthMinPixels: 1.2,
      pickable: true, onHover: onHoverPoi, onClick: onClickAirport,
      autoHighlight: true, highlightColor: [255, 255, 255, 200],
    }));
  }
  if (SHOWJOBS && POI && POI.jd_bars) {                    // 개별 JD 막대(높이=총보상, resume 30일 기준)
    const tmax = 520000;
    const szM2 = (SIZES[SIZEIDX] && SIZES[SIZEIDX].m2) || 79;   // 선택 평형 ㎡
    layers.push(new deck.ColumnLayer({
      id: 'jdbars', data: POI.jd_bars, diskResolution: 4,
      getPosition: (d) => [d.lon, d.lat],
      // 글로벌 뷰: 부동산과 동일 달러축 — "평형 총액 = 연봉"인 부동산 막대와 같은 높이(norm 공유).
      // 단일 국가 뷰(현지통화 축)는 종전 자체 축 유지.
      getElevation: (d) => (d.total > 0
        ? (isG ? Math.max(norm(d.total / (SIZEF * szM2)), 0.004) : 0.02 + d.total / tmax)
        : (isG ? 0.004 : 0.06)) * JDH,
      elevationScale: ecap(hs * (isG ? 40000 : 3000)),
      radius: rcap((isG ? 9000 : 260) * JDW, 9), radiusUnits: 'meters',   // uniform radius(getRadius는 ColumnLayer에 무효)
      updateTriggers: { getElevation: [JDH, SIZEF, SIZEIDX, domainLo, domainHi] },
      // 부동산 solid 막대와 구분: 아웃라인(와이어)만 도드라지고 내부는 거의 투명
      // (fill을 완전히 끄면 클릭·호버 picking이 죽어 아주 옅게만 유지)
      extruded: true, filled: true, wireframe: true, stroked: true,
      getFillColor: (d) => { if (!(d.total > 0)) return [133, 143, 158, 26];   // 보상 미공개=회색
        const t = Math.min(1, d.total / tmax);
        return [20 + 100 * t, 140 + 100 * t, 165 + 90 * t, 30]; },
      getLineColor: (d) => { if (!(d.total > 0)) return [150, 160, 175, 255];  // 아웃라인은 선명하게
        const t = Math.min(1, d.total / tmax);
        return [40 + 120 * t, 170 + 85 * t, 195 + 55 * t, 255]; },
      getLineWidth: 2, lineWidthUnits: 'pixels', lineWidthMinPixels: 1.2,
      pickable: true, onHover: onHoverPoi, onClick: onClickJd,
    }));
    layers.push(new deck.ScatterplotLayer({                 // 도시 마커(집계 툴팁)
      id: 'jobcity', data: POI.jobs,
      getPosition: (d) => [d.lon, d.lat],
      getFillColor: [40, 210, 245, 200], stroked: true, getLineColor: [10, 60, 80, 255],
      lineWidthMinPixels: 1, getRadius: isG ? 14000 : 900, radiusUnits: 'meters',
      radiusMinPixels: 3, radiusMaxPixels: 8,
      pickable: true, onHover: onHoverPoi,
    }));
  }
  if (SHOWMALL && POI && POI.malls) {
    layers.push(new deck.ColumnLayer({
      id: 'mall', data: POI.malls, diskResolution: 4, angle: 30,
      getPosition: (d) => [d.lon, d.lat],
      getElevation: (d) => 0.03 + d.gla / 3000,
      elevationScale: ecap(hs * (isG ? 40000 : 3000) * 0.8),
      radius: rcap(isG ? 24000 : 3800, 24), radiusUnits: 'meters',   // 면적 비례 폭은 ColumnLayer 불가(uniform만) — 높이가 이미 GLA 비례
      getFillColor: (d) => d.kind === 'mart' ? [64, 191, 184, 235]
        : d.kind === 'dept' ? [184, 107, 71, 235] : [240, 148, 56, 235],
      extruded: true, pickable: true, onHover: onHoverPoi, onClick: onClickPlace,
    }));
  }
  if (SHOWHOSP && POI && POI.hospitals) {
    layers.push(new deck.ColumnLayer({
      id: 'hosp', data: POI.hospitals, diskResolution: 6,
      getPosition: (d) => [d.lon, d.lat],
      getElevation: (d) => Math.max(0.02, d.beds / 4300),
      elevationScale: ecap(hs * (isG ? 40000 : 3000) * 0.8),
      radius: rcap(isG ? 30000 : 4200, 22), radiusUnits: 'meters',
      getFillColor: [240, 246, 252, 240], getLineColor: [220, 40, 45, 255],
      stroked: true, lineWidthMinPixels: 2,
      extruded: true, pickable: true, onHover: onHoverPoi, onClick: onClickPlace,
    }));
  }
  if (SHOWTOUR && POI) {
    layers.push(new deck.ScatterplotLayer({
      id: 'tour', data: POI.tours,
      getPosition: (d) => [d.lon, d.lat],
      getFillColor: [255, 200, 70, 235], getLineColor: [120, 82, 10, 255],
      stroked: true, lineWidthMinPixels: 1.5,
      getRadius: isG ? 26000 : 3600, radiusUnits: 'meters',
      radiusMinPixels: 4, radiusMaxPixels: 11,
      pickable: true, onHover: onHoverPoi, onClick: onClickPlace,
    }));
  }
  if (GLOBE && globeDeck) globeDeck.setProps({ layers: [...globeBaseLayers(), ...layers] });
  else overlay.setProps({ layers });
  $('ymLabel').textContent = CUBE.months[FRAME] || '—';
  $('time').value = FRAME;
}

// POI 툴팁(관광지 / 학교 학비·장학금)
// 호버 카드에 붙는 스냅샷 사진 + 홈페이지 링크(있는 POI만).
// 사진은 위키미디어 썸네일 핫링크 — 오프라인/차단 시 onerror로 조용히 숨긴다.
function linkCardHtml(o) {
  if (!o || (!o.img && !o.web)) return '';
  let h = '';
  if (o.img) {
    h += `<img src="${esc(o.img)}" alt="" loading="lazy"
            onerror="this.style.display='none'"
            style="display:block;margin:6px 0 4px;width:100%;max-width:230px;height:126px;
                   object-fit:cover;border-radius:6px;background:#1b2330">`;
  }
  if (o.local) h += `<div style="opacity:.65;font-size:10.5px">${esc(o.local)}</div>`;
  if (o.web) {
    let host = o.web;
    try { host = new URL(o.web).hostname.replace(/^www\./, ''); } catch (e) { /* 원문 표시 */ }
    h += `<div style="font-size:11px;color:#7fd0ff">🔗 ${esc(host)}
            <span style="opacity:.55">— 클릭 시 새 탭</span></div>`;
  }
  return h;
}
// 장소(관광·카페·클럽·쇼핑·병원) 클릭 → 사진·홈페이지·정보 패널.
// 호버 툴팁은 커서를 따라다녀 링크를 누를 수 없으므로, 실제 클릭 가능한 링크는 여기에 둔다.
function onClickPlace({ object }) {
  if (!object) return;
  track('place_click', object.name);
  const d = $('detail'); d.classList.remove('hidden');
  const icon = object.kind === '카페' ? '☕' : object.beds != null ? '🏥'
    : object.gla != null ? '🛍️' : object.init != null ? '⛳' : '🏛️';
  $('detailName').textContent = `${icon} ${object.name}`;
  const info = [];
  if (object.kind) info.push(esc(object.kind));
  if (object.beds != null) info.push(`${object.beds.toLocaleString()}병상`);
  if (object.gla != null) info.push(`연면적 ~${object.gla.toLocaleString()}천㎡`);
  if (object.init > 0) info.push(`입회비 $${object.init.toLocaleString()}`);
  if (object.annual > 0) info.push(`연회비 $${object.annual.toLocaleString()}`);
  const photo = object.img
    ? `<img src="${esc(object.img)}" alt="" loading="lazy" onerror="this.style.display='none'"
         style="display:block;width:100%;max-height:230px;object-fit:cover;border-radius:8px;margin:6px 0">`
    : `<div style="font-size:11.5px;color:#6f8099;margin:6px 0">사진 정보 없음</div>`;
  const link = object.web
    ? `<a href="${esc(object.web)}" target="_blank" rel="noopener noreferrer"
         style="color:#7fd0ff;font-size:12.5px">🔗 홈페이지 열기</a>`
    : `<span style="font-size:11.5px;color:#6f8099">홈페이지 정보 없음</span>`;
  $('detailStat').innerHTML = `
    <div style="grid-column:1/3">
      ${photo}
      <div style="font-size:12px;color:#cfe3ff">${info.join(' · ')}</div>
      ${object.local ? `<div style="font-size:11px;color:#93a4bd">${esc(object.local)}</div>` : ''}
      ${object.note ? `<div style="font-size:11.5px;color:#93a4bd;margin-top:3px">${esc(object.note)}</div>` : ''}
      <div style="margin-top:6px">${link}</div>
      <button id="placeAccess" style="margin-top:8px">📍 이 위치 기준 주변 분석</button>
    </div>`;
  $('chart').innerHTML = '';
  $('placeAccess').onclick = async () => {                  // 이 지점을 기준으로 접근성 보기
    const hits = await searchSuggest(object.name, false);
    if (hits.length) searchGo(hits[0]);
  };
}
function onHoverBike({ object, x, y }) {
  const tp = $('tooltip');
  if (!object) { tp.classList.add('hidden'); return; }
  tp.classList.remove('hidden');
  tp.style.left = (x + 14) + 'px'; tp.style.top = (y + 14) + 'px';
  const sun = object.layer === 'sunday';
  tp.innerHTML = `<b>🚲 ${esc(object.name || (sun ? '일요일 통제 구간' : '자전거도로'))}</b>`
    + (sun
      ? `<br>일요일 차 없는 거리 <b>Muévete en Bici</b>`
        + `<br>매주 일요일 <b>08:00~14:00</b> 차량 통제`
        + `<br><span style="opacity:.75">공식 총연장 주별 약 55~61km · 매월 마지막 일요일 미운영</span>`
      : `<br>상시 자전거도로(ciclovía)`);
  tp.innerHTML += `<div style="font-size:11px;color:#7fd0ff">🔗 sedema.cdmx.gob.mx</div>`;
}
function onHoverPoi(info) {
  onHoverPoiBase(info);
  if (!info.object) return;
  const extra = linkCardHtml(info.object);
  if (extra) $('tooltip').innerHTML += extra;
}
// 이름·비고 등 문자열 필드는 반드시 esc()를 거친다 — 구인(JD)은 levels.fyi에서 온 외부 문자열이라
// '<'나 '&'가 그대로 들어올 수 있고, 이스케이프 없이 innerHTML에 넣으면 툴팁이 깨지거나 주입된다.
// (숫자 필드는 toLocaleString/Math.round를 거치므로 그대로 둔다)
function onHoverPoiBase({ object, x, y }) {
  const tp = $('tooltip');
  if (!object) { tp.classList.add('hidden'); return; }
  tp.classList.remove('hidden');
  tp.style.left = (x + 14) + 'px'; tp.style.top = (y + 14) + 'px';
  if (object.src && object.dst) {                        // ✈️ 노선 아크: 일 편수·평균 비행시간
    const kd = object.kind === 'trunk' ? '국제 간선' : '국내·근거리 스포크';
    const fh = Math.floor(object.fmin / 60), fm = object.fmin % 60;
    tp.innerHTML = `<b>✈️ ${esc(object.src)} → ${esc(object.dst)}</b><br>${kd}`
      + `<br>일 <b>${object.daily}</b>편 · 평균 <b>${fh}h ${String(fm).padStart(2, '0')}m</b> · ${object.km.toLocaleString()}km`
      + `<br><span style="opacity:.6">클릭 → 오늘 예약 가능 편</span>`;
    return;
  }
  if (object.code && object.mpax != null) {              // 공항 마커
    const rk = object.rank === 0 ? '국제 메가허브' : object.rank === 1 ? '지역·국제 허브' : '국내 공항';
    tp.innerHTML = `<b>✈️ ${esc(object.name)} (${esc(object.code)})</b><br>${rk}`
      + `<br>연 <b>${Math.round(object.mpax * 100).toLocaleString()}</b>만 명 · 노선 <b>${object.routes}</b>개`;
    return;
  }
  if (object.init != null) {
    const kd = object.kind === 'tc' ? '테니스 클럽' : '컨트리클럽(골프)';
    let fee = object.init > 0
      ? `입회비 <b>$${object.init.toLocaleString()}</b> · 연회비 $${object.annual.toLocaleString()} (월 ~$${Math.round(object.annual/12).toLocaleString()})`
      : (object.annual > 0 ? `연회비 $${object.annual.toLocaleString()}` : '<b>비공개·초청제</b>');
    tp.innerHTML = `<b>⛳ ${esc(object.name)}</b><br>${kd}<br>${fee}`
      + (object.note ? `<br><span style="opacity:.8">가입: ${esc(object.note)}</span>` : '');
    return;
  }
  if (object.jid != null) {
    const comp = object.total > 0
      ? `총보상 <b>$${object.total.toLocaleString()}</b>/년` : '<b>보상 미공개</b>';
    tp.innerHTML = `<b>💼 ${esc(object.company || '?')}</b><br>${esc(object.title)}`
      + `<br>${comp} · ${esc(object.city)}`
      + (object.posted ? `<br>게시 <b>${esc(object.posted)}</b>` : '')
      + `<br><span style="opacity:.6">클릭 → JD 원문</span>`;
    return;
  }
  if (object.jobs != null && object.city) {
    tp.innerHTML = `<b>💼 ${esc(object.city)}</b><br>구인 <b>${object.jobs.toLocaleString()}</b>건 (levels.fyi · 최근 30일)`
      + (object.note ? `<br><span style="opacity:.8">${esc(object.note)}</span>` : '');
    return;
  }
  if (object.gla != null) {
    const kd = object.kind === 'mart' ? '마트' : object.kind === 'dept' ? '백화점' : '쇼핑몰';
    tp.innerHTML = `<b>🛍️ ${esc(object.name)}</b><br>${kd} · 연면적 ~<b>${object.gla.toLocaleString()}</b>천㎡`
      + (object.note ? `<br><span style="opacity:.8">${esc(object.note)}</span>` : '');
    return;
  }
  if (object.beds != null) {
    tp.innerHTML = `<b>🏥 ${esc(object.name)}</b><br>병원 · ${esc(object.kind)} · <b>${object.beds.toLocaleString()}</b>병상`
      + (object.note ? `<br><span style="opacity:.8">${esc(object.note)}</span>` : '');
    return;
  }
  if (object.kind) {
    tp.innerHTML = `<b>🏛️ ${esc(object.name)}</b><br>관광지 · ${esc(object.kind)}`;
    return;
  }
  const pct = object.tuition > 0 ? Math.round(object.schol / object.tuition * 100) : 0;
  tp.innerHTML = `<b>🎓 ${esc(object.name)}</b>`
    + `<br>${object.stype === 'k' ? '사립 중·고' : '대학'} · 연 학비 <b>$${object.tuition.toLocaleString()}</b>`
    + `<br>장학금 <b style="color:#4ade80">$${object.schol.toLocaleString()} (${pct}%)</b>`
    + ` · 실부담 $${Math.max(0, object.tuition - object.schol).toLocaleString()}`
    + (object.note ? `<br><span style="opacity:.8">${esc(object.note)}</span>` : '')
    + `<br><span style="opacity:.6">클릭 → 거주요건·장학금 상세</span>`;
}

// 개별 JD 클릭 → 원문 전문(디테일 패널)
// ✈️ 공항 클릭 → 취항 노선 목록(행 클릭 = 해당 노선 예약 패널)
function onClickAirport({ object }) {
  if (!object) return;
  track('airport_click', object.code);
  const d = $('detail'); d.classList.remove('hidden');
  $('detailName').textContent = `✈️ ${object.name} (${object.code})`;
  const rk = object.rank === 0 ? '국제 메가허브' : object.rank === 1 ? '지역·국제 허브' : '국내 공항';
  $('detailStat').innerHTML = `
    <div>등급</div><div><b>${rk}</b></div>
    <div>연 승객</div><div><b>${Math.round(object.mpax * 100).toLocaleString()}</b>만 명</div>
    <div>노선</div><div><b>${object.routes}</b>개</div>`;
  const conn = (POI.routes || [])
    .filter((r) => r.src === object.code || r.dst === object.code)
    .sort((a, b) => (b.kind === 'trunk') - (a.kind === 'trunk') || b.daily - a.daily);
  const rows = conn.map((r, i) => {
    const o = r.src === object.code ? r.dst : r.src;
    const fh = Math.floor(r.fmin / 60), fm = String(r.fmin % 60).padStart(2, '0');
    const col = r.kind === 'trunk' ? '#ffd98a' : '#9edcff';
    return `<tr style="cursor:pointer" data-ri="${i}"><td style="color:${col}"><b>→ ${esc(o)}</b></td>
      <td>일 ${r.daily}편</td><td>${fh}h ${fm}m</td>
      <td style="opacity:.7">${r.kind === 'trunk' ? '간선' : '스포크'}</td></tr>`;
  }).join('');
  $('chart').innerHTML = `
    <h4 style="margin:8px 0 4px;color:#7dd8f5">취항 노선 (행 클릭 = 예약 가능 편)</h4>
    <table id="apRoutes" style="width:100%;font-size:12px;line-height:1.8;border-collapse:collapse">${rows}</table>`;
  document.querySelectorAll('#apRoutes tr').forEach((tr) => {
    tr.onclick = () => onClickRoute({ object: conn[+tr.dataset.ri] });
  });
}

// ✈️ 노선 클릭 → 오늘 예약 가능 편(현재 시각 이후, 결정적 스케줄 모델 — 실시간 예약 아님)
function onClickRoute({ object }) {
  if (!object) return;
  track('route_click', object.src + '-' + object.dst);
  const d = $('detail'); d.classList.remove('hidden');
  $('detailName').textContent = `✈️ ${object.src} → ${object.dst}`;
  const fh = Math.floor(object.fmin / 60), fm = object.fmin % 60;
  $('detailStat').innerHTML = `
    <div>구분</div><div><b>${object.kind === 'trunk' ? '국제 간선' : '국내·근거리 스포크'}</b></div>
    <div>거리</div><div><b>${object.km.toLocaleString()}</b> km</div>
    <div>평균 비행</div><div><b>${fh}h ${String(fm).padStart(2, '0')}m</b></div>
    <div>일 편수</div><div><b>${object.daily}</b>편</div>
    <div>운항</div><div>${object.airlines.map(esc).join(' · ')}</div>`;
  const fnv = (s, k) => {                                  // 결정적 지터(네이티브와 동일 계열)
    let h = 2166136261 >>> 0;
    for (const ch of s) { h = (h ^ ch.charCodeAt(0)) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
    return (h ^ Math.imul(k, 2654435761)) >>> 0;
  };
  const key = object.src + object.dst, now = new Date();
  const nowH = now.getHours() + now.getMinutes() / 60;
  const span = 16.5, deps = [];
  for (let k = 0; k < object.daily; k++) {
    let t = 6 + span * (k + 0.5) / object.daily;
    t += (((fnv(key, k) % 61) - 30) / 60) * Math.min(1, span / object.daily);
    deps.push([Math.min(23.4, Math.max(6, t)), k]);
  }
  deps.sort((a, b) => a[0] - b[0]);
  const hm = (x) => `${String(Math.floor(x) % 24).padStart(2, '0')}:${String(Math.floor((x % 1) * 60)).padStart(2, '0')}`;
  const acft = (h) => object.km < 1500 ? (h & 1 ? 'B737-8' : 'A321neo')
    : object.km < 4500 ? (h & 1 ? 'B787-9' : 'A330-300')
    : object.km < 9500 ? (h & 1 ? 'B777-300ER' : 'A350-900') : (h & 1 ? 'B777-9' : 'A350-1000');
  const row = (t, k, dayOff) => {                          // 편명·시각·기종·이코/비즈·잔여석
    const h = fnv(key, k + dayOff * 997);
    const al = object.airlines[(k + Math.floor(h / 64)) % object.airlines.length] || 'XX';
    const acode = al.split(' ')[0];
    const arr = t + object.fmin / 60;
    const base = object.kind !== 'trunk' ? object.km * 0.14 + 22
               : (object.km < 1500 ? object.km * 0.13 + 28 : object.km * 0.082 + 85);
    let eco = base * (1 + ((h % 29) - 14) / 100);
    if (dayOff === 0 && t - nowH < 3) eco *= 1.25;         // 출발 임박 할증
    const biz = Math.round(eco * 3.2 / 10) * 10;
    const seats = 1 + (h % 17);
    const st = seats <= 4 ? `<span style="color:#f5b46e">잔여 ${seats}석</span>` : '여유';
    return `<tr><td><b>${esc(acode)}${100 + (h % 800)}</b></td>
      <td>${hm(t)}→${hm(arr)}${arr >= 24 ? '+1' : ''}</td><td style="opacity:.75">${acft(h)}</td>
      <td style="text-align:right"><b>$${Math.round(eco).toLocaleString()}</b></td>
      <td style="text-align:right;opacity:.85">비즈 $${biz.toLocaleString()}</td><td>${st}</td></tr>`;
  };
  let rows = '', shown = 0, remain = 0;
  for (const [t, k] of deps) {
    if (t < nowH) continue;
    remain++;
    if (shown >= 10) continue;
    shown++; rows += row(t, k, 0);
  }
  let rows2 = '', shown2 = 0;
  for (const [t, k] of deps) { if (shown2 >= 8) break; shown2++; rows2 += row(t, k, 1); }
  const tm = new Date(now.getTime() + 86400000);
  const md = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  const tbl = (r) => `<table style="width:100%;font-size:11.5px;line-height:1.75;border-collapse:collapse">${r}</table>`;
  $('chart').innerHTML = `
    <h4 style="margin:8px 0 4px;color:#7dd8f5">오늘 ${md(now)} · 지금 ${hm(nowH)} 이후 예약 가능</h4>
    ${remain ? tbl(rows) + (remain > shown ? `<p class="hint">… 외 ${remain - shown}편 (오늘 잔여 ${remain}편)</p>` : '')
             : '<p style="color:#f5b46e">오늘 남은 출발 없음</p>'}
    <h4 style="margin:10px 0 4px;color:#7dd8f5">내일 ${md(tm)} · 전 편 예약 가능 (일 ${object.daily}편)</h4>
    ${tbl(rows2)}${deps.length > shown2 ? `<p class="hint">… 외 ${deps.length - shown2}편</p>` : ''}
    <p class="hint">※ 스케줄·요금·잔여석은 거리 기반 모델 추정 — 실시간 예약 시스템 아님</p>`;
}

async function onClickJd({ object }) {
  if (!object) return;
  track('jd_click', object.company + ' — ' + object.title);
  const d = $('detail'); d.classList.remove('hidden');
  $('detailName').textContent = '💼 ' + (object.company || 'JD');
  const comp = object.total > 0 ? `<b>$${object.total.toLocaleString()}</b>/년` : '<b>미공개</b>';
  const inc = INVEST && INVEST.income && INVEST.income[object.cc || 'us'];   // 소득세(국가코드)
  const taxHtml = inc ? `
    <div style="grid-column:1/3;margin-top:8px;border-top:1px solid rgba(255,255,255,.15);padding-top:6px">
      <div style="color:#ffd54f;font-size:12px;font-weight:bold">소득·원천징수 세금</div>
      <div style="font-size:11.5px;margin-top:3px">${md(inc.inc)}</div>
      <div style="font-size:11.5px;color:#8ee89a;margin-top:3px">🇰🇷 한국인: ${md(inc.kr)}</div>
      <div style="font-size:11.5px;color:#f5b46e">🇺🇸 미국영주권자: ${md(inc.us)}</div>
    </div>` : '';
  $('detailStat').innerHTML = `
    <div>공고</div><div><b>${esc(object.title)}</b></div>
    <div>총보상</div><div>${comp}</div>
    <div>도시</div><div><b>${esc(object.city)}</b></div>
    ${object.posted ? `<div>게시일</div><div><b>${esc(object.posted)}</b></div>` : ''}${taxHtml}`;
  $('chart').innerHTML = '<p style="opacity:.6">원문 불러오는 중…</p>';
  try {
    const r = await (await fetch(`${API}/api/jd?jid=${object.jid}`)).json();
    $('chart').innerHTML = r.desc
      ? `<h4 style="margin:8px 0 4px;color:#7dd8f5">JD 원문</h4>
         <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;line-height:1.5;
           max-height:52vh;overflow-y:auto;background:rgba(255,255,255,.04);padding:10px;border-radius:8px">${
           r.desc.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`
      : '<p class="hint">원문 없음 — 요약만 제공된 공고</p>';
  } catch (e) { $('chart').innerHTML = '<p class="hint">원문 로드 실패</p>'; }
}

// 학교 클릭 → 상세(거주요건: 시민권/영주권/외국인 + 장학금 조건 상세)
function onClickSchool({ object }) {
  if (!object) return;
  const d = $('detail'); d.classList.remove('hidden');
  $('detailName').textContent = '🎓 ' + object.name;
  const pct = object.tuition > 0 ? Math.round(object.schol / object.tuition * 100) : 0;
  $('detailStat').innerHTML = `
    <div>유형</div><div><b>${object.stype === 'k' ? '사립 중·고등학교' : '대학'}</b></div>
    <div>연 학비</div><div><b>$${object.tuition.toLocaleString()}</b> <span style="opacity:.7">(유학생 기준)</span></div>
    <div>장학금 대표</div><div><b style="color:#4ade80">$${object.schol.toLocaleString()} (${pct}%)</b></div>
    <div>실부담</div><div><b>$${Math.max(0, object.tuition - object.schol).toLocaleString()}</b></div>`;
  let h = object.note ? `<p style="margin:8px 0 4px">${object.note}</p>` : '';
  const ul = (s, color) => '<ul style="margin:4px 0 10px 18px;padding:0">'
    + s.split('|').map((x) => `<li style="margin:3px 0;color:${color}">${x.trim()}</li>`).join('') + '</ul>';
  if (object.resid)
    h += `<h4 style="margin:10px 0 2px;color:#8ab6ff">거주 요건 (시민권 / 영주권 / 외국인)</h4>` + ul(object.resid, '#dfe7f5');
  if (object.schol_detail)
    h += `<h4 style="margin:10px 0 2px;color:#4ade80">장학금 조건 상세</h4>` + ul(object.schol_detail, '#d8f5e0');
  if (object.grad)
    h += `<h4 style="margin:10px 0 2px;color:#c9b6ff">대학원 (석사 / 박사)</h4>` + ul(object.grad, '#e6ddfa');
  h += `<p class="hint">⚠️ 대표값·요약(2026 기준) — 실제 금액·자격은 기관 공지 확인</p>`;
  $('chart').innerHTML = h;
}

function onHover({ object, x, y }) {
  const tp = $('tooltip');
  if (!object) { tp.classList.add('hidden'); return; }
  const M = curMeta();
  tp.classList.remove('hidden');
  tp.style.left = (x + 14) + 'px'; tp.style.top = (y + 14) + 'px';
  let h = `<b>${object.name}</b><br>${M.label} <b>${M.fmt(object.value)}</b> ${M.unit}`;
  if (SIZES[SIZEIDX] && METRIC === 'ppm2') {
    const s = SIZES[SIZEIDX], tu = M.unit.replace('/㎡', '');
    h += `<br>${s.name} ${s.pyeong}평·${s.m2}㎡ · <b>${s.family}</b> 가족`;
    h += `<br>${RENT ? '월세 ' : ''}총 <b>${M.fmt(object.value * s.m2)}</b> ${tu}`;
  }
  if (object.count != null && METRIC !== 'count') h += `<br>거래 ${object.count}건`;
  if (object.avgPrice != null) h += `<br>평균 ${(object.avgPrice / 10000).toFixed(2)} 억`;
  tp.innerHTML = h;
}
function onClick({ object }) {
  if (object) { track('detail_click', object.name); abConvert('poi_density'); showDetail(object); }
}

// ── 시계열 상세 (평단가 + 거래량) ──
async function showDetail(obj) {
  const d = $('detail'); d.classList.remove('hidden');
  $('detailName').textContent = obj.name;
  $('detailStat').innerHTML = '불러오는 중…';
  const p = $('ptype').value, dl = effDeal(p);
  const s = await (await fetch(`${API}/api/series?region_code=${obj.region_code}`
    + `&property_type=${p}&deal_type=${dl}`)).json();
  const pts = s.points;
  if (!pts.length) { $('detailStat').innerHTML = '데이터 없음'; return; }
  const u = UNIT_BY_TYPE[p] || '만원/㎡', isKR = u === '만원/㎡';
  const vlabel = isKR ? '평단가' : (p.indexOf('zhvi') >= 0 ? '주택가치'
    : (p.indexOf('zori') >= 0 ? '임대' : (p.indexOf('mx_') === 0 ? '주택가격' : '값')));
  const first = pts[0].avg_price_per_m2, last = pts[pts.length - 1].avg_price_per_m2;
  const chg = first ? ((last - first) / first * 100) : 0;
  const hasCnt = pts[pts.length - 1].count != null;
  // 부동산 세금(취득/보유/양도/임대 + 한국거주자/미국영주권자 관점) — 뷰 국가 기준
  let cc = CUR_COUNTRY;
  if ($('view').value === 'global') {                 // 글로벌뷰: region_code 접두로 국가 추정
    const rc = (obj.region_code || '') + '';
    cc = rc.startsWith('US') ? 'us' : rc.startsWith('MX') ? 'mx' : 'kr';
  }
  const iv = INVEST && INVEST.countries && INVEST.countries[cc];
  const taxHtml = iv ? `
    <div style="grid-column:1/3;margin-top:8px;border-top:1px solid rgba(255,255,255,.15);padding-top:6px">
      <div style="color:#ffd54f;font-size:12px;font-weight:bold">${esc(iv.name)} 부동산 세금</div>
      <div style="font-size:11.5px;margin-top:3px"><b>취득</b> ${md(iv.acq)}</div>
      <div style="font-size:11.5px"><b>보유</b> ${md(iv.hold)}</div>
      <div style="font-size:11.5px"><b>양도</b> ${md(iv.cgt)}</div>
      <div style="font-size:11.5px"><b>임대</b> ${md(iv.rent)}</div>
      ${iv.kr ? `<div style="font-size:11.5px;color:#8ee89a;margin-top:3px">🇰🇷 한국거주자: ${md(iv.kr)}</div>` : ''}
      ${iv.us ? `<div style="font-size:11.5px;color:#f5b46e">🇺🇸 미국영주권자: ${md(iv.us)}</div>` : ''}
    </div>` : '';
  $('detailStat').innerHTML = `
    <div>현재 ${vlabel}</div><div><b>${Math.round(last).toLocaleString()}</b> ${u}</div>
    ${isKR ? `<div>평당</div><div><b>${pyeong(last)}</b></div>` : ''}
    ${hasCnt ? `<div>현재 거래량</div><div><b>${pts[pts.length-1].count}</b> 건</div>` : ''}
    <div>변동(기간)</div><div><b style="color:${chg>=0?'#ff7043':'#4fc3f7'}">${chg>=0?'+':''}${chg.toFixed(1)}%</b></div>${taxHtml}`;
  const x = pts.map(p => p.ym);
  const traces = [
    { x, y: pts.map(p => p.avg_price_per_m2), name: `${vlabel}(${u})`, type: 'scatter',
      mode: 'lines', line: { color: '#4fc3f7', width: 2 }, fill: 'tozeroy',
      fillcolor: 'rgba(79,195,247,.12)' },
  ];
  if (hasCnt) traces.push({ x, y: pts.map(p => p.count), name: '거래량(건)', type: 'bar',
      yaxis: 'y2', marker: { color: 'rgba(255,213,79,.45)' } });
  const curYm = CUBE.months[FRAME];
  Plotly.newPlot('chart', traces, {
    margin: { l: 48, r: 44, t: 10, b: 36 }, paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)', font: { color: '#cfe3ff', size: 10 },
    showlegend: true, legend: { orientation: 'h', y: 1.12, font: { size: 9 } },
    xaxis: { gridcolor: '#1f2b3d', nticks: 6 },
    yaxis: { gridcolor: '#1f2b3d', title: u },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: '건' },
    shapes: [{ type: 'line', x0: curYm, x1: curYm, yref: 'paper', y0: 0, y1: 1,
               line: { color: '#ffd54f', width: 1.5, dash: 'dot' } }],
  }, { displayModeBar: false, responsive: true });
}

// ── 데이터 로드 ──
async function loadCube() {
  setStatus('데이터 불러오는 중…');
  stop();
  RENTF = (RENT && $('view').value !== 'global') ? ((YIELDS[CUR_COUNTRY] || 5) / 1200) : 1;
  SIZEF = (SIZES[SIZEIDX] ? SIZES[SIZEIDX].factor : 1);   // 평형 ㎡당 배수
  if ($('view').value === 'global') {   // 🌍 세계 비교 (근사 USD/㎡)
    const d = await (await fetch(`${API}/api/global_cube`)).json();
    CUBE = { months: d.months, regions: d.regions, value: d.value,
             ppm2: null, count: null, avg_price: null, isGlobal: true };
    METRIC = 'ppm2';
    let lo = Infinity, hi = -Infinity;
    for (const rc in CUBE.value) for (const x of CUBE.value[rc]) if (x != null) {
      if (x < lo) lo = x; if (x > hi) hi = x;
    }
    domainLo = (isFinite(lo) ? lo : 0) * RENTF * SIZEF; domainHi = (isFinite(hi) ? hi : 1) * RENTF * SIZEF;
    $('time').max = CUBE.months.length - 1;
    FRAME = (d.default_idx != null) ? d.default_idx : CUBE.months.length - 1;  // 3개국 공통 최신월
    buildLegend(); render();
    setStatus(`${CUBE.regions.length}개 지역(한·미·멕) · ${CUBE.months.length}개월 · 근사 USD/㎡`);
    return;
  }
  const p = $('ptype').value, dl = effDeal(p), lv = $('level').value;
  METRIC = $('metric').value;
  if (METRIC === 'jeonse') {
    const asset = p.startsWith('apt') ? 'apt' : (p.startsWith('villa') ? 'villa' : 'officetel');
    const d = await (await fetch(`${API}/api/ratio_cube?asset=${asset}&level=${lv}`)).json();
    CUBE = { months: d.months, regions: d.regions, value: d.ratio, ppm2: null, count: null, avg_price: null };
  } else {
    const d = await (await fetch(`${API}/api/cube?property_type=${p}&deal_type=${dl}&level=${lv}`)).json();
    CUBE = { months: d.months, regions: d.regions, value: d[METRIC], ppm2: d.ppm2, count: d.count, avg_price: d.avg_price };
  }
  let lo = Infinity, hi = -Infinity;
  for (const rc in CUBE.value) for (const v of CUBE.value[rc]) if (v != null) {
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  domainLo = (isFinite(lo) ? lo : 0) * RENTF * SIZEF; domainHi = (isFinite(hi) ? hi : 1) * RENTF * SIZEF;
  $('time').max = CUBE.months.length - 1;
  if (FRAME > CUBE.months.length - 1) FRAME = CUBE.months.length - 1;
  buildLegend();
  render();
  setStatus(`${CUBE.regions.length}개 지역 · ${CUBE.months.length}개월 · ${curMeta().label}`);
}

// ── 재생/슬라이더 ──
function step() { FRAME = (FRAME + 1) % CUBE.months.length; render(); }
function play() { if (!CUBE) return; PLAYING = true; $('play').textContent = '⏸'; $('play').classList.add('playing'); timer = setInterval(step, 230); }
function stop() { PLAYING = false; $('play').textContent = '▶'; $('play').classList.remove('playing'); if (timer) clearInterval(timer); timer = null; }

// ── 범례 ──
function buildLegend() {
  const M = curMeta();
  const grad = [];
  for (let i = 0; i <= 10; i++) { const c = ramp(i / 10); grad.push(`rgb(${c[0]},${c[1]},${c[2]}) ${i*10}%`); }
  const f = M.fmt;
  $('legend').innerHTML = `<div>${M.label} (${M.unit}) · 높이=값</div>
    <div class="bar" style="background:linear-gradient(90deg,${grad.join(',')})"></div>
    <div class="ticks"><span>${f(domainLo)}</span><span>${f((domainLo+domainHi)/2)}</span><span>${f(domainHi)}</span></div>`;
}

// ── 유틸 ──
const pyeong = (ppm2) => (ppm2 * 3.3058 / 10000).toFixed(2) + '억';
function setStatus(s) { $('status').textContent = s; }

// ── 권역(view) — 국가코드→대륙 매핑으로 <optgroup> 그룹화(권역이 많아 가독성↑) ──
const CONTINENT = {
  kr: '동아시아', jp: '동아시아', cn: '동아시아', tw: '동아시아',
  sg: '동남아', my: '동남아',
  in: '남아시아·중동', ae: '남아시아·중동', sa: '남아시아·중동', il: '남아시아·중동', tr: '남아시아·중동',
  uk: '유럽', de: '유럽', es: '유럽', pt: '유럽', it: '유럽', se: '유럽', ch: '유럽', fr: '유럽',
  ru: '유럽', nl: '유럽', pl: '유럽', at: '유럽', no: '유럽',
  us: '북미', ca: '북미', mx: '북미',
  br: '중남미', ar: '중남미', co: '중남미', cl: '중남미', pe: '중남미',
  ec: '중남미', bo: '중남미', py: '중남미', uy: '중남미',
  au: '오세아니아·태평양', nz: '오세아니아·태평양', gu: '오세아니아·태평양', sp: '오세아니아·태평양',
  id: '동남아', th: '동남아', ph: '동남아',
  za: '아프리카',
  global: '글로벌',
};
const CONT_ORDER = ['글로벌', '동아시아', '동남아', '남아시아·중동', '오세아니아·태평양',
                    '유럽', '북미', '중남미', '아프리카', '기타'];
function populateViews(sel, views) {
  sel.innerHTML = '';
  const groups = {};
  for (const v of views) {
    const cont = CONTINENT[v.key.split('_')[0]] || '기타';
    (groups[cont] = groups[cont] || []).push(v);
  }
  for (const cont of CONT_ORDER) {
    if (!groups[cont]) continue;
    const og = document.createElement('optgroup'); og.label = cont;
    for (const v of groups[cont]) {
      const o = document.createElement('option'); o.value = v.key; o.textContent = v.label;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
}
function populatePtype(types) {
  const sel = $('ptype'); sel.innerHTML = '';
  for (const p of META.property_types) {
    if (types && types.indexOf(p.key) < 0) continue;
    const o = document.createElement('option'); o.value = p.key; o.textContent = p.label;
    sel.appendChild(o);
  }
  // 기본 선택: 대표 유형(매매/주택가치) 우선
  const pref = ['apt_trade', 'us_zhvi', 'mx_home'].find(k => types && types.indexOf(k) >= 0);
  if (pref) sel.value = pref;
}
// ── 투자정보(규제·세금) ──
let INVEST = null, CUR_COUNTRY = 'kr';
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function md(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); }   // **강조** → <b>
function showInvest() {
  if (!INVEST) return;
  const c = INVEST.countries[CUR_COUNTRY];
  const box = $('invest');
  if (!c) { $('investName').textContent = '투자정보'; $('investBody').innerHTML =
    '<p class="hint">이 뷰(예: 글로벌)는 국가별 투자정보가 없습니다. 특정 국가 권역을 선택하세요.</p>';
    $('investDisc').textContent = ''; box.classList.remove('hidden'); return; }
  $('investName').textContent = '💰 ' + c.name + ' 부동산 투자정보';
  const rows = [['외국인 소유', c.own], ['취득세', c.acq], ['보유세', c.hold],
                ['양도세', c.cgt], ['임대소득세', c.rent], ['특이사항', c.note]];
  $('investBody').innerHTML =
    '<div class="ipill">🇺🇸 미국영주권자 공통: ' + md(INVEST.us_person_note) + '</div>' +
    rows.map(([k, v]) => `<div class="irow"><span class="ik">${k}</span><span class="iv">${md(v)}</span></div>`).join('');
  $('investDisc').textContent = '⚠️ ' + INVEST.disclaimer;
  box.classList.remove('hidden');
}

function applyView(key) {
  const v = VIEWS.find(x => x.key === key) || VIEWS[0];
  CUR_COUNTRY = (key || '').split('_')[0];        // 뷰 국가코드(투자정보 조회용)
  if (key !== 'global') {           // global 은 ptype/level 미사용(정규화 USD/㎡)
    populatePtype(v.types);
    $('level').value = v.level;
  }
  if (!$('invest').classList.contains('hidden')) showInvest();   // 열려있으면 갱신
  map.flyTo({ center: [v.lon, v.lat], zoom: v.zoom, pitch: key === 'global' ? 35 : 55,
              bearing: key === 'global' ? 0 : -12, duration: 1400 });
  if (GLOBE) globeGoTo(key === 'global' ? -172 : v.lon, key === 'global' ? 27 : v.lat,
                       key === 'global' ? 0.9 : m2g(v.zoom));
  loadCube();
}

// ── 초기화 ──
async function init() {
  META = await (await fetch(`${API}/api/meta`)).json();
  UNIT_BY_TYPE = {}; META.property_types.forEach(p => UNIT_BY_TYPE[p.key] = p.unit);
  VIEWS = META.views && META.views.length ? META.views
    : [{ key: 'kr', label: '대한민국', types: META.property_types.map(p => p.key), level: 'sigungu', lat: 36.2, lon: 127.7, zoom: 6.6 }];
  const vsel = $('view');
  populateViews(vsel, VIEWS);
  populatePtype(VIEWS[0].types);
  $('level').value = VIEWS[0].level;
  FRAME = 1e9;   // loadCube에서 최신 월로 클램프
  $('hsVal').textContent = '×' + $('hscale').value;

  $('view').onchange = (e) => { track('view', e.target.value); applyView(e.target.value); };
  $('ptype').onchange = () => {                          // 유형 선택 → 해당 국가로 자동 이동
    const p = $('ptype').value;
    const vk = p.startsWith('us_') ? 'us' : p === 'mx_home' ? 'mx' : 'kr';   // 유형→대표 권역
    const cur = ($('view').value || '').split('_')[0];
    if (cur !== vk && VIEWS.some((x) => x.key === vk)) {
      $('view').value = vk; applyView(vk);
      if ($('ptype').value !== p && [...$('ptype').options].some((o) => o.value === p)) {
        $('ptype').value = p; loadCube();
      }
    } else loadCube();
  };
  $('level').onchange = loadCube;
  $('metric').onchange = loadCube;
  $('hscale').oninput = () => { $('hsVal').textContent = '×' + $('hscale').value; render(); };
  $('wscale').oninput = () => { WSCALE = +$('wscale').value / 10; $('wsVal').textContent = '×' + WSCALE.toFixed(1); render(); };
  $('jdh').oninput = () => { JDH = +$('jdh').value / 10; $('jdhVal').textContent = '×' + JDH.toFixed(1); render(); };
  $('jdw').oninput = () => { JDW = +$('jdw').value / 10; $('jdwVal').textContent = '×' + JDW.toFixed(1); render(); };
  $('time').oninput = (e) => { stop(); FRAME = +e.target.value; render(); };
  $('play').onclick = () => PLAYING ? stop() : play();
  $('closeDetail').onclick = () => $('detail').classList.add('hidden');
  try { INVEST = await (await fetch(`${API}/api/invest`)).json(); } catch (e) { INVEST = null; }
  try { YIELDS = (await (await fetch(`${API}/api/yields`)).json()).yields || {}; } catch (e) { YIELDS = {}; }
  try { POI = await (await fetch(`${API}/api/poi`)).json(); } catch (e) { POI = null; }
  $('tourBtn').classList.toggle('on', SHOWTOUR);
  $('eduBtn').classList.toggle('on', SHOWEDU);
  $('tourBtn').onclick = () => { SHOWTOUR = !SHOWTOUR; track('toggle_tour', SHOWTOUR); $('tourBtn').classList.toggle('on', SHOWTOUR); render(); };
  $('eduBtn').onclick = () => { SHOWEDU = !SHOWEDU; $('eduBtn').classList.toggle('on', SHOWEDU); render(); };
  $('hospBtn').classList.toggle('on', SHOWHOSP);
  $('hospBtn').onclick = () => { SHOWHOSP = !SHOWHOSP; $('hospBtn').classList.toggle('on', SHOWHOSP); render(); };
  $('mallBtn').classList.toggle('on', SHOWMALL);
  $('mallBtn').onclick = () => { SHOWMALL = !SHOWMALL; $('mallBtn').classList.toggle('on', SHOWMALL); render(); };
  $('jobsBtn').classList.toggle('on', SHOWJOBS);
  $('jobsBtn').onclick = () => { SHOWJOBS = !SHOWJOBS; $('jobsBtn').classList.toggle('on', SHOWJOBS); render(); };
  $('clubBtn').classList.toggle('on', SHOWCLUB);
  $('clubBtn').onclick = () => { SHOWCLUB = !SHOWCLUB; $('clubBtn').classList.toggle('on', SHOWCLUB); render(); };
  $('airBtn').classList.toggle('on', SHOWAIR);
  $('airBtn').onclick = () => { SHOWAIR = !SHOWAIR; $('airBtn').classList.toggle('on', SHOWAIR); track('toggle', 'air:' + SHOWAIR); render(); };
  $('bikeBtn').onclick = async () => {                     // 데이터가 크므로 첫 켤 때만 로드
    SHOWBIKE = !SHOWBIKE;
    $('bikeBtn').classList.toggle('on', SHOWBIKE);
    track('toggle', 'bike:' + SHOWBIKE);
    if (SHOWBIKE && !BIKE) {
      setStatus('🚲 자전거 루트 로딩…');
      try { BIKE = await (await fetch(`${API}/api/bike`)).json(); } catch (e) { BIKE = null; }
      setStatus(BIKE && BIKE.features && BIKE.features.length
        ? `🚲 상시 ${BIKE.meta.permanent_km}km · 일요일 통제축(08~14시) 표시 — 멕시코시티로 이동하세요`
        : '자전거 데이터를 불러오지 못했습니다');
    }
    render();
  };
  $('globeBtn').onclick = () => setGlobe(!GLOBE);
  $('rentBtn').onclick = () => {
    RENT = !RENT; $('rentBtn').classList.toggle('on', RENT);
    $('rentBtn').textContent = RENT ? '🏠 렌탈(월세)' : '💵 매매';
    loadCube();
  };
  $('investBtn').onclick = () => {
    const box = $('invest');
    if (box.classList.contains('hidden')) showInvest(); else box.classList.add('hidden');
  };
  $('closeInvest').onclick = () => $('invest').classList.add('hidden');
  try { const sd = await (await fetch(`${API}/api/sizes`)).json(); SIZES = sd.sizes || []; SIZEIDX = sd.default || 0; }
  catch (e) { SIZES = []; }
  const ssel = $('size');
  SIZES.forEach((s, i) => { const o = document.createElement('option'); o.value = i;
    o.textContent = `${s.name} · ${s.family}(${s.m2}㎡)`; ssel.appendChild(o); });
  ssel.value = SIZEIDX;
  ssel.onchange = (e) => { SIZEIDX = +e.target.value; loadCube(); };

  // 공유/모바일 진입 URL: ?view=global&globe=1 (글로브는 뷰 적용 전에 켜야 글로브 카메라가 뷰를 따라감)
  const qp = new URLSearchParams(location.search);
  if (qp.get('globe') === '1') setGlobe(true);
  const qv = qp.get('view');
  if (qv && VIEWS.find((v) => v.key === qv)) { $('view').value = qv; applyView(qv); }
  else await loadCube();
  refreshNas(); setInterval(refreshNas, 60000);          // NAS 용량(60초)
  $('schedBtn').onclick = toggleSched;                   // 수집 스케줄러 on/off(모바일 공용)
  refreshSched(); setInterval(refreshSched, 60000);
  // 검색창: 입력=자동완성(250ms 디바운스), Enter=최상 후보(없으면 온라인 폴백)
  const sb = $('searchBox'), shd = $('searchHits');
  sb.oninput = () => {
    clearTimeout(SRCH_T);
    const q = sb.value.trim();
    if (q.length < 2) { shd.classList.add('hidden'); return; }
    SRCH_T = setTimeout(async () => {
      const hits = (await searchSuggest(q, false)).slice(0, 6);
      // 동명이지(Vista Hermosa 등)가 여러 건 나오므로 도시명을 함께 보여 구분
      shd.innerHTML = hits.map((h) =>
        `<div class="srow">${esc(h.name)}<span>[${esc(h.kind)}]${
          h.ctx ? ' · ' + esc(h.ctx) : ''}</span></div>`).join('');
      shd.classList.toggle('hidden', !hits.length);
      shd.querySelectorAll('.srow').forEach((el, i) => { el.onclick = () => searchGo(hits[i]); });
    }, 250);
  };
  // [/] 로 검색창 포커스(네이티브 시뮬레이터와 동일한 진입 키). 입력 중일 때는 통과.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    sb.focus(); sb.select();
    setStatus('검색 — 쉼표로 여러 곳을 넣으면 후보 비교(예: 인터로마스, 폴랑코)');
  });
  sb.onkeydown = async (e) => {
    if (e.key === 'Escape') { sb.blur(); return; }
    if (e.key !== 'Enter') return;
    const q = sb.value.trim(); if (!q) return;
    // "인터로마스, 폴랑코" 처럼 후보를 여러 개 넣으면 비교 모드
    if (/(,|\s\/\s|\bvs\.?\b|대비)/i.test(q)) { await showCompare(q); return; }
    let hits = await searchSuggest(q, false);
    if (!hits.length) { setStatus('🌐 온라인 장소 검색 중…'); hits = await searchSuggest(q, true); }
    if (hits.length) { setStatus(''); searchGo(hits[0]); }
    else setStatus('검색 결과 없음: ' + q);
  };
  // 로그인 상태 표시 + 모달
  const uBtn = $('userBtn');
  const setUserUi = () => { uBtn.textContent = USERNAME ? ('👤 ' + USERNAME) : '👤 로그인'; };
  setUserUi();
  uBtn.onclick = async () => {
    if (USERNAME) {
      if (confirm(USERNAME + ' 로그아웃?')) {
        await fetch(`${API}/api/auth/logout`, { method: 'POST', headers: authHdr() }).catch(() => {});
        TOKEN = ''; USERNAME = ''; localStorage.removeItem('re3d_token'); localStorage.removeItem('re3d_user');
        setUserUi();
      }
      return;
    }
    const u = prompt('사용자명 (신규면 자동 가입):'); if (!u) return;
    const p = prompt('비밀번호 (4자+):'); if (!p) return;
    let r = await (await fetch(`${API}/api/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json();
    if (!r.ok) r = await (await fetch(`${API}/api/auth/register`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json();
    if (r.ok) { TOKEN = r.token; USERNAME = r.username;
      localStorage.setItem('re3d_token', TOKEN); localStorage.setItem('re3d_user', USERNAME);
      setUserUi(); track('login_ui', USERNAME);
    } else alert(r.error || '실패');
  };
  // A/B: POI 기본 표시 밀도(B=핵심만) — 해시 고정 배정
  try {
    const ab = await (await fetch(`${API}/api/ab?exp=poi_density`, { headers: authHdr() })).json();
    if (ab.ok) { AB.poi_density = ab.variant;
      if (ab.variant === 'B') { SHOWTOUR = SHOWMALL = SHOWCLUB = SHOWJOBS = false;
        ['tourBtn','mallBtn','clubBtn','jobsBtn'].forEach(id => $(id).classList.remove('on')); render(); }
    }
  } catch (e) { /* 무시 */ }
  track('session_start', navigator.userAgent.slice(0, 60));
}
// ── 주소·명소 검색(네이티브 [/]와 동일 인덱스 + 온라인 폴백) ──
let SRCH_T = 0, SEARCH_MARKER = null;
function searchGo(h) {
  try {
  $('searchHits').classList.add('hidden');
  $('searchBox').blur();
  clearCompareMap();                          // 단일 검색으로 돌아오면 비교 표시 제거
  if (GLOBE) setGlobe(false);                 // 상세 확인은 평면 지도에서
  if (SEARCH_MARKER) SEARCH_MARKER.remove();
  let html = `<b>${esc(h.name)}</b> <span style="opacity:.65">[${esc(h.kind)}]</span>`;
  if (h.area) {                               // 최근접 주거단지 프로필(장단점) — 네이티브 스팟 패널 대응
    const a = h.area;
    html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(0,0,0,.15);max-width:250px">
      <div style="color:#7a5c00;font-weight:700">🏘 ${esc(a.name)} (${esc(a.kind)})${a.km > 0.5 ? ` · ${a.km}km` : ''}</div>
      <div style="font-size:11px;color:#555;margin:2px 0">${esc(a.note)}</div>
      <div style="font-size:11.5px;color:#1a7a2e"><b>장점</b> ${esc(a.pros)}</div>
      <div style="font-size:11.5px;color:#b45f06"><b>단점</b> ${esc(a.cons)}</div>
    </div>`;
  }
  SEARCH_MARKER = new maplibregl.Marker({ color: '#ffd54f' })
    .setLngLat([h.lon, h.lat])
    .setPopup(new maplibregl.Popup({ closeOnClick: false, offset: 24, maxWidth: '280px' })
      .setHTML(html))
    .addTo(map);
  SEARCH_MARKER.togglePopup();                // 캡션 항상 표시(시인성)
  const z = (h.kind === '지역' || h.kind === '도시') ? 11.5 : 14.5;
  map.flyTo({ center: [h.lon, h.lat], zoom: z, pitch: 55, bearing: -12, duration: 1600 });
  if (h.access) showAccess(h);                // 거점 접근성(거리·수단별 시간) 패널
  track('search', h.name);
  } catch (e) { setStatus('검색 이동 실패: ' + e.message); }
}
// 검색 지점 접근성 패널(#detail 재사용) — 네이티브 거점 접근성 패널의 웹 대응
function showAccess(h) {
  const d = $('detail'); d.classList.remove('hidden');
  $('detailName').textContent = '📍 ' + h.name;
  const fm = (m) => m == null ? '-' : (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}분`);
  // 홈페이지가 있으면 이름을 클릭 가능한 링크로, 사진이 있으면 썸네일을 곁들인다
  const nameCell = (s) => {
    const nm = s.web
      ? `<a href="${esc(s.web)}" target="_blank" rel="noopener noreferrer"
            style="color:#cfe3ff;text-decoration:underline dotted">${esc(s.name)}</a>`
      : esc(s.name);
    const th = s.img
      ? `<img src="${esc(s.img)}" alt="" loading="lazy" onerror="this.style.display='none'"
             style="width:34px;height:24px;object-fit:cover;border-radius:3px;flex:none">` : '';
    return `<span style="min-width:0;display:flex;align-items:center;gap:5px">${th}
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nm}</span></span>`;
  };
  const rows = (h.access.spots || []).map((s) =>
    `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:4px 0;border-top:1px solid rgba(255,255,255,.08)">
       <span style="min-width:0;display:flex;gap:4px;align-items:center">${nameCell(s)}
         <span style="color:#7fa8d9;font-size:10.5px;flex:none">[${esc(s.cat)}]</span></span>
       <span style="white-space:nowrap;color:#cfe3ff">${s.km}km · 🚶${fm(s.walk)} · 🚗${fm(s.car)} · 🚌${fm(s.tr)}</span>
     </div>`).join('');
  // 통학 전용 섹션 — 주재원은 학교를 보고 집을 고르므로 거점 상한에 밀리지 않게 따로 보여준다
  const sch = h.access.schools || [];
  const schHtml = sch.length ? `
    <div style="margin-top:10px;border-top:1px solid rgba(255,255,255,.15);padding-top:6px">
      <div style="color:#7fd0ff;font-weight:700;font-size:12.5px">🎓 통학 거리(초중고·국제학교)</div>
      ${sch.map((s) => `
        <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:3px 0">
          ${nameCell(s)}
          <span style="white-space:nowrap;color:#cfe3ff">${s.km}km · 🚶${fm(s.walk)} · 🚗${fm(s.car)} · 🚌${fm(s.tr)}</span>
        </div>`).join('')}
    </div>` : '';
  const areaHtml = h.area ? `
    <div style="margin-top:10px;border-top:1px solid rgba(255,255,255,.15);padding-top:6px">
      <div style="color:#7fd0ff;font-weight:700;font-size:12.5px">🏘 ${esc(h.area.name)} (${esc(h.area.kind)})</div>
      <div style="font-size:11px;color:#93a4bd;margin:2px 0">${esc(h.area.note)}</div>
      <div style="font-size:11.5px;color:#8ee89a"><b>장점</b> ${esc(h.area.pros)}</div>
      <div style="font-size:11.5px;color:#f5b46e"><b>단점</b> ${esc(h.area.cons)}</div>
    </div>` : '';
  $('detailStat').innerHTML = `
    <div style="grid-column:1/3">
      ${h.access.label ? `<div style="font-size:11px;color:#93a4bd;margin-bottom:4px">교통환경: ${esc(h.access.label)}</div>` : ''}
      <div style="font-size:11px;color:#7fa8d9">거점 [유형] — 거리 · 🚶도보 · 🚗차량 · 🚌대중교통</div>
      ${rows}${schHtml}${areaHtml}
      <div style="font-size:10.5px;color:#6f8099;margin-top:6px">※ 교통환경 기반 근사치</div>
    </div>`;
  $('chart').innerHTML = '';                  // 시계열 차트 영역은 비움(지역 클릭 시 사용)
}
// 후보 여러 곳 비교 — 지도에는 전 후보 마커를 찍고 전체가 보이게 맞춘 뒤,
// 패널에 접근성 표 + 후보 간 거리 + 장단점을 나란히 놓는다.
let CMP_MARKERS = [];
const CMP_SRC = 'cmp-lines';
// 네이티브 비교 마커와 같은 팔레트 — 패널 번호와 지도 마커를 눈으로 잇기 위함
const CMP_COLORS = ['#ffb829', '#5cc7ff', '#8ce673', '#f585cc', '#ccadff'];
function clearCompareMap() {
  CMP_MARKERS.forEach((m) => m.remove());
  CMP_MARKERS = [];
  for (const id of [CMP_SRC + '-lbl', CMP_SRC + '-line'])
    if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(CMP_SRC)) map.removeSource(CMP_SRC);
}
async function showCompare(q) {
  setStatus('⚖️ 후보 비교 중…');
  let d;
  try { d = await (await fetch(`${API}/api/compare?q=${encodeURIComponent(q)}&online=1`)).json(); }
  catch (e) { setStatus('비교 실패'); return; }
  if (!d.ok) { setStatus(d.error || '비교할 수 없습니다'); return; }
  const ok = d.items.filter((i) => i.found);
  if (ok.length < 2) { setStatus('찾은 후보가 2곳 미만입니다'); return; }
  setStatus('');
  track('compare', q);

  clearCompareMap();
  if (GLOBE) setGlobe(false);
  const bnd = new maplibregl.LngLatBounds();
  ok.forEach((i, n) => {
    const el = document.createElement('div');
    el.textContent = String(n + 1);
    el.style.cssText = `width:26px;height:26px;border-radius:50%;background:${CMP_COLORS[n % 5]};`
      + 'color:#10151d;font:700 14px/26px system-ui;text-align:center;border:2px solid #fff;'
      + 'box-shadow:0 0 0 2px rgba(0,0,0,.45);cursor:pointer';
    CMP_MARKERS.push(new maplibregl.Marker({ element: el }).setLngLat([i.lon, i.lat])
      .setPopup(new maplibregl.Popup({ offset: 14 }).setText(`${n + 1}. ${i.name}`)).addTo(map));
    bnd.extend([i.lon, i.lat]);
  });
  // 후보를 잇는 선 + 중점 거리 라벨(네이티브 비교 화면과 동일한 시각 언어)
  const feats = d.pairs.map((p) => {
    const a = ok.find((x) => x.name === p.a), b = ok.find((x) => x.name === p.b);
    return a && b ? { type: 'Feature', properties: { km: `${p.km}km` },
      geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } } : null;
  }).filter(Boolean);
  map.addSource(CMP_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: feats } });
  map.addLayer({ id: CMP_SRC + '-line', type: 'line', source: CMP_SRC,
    paint: { 'line-color': '#9fb4d6', 'line-width': 1.8, 'line-dasharray': [2, 1.6],
             'line-opacity': 0.85 } });
  map.addLayer({ id: CMP_SRC + '-lbl', type: 'symbol', source: CMP_SRC,
    layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'km'],
              'text-size': 12, 'text-allow-overlap': false },
    paint: { 'text-color': '#dce9ff', 'text-halo-color': '#0b1018', 'text-halo-width': 1.6 } });
  map.fitBounds(bnd, { padding: 90, maxZoom: 13, duration: 900 });

  const fm = (m) => m == null ? '-' : (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}분`);
  // 각 지표의 최적값을 굵게 — 표를 훑기만 해도 우열이 보이게
  const best = (vals) => Math.min(...vals.filter((v) => v != null));
  const apC = best(ok.map((i) => i.airport && i.airport.car));
  const scC = best(ok.map((i) => i.school_avg_car));
  const cell = (v, isBest, txt) => `<td style="padding:4px 6px;text-align:right;white-space:nowrap;${
    isBest ? 'color:#8ee89a;font-weight:700' : 'color:#cfe3ff'}">${txt}</td>`;
  const head = ok.map((i, n) => `<th style="padding:4px 6px;text-align:right;color:#ffd54f;
      font-size:11.5px;white-space:nowrap">${n + 1}. ${esc(i.name)}</th>`).join('');
  // 레이블 칸은 반드시 nowrap — 안 그러면 좁은 패널에서 한 글자씩 세로로 쪼개진다
  const lbl = (t) => `<td style="padding:4px 6px;color:#7fa8d9;white-space:nowrap">${t}</td>`;
  const rowAir = ok.map((i) => cell(0, i.airport && i.airport.car === apC,
    i.airport ? `${i.airport.km}km · 🚗${fm(i.airport.car)}` : '-')).join('');
  const rowSch = ok.map((i) => cell(0, i.school_avg_car === scC,
    i.school_avg_car != null ? `${i.school_n}곳 · 🚗${fm(i.school_avg_car)}` : '-')).join('');
  const rowHos = ok.map((i) => cell(0, false,
    i.hospital ? `${i.hospital.km}km · 🚗${fm(i.hospital.car)}` : '-')).join('');
  const rowLbl = ok.map((i) => cell(0, false, esc(i.label || '-'))).join('');
  // 월세는 낮을수록 유리 — 최저가에 초록 강조
  const rentVals = ok.map((i) => i.rent && i.rent.rent_usd).filter((v) => v);
  const bestRent = rentVals.length ? Math.min(...rentVals) : null;
  const rowRent = ok.map((i) => cell(0, i.rent && i.rent.rent_usd === bestRent,
    i.rent ? `$${i.rent.rent_usd.toLocaleString()}/월` : '-')).join('');
  const rowBuy = ok.map((i) => cell(0, false,
    i.rent ? `$${Math.round(i.rent.buy_usd / 1000).toLocaleString()}k` : '-')).join('');

  const prosCons = ok.map((i, n) => i.area ? `
    <div style="margin-top:8px;border-top:1px solid rgba(255,255,255,.12);padding-top:5px">
      <div style="color:#7fd0ff;font-weight:700;font-size:12px">${n + 1}. ${esc(i.area.name)} (${esc(i.area.kind)})</div>
      <div style="font-size:11.5px;color:#8ee89a"><b>장점</b> ${esc(i.area.pros)}</div>
      <div style="font-size:11.5px;color:#f5b46e"><b>단점</b> ${esc(i.area.cons)}</div>
    </div>` : `
    <div style="margin-top:8px;font-size:11.5px;color:#93a4bd">${n + 1}. ${esc(i.name)} — 등록된 주거 프로필 없음</div>`).join('');

  const miss = d.items.filter((i) => !i.found).map((i) => esc(i.query));
  const d1 = $('detail'); d1.classList.remove('hidden');
  $('detailName').textContent = '⚖️ 후보 비교 — ' + ok.map((i) => i.name).join(' vs ');
  $('detailStat').innerHTML = `
    <div style="grid-column:1/3">
      <div style="overflow-x:auto">
        <table style="border-collapse:collapse;font-size:12px;min-width:100%">
          <tr><th></th>${head}</tr>
          <tr>${lbl('💵 월세(100㎡ 추정)')}${rowRent}</tr>
          <tr>${lbl('🏠 매매가(100㎡)')}${rowBuy}</tr>
          <tr>${lbl('✈️ 공항')}${rowAir}</tr>
          <tr>${lbl('🎓 학교(3곳 평균)')}${rowSch}</tr>
          <tr>${lbl('🏥 병원')}${rowHos}</tr>
          <tr>${lbl('🚦 교통환경')}${rowLbl}</tr>
        </table>
      </div>
      <div style="margin-top:8px;font-size:11.5px;color:#7fa8d9">📍 후보 간 직선거리</div>
      ${d.pairs.map((p) => `<div style="font-size:12px;color:#cfe3ff">${esc(p.a)} ↔ ${esc(p.b)} —
        <b>${p.km}km</b></div>`).join('')}
      ${prosCons}
      ${miss.length ? `<div style="margin-top:6px;font-size:11px;color:#f5b46e">찾지 못함: ${miss.join(', ')}</div>` : ''}
      <div style="font-size:10.5px;color:#6f8099;margin-top:6px">※ 초록 = 해당 항목 최우수(월세는 최저가) ·
        시간은 교통환경 기반 근사치 · 월세/매매가는 <b>최근접 지역 평균</b>에서 도출한 추정치로
        단지별 실거래와 다를 수 있음</div>
    </div>`;
  $('chart').innerHTML = '';
}
async function searchSuggest(q, online) {
  try {
    const r = await (await fetch(`${API}/api/geocode?q=${encodeURIComponent(q)}${online ? '&online=1' : ''}`)).json();
    return r.hits || [];
  } catch (e) { return []; }
}

// ── 백그라운드 수집 스케줄러 on/off(모바일·PC 공용 컨트롤) ──
let SCHED_ON = null;
async function refreshSched() {
  try {
    const s = await (await fetch(`${API}/api/scheduler`)).json();
    SCHED_ON = !!s.running;
    const b = $('schedBtn'); if (!b) return;
    b.classList.toggle('on', SCHED_ON);
    b.textContent = SCHED_ON ? '⚙️ 수집 ON' : '⚙️ 수집 OFF';
  } catch (e) { /* 무시 */ }
}
async function toggleSched() {
  const to = SCHED_ON ? 'stop' : 'start';
  if (!confirm(`백그라운드 수집 스케줄러를 ${to === 'stop' ? '중지' : '시작'}할까요?\n(실시간 수집·export·NAS 백업${to === 'stop' ? '이 멈춥니다' : '을 재개합니다'})`)) return;
  try {
    const r = await (await fetch(`${API}/api/scheduler`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHdr() },
      body: JSON.stringify({ action: to }) })).json();
    if (r.ok === false) alert(r.error || '실패');
    track('scheduler', to);
  } catch (e) { alert('제어 실패 — 외부(원격) 접속은 로그인이 필요합니다'); }
  setTimeout(refreshSched, 1200);
}
async function refreshNas() {
  try {
    const n = await (await fetch(`${API}/api/nas`)).json();
    const el = $('nasLine');
    if (!el) return;
    let line = n.ok
      ? `NAS 사용 ${n.used_tb}TB · 여유 ${n.free_tb}TB / 총 ${n.total_tb}TB (${n.used_pct}%) · 이 시뮬 ${n.sim_gb}GB(${n.sim_pct_of_used}%)`
      : 'NAS: 연결 안 됨';
    try {                                   // 현재 셀룰러(공개) URL — 터널 재기동으로 바뀌어도 최신 표시
      const r = await (await fetch(`${API}/api/remote`)).json();
      if (r.url && location.hostname !== new URL(r.url).hostname)
        line += `\n📱 셀룰러 URL: ${r.url}`;
    } catch (e) { /* 무시 */ }
    el.style.whiteSpace = 'pre-line';
    el.textContent = line;
  } catch (e) { /* 무시 */ }
}
// ── 플로팅 패널 드래그 이동(모바일에서 정보 패널·시간 막대가 화면을 가릴 때 옮겨두기) ──
// 패널은 CSS로 배치돼(top/left 또는 timebar의 left:50%+translateX 중앙정렬) 있으므로,
// 드래그가 시작되면 그 순간의 화면상 위치를 px로 고정해(transform·right·bottom 해제)
// 자유 이동시키고 localStorage에 남겨 재접속해도 유지한다. 전용 손잡이에서만 시작되므로
// 슬라이더 드래그·버튼 클릭 등 기존 조작과 겹치지 않는다.
function makeDraggable(panel, handle, storeKey) {
  function lockWidth() {                              // right/transform 해제 시 리플로우로 폭이 바뀌는 것 방지
    if (!panel.style.width) panel.style.width = panel.getBoundingClientRect().width + 'px';
  }
  function clamp(left, top) {
    const w = panel.offsetWidth, h = panel.offsetHeight, vis = 48;   // 최소 이만큼은 화면에 남긴다
    return [Math.min(Math.max(left, vis - w), window.innerWidth - vis),
            Math.min(Math.max(top, 0), window.innerHeight - vis)];
  }
  function place(left, top) {
    [left, top] = clamp(left, top);
    Object.assign(panel.style, { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto', transform: 'none' });
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) || 'null');
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) { lockWidth(); place(saved.left, saved.top); }
  } catch (e) { /* 무시 */ }
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 비활성 포인터 등 — 무시하고 계속 */ }
    lockWidth();
    const r = panel.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (dragging) place(ox + (e.clientX - sx), oy + (e.clientY - sy));
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    try { localStorage.setItem(storeKey, JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop })); }
    catch (e) { /* 무시 */ }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}
makeDraggable($('panel'), $('panelHandle'), 're3d_panel_pos');
makeDraggable($('timebar'), $('timebarHandle'), 're3d_timebar_pos');

// PWA 서비스워커(모바일 홈화면 설치)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
map.on('load', init);
