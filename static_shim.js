'use strict';
// 정적 모드 fetch 인터셉터 — app.js 무수정으로 서버 없이 동작(PC-off 열람용).
// index.html(정적 빌드)이 window.RE3D_STATIC=true 와 함께 app.js보다 먼저 로드한다.
// /api/* 호출을 정적 JSON 파일 또는 클라이언트 계산(검색·접근성·시계열)으로 대체.
(function () {
  if (!window.RE3D_STATIC) return;
  const realFetch = window.fetch.bind(window);
  const cache = {};
  async function file(name) {
    if (!(name in cache)) cache[name] = await (await realFetch('api/' + name)).json();
    return cache[name];
  }
  const J = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' } });

  const hav = (la1, lo1, la2, lo2) => {
    const r = Math.PI / 180, p1 = la1 * r, p2 = la2 * r;
    const dp = (la2 - la1) * r, dl = (lo2 - lo1) * r;
    return 6371 * 2 * Math.asin(Math.sqrt(
      Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2));
  };

  const toks = (s) => s.split(/[^0-9a-z가-힣]+/).filter(Boolean);

  function score(nf, qf, qtok) {                            // 서버 _score 와 동일 규칙
    if (nf === qf) return [5, nf.length];
    // 단어 단위로 끊기는 접두를 우선 — "cumbe"는 "Cumbe Coffee"가 "Cumberland"보다 맞다
    if (nf.startsWith(qf))
      return [(nf.length === qf.length || !/[0-9a-z가-힣]/.test(nf[qf.length])) ? 4 : 3, nf.length];
    if (nf.includes(qf)) return [2, nf.length];
    if (nf.length >= 5 && qf.includes(nf)) {
      let aligned = qtok.includes(nf);                      // 단어 경계에 맞는가
      for (let i = 0; !aligned && i < qtok.length; i++)
        for (let j = i + 2; !aligned && j <= qtok.length; j++)
          if (qtok.slice(i, j).join(' ') === nf) aligned = true;
      // 질의 과반을 덮어야 인정 — 'puerta de lagos'가 나이지리아 Lagos를 물던 오답 차단
      if (aligned && nf.length / Math.max(qf.length, 1) >= 0.55)
        return [1, 100 - Math.min(nf.length, 99)];
    }
    const ntok = new Set(toks(nf));                         // 토큰 전부 포함(어순 무관)
    if (qtok.length >= 2 && ntok.size && qtok.every((t) => t.length < 3 || ntok.has(t)))
      return [1, 200 + nf.length];
    // 토큰 접두 허용 — 단수/복수·어미 차이("fuente"→"Fuentes de las Lomas") 흡수.
    // 어순까지 같으면 우선(안 그러면 'Lomas de las Fuentes'가 먼저 잡힌다).
    const nlist = toks(nf);
    const need = qtok.filter((t) => t.length >= 3);
    if (qtok.length >= 2 && nlist.length && need.length
        && need.every((t) => nlist.some((n2) => n2.startsWith(t)))) {
      let j = 0, ordered = true;
      for (const t of need) {
        while (j < nlist.length && !nlist[j].startsWith(t)) j++;
        if (j >= nlist.length) { ordered = false; break; }
        j++;
      }
      return [1, (ordered ? 300 : 400) + nf.length];
    }
    return [0, 0];
  }

  async function geocode(q, online) {                       // 서버 /api/geocode 클라이언트판
    const idx = await file('geo_index.json');
    const qf = q.trim().toLowerCase();
    const qtok = toks(qf);
    const sc = [];
    for (let i = 0; i < idx.length; i++) {
      const [s, tie] = score(idx[i][0].toLowerCase(), qf, qtok);
      if (s) sc.push([-s * 1000 + tie, i]);
    }
    sc.sort((a, b) => a[0] - b[0]);
    const seen = new Set(), hits = [];
    for (const [, i] of sc) {
      // 좌표까지 포함해 중복 판정 — 동명이지가 하나로 뭉개지지 않게(서버와 동일)
      const [n, k, la, lo, ctx] = idx[i], key = n + '|' + k + '|' + la.toFixed(2) + '|' + lo.toFixed(2);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ name: n, kind: k, lat: la, lon: lo, ctx: ctx || '' });
      if (hits.length >= 8) break;
    }
    // 최상 히트가 약한 매칭(토큰 일치)뿐이면 온라인 결과를 앞세운다 — 로컬 근사치가
    // 폴백을 막아 엉뚱한 곳으로 보내던 문제 방지.
    // 주의: JS의 %는 음수 피제수의 부호를 그대로 따른다(파이썬은 항상 비음수) — sc[0][0]은
    // 늘 음수라 그냥 %만 쓰면 이 조건이 사실상 항상 거짓이 된다. 부호 보정 필수.
    const weak = sc.length > 0 && Math.floor(-sc[0][0] / 1000) <= 1
      && (((sc[0][0] % 1000) + 1000) % 1000) >= 200;
    if ((!hits.length || weak) && online) {                 // Nominatim은 CORS 허용 — 브라우저 직접
      try {
        const d = await (await realFetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ko&q='
          + encodeURIComponent(q))).json();
        if (d.length) {
          const h = { name: (d[0].display_name || q).split(',')[0], kind: '온라인',
                      lat: +d[0].lat, lon: +d[0].lon };
          weak ? hits.unshift(h) : hits.push(h);
        }
      } catch (e) { /* 오프라인 */ }
    }
    if (hits.length) {                                      // 프로필 + 접근성 첨부(서버와 동일 규칙)
      const h0 = hits[0];
      const areas = await file('areas.json');
      let best = 12, ba = null;
      for (const a of areas) { const d = hav(h0.lat, h0.lon, a.lat, a.lon); if (d < best) { best = d; ba = a; } }
      if (ba) h0.area = { ...ba, km: Math.round(best * 10) / 10 };
      h0.access = await access(h0.lat, h0.lon);
    }
    return { ok: true, hits };
  }

  async function access(lat, lon) {                         // 서버 _access 클라이언트판
    const idx = await file('geo_index.json');
    const traffic = await file('traffic.json');
    const hubcc = await file('hubcc.json');
    let links = {};
    try { links = await file('links.json'); } catch (e) { /* 링크 없는 구버전 스냅샷 */ }
    let cc = 'us', best = 1e18;
    for (const [c, la, lo] of hubcc) { const d = hav(lat, lon, la, lo); if (d < best) { best = d; cc = c; } }
    const [city, hwy, tf, label] = traffic[cc] || [25, 90, 1.3, ''];
    const times = (d) => {
      const rd = d * 1.35;
      const walk = rd / 4.5 * 60 <= 240 ? Math.round(rd / 4.5 * 60) : null;
      const car = Math.round((Math.min(rd, 8) / city + Math.max(Math.min(rd, 22) - 8, 0) / ((city + hwy) / 2)
                   + Math.max(rd - 22, 0) / hwy) * 60 + 5);
      return [walk, car, Math.round(car * tf + 12)];
    };
    const cand = [];
    const aps = [];                                         // 공항은 거리 제한 없이 별도 탐색(서버와 동일)
    for (const [n, k, la, lo] of idx) {
      if (k === '공항') aps.push([hav(lat, lon, la, lo), n, la, lo]);
      if (k === '도시' || k === '지역' || k === '주거' || k === '동네' || k === '온라인') continue;
      const d = hav(lat, lon, la, lo);
      if (d < 60) cand.push([d, n, k, la, lo]);              // 60km 이내 공항은 일반 후보에도 남긴다
    }
    cand.sort((a, b) => a[0] - b[0]);
    aps.sort((a, b) => a[0] - b[0]);
    const spots = [], catn = {}, seen = new Set(), picked = [];
    if (aps.length) {
      const [d, n, la, lo] = aps[0], [w, cr, tr] = times(d);
      spots.push({ name: n, cat: '공항', km: Math.round(d * 10) / 10, walk: w, car: cr, tr });
      seen.add(n); catn['공항'] = 1; picked.push([la, lo]);
    }
    for (const [d, n, k, la, lo] of cand) {
      if (spots.length >= 11) break;
      if (seen.has(n) || (catn[k] || 0) >= 2 || d < 0.05) continue;
      if ([...seen].some((sn) => n.startsWith(sn) || sn.startsWith(n))) continue;
      if (picked.some(([pl, po]) => hav(la, lo, pl, po) < 1)) continue;
      const [w, cr, tr] = times(d);
      spots.push({ name: n, cat: k, km: Math.round(d * 10) / 10, walk: w, car: cr, tr,
                   ...(links[n] || {}) });                // 홈페이지·사진(호버/상세 카드)
      seen.add(n); catn[k] = (catn[k] || 0) + 1; picked.push([la, lo]);
    }
    // 통학 전용 목록(서버와 동일) — 카테고리 상한에 밀려 학교가 사라지지 않게
    const schools = [], sseen = new Set();
    for (const [d, n, k] of cand) {
      if (k !== '학교' || sseen.has(n) || d < 0.05) continue;
      sseen.add(n);
      const [w, cr, tr] = times(d);
      schools.push({ name: n, km: Math.round(d * 10) / 10, walk: w, car: cr, tr,
                     ...(links[n] || {}) });
      if (schools.length >= 6) break;
    }
    return spots.length ? { label, spots, schools } : null;
  }

  async function rentAt(lat, lon, m2 = 100) {               // 서버 _rent_at 클라이언트판
    let regs;
    try { regs = (await file('region_prices.json')).regions; } catch (e) { return null; }
    let best = null, bd = 1e18;
    for (const r of regs) {                                 // [lat, lon, usd/㎡, 수익률%]
      const d = hav(lat, lon, r[0], r[1]);
      if (d < bd) { bd = d; best = r; }
    }
    if (!best || bd > 60) return null;                      // 60km 넘으면 대표성 없음
    const buy = best[2] * m2;
    return { usd_m2: best[2], buy_usd: Math.round(buy),
             rent_usd: Math.round(buy * best[3] / 1200), yield: best[3], m2,
             km: Math.round(bd * 10) / 10 };
  }

  async function compare(q, online) {                       // 서버 /api/compare 클라이언트판
    const parts = q.split(/\s*(?:,|\/|\bvs\.?\b|대비|versus)\s*/i)
      .map((s) => s.trim()).filter(Boolean).slice(0, 8);
    if (parts.length < 2)
      return { ok: false, error: '후보를 2곳 이상 입력하세요(쉼표 또는 vs 로 구분)' };
    const items = [];
    for (const p of parts) {
      const h = (await geocode(p, online)).hits[0];
      if (!h) { items.push({ query: p, found: false }); continue; }
      const ac = h.access || {}, sp = ac.spots || [], sch = ac.schools || [];
      items.push({
        query: p, found: true, name: h.name, kind: h.kind, lat: h.lat, lon: h.lon,
        ctx: h.ctx || '', area: h.area || null, label: ac.label || '',
        airport: sp.find((s) => s.cat === '공항') || null,
        hospital: sp.find((s) => s.cat === '병원') || null,
        schools: sch.slice(0, 3), school_n: sch.length,
        rent: await rentAt(h.lat, h.lon),                   // 월세·매매가 추정(100㎡)
        school_avg_car: sch.length
          ? Math.round(sch.slice(0, 3).reduce((a, s) => a + s.car, 0) / Math.min(3, sch.length))
          : null,
      });
    }
    const ok = items.filter((i) => i.found), pairs = [];
    for (let i = 0; i < ok.length; i++)
      for (let j = i + 1; j < ok.length; j++)
        pairs.push({ a: ok[i].name, b: ok[j].name,
                     km: Math.round(hav(ok[i].lat, ok[i].lon, ok[j].lat, ok[j].lon) * 10) / 10 });
    return { ok: true, items, pairs };
  }

  function seriesFromCube(rc) {                             // 시계열 = 현재 로드된 CUBE에서
    try {
      const val = (CUBE.ppm2 || CUBE.value)[rc] || [];
      const cnt = CUBE.count ? CUBE.count[rc] : null;
      return { points: CUBE.months.map((ym, i) => ({
        ym, avg_price_per_m2: val[i], count: cnt ? cnt[i] : null })).filter((p) => p.avg_price_per_m2 != null) };
    } catch (e) { return { points: [] }; }
  }

  window.fetch = async function (url, opts) {
    const u = String(url);
    const m = u.match(/\/api\/([a-z_]+)(\?(.*))?$/);
    if (!m) return realFetch(url, opts);
    const ep = m[1], q = new URLSearchParams(m[3] || '');
    try {
      switch (ep) {
        case 'meta': return J(await file('meta.json'));
        case 'global_cube': return J(await file('global_cube.json'));
        case 'cube': return J(await file(`cube_${q.get('property_type')}_${q.get('deal_type')}_${q.get('level')}.json`));
        case 'ratio_cube': return J(await file(`ratio_${q.get('asset')}_${q.get('level')}.json`));
        case 'series': return J(seriesFromCube(q.get('region_code')));
        case 'poi': return J(await file('poi.json'));      // 링크는 생성 시점에 병합돼 있음
        case 'invest': return J(await file('invest.json'));
        case 'yields': return J(await file('yields.json'));
        case 'sizes': return J(await file('sizes.json'));
        case 'geocode': return J(await geocode(q.get('q') || '', q.get('online') === '1'));
        case 'bike': return J(await file('bike.json'));
        case 'region_prices': return J(await file('region_prices.json'));
        case 'compare': return J(await compare(q.get('q') || '', q.get('online') === '1'));
        case 'health': return J({ ok: true, static: true });
        case 'nas': return J({ ok: false });
        case 'scheduler': return J({ ok: true, running: false, pid: 0, static: true });
        case 'remote': return J({ ok: true, url: '' });
        default: return J({ ok: false, static: true }, 200);   // track/ab/auth/jd 등 — 조용히 무시
      }
    } catch (e) {
      return J({ ok: false, error: '정적 스냅샷에 없는 데이터: ' + ep }, 404);
    }
  };
})();
