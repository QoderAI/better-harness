import { strToU8, zipSync } from "fflate";

export function createPptxFixture(text: string, image: Uint8Array = TINY_PNG): Uint8Array {
  const xml = (source: string): Uint8Array => strToU8(source);
  return zipSync({
    "ppt/presentation.xml": xml(`<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`),
    "ppt/_rels/presentation.xml.rels": xml(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="slides/slide1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/></Relationships>`),
    "ppt/slides/slide1.xml": xml(`<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="685800"/><a:ext cx="5486400" cy="1143000"/></a:xfrm><a:solidFill><a:srgbClr val="F5F7FA"/></a:solidFill></p:spPr><p:txBody><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="3200" b="1"><a:solidFill><a:srgbClr val="172033"/></a:solidFill></a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:nvPicPr><p:cNvPr id="3" name="Screenshot" descr="fixture image"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="7315200" y="685800"/><a:ext cx="3657600" cy="2743200"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`),
    "ppt/slides/_rels/slide1.xml.rels": xml(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Target="../media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/><Relationship Id="rId3" Target="../notesSlides/notesSlide1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"/></Relationships>`),
    "ppt/notesSlides/notesSlide1.xml": xml(`<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Source /Users/alice/project/secret.md</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`),
    "ppt/media/image1.png": image,
  });
}

export const TINY_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
