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
    { k: 'sign', l: 'ผู้ถือป้ายคณะสี', w: 6, person: true },
    { k: 'flag', l: 'ผู้ถือธงคณะสี', w: 6, person: true },
    { k: 'scorer', l: 'ผู้ส่งคะแนนลงระบบประจำสนาม', w: 12, person: true, noConflict: true, note: 'ซ้ำคนได้กรณีแข่งคนละช่วงเวลา', ph: 'พิมพ์ชื่อแล้วเลือกจากรายการ (หลายคนคั่นด้วยลูกน้ำ เช่น สนามละ 1 คน)' }
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
    const out = [];
    Object.values(by).forEach(arr => {
        for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
            const a = arr[i], b = arr[j];
            if (a.role === 'ครู' && b.role === 'ครู') {
                // ครูคนเดียวคุมหลายรายการเวลาชนกันก็เตือนเช่นกัน
            }
            if (a.m.id === b.m.id) {
                if (a.team !== b.team && a.role === b.role) out.push({ name: a.n, kind: 'both-teams', a, b });
                continue;
            }
            if (a.m.date === b.m.date && a.iv.s < b.iv.e && b.iv.s < a.iv.e) out.push({ name: a.n, kind: 'time', a, b });
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
