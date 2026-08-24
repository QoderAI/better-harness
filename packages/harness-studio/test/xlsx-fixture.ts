import { strToU8, zipSync } from "fflate";

export interface XlsxFixtureOptions {
  emptySharedStrings?: boolean;
  workbookRelationshipTarget?: string;
  formulaResult?: number;
  farRow?: number;
  farColumn?: number;
}

/** Produces real ZIP/OPC XLSX bytes with two sheets, formulas, merges, and styles. */
export function createXlsxFixture(options: XlsxFixtureOptions = {}): Uint8Array {
  const workbookRelationshipTarget = options.workbookRelationshipTarget ?? "xl/workbook.xml";
  const formulaResult = options.formulaResult ?? 30;
  const xml = (source: string): Uint8Array => strToU8(source);
  return zipSync({
    "[Content_Types].xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
        <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
      </Types>`),
    "_rels/.rels": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${workbookRelationshipTarget}"/>
      </Relationships>`),
    "xl/workbook.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <x:workbookPr date1904="0"/>
        <x:bookViews><x:workbookView activeTab="1"/></x:bookViews>
        <x:sheets>
          <x:sheet name="Summary" sheetId="1" r:id="rIdSheet1"/>
          <x:sheet name="Data" sheetId="2" r:id="rIdSheet2"/>
        </x:sheets>
        <x:definedNames><x:definedName name="PlannedTotal">Summary!$B$3</x:definedName></x:definedNames>
      </x:workbook>`),
    "xl/_rels/workbook.xml.rels": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdSheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rIdSheet2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
        <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
        <Relationship Id="rIdStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
      </Relationships>`),
    "xl/sharedStrings.xml": xml(options.emptySharedStrings === true
      ? `<?xml version="1.0" encoding="UTF-8"?><x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`
      : `<?xml version="1.0" encoding="UTF-8"?>
      <x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1">
        <x:si><x:r><x:rPr><x:b/><x:color rgb="FF17324D"/></x:rPr><x:t>Canvas </x:t></x:r><x:r><x:t>TSX</x:t></x:r></x:si>
      </x:sst>`),
    "xl/styles.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <x:styleSheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <x:numFmts count="3">
          <x:numFmt numFmtId="164" formatCode="0.0%"/>
          <x:numFmt numFmtId="165" formatCode="yyyy-mm-dd"/>
          <x:numFmt numFmtId="166" formatCode="#,##0;[Red]-#,##0"/>
        </x:numFmts>
        <x:fonts count="2">
          <x:font><x:sz val="11"/><x:name val="Aptos"/></x:font>
          <x:font><x:b/><x:sz val="16"/><x:color rgb="FFFFFFFF"/><x:name val="Aptos Display"/></x:font>
        </x:fonts>
        <x:fills count="3">
          <x:fill><x:patternFill patternType="none"/></x:fill>
          <x:fill><x:patternFill patternType="gray125"/></x:fill>
          <x:fill><x:patternFill patternType="solid"><x:fgColor rgb="FF17324D"/></x:patternFill></x:fill>
        </x:fills>
        <x:borders count="1"><x:border/></x:borders>
        <x:cellStyleXfs count="1"><x:xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></x:cellStyleXfs>
        <x:cellXfs count="5">
          <x:xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
          <x:xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><x:alignment vertical="center"/></x:xf>
          <x:xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0"/>
          <x:xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0"/>
          <x:xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0"/>
        </x:cellXfs>
      </x:styleSheet>`),
    "xl/worksheets/sheet1.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <x:cols><x:col min="1" max="1" width="24" customWidth="1"/><x:col min="2" max="2" width="16" customWidth="1"/></x:cols>
        <x:sheetData>
          <x:row r="1" ht="30" customHeight="1"><x:c r="A1" s="1" t="str"><x:v>Studio XLSX Fixture</x:v></x:c><x:c r="B1" s="1"/></x:row>
          <x:row r="3"><x:c r="A3" t="str"><x:v>Planned</x:v></x:c><x:c r="B3" s="4" t="n"><x:f>SUM('Data'!B2:B3)</x:f><x:v>${formulaResult}</x:v></x:c></x:row>
          <x:row r="4"><x:c r="A4" t="str"><x:v>Completion</x:v></x:c><x:c r="B4" s="2" t="n"><x:v>0.75</x:v></x:c>${options.farColumn === undefined ? "" : `<x:c r="${xlsxColumnLabel(options.farColumn)}4" t="str"><x:v>Virtualized column</x:v></x:c>`}</x:row>
          ${options.farRow === undefined ? "" : `<x:row r="${options.farRow}"><x:c r="A${options.farRow}" t="str"><x:v>Virtualized row</x:v></x:c><x:c r="B${options.farRow}" t="n"><x:v>${options.farRow}</x:v></x:c></x:row>`}
        </x:sheetData>
        <x:mergeCells count="1"><x:mergeCell ref="A1:B1"/></x:mergeCells>
      </x:worksheet>`),
    "xl/worksheets/sheet2.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
      <x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <x:sheetData>
          <x:row r="1"><x:c r="A1" t="str"><x:v>Date</x:v></x:c><x:c r="B1" t="str"><x:v>Actual</x:v></x:c><x:c r="C1" t="str"><x:v>Label</x:v></x:c></x:row>
          <x:row r="2"><x:c r="A2" s="3" t="n"><x:v>46257</x:v></x:c><x:c r="B2" t="n"><x:v>10</x:v></x:c>${options.emptySharedStrings === true ? '<x:c r="C2" t="str"><x:v>Canvas TSX</x:v></x:c>' : '<x:c r="C2" t="s"><x:v>0</x:v></x:c>'}</x:row>
          <x:row r="3"><x:c r="A3" s="3" t="n"><x:v>46258</x:v></x:c><x:c r="B3" t="n"><x:v>20</x:v></x:c></x:row>
        </x:sheetData>
      </x:worksheet>`),
  });
}

function xlsxColumnLabel(column: number): string {
  let value = column;
  let label = "";
  while (value > 0) {
    label = String.fromCharCode(65 + (value - 1) % 26) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}
