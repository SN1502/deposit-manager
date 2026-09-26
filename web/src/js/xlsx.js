/* Deposit Manager — minimal, dependency-light .xlsx reader and writer (on top of JSZip).
 *
 * Writer: real Excel dates, text-formatted ID / account columns (so leading zeros and
 * long numbers survive), bold frozen header row, filters, and dropdown validation lists.
 * Reader: shared + inline strings, numbers, booleans, formulas (cached values), date and
 * percent number formats, 1900 and 1904 date systems, prefixed/namespaced XML. */
(function (DM) {
  'use strict';
  var U = DM.util;

  var NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  /* ------------------------------------------------------------- helpers */

  function esc(s) {
    return String(s)
      // strip characters that are illegal in XML 1.0
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function colName(i) { // 0 -> A, 25 -> Z, 26 -> AA
    var s = '';
    i += 1;
    while (i > 0) {
      var r = (i - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function colIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  /** ISO date -> Excel serial (1900 system). */
  function dateToSerial(isoStr) {
    var t = Date.UTC(+isoStr.slice(0, 4), +isoStr.slice(5, 7) - 1, +isoStr.slice(8, 10));
    return Math.round((t - Date.UTC(1899, 11, 30)) / 86400000);
  }

  /** Excel serial -> ISO date. */
  function serialToDate(serial, date1904) {
    serial = Math.floor(serial);
    var base;
    if (date1904) base = Date.UTC(1904, 0, 1);
    else if (serial >= 61) base = Date.UTC(1899, 11, 30);
    else base = Date.UTC(1899, 11, 31); // before the fictional 29 Feb 1900
    var d = new Date(base + serial * 86400000);
    return U.iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  /* ------------------------------------------------------------- writer */

  // cellXfs indices used by the writer
  var ST = { normal: 0, header: 1, text: 2, date: 3, money: 4, rate: 5, int: 6, wrap: 7, title: 8 };

  var STYLES_XML = XML_HEAD +
    '<styleSheet xmlns="' + NS_MAIN + '">' +
    '<numFmts count="3">' +
    '<numFmt numFmtId="164" formatCode="dd\\-mm\\-yyyy"/>' +
    '<numFmt numFmtId="165" formatCode="&quot;₹&quot;#,##0.00"/>' +
    '<numFmt numFmtId="166" formatCode="0.00"/>' +
    '</numFmts>' +
    '<fonts count="3">' +
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
    '<font><b/><sz val="14"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0F5C5A"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FF0A3F3E"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="9">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
    '</styleSheet>';

  var TYPE_STYLE = { text: ST.text, date: ST.date, money: ST.money, rate: ST.rate, int: ST.int, wrap: ST.wrap };

  function SharedStrings() {
    this.list = [];
    this.map = Object.create(null);
    this.count = 0;
  }
  SharedStrings.prototype.idx = function (s) {
    this.count++;
    if (!(s in this.map)) {
      this.map[s] = this.list.length;
      this.list.push(s);
    }
    return this.map[s];
  };
  SharedStrings.prototype.xml = function () {
    var parts = [XML_HEAD, '<sst xmlns="', NS_MAIN, '" count="', this.count, '" uniqueCount="', this.list.length, '">'];
    for (var i = 0; i < this.list.length; i++) {
      var s = this.list[i];
      var sp = /^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : '';
      parts.push('<si><t', sp, '>', esc(s), '</t></si>');
    }
    parts.push('</sst>');
    return parts.join('');
  };

  function cellXml(ref, value, type, sst) {
    if (value === null || value === undefined || value === '') return '';
    var style = TYPE_STYLE[type] || ST.normal;
    if (type === 'date') {
      if (!U.isValidISO(value)) return '<c r="' + ref + '" s="' + ST.text + '" t="s"><v>' + sst.idx(String(value)) + '</v></c>';
      return '<c r="' + ref + '" s="' + style + '"><v>' + dateToSerial(value) + '</v></c>';
    }
    if (type === 'money' || type === 'rate' || type === 'int' || type === 'number') {
      var n = typeof value === 'number' ? value : U.toNumber(value);
      if (!isFinite(n)) return '<c r="' + ref + '" s="' + ST.text + '" t="s"><v>' + sst.idx(String(value)) + '</v></c>';
      return '<c r="' + ref + '" s="' + style + '"><v>' + n + '</v></c>';
    }
    return '<c r="' + ref + '" s="' + style + '" t="s"><v>' + sst.idx(String(value)) + '</v></c>';
  }

  /**
   * sheet = {name, columns:[{header, key, type, width}], rows:[obj], validations:[{key, list}],
   *          freeze: true, filter: true, plain: false}
   * A `plain` sheet (used for instructions) is rows of single strings, no header styling.
   */
  function sheetXml(sheet, sst, isFirst) {
    var cols = sheet.columns, rows = sheet.rows || [], out = [];
    var lastCol = colName(Math.max(cols.length, 1) - 1);
    var lastRow = rows.length + 1;
    out.push(XML_HEAD, '<worksheet xmlns="', NS_MAIN, '" xmlns:r="', NS_REL, '">');
    out.push('<dimension ref="A1:', lastCol, lastRow, '"/>');
    out.push('<sheetViews><sheetView workbookViewId="0"', isFirst ? ' tabSelected="1"' : '', '>');
    if (!sheet.plain) {
      out.push('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>');
    }
    out.push('</sheetView></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="15"/>');
    out.push('<cols>');
    for (var c = 0; c < cols.length; c++) {
      var st = TYPE_STYLE[cols[c].type];
      out.push('<col min="', c + 1, '" max="', c + 1, '" width="', cols[c].width || 14, '"',
        st ? ' style="' + st + '"' : '', ' customWidth="1"/>');
    }
    out.push('</cols>');
    out.push('<sheetData>');
    if (sheet.plain) {
      for (var p = 0; p < rows.length; p++) {
        var line = rows[p];
        out.push('<row r="', p + 1, '">');
        if (line !== '') {
          var style = p === 0 ? ST.title : ST.wrap;
          out.push('<c r="A', p + 1, '" s="', style, '" t="s"><v>', sst.idx(String(line)), '</v></c>');
        }
        out.push('</row>');
      }
    } else {
      out.push('<row r="1" ht="30" customHeight="1">');
      for (var hc = 0; hc < cols.length; hc++) {
        out.push('<c r="', colName(hc), '1" s="', ST.header, '" t="s"><v>', sst.idx(cols[hc].header), '</v></c>');
      }
      out.push('</row>');
      for (var r = 0; r < rows.length; r++) {
        var rowNum = r + 2, cells = [];
        for (var cc = 0; cc < cols.length; cc++) {
          cells.push(cellXml(colName(cc) + rowNum, rows[r][cols[cc].key], cols[cc].type, sst));
        }
        out.push('<row r="', rowNum, '">', cells.join(''), '</row>');
      }
    }
    out.push('</sheetData>');
    if (!sheet.plain && sheet.filter !== false) out.push('<autoFilter ref="A1:', lastCol, lastRow, '"/>');
    var vals = sheet.validations || [];
    if (vals.length) {
      var endRow = Math.max(1000, lastRow + 500);
      out.push('<dataValidations count="', vals.length, '">');
      for (var v = 0; v < vals.length; v++) {
        var ci = -1;
        for (var k = 0; k < cols.length; k++) if (cols[k].key === vals[v].key) ci = k;
        if (ci < 0) continue;
        var ref = colName(ci) + '2:' + colName(ci) + endRow;
        out.push('<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" ',
          'errorTitle="Choose from the list" error="Please pick one of: ', esc(vals[v].list.join(', ')), '" sqref="', ref, '">',
          '<formula1>"', esc(vals[v].list.join(',')), '"</formula1></dataValidation>');
      }
      out.push('</dataValidations>');
    }
    out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
    out.push('</worksheet>');
    return out.join('');
  }

  /** Build the .xlsx. Returns Promise<Uint8Array>. */
  function write(sheets, meta) {
    var zip = new window.JSZip();
    var sst = new SharedStrings();
    var n = sheets.length, i;
    var nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    var sheetEntries = [], relEntries = [], ctOverrides = [], defNames = [];
    for (i = 0; i < n; i++) {
      var s = sheets[i];
      zip.file('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s, sst, i === 0));
      sheetEntries.push('<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>');
      relEntries.push('<Relationship Id="rId' + (i + 1) + '" Type="' + NS_REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>');
      ctOverrides.push('<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
      if (!s.plain && s.filter !== false) {
        var lc = colName(Math.max(s.columns.length, 1) - 1), lr = (s.rows || []).length + 1;
        defNames.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' +
          esc(s.name) + '\'!$A$1:$' + lc + '$' + lr + '</definedName>');
      }
    }

    zip.file('[Content_Types].xml', XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      ctOverrides.join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>');

    zip.file('_rels/.rels', XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + NS_REL + '/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="' + NS_REL + '/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>');

    zip.file('docProps/core.xml', XML_HEAD +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc((meta && meta.title) || 'Deposit Manager') + '</dc:title>' +
      '<dc:creator>Deposit Manager</dc:creator><cp:lastModifiedBy>Deposit Manager</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:modified>' +
      '</cp:coreProperties>');

    zip.file('docProps/app.xml', XML_HEAD +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>Deposit Manager</Application></Properties>');

    zip.file('xl/workbook.xml', XML_HEAD +
      '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
      '<workbookPr/>' +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="10000" activeTab="0"/></bookViews>' +
      '<sheets>' + sheetEntries.join('') + '</sheets>' +
      (defNames.length ? '<definedNames>' + defNames.join('') + '</definedNames>' : '') +
      '<calcPr calcId="191029"/>' +
      '</workbook>');

    zip.file('xl/_rels/workbook.xml.rels', XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      relEntries.join('') +
      '<Relationship Id="rId' + (n + 1) + '" Type="' + NS_REL + '/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId' + (n + 2) + '" Type="' + NS_REL + '/sharedStrings" Target="sharedStrings.xml"/>' +
      '</Relationships>');

    zip.file('xl/styles.xml', STYLES_XML);
    zip.file('xl/sharedStrings.xml', sst.xml()); // after all sheets, so every string is registered

    return zip.generateAsync({
      type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 },
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  /* ------------------------------------------------------------- reader */

  function parseXml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    var err = doc.getElementsByTagName('parsererror');
    if (err.length) throw new Error('The Excel file contains damaged XML.');
    return doc;
  }

  function byLocal(node, name) {
    return node.getElementsByTagNameNS('*', name);
  }

  function childrenByLocal(node, name) {
    var out = [];
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && (c.localName === name)) out.push(c);
    }
    return out;
  }

  function attrLocal(el, name) {
    if (el.hasAttribute(name)) return el.getAttribute(name);
    for (var i = 0; i < el.attributes.length; i++) {
      if (el.attributes[i].localName === name) return el.attributes[i].value;
    }
    return null;
  }

  function findFile(zip, path) {
    path = path.replace(/^\//, '');
    if (zip.files[path]) return zip.files[path];
    var lower = path.toLowerCase();
    for (var k in zip.files) if (k.toLowerCase() === lower) return zip.files[k];
    return null;
  }

  function resolveTarget(base, target) {
    if (target.charAt(0) === '/') return target.slice(1);
    var parts = base.split('/');
    parts.pop();
    var t = target.split('/');
    for (var i = 0; i < t.length; i++) {
      if (t[i] === '..') parts.pop();
      else if (t[i] !== '.') parts.push(t[i]);
    }
    return parts.join('/');
  }

  /** Concatenate all <t> text in a string item, skipping phonetic runs. */
  function stringItemText(si) {
    var out = '';
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (c.localName === 'rPh' || c.localName === 'phoneticPr') continue;
        if (c.localName === 't') out += c.textContent;
        else walk(c);
      }
    })(si);
    return out;
  }

  var BUILTIN_DATE_IDS = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 27: 1, 28: 1, 29: 1, 30: 1,
    31: 1, 32: 1, 33: 1, 34: 1, 35: 1, 36: 1, 45: 1, 46: 1, 47: 1, 50: 1, 51: 1, 52: 1, 53: 1, 54: 1, 55: 1, 56: 1, 57: 1, 58: 1 };

  function isDateFormat(id, code) {
    if (BUILTIN_DATE_IDS[id]) return true;
    if (!code) return false;
    var c = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').replace(/_.|\*./g, '');
    if (/general/i.test(c)) return false;
    return /[dmyhs]/i.test(c) && !/[0#?]/.test(c.replace(/[dmyhs]+/ig, ''));
  }

  function isPercentFormat(id, code) {
    return id === 9 || id === 10 || (!!code && code.replace(/"[^"]*"/g, '').indexOf('%') >= 0);
  }

  /**
   * Read a workbook. Returns Promise<{sheets:[{name, rows:[[cell|null]]}]}> where a cell is
   * {v: string|number|boolean, date: 'YYYY-MM-DD'|null, pct: boolean, text: string}.
   */
  function read(bytes) {
    if (!window.JSZip) return Promise.reject(new Error('Zip library missing'));
    return window.JSZip.loadAsync(bytes).catch(function () {
      throw new Error('This file is not an Excel .xlsx workbook (or it is damaged). If it is an old .xls file, open it in Excel or Google Sheets and save it as .xlsx first.');
    }).then(function (zip) {
      var wbFile = findFile(zip, 'xl/workbook.xml');
      var wbPath = 'xl/workbook.xml';
      var rootRels = findFile(zip, '_rels/.rels');
      var ready = Promise.resolve();
      if (rootRels) {
        ready = rootRels.async('string').then(function (t) {
          var rels = byLocal(parseXml(t), 'Relationship');
          for (var i = 0; i < rels.length; i++) {
            if (/officeDocument$/.test(rels[i].getAttribute('Type'))) {
              wbPath = resolveTarget('', rels[i].getAttribute('Target'));
              wbFile = findFile(zip, wbPath) || wbFile;
            }
          }
        });
      }
      return ready.then(function () {
        if (!wbFile) throw new Error('This file does not look like an Excel workbook.');
        var relsPath = wbPath.replace(/[^/]*$/, '_rels/') + wbPath.split('/').pop() + '.rels';
        var relsFile = findFile(zip, relsPath);
        return Promise.all([
          wbFile.async('string'),
          relsFile ? relsFile.async('string') : Promise.resolve(''),
        ]).then(function (res) {
          var wbDoc = parseXml(res[0]);
          var pr = byLocal(wbDoc, 'workbookPr')[0];
          var date1904 = !!(pr && /^(1|true)$/i.test(pr.getAttribute('date1904') || ''));
          var relMap = {}, sstPath = null, stylesPath = null;
          if (res[1]) {
            var rels = byLocal(parseXml(res[1]), 'Relationship');
            for (var i = 0; i < rels.length; i++) {
              var type = rels[i].getAttribute('Type') || '', target = resolveTarget(wbPath, rels[i].getAttribute('Target'));
              relMap[rels[i].getAttribute('Id')] = target;
              if (/\/sharedStrings$/.test(type)) sstPath = target;
              if (/\/styles$/.test(type)) stylesPath = target;
            }
          }
          var sheetEls = byLocal(wbDoc, 'sheet'), sheetDefs = [];
          for (var s = 0; s < sheetEls.length; s++) {
            var rid = attrLocal(sheetEls[s], 'id');
            sheetDefs.push({ name: sheetEls[s].getAttribute('name'), path: relMap[rid] || ('xl/worksheets/sheet' + (s + 1) + '.xml') });
          }
          var sstFile = findFile(zip, sstPath || 'xl/sharedStrings.xml');
          var stFile = findFile(zip, stylesPath || 'xl/styles.xml');
          return Promise.all([
            sstFile ? sstFile.async('string') : Promise.resolve(''),
            stFile ? stFile.async('string') : Promise.resolve(''),
          ]).then(function (r2) {
            var strings = [];
            if (r2[0]) {
              var sis = byLocal(parseXml(r2[0]), 'si');
              for (var i = 0; i < sis.length; i++) strings.push(stringItemText(sis[i]));
            }
            var xfDate = [], xfPct = [];
            if (r2[1]) {
              var stDoc = parseXml(r2[1]), custom = {};
              var nf = byLocal(stDoc, 'numFmt');
              for (var j = 0; j < nf.length; j++) custom[+nf[j].getAttribute('numFmtId')] = nf[j].getAttribute('formatCode');
              var cellXfs = byLocal(stDoc, 'cellXfs')[0];
              if (cellXfs) {
                var xfs = childrenByLocal(cellXfs, 'xf');
                for (var x = 0; x < xfs.length; x++) {
                  var id = +(xfs[x].getAttribute('numFmtId') || 0);
                  xfDate.push(isDateFormat(id, custom[id]));
                  xfPct.push(isPercentFormat(id, custom[id]));
                }
              }
            }
            return Promise.all(sheetDefs.map(function (def) {
              var f = findFile(zip, def.path);
              if (!f) return { name: def.name, rows: [] };
              return f.async('string').then(function (xml) {
                return { name: def.name, rows: readSheet(xml, strings, xfDate, xfPct, date1904) };
              });
            }));
          }).then(function (sheets) {
            return { sheets: sheets, date1904: date1904 };
          });
        });
      });
    });
  }

  function readSheet(xml, strings, xfDate, xfPct, date1904) {
    var doc = parseXml(xml), rows = [], rowEls = byLocal(doc, 'row'), nextRow = 0;
    for (var r = 0; r < rowEls.length; r++) {
      var rAttr = rowEls[r].getAttribute('r');
      var rowIdx = rAttr ? (+rAttr - 1) : nextRow;
      nextRow = rowIdx + 1;
      if (rowIdx > 100000) break;
      var row = [], cells = childrenByLocal(rowEls[r], 'c'), nextCol = 0;
      for (var c = 0; c < cells.length; c++) {
        var cel = cells[c], ref = cel.getAttribute('r'), ci = nextCol;
        if (ref) {
          var m = /^([A-Z]+)\d*$/i.exec(ref);
          if (m) ci = colIndex(m[1].toUpperCase());
        }
        nextCol = ci + 1;
        var t = cel.getAttribute('t') || 'n', s = +(cel.getAttribute('s') || 0);
        var vEl = childrenByLocal(cel, 'v')[0], raw = vEl ? vEl.textContent : '';
        var cell = null;
        if (t === 's') {
          var sv = strings[+raw];
          if (sv !== undefined && sv !== '') cell = { v: sv, text: sv };
        } else if (t === 'inlineStr') {
          var isEl = childrenByLocal(cel, 'is')[0], txt = isEl ? stringItemText(isEl) : '';
          if (txt !== '') cell = { v: txt, text: txt };
        } else if (t === 'str') {
          if (raw !== '') cell = { v: raw, text: raw };
        } else if (t === 'b') {
          if (raw !== '') cell = { v: raw === '1', text: raw === '1' ? 'TRUE' : 'FALSE' };
        } else if (t === 'e') {
          cell = null; // #N/A, #REF! etc. are treated as empty
        } else if (t === 'd') {
          var dd = U.parseFlexibleDate(raw);
          if (dd) cell = { v: raw, text: raw, date: dd };
        } else if (raw !== '') {
          var num = parseFloat(raw);
          if (isFinite(num)) {
            cell = { v: num, text: raw };
            if (xfDate[s]) cell.date = serialToDate(num, date1904);
            if (xfPct[s]) cell.pct = true;
          }
        }
        if (cell) row[ci] = cell;
      }
      if (row.length) rows[rowIdx] = row;
    }
    for (var i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  DM.xlsx = {
    write: write, read: read, colName: colName,
    dateToSerial: dateToSerial, serialToDate: serialToDate, MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
})(window.DM = window.DM || {});
