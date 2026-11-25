// ฟังก์ชันที่ใช้ร่วมกันระหว่าง register.html / register-admin.html
// - ปรับชื่อให้เทียบกันได้ / ตรวจชื่อชนกัน (ขบวนพาเหรด + เวลาแข่งขัน) / ช่วยเติมชื่อ (suggest)

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PREFIX = /^(เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|นางสาว|น\.ส\.|นาย|นาง|ครู|คุณครู|อาจารย์|ว่าที่ร้อยตรี)/;
export const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').replace(PREFIX, '');
// ช่องที่อาจมีหลายชื่อ เช่น ครูผู้ฝึกซ้อม "ครูก, ครูข และครูค"
export const splitNames = (s) => String(s || '').split(/[,،;\n]|และ/).map(x => x.trim()).filter(Boolean);

// ---------- ช่องข้อมูลขบวน (ต้องตรงกับ mc-data.html / ceremony-docs.html) ----------
export const TEAM_PARADE_FIELDS = [
    { k: 'alias', l: 'ชื่อขบวน', w: 6 },
    { k: 'leader', l: 'ชื่อประธานสี', w: 4, person: true },
    { k: 'level', l: 'ชั้น ม.', w: 2, ph: 'เช่น 5' },
    { k: 'concept', l: 'คอนเซปต์ขบวน', w: 12, area: true, rows: 5, ph: 'เขียนได้เต็มที่ เช่น แนวคิดหลักของขบวน / ที่มาของชื่อสี / สัญลักษณ์ ธีมการแต่งกาย / ความหมายที่อยากให้พิธีกรเล่า (ประมาณ 2-4 ประโยค)' },
    { k: 'count', l: 'จำนวนสมาชิก (คน)', w: 4 },
    { k: 'sign', l: 'ผู้ถือป้ายคณะสี', w: 6, person: true, list: true, ph: 'พิมพ์ชื่อแล้วเลือกจากรายการ' },
    { k: 'flag', l: 'ผู้ถือธงคณะสี', w: 6, person: true },
    { k: 'cheer_sign', l: 'ผู้ถือป้ายคณะหลีดเดอร์ (ถ้ามี)', w: 12, person: true, list: true, optional: true, ph: 'พิมพ์ชื่อแล้วเลือกจากรายการ (ไม่มีให้เว้นว่าง)' }
];
export const SCHOOL_PARADE_FIELDS = [
    { k: 'mj', l: 'คฑากรนำขบวน', w: 4, person: true },
    { k: 'sign_school', l: 'ผู้ถือป้ายโรงเรียน', w: 4, person: true },
    { k: 'flag_school', l: 'ผู้ถือธงโรงเรียน', w: 4, person: true },
    { k: 'band_teachers', l: 'ครูผู้ฝึกซ้อมวงดุริยางค์ (หลายคนคั่นด้วยลูกน้ำ)', w: 12, person: true }
];

// ---------- ตรวจชื่อชนกันในขบวน ----------
// mc = ข้อมูล mcData ทั้งก้อน, teams = settings.teams
// คืนค่า [{ name, entries:[{label, scope}] }]  scope = 'school' | teamKey | 'event'
export function paradeConflicts(mc, teams) {
    mc = mc || {};
    const shared = mc.shared || {}, td = mc.teams || {};
    const list = [];
    const push = (raw, label, scope) => splitNames(raw).forEach(n => list.push({ n, key: normName(n), label, scope }));
    SCHOOL_PARADE_FIELDS.forEach(f => push(shared[f.k], f.l.replace(/\s*\(.*\)/, ''), 'school'));
    push(shared.mc1_full, 'พิธีกร 1', 'event');
    push(shared.mc2_full, 'พิธีกร 2', 'event');
    push(shared.sr_name, 'นักกีฬาอาวุโส', 'event');
    const torch = shared.torch && typeof shared.torch === 'object' ? Object.values(shared.torch) : [];
    torch.forEach(t => t && push(t.name, 'นักกีฬาวิ่งคบเพลิง', 'event'));
    Object.keys(teams || {}).forEach(tk => {
        const d = td[tk] || {}, tn = (teams[tk] || {}).name || tk;
        TEAM_PARADE_FIELDS.filter(f => f.person && !f.noConflict).forEach(f => push(d[f.k], `${f.l} (${tn})`, tk));
    });
    const g = {};
    list.forEach(x => { if (x.key) (g[x.key] = g[x.key] || []).push(x); });
    return Object.values(g).filter(a => a.length > 1)
        .map(a => ({ name: a[0].n, entries: a.map(x => ({ label: x.label, scope: x.scope })) }));
}


// ---------- เทียบชื่อแบบ fuzzy (พิมพ์ผิด/สระ-วรรณยุกต์ต่างกันเล็กน้อย) ----------
export function editDist(a, b) {
    if (a === b) return 0;
    const A = [...a], B = [...b];
    if (Math.abs(A.length - B.length) > 2) return 9;
    let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
    for (let i = 1; i <= A.length; i++) {
        const cur = [i];
        for (let j = 1; j <= B.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[B.length];
}
// ka, kb = ชื่อที่ผ่าน normName แล้ว : สั้น (<5) ต้องตรงเป๊ะ, 5-13 ตัวอักษรต่างได้ 1, ยาวกว่านั้นต่างได้ 2
export function similarKey(ka, kb) {
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    const L = Math.min([...ka].length, [...kb].length);
    if (L < 5) return false;
    return editDist(ka, kb) <= (L >= 14 ? 2 : 1);
}
export const similarName = (a, b) => similarKey(normName(a), normName(b));
// รวมคีย์ที่คล้ายกันเป็นกลุ่มเดียว คืน {key: คีย์ตัวแทนของกลุ่ม}
export function clusterKeys(keys) {
    const ks = [...new Set(keys)], par = {};
    ks.forEach(k => par[k] = k);
    const find = (x) => par[x] === x ? x : (par[x] = find(par[x]));
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++)
        if (similarKey(ks[i], ks[j])) par[find(ks[j])] = find(ks[i]);
    const out = {}; ks.forEach(k => out[k] = find(k));
    return out;
}

// ---------- ผู้ส่งคะแนนประจำสนาม (ที่แต่ละคณะสีกรอกตอนลงทะเบียน) ----------
// คืน [{ team, name, variants:[ชื่อที่พิมพ์ต่างกัน], ms:[match], fuzzy:boolean }] จัดกลุ่มตามคณะสี + ชื่อที่คล้ายกัน
export function scorerCards(matches, opts = {}) {
    const rows = [];
    (matches || []).forEach(m => Object.keys(m.scorers || {}).forEach(tk => ((m.scorers || {})[tk] || []).forEach(n => {
        const raw = String(n || '').replace(/\s+/g, ' ').trim(), k = normName(raw);
        if (k) rows.push({ tk, raw, k, m });
    })));
    const out = [];
    [...new Set(rows.map(r => r.tk))].forEach(tk => {
        const rs = rows.filter(r => r.tk === tk), rep = clusterKeys(rs.map(r => r.k)), g = {};
        rs.forEach(r => (g[rep[r.k]] = g[rep[r.k]] || []).push(r));
        Object.values(g).forEach(a => {
            const cnt = {}; a.forEach(r => cnt[r.raw] = (cnt[r.raw] || 0) + 1);
            const variants = Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x]);
            const ms = []; a.forEach(r => { if (!ms.includes(r.m)) ms.push(r.m); });
            ms.sort((x, y) => ((x.date || '') + (x.time || '')).localeCompare((y.date || '') + (y.time || '')));
            out.push({ team: tk, name: variants[0], variants, ms, fuzzy: new Set(a.map(r => r.k)).size > 1 });
        });
    });
    const sorted = out.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name, 'th'));
    return opts.one ? assignOneScorer(sorted) : sorted;
}

// โหมด "รายการละ 1 คน": จากการ์ดของทุกคณะสี เลือกผู้ส่งคะแนน 1 คนต่อ 1 รายการ
// แบ่งสีละครึ่ง (เลือกสีที่ได้รับมอบหมายน้อยกว่าก่อน) แล้วกระจายระหว่างคนในสีเดียวกัน และเลี่ยงเวลาแข่งซ้อนกัน — คำนวณแบบกำหนดได้แน่นอน ทุกหน้าได้ผลตรงกัน
export function assignOneScorer(cards) {
    const key = (m) => ((m.date || '') + '|' + (m.time || '') + '|' + (m.id || ''));
    const all = new Map(); cards.forEach(c => c.ms.forEach(m => all.set(m.id ?? key(m), m)));
    const ms = [...all.values()].sort((a, b) => key(a).localeCompare(key(b)));
    const got = cards.map(() => []), perTeam = {};
    const clash = (i, m) => { const iv = matchInterval(m); if (!iv) return false;
        return got[i].some(x => { const j = matchInterval(x); return j && iv.s < j.e && j.s < iv.e; }); };
    ms.forEach(m => {
        const cand = cards.map((c, i) => ({ c, i })).filter(x => x.c.ms.some(y => (y.id ?? key(y)) === (m.id ?? key(m))));
        if (!cand.length) return;
        const pick = cand.slice().sort((a, b) =>
            (perTeam[a.c.team] || 0) - (perTeam[b.c.team] || 0) ||
            (clash(a.i, m) ? 1 : 0) - (clash(b.i, m) ? 1 : 0) ||
            got[a.i].length - got[b.i].length || a.i - b.i)[0];
        got[pick.i].push(m); perTeam[pick.c.team] = (perTeam[pick.c.team] || 0) + 1;
    });
    return cards.map((c, i) => ({ ...c, allCount: c.ms.length, ms: got[i] })).filter(c => c.ms.length);
}

// ---------- ตรวจชื่อชนกันตามเวลาแข่งขัน ----------
const toMin = (t) => { const m = String(t || '').match(/(\d{1,2})[:.](\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; };
export function matchInterval(m) {
    const s = toMin(m.time);
    if (s === null) return null;
    let e = s + 60;                                    // ไม่ทราบเวลาจบ สมมติ 60 นาที
    const r = String(m.note || '').match(/(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/);   // เช่น "เวลาแข่ง 13.00-14.40 น."
    if (r) { const e2 = (+r[3]) * 60 + (+r[4]); if (e2 > s) e = e2; }
    return { s, e };
}
// matches = [{id,sport,category,date,time,note,teams,players:{tk:[]},coaches:{tk:[]}}]
// คืน [{ name, kind:'time'|'both-teams', a:{m,team,role}, b:{m,team,role} }]
export function athleteConflicts(matches) {
    const by = {};
    matches.forEach(m => {
        const iv = matchInterval(m); if (!iv) return;
        Object.keys(m.players || {}).forEach(tk => ((m.players || {})[tk] || []).forEach(n => {
            const k = normName(n); if (k) (by[k] = by[k] || []).push({ n, m, team: tk, role: 'นักกีฬา', iv });
        }));
        Object.keys(m.coaches || {}).forEach(tk => ((m.coaches || {})[tk] || []).forEach(n => {
            const k = normName(n); if (k) (by[k] = by[k] || []).push({ n, m, team: tk, role: 'ครู', iv });
        }));
    });
    // รวมชื่อที่คล้ายกัน (พิมพ์ผิดเล็กน้อย) เป็นคนเดียวกัน
    const rep = clusterKeys(Object.keys(by)), merged = {};
    Object.keys(by).forEach(k => { (merged[rep[k]] = merged[rep[k]] || []).push(...by[k]); });
    const out = [];
    Object.values(merged).forEach(arr => {
        for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
            const a = arr[i], b = arr[j];
            if (a.role === 'ครู' && b.role === 'ครู') {
                // ครูคนเดียวคุมหลายรายการเวลาชนกันก็เตือนเช่นกัน
            }
            if (a.m.id === b.m.id) {
                if (a.team !== b.team && a.role === b.role) out.push({ name: a.n, kind: 'both-teams', a, b, fuzzy: normName(a.n) !== normName(b.n) });
                continue;
            }
            if (a.m.date === b.m.date && a.iv.s === b.iv.s) out.push({ name: a.n, kind: 'time', a, b, fuzzy: normName(a.n) !== normName(b.n) });
        }
    });
    return out;
}
export const fmtTime = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

// ---------- ช่วยกรอกชื่อ (suggest) ----------
// pool = [{n, c, kind}] ; box = element #sugBox
export function attachSuggest(box, getPool, onPick) {
    let target = null, hits = [];
    const key = normName;
    const show = (el) => {
        const q = key(el.value), pool = getPool(el) || [];
        if (q.length < 1 || !pool.length) { box.style.display = 'none'; return; }
        hits = pool.filter(p => key(p.n).includes(q) && key(p.n) !== q)
            .map(p => ({ p, s: key(p.n).startsWith(q) ? 0 : 1 }))
            .sort((a, b) => a.s - b.s || key(a.p.n).length - key(b.p.n).length)
            .slice(0, 8).map(x => x.p);
        if (!hits.length) { box.style.display = 'none'; return; }
        target = el;
        box.innerHTML = hits.map((p, n) => `<div class="sug-item" data-n="${n}"><span>${esc(p.n)}</span><small class="text-muted">${esc(p.c || '')}</small></div>`).join('');
        const r = el.getBoundingClientRect();
        box.style.left = r.left + 'px'; box.style.top = (r.bottom + 2) + 'px'; box.style.width = r.width + 'px';
        box.style.display = 'block';
    };
    box.addEventListener('pointerdown', (e) => {
        const it = e.target.closest('.sug-item'); if (!it || !target) return;
        e.preventDefault();
        const p = hits[+it.dataset.n], el = target;
        box.style.display = 'none'; target = null;
        onPick(el, p);
    });
    return {
        bind(el) {
            el.setAttribute('autocomplete', 'off');
            el.addEventListener('input', () => show(el));
            el.addEventListener('focus', () => show(el));
            el.addEventListener('blur', () => setTimeout(() => { box.style.display = 'none'; target = null; }, 150));
        }
    };
}


// ---------- ช่องรายชื่อแบบกด "+ เพิ่ม" (เก็บเป็นข้อความคั่นด้วย ", " ในช่อง hidden เดียว) ----------
const lfRow = (v, n, ph) => `<div class="input-group mb-2 lf-row"><span class="input-group-text bg-white text-muted lf-n">${n}</span>
    <input type="text" class="form-control lf-in" value="${esc(v)}" placeholder="${esc(ph || '')}" autocomplete="off">
    <button type="button" class="btn btn-outline-danger lf-del" title="ลบ"><i class="fas fa-trash-alt"></i></button></div>`;
export function lfHtml(f, val, hiddenAttrs) {
    const names = String(val ?? '').split(/[,،\n]/).map(x => x.trim()).filter(Boolean);
    if (!names.length) names.push('');
    return `<div class="lf-wrap" data-ph="${esc(f.ph || '')}">
        <div class="lf-rows">${names.map((n, i) => lfRow(n, i + 1, f.ph)).join('')}</div>
        <button type="button" class="btn btn-sm btn-light border fw-bold lf-add"><i class="fas fa-plus"></i> เพิ่ม</button>
        <input type="hidden" ${hiddenAttrs} data-orig="${esc(val ?? '')}" value="${esc(val ?? '')}"></div>`;
}
// เรียกครั้งเดียวต่อหน้า: opts.onChange(hiddenEl) เมื่อรายชื่อเปลี่ยน, opts.onRow(inputEl) เมื่อมีช่องใหม่ (ไว้ผูก suggest)
export function lfBind(opts = {}) {
    const sync = (wrap) => {
        const rows = [...wrap.querySelectorAll('.lf-row')];
        rows.forEach((r, i) => { r.querySelector('.lf-n').textContent = i + 1; });
        const h = wrap.querySelector('input[type=hidden]');
        h.value = rows.map(r => r.querySelector('.lf-in').value.trim()).filter(Boolean).join(', ');
        if (opts.onChange) opts.onChange(h);
    };
    document.addEventListener('input', (e) => { const w = e.target.closest && e.target.closest('.lf-wrap'); if (w && e.target.classList.contains('lf-in')) sync(w); });
    document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.lf-add, .lf-del'); if (!b) return;
        const w = b.closest('.lf-wrap'), rows = w.querySelector('.lf-rows');
        if (b.classList.contains('lf-add')) {
            rows.insertAdjacentHTML('beforeend', lfRow('', rows.children.length + 1, w.dataset.ph));
            const el = rows.lastElementChild.querySelector('.lf-in'); if (opts.onRow) opts.onRow(el); el.focus();
        } else {
            b.closest('.lf-row').remove();
            if (!rows.children.length) rows.insertAdjacentHTML('beforeend', lfRow('', 1, w.dataset.ph));
        }
        sync(w);
    });
}

// ---------- การ์ดฉุกเฉิน (ลงคะแนนได้ทุกรายการ) + ประวัติการส่งคะแนน ----------
export const VIA_LABEL = { staff: 'การ์ดประจำสนาม', emergency: 'การ์ดฉุกเฉิน', link: 'ลิงก์กรรมการ' };
export function emergencyCardsPage(evName, staffHref, n) {
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=4&data=${encodeURIComponent(staffHref)}`;
    const card = (i) => `<div class="c"><div class="ev">${evName}</div><div class="ti">การ์ดฉุกเฉิน</div><div class="sub">ลงคะแนนได้ทุกรายการ</div><img src="${qr}"><div class="nm">ใบที่ ${i}</div><div class="sm">ใช้เมื่อผู้ส่งคะแนนประจำสนามไม่อยู่หรือขัดข้องเท่านั้น<br>ระบบบันทึกประวัติทุกครั้งที่ส่งคะแนน (เวลา/ผู้ส่ง/อุปกรณ์)</div><div class="wn">โปรดลงคะแนนตามข้อเท็จจริงและเป็นธรรม ห้าม! ลงคะแนนมั่วหรือลงเล่น ระบบสามารถแกะรอยอุปกรณ์ได้<br>ห้ามเผยแพร่ QR code ให้ผู้ไม่เกี่ยวข้อง</div></div>`;
    return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>การ์ดฉุกเฉิน</title>
        <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&family=Kanit:wght@600&display=swap" rel="stylesheet">
        <style>@page{size:A4;margin:10mm}body{font-family:'Sarabun',sans-serif;margin:0}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:8mm}
        .c{border:4px dashed #c62828;border-radius:10px;padding:7mm;text-align:center;page-break-inside:avoid}.ev{font-size:11pt;color:#555}.ti{font-family:'Kanit',sans-serif;font-size:20pt;color:#c62828}.sub{font-size:14pt;font-weight:700}
        img{width:56mm;height:56mm;margin:3mm 0}.nm{font-size:14pt;font-weight:700}.sm{font-size:10pt;color:#555}.wn{color:#d00;font-weight:700;font-size:9.5pt;line-height:1.35;margin-top:2mm;text-align:center}</style></head><body><div class="g">${Array.from({ length: n }, (_, i) => card(i + 1)).join('')}</div>
        <script>Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>setTimeout(()=>print(),300))</script></body></html>`;
}
export function scoreLogRows(logs) {
    const rows = [];
    Object.entries(logs || {}).forEach(([mid, o]) => Object.values(o || {}).forEach(e => rows.push({ ...e, mid })));
    return rows.sort((a, b) => (b.t || 0) - (a.t || 0));
}
export function scoreLogHtml(rows, labelOf, esc) {
    if (!rows.length) return '<div class="text-center text-muted py-4">ยังไม่มีประวัติการส่งคะแนน</div>';
    const fmt = (t) => new Date(t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' });
    return `<div class="table-responsive" style="max-height:60vh"><table class="table table-sm table-striped align-middle small text-start mb-0"><thead class="table-light" style="position:sticky;top:0"><tr><th>เวลา</th><th>รายการ</th><th>การกระทำ</th><th>ผู้ส่ง</th><th>ช่องทาง</th><th>อุปกรณ์ / IP</th></tr></thead><tbody>${rows.slice(0, 400).map(e =>
        `<tr><td class="text-nowrap">${esc(fmt(e.t))}</td><td>${esc(labelOf(e.mid))}</td><td>${esc(e.action || '')}${e.detail ? '<br><span class="text-muted">' + esc(e.detail) + '</span>' : ''}</td><td>${esc(e.by || '-')}</td><td>${esc(VIA_LABEL[e.via] || e.via || '-')}</td><td>${esc(e.dev || '')}${e.ip ? '<br><span class="text-muted">' + esc(e.ip) + '</span>' : ''}</td></tr>`).join('')}</tbody></table></div>${rows.length > 400 ? '<div class="small text-muted mt-1">แสดง 400 รายการล่าสุด</div>' : ''}`;
}
