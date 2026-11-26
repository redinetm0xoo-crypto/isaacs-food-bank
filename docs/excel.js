// Food Bank Manager – Excel (.xlsx) files made in the browser, with real Excel bar charts (v1.8).
// No outside library: the workbook is a zip of XML files (Office Open XML), written here.
//
//   const wb = new Workbook();
//   const sh = wb.sheet('Main Storage', [18, 12, 12]);     // name, column widths
//   sh.set(row, col, value, style);                          // 0-based row/col; numbers stay numbers
//   sh.chart({ title, cat: { col, r1, r2 }, vals: [{ col, nameRow, color }], at: { col, row }, size: { cols, rows } });
//   const bytes = wb.save();                                 // Uint8Array – the .xlsx file
//
// Styles: 'title', 'h' (heading), 'th' (table header), 'n' (number), 'tot' (total row text), 'totn' (total number), 'note'.

const STYLE = { '': 0, title: 1, h: 2, th: 3, n: 4, tot: 5, totn: 6, note: 7, thn: 8 };
const MIME = {
  wb: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  ws: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  st: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  dr: 'application/vnd.openxmlformats-officedocument.drawing+xml',
  ch: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
};
const NS = {
  main: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  pr: 'http://schemas.openxmlformats.org/package/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  xdr: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
};
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

// text safe for XML (control characters Excel refuses are dropped)
export const xml = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const colName = c => { let s = ''; c++; while (c) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
const ref = (sheet, c, r1, r2 = r1) => `'${sheet.replace(/'/g, "''")}'!$${colName(c)}$${r1 + 1}` + (r2 !== r1 ? `:$${colName(c)}$${r2 + 1}` : '');
// sheet names: at most 31 characters, none of : \ / ? * [ ], not blank, different from the others
export function sheetName(name, used) {
  let base = String(name).replace(/[:\\/?*[\]]/g, '-').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
  let n = base, k = 2;
  while (used.has(n.toLowerCase())) { const suf = ` (${k++})`; n = base.slice(0, 31 - suf.length) + suf; }
  used.add(n.toLowerCase()); return n;
}

class Sheet {
  constructor(wb, name, widths) { this.wb = wb; this.name = name; this.widths = widths || []; this.rows = new Map(); this.charts = []; }
  set(r, c, v, s = '') { if (v === undefined || v === null || v === '') { if (!s) return this; v = ''; } if (!this.rows.has(r)) this.rows.set(r, new Map()); this.rows.get(r).set(c, { v, s: STYLE[s] ?? 0 }); return this; }
  get(r, c) { return this.rows.get(r)?.get(c)?.v; }
  row(r, c, values, s = '') { values.forEach((v, k) => this.set(r, c + k, v, Array.isArray(s) ? s[k] : s)); return this; }
  chart(spec) { this.charts.push(spec); return this; }
  xmlText(drawRel) {
    const rows = [...this.rows.keys()].sort((a, b) => a - b).map(r => {
      const cells = [...this.rows.get(r).entries()].sort((a, b) => a[0] - b[0]).map(([c, { v, s }]) => {
        const at = `${colName(c)}${r + 1}`, st = s ? ` s="${s}"` : '';
        if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${at}"${st}><v>${v}</v></c>`;
        if (v === '') return `<c r="${at}"${st}/>`;
        return `<c r="${at}"${st} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    const cols = this.widths.length ? `<cols>${this.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS.main}" xmlns:r="${NS.r}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" zoomScale="100"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>${drawRel ? `<drawing r:id="${drawRel}"/>` : ''}</worksheet>`;
  }
}

// one clustered column chart; the figures and labels are read from the sheet (and cached, so it shows at once)
function chartXml(sh, ch) {
  const { cat, vals } = ch, n = cat.r2 - cat.r1 + 1;
  const strCache = list => `<c:strCache><c:ptCount val="${list.length}"/>${list.map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
  const labels = []; for (let r = cat.r1; r <= cat.r2; r++) labels.push(String(sh.get(r, cat.col) ?? ''));
  const sers = vals.map((s, k) => {
    const nums = []; for (let r = cat.r1; r <= cat.r2; r++) nums.push(Number(sh.get(r, s.col)) || 0);
    return `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx><c:strRef><c:f>${xml(ref(sh.name, s.col, s.nameRow))}</c:f>${strCache([String(sh.get(s.nameRow, s.col) ?? '')])}</c:strRef></c:tx>` +
      `<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>` +
      `<c:cat><c:strRef><c:f>${xml(ref(sh.name, cat.col, cat.r1, cat.r2))}</c:f>${strCache(labels)}</c:strRef></c:cat>` +
      `<c:val><c:numRef><c:f>${xml(ref(sh.name, s.col, cat.r1, cat.r2))}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${nums.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val></c:ser>`;
  }).join('');
  const txt = (sz, b) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${b}"><a:solidFill><a:srgbClr val="404040"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-GB"/></a:p></c:txPr>`;
  const line = c => `<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></a:ln></c:spPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:roundedCorners val="0"/><c:chart>` +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-GB" sz="1200" b="1"><a:solidFill><a:srgbClr val="227040"/></a:solidFill></a:rPr><a:t>${xml(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${sers}<c:gapWidth val="${n > 20 ? 30 : 80}"/><c:axId val="111"/><c:axId val="222"/></c:barChart>` +
    `<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>${line('BFBFBF')}${txt(900, 0)}<c:crossAx val="222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines>${line('E3E8E4')}</c:majorGridlines><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txt(900, 0)}<c:crossAx val="111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea>` +
    (vals.length > 1 ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txt(900, 0)}</c:legend>` : '') +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E8E4"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS.main}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0;[Red]-#,##0"/></numFmts>
<fonts count="6"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="16"/><color rgb="FF227040"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="13"/><color rgb="FF227040"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FF227040"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><i/><sz val="10"/><color rgb="FF5A5A5A"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F7F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FFBFBFBF"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="164" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="0"/></xf><xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export class Workbook {
  constructor() { this.sheets = []; this.used = new Set(); }
  // the name actually used is returned on the sheet (sheet.name) – it may be shortened or numbered
  sheet(name, widths) { const s = new Sheet(this, sheetName(name, this.used), widths); this.sheets.push(s); return s; }
  save(title = '') {
    const files = [], ct = [], wbRels = [];
    let chartNo = 0, drawNo = 0;
    this.sheets.forEach((sh, i) => {
      const n = i + 1;
      wbRels.push(`<Relationship Id="rId${n}" Type="${REL}worksheet" Target="worksheets/sheet${n}.xml"/>`);
      ct.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="${MIME.ws}"/>`);
      if (sh.charts.length) {
        const d = ++drawNo, anchors = [], dRels = [];
        sh.charts.forEach((ch, k) => {
          const c = ++chartNo;
          files.push([`xl/charts/chart${c}.xml`, chartXml(sh, ch)]);
          ct.push(`<Override PartName="/xl/charts/chart${c}.xml" ContentType="${MIME.ch}"/>`);
          dRels.push(`<Relationship Id="rId${k + 1}" Type="${REL}chart" Target="../charts/chart${c}.xml"/>`);
          const { at, size } = ch;
          anchors.push(`<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${at.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${at.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${at.col + size.cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${at.row + size.rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
            `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${k + 2}" name="${xml(ch.title).slice(0, 200)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
            `<a:graphic><a:graphicData uri="${NS.c}"><c:chart xmlns:c="${NS.c}" r:id="rId${k + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`);
        });
        files.push([`xl/drawings/drawing${d}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">${anchors.join('')}</xdr:wsDr>`]);
        files.push([`xl/drawings/_rels/drawing${d}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS.pr}">${dRels.join('')}</Relationships>`]);
        ct.push(`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="${MIME.dr}"/>`);
        files.push([`xl/worksheets/_rels/sheet${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS.pr}"><Relationship Id="rId1" Type="${REL}drawing" Target="../drawings/drawing${d}.xml"/></Relationships>`]);
        files.push([`xl/worksheets/sheet${n}.xml`, sh.xmlText('rId1')]);
      } else files.push([`xl/worksheets/sheet${n}.xml`, sh.xmlText(null)]);
    });
    wbRels.push(`<Relationship Id="rId${this.sheets.length + 1}" Type="${REL}styles" Target="styles.xml"/>`);
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    files.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${MIME.wb}"/><Override PartName="/xl/styles.xml" ContentType="${MIME.st}"/><Override PartName="/docProps/core.xml" ContentType="${MIME.core}"/>${ct.join('')}</Types>`]);
    files.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS.pr}"><Relationship Id="rId1" Type="${REL}officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`]);
    files.push(['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>Food Bank Manager</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`]);
    files.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS.main}" xmlns:r="${NS.r}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${this.sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`]);
    files.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS.pr}">${wbRels.join('')}</Relationships>`]);
    files.push(['xl/styles.xml', STYLES_XML]);
    // [Content_Types].xml first, as Office writes it
    files.sort((a, b) => (a[0] === '[Content_Types].xml' ? -1 : b[0] === '[Content_Types].xml' ? 1 : 0));
    return zip(files);
  }
}

// ---------- zip (files stored, not compressed – Excel opens these fine) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let off = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = typeof text === 'string' ? enc.encode(text) : text, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const cSize = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}
