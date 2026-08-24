import { strToU8, zipSync } from "fflate";

export interface DocxFixtureOptions {
  documentRelationshipTarget?: string;
  imageRelationshipTarget?: string;
  includeHeader?: boolean;
  includeFooter?: boolean;
}

/** Produces real ZIP/OPC DOCX bytes with body text, a table, and DrawingML media. */
export function createDocxFixture(
  text: string,
  image: Uint8Array = TINY_PNG,
  options: DocxFixtureOptions = {},
): Uint8Array {
  const documentRelationshipTarget = options.documentRelationshipTarget ?? "word/document.xml";
  const imageRelationshipTarget = options.imageRelationshipTarget ?? "media/image1.png";
  const includeHeader = options.includeHeader ?? true;
  const includeFooter = options.includeFooter ?? true;
  const xml = (source: string): Uint8Array => strToU8(source);
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Default Extension="png" ContentType="image/png"/>
        <Override PartName="/${documentRelationshipTarget}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
        ${includeHeader ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}
        ${includeFooter ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ""}
      </Types>`),
    "_rels/.rels": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${documentRelationshipTarget}"/>
      </Relationships>`),
    "word/document.xml": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <w:body>
          <w:p>
            <w:pPr>
              <w:pStyle w:val="Heading1"/>
              <w:jc w:val="center"/>
              <w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr>
            </w:pPr>
            <w:r>
              <w:rPr>
                <w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/>
                <w:b/><w:i/><w:u w:val="single"/><w:strike/>
                <w:color w:val="123ABC"/><w:sz w:val="28"/>
              </w:rPr>
              <w:t xml:space="preserve">${escapeXml(text)} </w:t><w:tab/><w:t>Tabbed</w:t><w:br/><w:t>Line</w:t>
              <w:drawing>
                <wp:inline>
                  <wp:extent cx="914400" cy="457200"/>
                  <wp:docPr id="1" name="Fixture image" descr="fixture alt"/>
                  <a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdImage1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>
                </wp:inline>
              </w:drawing>
            </w:r>
          </w:p>
          <w:tbl>
            <w:tr>
              <w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc>
            </w:tr>
          </w:tbl>
          <w:sectPr>
            ${includeHeader ? '<w:headerReference w:type="default" r:id="rIdHeader1"/>' : ""}
            ${includeFooter ? '<w:footerReference w:type="default" r:id="rIdFooter1"/>' : ""}
          </w:sectPr>
        </w:body>
      </w:document>`),
    "word/_rels/document.xml.rels": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${imageRelationshipTarget}"/>
        <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
        ${includeHeader ? '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : ""}
        ${includeFooter ? '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : ""}
      </Relationships>`),
    "word/styles.xml": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
      </w:styles>`),
    "word/media/image1.png": image,
  };
  if (includeHeader) {
    entries["word/header1.xml"] = xml(`<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Fixture header</w:t></w:r></w:p></w:hdr>`);
  }
  if (includeFooter) {
    entries["word/footer1.xml"] = xml(`<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Fixture footer</w:t></w:r></w:p></w:ftr>`);
  }
  return zipSync(entries);
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export const TINY_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));
