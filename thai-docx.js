/* thai-docx.js — แปลง HTML ชุดเอกสารพิธีการ (div/table/ul/br/strong/em/img) เป็นไฟล์ .docx จริง
 * ใช้ docx-js + JSZip (global: docx, JSZip) และตั้งค่าอักษรไทยตามแนวทาง: ใส่ <w:cs/> ทุก run ที่เป็นภาษาไทย
 * ใช้: const blob = await ThaiDocx.build([{ html, newPage: true }, ...], { footerText }); */
(function () {
    'use strict';
    const FONT = 'TH SarabunPSK', BASE_PT = 16;
    const PAGE = { top: 1134, bottom: 1134, left: 1417, right: 1417 };     // A4: บน/ล่าง 2 ซม. ซ้าย/ขวา 2.5 ซม.
    const CONTENT_W = 11906 - PAGE.left - PAGE.right;                      // DXA
    const BLOCK = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'UL', 'OL']);

    const clean = (s) => String(s ?? '').replace(/ /g, ' ').replace(/‌/g, '').replace(/[ \t\r\n]+/g, ' ');

    // ---------- หน่วย ----------
    function toTwip(v) {            // '12px' '1.2cm' '10pt' '3mm' -> twip
        const m = String(v || '').trim().match(/^(-?[\d.]+)\s*(px|pt|cm|mm|em)?$/);
        if (!m) return 0;
        const n = parseFloat(m[1]), u = m[2] || 'px';
        return Math.round(u === 'px' ? n * 15 : u === 'pt' ? n * 20 : u === 'cm' ? n * 567 : u === 'mm' ? n * 56.7 : n * 320);
    }
    const toPx = (v, def) => { const t = toTwip(v); return t ? t / 15 : def; };
    const toPt = (v, def) => { const m = String(v || '').match(/^([\d.]+)pt$/); return m ? parseFloat(m[1]) : def; };

    const tint = (hex, k) => { const h = String(hex || '').replace('#', ''); if (!/^[0-9a-f]{6}$/i.test(h)) return 'F3F3F3'; return [0, 2, 4].map(i => Math.round(255 - (255 - parseInt(h.substr(i, 2), 16)) * k).toString(16).padStart(2, '0')).join('').toUpperCase(); };

    // ประมาณจำนวนหน้าของแต่ละส่วน เพื่อใส่เลขหน้าเริ่มต้นในสารบัญ (Word จะอัปเดตเป็นค่าจริงเมื่อเปิดไฟล์/กด F9)
    const PAGE_PX = 971 * 0.95;   // ความสูงเนื้อหา A4 (25.7 ซม.) เผื่อความคลาดเคลื่อน
    function measure(html, line) {
        const d = document.createElement('div');
        d.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;width:${Math.round(CONTENT_W / 15)}px;font-family:'TH SarabunPSK','Sarabun',sans-serif;font-size:${BASE_PT}pt;line-height:${((line || 276) / 240 * 1.15).toFixed(2)};`;
        d.innerHTML = html;
        d.querySelectorAll('[style]').forEach(e => { e.style.lineHeight = ''; });
        document.body.appendChild(d);
        const h = d.offsetHeight; document.body.removeChild(d);
        return h;
    }
    const estPages = (html, line) => Math.max(1, Math.ceil(measure(html, line) / PAGE_PX));
    const scaleHtml = (html, s) => html.replace(/font-size:\s*([\d.]+)pt/g, (m, n) => `font-size:${(n * s).toFixed(1)}pt`);
    // เอกสารที่ต้องอยู่ใน 1 หน้า: หาสเกลตัวอักษร (ไม่ต่ำกว่า 0.8) ที่ทำให้พอดีหน้าเดียว
    function fitScale(html, line) {
        for (const s of [1, 0.96, 0.92, 0.88, 0.84, 0.8]) {
            if (measure(scaleHtml(html, s), (line || 276) * (s < 0.9 ? 0.92 : 1)) <= PAGE_PX) return s;
        }
        return 0.8;
    }
    function scaleSpecs(specs, s) {
        const f = (sp) => {
            if (sp.k === 't') { sp.rows.forEach(r => r.forEach(c => c.content.forEach(f))); return; }
            if (sp.size) sp.size *= s;
            (sp.runs || []).forEach(r => { if (r.size) r.size *= s; if (r.img) { r.w = Math.round(r.w * s); r.h = Math.round(r.h * s); } });
            if (sp.before) sp.before = Math.round(sp.before * s);
            if (sp.after) sp.after = Math.round(sp.after * s);
            if (sp.firstLine) sp.firstLine = Math.round(sp.firstLine * s);
        };
        specs.forEach(f);
    }

    // ---------- รูปภาพ ----------
    async function loadImage(src) {
        try {
            const blob = await (await fetch(src)).blob();
            const bmp = await createImageBitmap(blob);
            let type = /png/.test(blob.type) ? 'png' : /jpe?g/.test(blob.type) ? 'jpg' : /gif/.test(blob.type) ? 'gif' : null;
            let data;
            if (type) data = new Uint8Array(await blob.arrayBuffer());
            else {                                                         // webp/svg ฯลฯ -> png ผ่าน canvas
                const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
                c.getContext('2d').drawImage(bmp, 0, 0);
                const pb = await new Promise(r => c.toBlob(r, 'image/png'));
                data = new Uint8Array(await pb.arrayBuffer()); type = 'png';
            }
            return { data, type, w: bmp.width, h: bmp.height };
        } catch (e) { return null; }
    }

    // ---------- HTML -> specs ----------
    // spec ย่อหน้า: {k:'p', runs:[{t,b,i,color,size,br,tab,img}], align, size, before, after, left, hanging, bTop, bBottom, box, keep, pageBreak}
    function runsOf(node, st, imgs, out) {
        node.childNodes.forEach(n => {
            if (n.nodeType === 3) {
                const t = clean(n.nodeValue);
                if (t) out.push({ t, b: st.b, i: st.i, color: st.color, size: st.size });
            } else if (n.nodeType === 1) {
                const tag = n.tagName;
                if (tag === 'BR') { out.push({ br: true }); return; }
                if (tag === 'IMG') {
                    const im = imgs[n.getAttribute('src')];
                    if (im) {
                        const h = toPx(n.style.height, 76), w = h * im.w / im.h;
                        out.push({ img: im, w: Math.round(w), h: Math.round(h) });
                    }
                    return;
                }
                const s2 = { ...st };
                if (tag === 'STRONG' || tag === 'B' || /bold|[6-9]00/.test(n.style.fontWeight)) s2.b = true;
                if (tag === 'EM' || tag === 'I' || n.style.fontStyle === 'italic') s2.i = true;
                if (n.style.color) s2.color = n.style.color;
                if (n.style.fontSize) s2.size = toPt(n.style.fontSize, st.size);
                runsOf(n, s2, imgs, out);
            }
        });
        return out;
    }
    const hasBlockChild = (el) => [...el.children].some(c => BLOCK.has(c.tagName));
    const isFooter = (el) => /^\s*เอกสารนี้พิมพ์จาก/.test(el.textContent || '');
    const colorHex = (c) => {
        if (!c) return undefined;
        const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (m) return [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
        return /^#[0-9a-f]{6}$/i.test(c) ? c.slice(1).toUpperCase() : undefined;
    };
    function borderOf(v) {           // '3px double #000'
        if (!v) return null;
        const s = /double/.test(v) ? 'double' : /dashed/.test(v) ? 'dashed' : /dotted/.test(v) ? 'dotted' : 'single';
        const w = parseFloat((v.match(/([\d.]+)px/) || [0, 1])[1]);
        const c = (v.match(/#[0-9a-f]{3,6}|rgb\([^)]*\)/i) || ['#000'])[0];
        return { s, sz: Math.max(2, Math.min(24, Math.round(w * 6))), color: colorHex(c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c) || '000000' };
    }

    function paraSpec(el, st, runs) {
        const cs = el.style;
        const sp = {
            k: 'p', runs, size: st.size,
            align: cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' ? 'right' : cs.textAlign === 'justify' ? 'dist' : 'left',
            before: toTwip(cs.marginTop), after: toTwip(cs.marginBottom),
            left: toTwip(cs.marginLeft) + toTwip(cs.paddingLeft), hanging: 0, firstLine: toTwip(cs.textIndent),
            bTop: borderOf(cs.borderTop), bBottom: borderOf(cs.borderBottom),
            box: (cs.border && !/none/.test(cs.border)) ? borderOf(cs.border) : null,
            keep: /avoid/.test(cs.pageBreakInside || cs.breakInside || ''),
            keepNext: /avoid/.test(cs.pageBreakAfter || cs.breakAfter || ''),
            pageBreak: /always|page/.test(cs.pageBreakBefore || cs.breakBefore || '')
        };
        if (cs.padding && sp.box) { sp.pad = toTwip(cs.padding.split(' ')[0]); }
        return sp;
    }

    function convertChildren(parent, st, imgs, out) {
        let pending = [];
        const flush = () => {
            if (pending.some(r => r.t && r.t.trim() || r.img || r.br)) {
                // ตัดช่องว่างหัว/ท้าย
                const first = pending.find(r => r.t); if (first) first.t = first.t.replace(/^ +/, '');
                const last = [...pending].reverse().find(r => r.t); if (last) last.t = last.t.replace(/ +$/, '');
                out.push({ k: 'p', runs: pending, size: st.size, align: 'left', before: 0, after: 0, left: 0, hanging: 0 });
            }
            pending = [];
        };
        parent.childNodes.forEach(n => {
            if (n.nodeType === 3) { const t = clean(n.nodeValue); if (t.trim() || pending.length) pending.push({ t, b: st.b, i: st.i, color: st.color, size: st.size }); return; }
            if (n.nodeType !== 1) return;
            if (!BLOCK.has(n.tagName)) { runsOf({ childNodes: [n] }, st, imgs, pending); return; }
            flush();
            convertBlock(n, st, imgs, out);
        });
        flush();
        return out;
    }

    function convertBlock(el, st, imgs, out) {
        const tag = el.tagName, cs = el.style;
        if (isFooter(el)) return;
        const s2 = { ...st };
        if (cs.fontSize) s2.size = toPt(cs.fontSize, st.size);
        if (/H[1-6]/.test(tag)) { s2.b = true; if (!cs.fontSize) s2.size = tag === 'H3' ? 18 : 16; }
        if (/bold|[6-9]00/.test(cs.fontWeight)) s2.b = true;
        if (cs.fontStyle === 'italic') s2.i = true;
        if (cs.color) s2.color = cs.color;

        if (tag === 'TABLE') { out.push(tableSpec(el, s2, imgs)); return; }
        if (tag === 'UL' || tag === 'OL') {
            [...el.children].filter(c => c.tagName === 'LI').forEach((li, idx) => {
                const runs = runsOf(li, s2, imgs, []);
                out.push({ k: 'p', runs, size: s2.size, align: 'left', before: 0, after: 80, left: 1134, hanging: 340, bullet: tag === 'UL' ? '•' : (idx + 1) + '.' });
            });
            return;
        }
        // flex: แถวโลโก้ (img อย่างเดียว) หรือแถว "○ ข้อความ"
        if (/flex/.test(cs.display || '')) {
            const kids = [...el.children];
            if (kids.length && kids.every(k => k.tagName === 'IMG')) {
                const runs = []; kids.forEach((k, i) => { if (i) runs.push({ t: '    ' }); runsOf({ childNodes: [k] }, s2, imgs, runs); });
                out.push({ k: 'p', runs, size: s2.size, align: 'center', before: 0, after: toTwip(cs.marginBottom) || 120, left: 0, hanging: 0 });
                return;
            }
            const bullet = clean(kids[0] ? kids[0].textContent : '').trim();
            const runs = runsOf(kids[1] || el, s2, imgs, []);
            out.push({ k: 'p', runs, size: s2.size, align: 'dist', before: 0, after: toTwip(cs.marginBottom) || 120, left: 454, hanging: 454, bullet, keep: true });
            return;
        }
        if ((tag === 'DIV' || tag === 'P') && hasBlockChild(el)) {
            const start = out.length;
            convertChildren(el, s2, imgs, out);
            const added = out.slice(start);
            const bb = borderOf(cs.borderBottom), bt = borderOf(cs.borderTop);
            if (added.length) {
                if (bb) added[added.length - 1].bBottom = bb;
                if (bt) added[0].bTop = bt;
                if (/always|page/.test(cs.pageBreakBefore || cs.breakBefore || '')) added[0].pageBreak = true;
                if (toTwip(cs.marginTop)) added[0].before = (added[0].before || 0) + toTwip(cs.marginTop);
                if (toTwip(cs.marginBottom)) added[added.length - 1].after = (added[added.length - 1].after || 0) + toTwip(cs.marginBottom);
            }
            return;
        }
        // ย่อหน้าธรรมดา (div/p/h*)
        const runs = runsOf(el, s2, imgs, []);
        const first = runs.find(r => r.t); if (first) first.t = first.t.replace(/^ +/, '');
        const last = [...runs].reverse().find(r => r.t); if (last) last.t = last.t.replace(/ +$/, '');
        if (!runs.length) return;
        const sp = paraSpec(el, s2, runs);
        if (/H[1-6]/.test(tag)) { sp.align = 'center'; sp.after = sp.after || 0; sp.before = sp.before || 0; }
        out.push(sp);
    }

    function tableSpec(el, st, imgs) {
        const rows = [...el.querySelectorAll('tr')].map(tr => [...tr.children].map(td => {
            const inner = convertChildren(td, { ...st, b: st.b || /bold|[6-9]00/.test(td.style.fontWeight) }, imgs, []);
            return { w: td.style.width ? toTwip(td.style.width) : 0, content: inner };
        }));
        return { k: 't', rows, keepRows: true };
    }

    // ---------- specs -> docx ----------
    function buildDocx(specs, opts, cover) {
        const D = docx;
        const border = (b) => b ? { style: b.s === 'double' ? D.BorderStyle.DOUBLE : b.s === 'dashed' ? D.BorderStyle.DASHED : b.s === 'dotted' ? D.BorderStyle.DOTTED : D.BorderStyle.SINGLE, size: b.sz, color: b.color, space: 4 } : undefined;
        const ALIGN = { center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, left: D.AlignmentType.LEFT, dist: D.AlignmentType.THAI_DISTRIBUTE };
        const runOf = (r, size) => {
            if (r.br) return new D.TextRun({ break: 1 });
            if (r.tab) return new D.TextRun({ children: [new D.Tab()] });
            if (r.pageref) { const z = Math.round((r.size || size || BASE_PT) * 2); return new D.TextRun({ children: [new D.PageReference(r.pageref, { hyperlink: true })], size: z, sizeComplexScript: z }); }
            if (r.img) return new D.ImageRun({ type: r.img.type, data: r.img.data, transformation: { width: r.w, height: r.h }, altText: { title: 'logo', description: 'logo', name: 'logo' } });
            const sz = Math.round((r.size || size || BASE_PT) * 2);
            return new D.TextRun({ text: r.t, bold: !!r.b, italics: !!r.i, color: colorHex(r.color) || undefined, size: sz, sizeComplexScript: sz });
        };
        const para = (sp) => {
            const runs = [];
            if (sp.bullet) { runs.push(new D.TextRun({ text: sp.bullet, size: Math.round((sp.size || BASE_PT) * 2), sizeComplexScript: Math.round((sp.size || BASE_PT) * 2) })); runs.push(new D.TextRun({ children: [new D.Tab()] })); }
            if (sp.bm) runs.push(new D.Bookmark({ id: sp.bm, children: [new D.TextRun({ text: '' })] }));
            sp.runs.forEach(r => runs.push(runOf(r, sp.size)));
            // บรรทัดที่ถูกตัดด้วย <br> ห้ามจัดแบบกระจายอักษรไทย ไม่งั้นตัวอักษรถูกยืดจนอ่านไม่ออก
            const alignKey = (sp.align === 'dist' && sp.runs.some(r => r.br)) ? 'left' : sp.align;
            const o = {
                children: runs, alignment: ALIGN[alignKey] || D.AlignmentType.LEFT,
                tabStops: sp.tabRight ? [{ type: D.TabStopType.RIGHT, position: sp.tabRight, leader: D.LeaderType.DOT }] : undefined,
                spacing: { before: sp.before || 0, after: sp.after == null ? 0 : sp.after, line: sp.line || opts.line || 276, lineRule: D.LineRuleType.AUTO },
                indent: (sp.left || sp.hanging || sp.firstLine) ? { left: sp.left + (sp.hanging || 0), hanging: sp.hanging || undefined, firstLine: (!sp.hanging && sp.firstLine) ? sp.firstLine : undefined } : undefined,
                pageBreakBefore: !!sp.pageBreak, keepLines: !!sp.keep, keepNext: !!sp.keepNext
            };
            if (sp.bullet) o.indent = { left: sp.left, hanging: sp.hanging };
            if (sp.box) { const b = border(sp.box); o.border = { top: b, bottom: b, left: b, right: b }; }
            if (sp.bTop || sp.bBottom) o.border = { ...(o.border || {}), ...(sp.bTop ? { top: border(sp.bTop) } : {}), ...(sp.bBottom ? { bottom: border(sp.bBottom) } : {}) };
            return new D.Paragraph(o);
        };
        const NONE = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
        const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
        const table = (sp) => {
            const ncol = Math.max(...sp.rows.map(r => r.length));
            const first = sp.rows[0] || [];
            let widths = []; let used = 0, unset = 0;
            for (let i = 0; i < ncol; i++) { const w = first[i] ? first[i].w : 0; widths.push(w); used += w; if (!w) unset++; }
            widths = widths.map(w => w || Math.floor((CONTENT_W - used) / Math.max(1, unset)));
            const sum = widths.reduce((a, b) => a + b, 0); if (sum > CONTENT_W) widths = widths.map(w => Math.floor(w * CONTENT_W / sum));
            return new D.Table({
                width: { size: widths.reduce((a, b) => a + b, 0), type: D.WidthType.DXA }, columnWidths: widths, borders: noBorders,
                rows: sp.rows.map(r => new D.TableRow({
                    cantSplit: true,
                    children: r.map((c, i) => new D.TableCell({
                        width: { size: widths[i], type: D.WidthType.DXA }, borders: noBorders,
                        margins: { top: 60, bottom: 60, left: 0, right: i === 0 ? 140 : 0 },
                        children: (c.content.length ? c.content : [{ k: 'p', runs: [], size: BASE_PT }]).map(x => x.k === 't' ? table(x) : para(x))
                    }))
                }))
            });
        };
        // ปกเต็มหน้า: ตารางแถบสีอ่อน 2 แถบ (ตามสีพิธีกร 1 และ 2) ในส่วน (section) ที่ไม่มีขอบกระดาษ
        const coverSection = () => {
            const strip = () => new D.TableRow({
                cantSplit: true, height: { value: 420, rule: D.HeightRule.EXACT },
                children: [0, 1].map(i => new D.TableCell({ width: { size: 5953, type: D.WidthType.DXA }, borders: noBorders, shading: { type: D.ShadingType.CLEAR, fill: cover.colors[i] || '444444', color: 'auto' }, children: [new D.Paragraph({ children: [] })] }))
            });
            const rowsH = [10400, 5400];
            const band = (b, i) => new D.TableRow({
                cantSplit: true, height: { value: rowsH[i] || 3000, rule: D.HeightRule.EXACT },
                children: [new D.TableCell({
                    columnSpan: 2, width: { size: 11906, type: D.WidthType.DXA }, borders: noBorders,
                    verticalAlign: i === 0 ? D.VerticalAlign.CENTER : D.VerticalAlign.TOP,
                    margins: { top: 200, bottom: 0, left: 1417, right: 1417 },
                    children: b.length ? b.map(x => x.k === 't' ? table(x) : para(x)) : [new D.Paragraph({ children: [] })]
                })]
            });
            return {
                properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } } },
                children: [new D.Table({ width: { size: 11906, type: D.WidthType.DXA }, columnWidths: [5953, 5953], borders: noBorders, rows: [strip(), ...cover.bands.map(band), strip()] }),
                    new D.Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: D.LineRuleType.EXACT }, children: [new D.TextRun({ text: '', size: 2 })] })]
            };
        };
        const children = specs.map(sp => sp.k === 't' ? table(sp) : para(sp));
        if (!children.length) children.push(new D.Paragraph({ children: [] }));
        const T = (text, size, extra = {}) => new D.TextRun({ text, size: size * 2, sizeComplexScript: size * 2, color: '666666', ...extra });
        const footer = new D.Footer({
            children: [new D.Paragraph({
                alignment: D.AlignmentType.CENTER,
                children: [T((opts.footerText || '') + '   หน้า ', 10), new D.TextRun({ children: [D.PageNumber.CURRENT], size: 20, sizeComplexScript: 20, color: '666666' })]
            })]
        });
        return new D.Document({
            creator: opts.creator || 'ระบบจัดการกีฬาภายใน', title: opts.title || '',
            features: opts.toc ? { updateFields: true } : undefined,
            styles: {
                default: {
                    document: {
                        run: { font: { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT }, size: BASE_PT * 2, sizeComplexScript: BASE_PT * 2, language: { value: 'th-TH', eastAsia: 'th-TH', bidirectional: 'th-TH' } },
                        paragraph: { alignment: D.AlignmentType.LEFT, spacing: { before: 0, after: 0, line: 276, lineRule: D.LineRuleType.AUTO } }
                    }
                }
            },
            sections: [...(cover ? [coverSection()] : []), { properties: { page: { size: { width: 11906, height: 16838 }, margin: { ...PAGE, footer: 567 } } }, footers: { default: footer }, children }]
        });
    }

    // ใส่เลขหน้าที่ประมาณไว้เป็นค่าเริ่มต้นของฟิลด์ PAGEREF (ไม่เช่นนั้นจะขึ้นเป็น 1 ทั้งหมดจนกว่าจะอัปเดตฟิลด์)
    async function fillPageRefs(blob, marks) {
        if (!marks.length) return blob;
        const pg = {}; marks.forEach(m => { pg[m.bm] = m.page; });
        const zip = await JSZip.loadAsync(blob);
        let xml = await zip.file('word/document.xml').async('string');
        xml = xml.replace(/<w:r>(<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)?<w:fldChar w:fldCharType="begin"([^>]*)\/><w:instrText([^>]*)>PAGEREF (\w+) \\h<\/w:instrText><w:fldChar w:fldCharType="separate"\/><w:fldChar w:fldCharType="end"\/><\/w:r>/g,
            (m, rpr, a1, a2, bm) => {
                const rp = rpr || '';
                return `<w:r>${rp}<w:fldChar w:fldCharType="begin"${a1}/><w:instrText${a2}>PAGEREF ${bm} \\h</w:instrText><w:fldChar w:fldCharType="separate"/></w:r><w:r>${rp}<w:t>${pg[bm] || 1}</w:t></w:r><w:r>${rp}<w:fldChar w:fldCharType="end"/></w:r>`;
            });
        zip.file('word/document.xml', xml);
        return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }

    // ใส่ <w:cs/> ให้ทุก run ที่มีอักษรไทย (Word จึงตัดคำไทยถูกและไม่ขีดเส้นแดง)
    async function addThaiCs(blob) {
        const zip = await JSZip.loadAsync(blob);
        const THAI = /[฀-๿]/;
        for (const name of Object.keys(zip.files).filter(n => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n))) {
            let xml = await zip.file(name).async('string');
            xml = xml.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, r => {
                if (!THAI.test(r.replace(/<[^>]+>/g, '')) || /<w:cs\b/.test(r)) return r;
                const end = r.indexOf('</w:rPr>');
                if (end < 0) {
                    if (r.includes('<w:rPr/>')) return r.replace('<w:rPr/>', '<w:rPr><w:cs/></w:rPr>');
                    return r.replace(/^(<w:r(?:\s[^>]*)?>)/, '$1<w:rPr><w:cs/></w:rPr>');
                }
                const m = r.slice(0, end).match(/<w:(em|lang|eastAsianLayout|specVanish|oMath|rPrChange)\b/);
                const at = m ? m.index : end;
                return r.slice(0, at) + '<w:cs/>' + r.slice(at);
            });
            zip.file(name, xml);
        }
        return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }

    /** sections: [{html, newPage}] -> Blob (.docx) */
    async function build(sections, opts = {}) {
        // โหลดรูปทั้งหมดก่อน (data: URL หรือ URL ที่ดึงได้) ถ้าดึงไม่ได้จะข้ามรูปนั้น
        const srcs = new Set();
        const docs = sections.map(s => new DOMParser().parseFromString('<body>' + s.html + '</body>', 'text/html'));
        docs.forEach(d => d.querySelectorAll('img').forEach(i => { const s = i.getAttribute('src'); if (s) srcs.add(s); }));
        const imgs = {};
        await Promise.all([...srcs].map(async s => { imgs[s] = await loadImage(s); }));
        const specs = [], marks = [];
        let tocAt = 0, cover = null, nextPage = 1;
        docs.forEach((d, idx) => {
            const sec = sections[idx];
            if (sec.cover) {
                const bands = [...d.body.querySelectorAll('[data-band]')].map(b => convertChildren(b, { size: BASE_PT }, imgs, []));
                cover = { bands, colors: (sec.bandColors || []).map(c => String(c || '').replace('#', '').toUpperCase()) };
                nextPage = 2;
                return;
            }
            const part = convertChildren(d.body, { size: BASE_PT }, imgs, []);
            if (part.length && sec.newPage && specs.length) part[0].pageBreak = true;
            if (sec.line) part.forEach(sp => { sp.line = sec.line; });
            let np;
            if (sec.fit1) {
                const sc = fitScale(sec.html, sec.line);
                if (sc < 1) { scaleSpecs(part, sc); if (!sec.line) part.forEach(sp => { sp.line = 254; }); }
                np = 1;
            } else np = estPages(sections[idx].html, sec.line);
            if (sec.tocTitle && part.length) { const bm = 'sec' + idx; part[0].bm = bm; marks.push({ title: sec.tocTitle, bm, level: sec.tocLevel || 0, page: nextPage }); }
            nextPage += np;
            specs.push(...part);
            if (sec.tocAfter) tocAt = specs.length;
        });
        if (opts.toc && marks.length) {
            const tocPages = Math.max(1, Math.ceil((marks.length + 2) / 28));
            marks.forEach(m => { m.page += tocPages; });
            // สารบัญ: ชื่อส่วน ....... เลขหน้า (เลขหน้าเป็นฟิลด์ PAGEREF ให้ Word อัปเดตตอนเปิดไฟล์)
            const toc = [{ k: 'p', runs: [{ t: 'สารบัญ', b: true, size: 24 }], size: 24, align: 'center', before: 0, after: 360, left: 0, hanging: 0, pageBreak: tocAt > 0, keepNext: true }];
            marks.forEach(m => toc.push({ k: 'p', runs: [{ t: m.title, b: m.level === 0 && !!m.bold }, { tab: true }, { pageref: m.bm }], size: 16, align: 'left', before: 0, after: 100, left: m.level ? 567 : 0, hanging: 0, tabRight: CONTENT_W - (m.level ? 567 : 0) }));
            if (specs[tocAt]) specs[tocAt].pageBreak = true;
            specs.splice(tocAt, 0, ...toc);
        }
        const blob = await docx.Packer.toBlob(buildDocx(specs, opts, cover));
        return addThaiCs(await fillPageRefs(blob, marks));
    }

    window.ThaiDocx = { build, _convert: (html, imgs = {}) => convertChildren(new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html').body, { size: BASE_PT }, imgs, []) };
})();
