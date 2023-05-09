import { writeFile, readFile } from "node:fs/promises";
import pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import {
  DocumentInitParameters,
  PDFDocumentProxy,
  TextContent,
  TextItem,
} from "pdfjs-dist/types/src/display/api.js";

const CMAP_PATH = "node_modules/pdfjs-dist/cmaps/";

async function getPDFDoc(pdfPath: string) {
  const data = await readFile(pdfPath);
  const pdfData = new Uint8Array(data);

  const config: DocumentInitParameters = {
    cMapUrl: CMAP_PATH,
    cMapPacked: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    data: pdfData,
  };
  return pdfjs.getDocument(config).promise;
}

async function extractTextContents(doc: PDFDocumentProxy) {
  const contents: TextContent[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    contents.push(textContent);
  }
  return contents;
}

type StringBox = {
  str: string;
  bbox: { startx: number; starty: number; endx: number; endy: number };
  page: number;
  fonts: { name: string; pt: number }[];
};

function samebox(lastbox: StringBox, item: TextItem): boolean {
  if (lastbox === undefined) {
    return false;
  }

  const { fontName, transform } = item;
  const [xr, _x0, _y0, yr, x, y] = transform;
  const prevFont = lastbox.fonts.at(-1);
  if (prevFont.name === fontName) {
    if (prevFont.pt === yr) {
      const xdiff = Math.abs(lastbox.bbox.startx - x);
      if (xdiff < yr * 5) {
        return true;
      }
    }
  }
  //  同一行を連結したいが．．．
  if (lastbox.bbox.starty === y) {
    const endx = lastbox.bbox.endx;
    if (endx === x || endx >= x - xr) {
      return true;
    }
  }

  return false;
}

async function convertContents(pages: TextContent[]) {
  let pageNo = 0;
  const contentsArray: StringBox[][] = [];
  for (const page of pages) {
    pageNo += 1; // 1 origin
    let contents: StringBox[] = [];
    // x の昇順，y の降順（x は小さい方が左，y は大きい方が上なので左上からの順に並べると表形式の連結がおかしくなるので微妙
    // .sort(
    //   (a, b) =>
    //     b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]
    // );
    const items: TextItem[] = page.items.map((i) => i as TextItem);
    for (const item of items) {
      const { str, width, height, fontName, transform } = item;
      const [_xr, _x0, _y0, yr, x, y] = transform;
      //      console.log({ str, transform, width, height });
      const lastIndex = contents.length - 1;
      if (samebox(contents[lastIndex], item)) {
        contents[lastIndex].str += str;
        contents[lastIndex].bbox.endx = x + width;
        contents[lastIndex].bbox.endy = y + yr;
        const lastFont = contents[lastIndex].fonts.at(-1);
        if (lastFont.name !== fontName || lastFont.pt !== yr) {
          contents[lastIndex].fonts.push({ name: fontName, pt: yr });
        }
      } else {
        const bbox = { startx: x, starty: y, endx: x + width, endy: y + yr };
        const box: StringBox = {
          page: pageNo,
          str: str,
          bbox: bbox,
          fonts: [{ name: fontName, pt: yr }],
        };
        contents.push(box);
      }
    }
    contentsArray.push(contents);
  }
  return contentsArray.flat();
}

async function writeContents(basePdfPath: string, contents: StringBox[]) {
  const writePath = `${basePdfPath}.json`;
  await writeFile(writePath, JSON.stringify(contents));
}

async function main(args: string[]) {
  const pdfPath = args[0];
  console.log({ pdfPath });
  const doc = await getPDFDoc(pdfPath);
  const texts = await extractTextContents(doc);
  const contents = await convertContents(texts);
  await writeContents(pdfPath, contents);
}

(async () => {
  const [_node, _script, ...args] = process.argv;
  await main(args);
})();
