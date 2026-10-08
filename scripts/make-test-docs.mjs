// Generates a conversion test PDF (invoice table, colours, rotated stamp, prose):
//   node scripts/make-test-docs.mjs <out.pdf>
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "conversion-test.pdf";
const doc = await PDFDocument.create();
const helv = await doc.embedFont(StandardFonts.Helvetica);
const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
const times = await doc.embedFont(StandardFonts.TimesRoman);
const timesItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);
const timesBold = await doc.embedFont(StandardFonts.TimesRomanBold);
const ink = rgb(0.11, 0.11, 0.1);
const accent = rgb(0.78, 0.25, 0.09);
const navy = rgb(0.1, 0.2, 0.45);

// ---- Page 1: invoice
{
  const page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 0, y: 772, width: 595, height: 70, color: navy });
  page.drawText("INVOICE", { x: 50, y: 795, size: 28, font: helvBold, color: rgb(1, 1, 1) });
  page.drawText("No. 2026/10/0142", { x: 400, y: 800, size: 12, font: helv, color: rgb(1, 1, 1) });

  page.drawText("Northwind Supplies Sp. z o.o.", { x: 50, y: 735, size: 12, font: helvBold, color: ink });
  page.drawText("ul. Dluga 12, 00-238 Warszawa", { x: 50, y: 719, size: 10, font: helv, color: ink });
  page.drawText("Issued: 08.10.2026   Due: 22.10.2026", { x: 50, y: 703, size: 10, font: helv, color: rgb(0.4, 0.4, 0.4) });

  const cols = [50, 300, 370, 460];
  const headers = ["Description", "Qty", "Unit price", "Amount"];
  const rows = [
    ["Office chairs (ergonomic)", "4", "1 249,00", "4 996,00"],
    ["Standing desk 160 cm", "2", "2 890,50", "5 781,00"],
    ["Monitor arm, dual", "4", "389,99", "1 559,96"],
    ["Delivery & assembly", "1", "450,00", "450,00"],
    ["Discount", "", "-5%", "(639,35)"],
  ];
  let y = 650;
  page.drawRectangle({ x: 45, y: y - 6, width: 505, height: 22, color: rgb(0.93, 0.92, 0.9) });
  headers.forEach((h, i) => page.drawText(h, { x: cols[i], y, size: 11, font: helvBold, color: ink }));
  y -= 26;
  for (const row of rows) {
    row.forEach((cell, i) => {
      const font = helv;
      const size = 10.5;
      const x = i === 0 ? cols[i] : cols[i] + 70 - font.widthOfTextAtSize(cell, size);
      page.drawText(cell, { x: i === 0 ? cols[0] : x, y, size, font, color: cell.startsWith("(") ? accent : ink });
    });
    page.drawLine({ start: { x: 45, y: y - 8 }, end: { x: 550, y: y - 8 }, thickness: 0.6, color: rgb(0.8, 0.78, 0.75) });
    y -= 24;
  }
  page.drawText("Total due", { x: 370, y: y - 10, size: 12, font: helvBold, color: ink });
  page.drawText("12 147,61 PLN", { x: 452, y: y - 10, size: 12, font: helvBold, color: accent });

  // Rotated stamp (should stay as part of the background picture).
  page.drawText("PAID", { x: 380, y: 230, size: 64, font: helvBold, color: rgb(0.2, 0.55, 0.3), rotate: degrees(25), opacity: 0.5 });

  page.drawText("Thank you for your business. Payment by bank transfer to PL61 1090 1014 0000 0712 1981 2874.", {
    x: 50,
    y: 120,
    size: 9,
    font: helv,
    color: rgb(0.4, 0.4, 0.4),
  });
}

// ---- Page 2: prose with heading, italics and a list
{
  const page = doc.addPage([595, 842]);
  page.drawText("Project summary", { x: 72, y: 760, size: 22, font: timesBold, color: navy });
  const para =
    "The new office layout was completed ahead of schedule. Staff feedback has been positive, and the open plan " +
    "has improved collaboration between the design and engineering teams. Remaining work is listed below.";
  let y = 720;
  const words = para.split(" ");
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (times.widthOfTextAtSize(test, 12) > 451) {
      page.drawText(line, { x: 72, y, size: 12, font: times, color: ink });
      y -= 16;
      line = w;
    } else line = test;
  }
  page.drawText(line, { x: 72, y, size: 12, font: times, color: ink });
  y -= 30;
  page.drawText("Open items", { x: 72, y, size: 15, font: timesBold, color: ink });
  y -= 22;
  for (const item of ["Install acoustic panels in meeting room B", "Replace two broken desk lamps", "Order spare keyboard and mouse sets"]) {
    page.drawText("•", { x: 80, y, size: 12, font: times, color: ink });
    page.drawText(item, { x: 94, y, size: 12, font: times, color: ink });
    y -= 18;
  }
  y -= 14;
  page.drawText("Prepared by the facilities team.", { x: 72, y, size: 11, font: timesItalic, color: rgb(0.35, 0.35, 0.35) });
}

writeFileSync(out, await doc.save());
console.log(`Wrote ${out}`);
