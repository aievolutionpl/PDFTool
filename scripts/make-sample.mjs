// Generates a small multi-page PDF for testing: node scripts/make-sample.mjs <out.pdf>
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "sample.pdf";
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
doc.setTitle("PDF Tool sample");
doc.setAuthor("PDF Tool");

const lorem =
  "PDF files keep their layout on every device. This sample document is used to try out the viewer: " +
  "searching for text, highlighting, drawing, adding notes, rotating and reordering pages, and converting " +
  "the result to Word, plain text or images.";

const colors = [rgb(0.39, 0.4, 0.95), rgb(0.06, 0.65, 0.91), rgb(0.55, 0.36, 0.96), rgb(0.07, 0.63, 0.31), rgb(0.9, 0.28, 0.3)];
for (let i = 1; i <= 5; i++) {
  const landscape = i === 4;
  const page = doc.addPage(landscape ? [842, 595] : [595, 842]);
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: colors[i - 1] });
  page.drawText(`Chapter ${i}`, { x: 50, y: height - 75, size: 34, font: bold, color: rgb(1, 1, 1) });
  page.drawText(i === 4 ? "A landscape page" : "Sample heading for this page", { x: 50, y: height - 170, size: 20, font: bold });
  let y = height - 210;
  for (let p = 0; p < 4; p++) {
    const words = lorem.split(" ");
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, 12) > width - 100) {
        page.drawText(line, { x: 50, y, size: 12, font });
        y -= 18;
        line = word;
      } else line = test;
    }
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 34;
  }
  page.drawText(`Page ${i} of 5`, { x: width / 2 - 30, y: 30, size: 10, font, color: rgb(0.4, 0.4, 0.45) });
}
writeFileSync(out, await doc.save());
console.log(`Wrote ${out}`);
