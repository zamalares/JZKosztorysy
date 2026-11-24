import { formatPLN, parseDiscount } from './estimate-editor.js';

const PDFMAKE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js';
const VFS_FONTS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.min.js';

let pdfMakeLoaderPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      if (existing.dataset.error === 'true') {
        reject(new Error(`Nie udało się wczytać skryptu: ${src}`));
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Nie udało się załadować: ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => {
      script.dataset.error = 'true';
      reject(new Error(`Nie udało się załadować: ${src}`));
    };
    document.head.appendChild(script);
  });
}

async function ensurePdfMake() {
  if (window.pdfMake && typeof window.pdfMake.createPdf === 'function') {
    return window.pdfMake;
  }
  if (!pdfMakeLoaderPromise) {
    pdfMakeLoaderPromise = (async () => {
      await loadScript(PDFMAKE_CDN);
      await loadScript(VFS_FONTS_CDN);
      if (!window.pdfMake || typeof window.pdfMake.createPdf !== 'function') {
        throw new Error('Biblioteka pdfMake nie została poprawnie zainicjalizowana.');
      }
      return window.pdfMake;
    })().catch((err) => {
      pdfMakeLoaderPromise = null;
      throw err;
    });
  }
  return pdfMakeLoaderPromise;
}

function formatDatePL(isoStr) {
  if (!isoStr) return '—';
  const parts = String(isoStr).split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoStr;
}

function sanitizeFileName(name) {
  return String(name || 'Kosztorys')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

function buildDocDefinition(estimate) {
  const items = Array.isArray(estimate.items) ? estimate.items : [];

  const tableBody = [
    [
      { text: 'Lp.', style: 'th', alignment: 'center' },
      { text: 'Usługa', style: 'th' },
      { text: 'Jedn.', style: 'th', alignment: 'center' },
      { text: 'Ilość', style: 'th', alignment: 'right' },
      { text: 'Cena', style: 'th', alignment: 'right' },
      { text: 'Rabat', style: 'th', alignment: 'right' },
      { text: 'Łączna cena', style: 'th', alignment: 'right' }
    ]
  ];

  let lp = 0;
  let grossBeforeGlobal = 0;
  let runningSubtotal = 0;

  items.forEach((item) => {
    if (item.type === 'separator') {
      runningSubtotal = 0;
      tableBody.push([
        {
          colSpan: 7,
          text: item.label ? `— ${item.label} —` : '—',
          alignment: 'center',
          fontSize: 7.5,
          bold: true,
          color: '#374151',
          fillColor: '#f3f4f6',
          margin: [0, 1.5, 0, 1.5]
        },
        {}, {}, {}, {}, {}, {}
      ]);
      return;
    }

    if (item.type === 'subtotal') {
      const subLabel = item.label || 'Suma częściowa';
      const subValue = runningSubtotal;
      runningSubtotal = 0;

      // ~20% szarego tła (#cccccc) z czarnym tekstem
      tableBody.push([
        {
          colSpan: 6,
          text: subLabel,
          bold: true,
          fontSize: 8,
          color: '#000000',
          fillColor: '#cccccc',
          alignment: 'right',
          margin: [0, 1.5, 4, 1.5]
        },
        {}, {}, {}, {}, {},
        {
          text: formatPLN(subValue),
          bold: true,
          fontSize: 8,
          color: '#000000',
          fillColor: '#cccccc',
          alignment: 'right',
          margin: [0, 1.5, 0, 1.5]
        }
      ]);
      return;
    }

    lp += 1;
    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
    const unitPrice = Number(item.price) || 0;
    const lineGross = qty * unitPrice;
    const { discountAmount, label: discountLabel } = parseDiscount(item.discount, lineGross);
    const lineNet = Math.max(0, lineGross - discountAmount);

    grossBeforeGlobal += lineNet;
    runningSubtotal += lineNet;

    const hasNote = Boolean(item.note && item.note.trim());

    tableBody.push([
      {
        text: `${lp}.`,
        alignment: 'center',
        fontSize: 8,
        margin: [0, 1.5, 0, 1.5]
      },
      {
        text: item.name || 'Pozycja bez nazwy',
        bold: true,
        fontSize: 8,
        margin: [0, 1.5, 0, 1.5]
      },
      {
        text: item.unit || 'usł.',
        alignment: 'center',
        fontSize: 8,
        margin: [0, 1.5, 0, 1.5]
      },
      {
        text: String(qty),
        alignment: 'right',
        fontSize: 8,
        margin: [0, 1.5, 0, 1.5]
      },
      {
        text: formatPLN(unitPrice),
        alignment: 'right',
        fontSize: 8,
        margin: [0, 1.5, 0, 1.5]
      },
      {
        text: discountLabel || '—',
        alignment: 'right',
        fontSize: 8,
        margin: [0, 1.5, 0, 1.5]
      },
      {
        text: formatPLN(lineNet),
        bold: true,
        alignment: 'right',
        fontSize: 8,
        margin: [0, 1.5, 0, 1.5]
      }
    ]);

    // Pełne obramowanie + delikatne tło pod notatką, bez rozrywania siatki tabeli
    if (hasNote) {
      tableBody.push([
        {
          text: '',
          fillColor: '#f8fafc',
          margin: [0, 1, 0, 1]
        },
        {
          colSpan: 6,
          text: `↳ ${item.note.trim()}`,
          fontSize: 7.5,
          italics: true,
          color: '#374151',
          fillColor: '#f8fafc',
          margin: [8, 1, 2, 1]
        },
        {}, {}, {}, {}, {}
      ]);
    }
  });

  const { discountAmount: globalDiscountAmt, label: globalDiscountLabel } = parseDiscount(
    estimate.globalDiscount,
    grossBeforeGlobal
  );
  const finalTotal = Math.max(0, grossBeforeGlobal - globalDiscountAmt);

  const offerTitle = estimate.title ? `OFERTA: ${estimate.title}` : 'OFERTA / KOSZTORYS';

  return {
    pageSize: 'A4',
    pageMargins: [24, 24, 24, 24],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 8.5,
      color: '#111827',
      lineHeight: 1.18
    },
    content: [
      // NAGŁÓWEK DOKUMENTU
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Jacek Zamecki', fontSize: 16, bold: true, margin: [0, 0, 0, 1] },
              {
                text: 'Kompozycja, Aranżacja, Produkcja muzyczna, Edukacja muzyczna',
                fontSize: 8.5,
                color: '#374151',
                margin: [0, 0, 0, 10]
              },
              {
                text: offerTitle,
                fontSize: 11.5,
                bold: true,
                margin: [0, 2, 0, 0]
              }
            ]
          },
          {
            width: 210,
            stack: [
              {
                text: 'JZ PRODUCTION',
                fontSize: 13,
                bold: true,
                alignment: 'right',
                margin: [0, 0, 0, 6]
              },
              {
                table: {
                  widths: [64, '*'],
                  body: [
                    [
                      { text: 'Dla:', bold: true, fontSize: 8, fillColor: '#f3f4f6' },
                      { text: estimate.client || '—', bold: true, fontSize: 8 }
                    ],
                    [
                      { text: 'Ważna od:', bold: true, fontSize: 8, fillColor: '#f3f4f6' },
                      { text: formatDatePL(estimate.validFrom), fontSize: 8 }
                    ],
                    [
                      { text: 'Ważna do:', bold: true, fontSize: 8, fillColor: '#f3f4f6' },
                      { text: formatDatePL(estimate.validTo), fontSize: 8 }
                    ]
                  ]
                },
                layout: {
                  hLineWidth: () => 0.5,
                  vLineWidth: () => 0.5,
                  hLineColor: () => '#9ca3af',
                  vLineColor: () => '#9ca3af',
                  paddingLeft: () => 5,
                  paddingRight: () => 5,
                  paddingTop: () => 2,
                  paddingBottom: () => 2
                }
              }
            ]
          }
        ],
        columnGap: 14,
        margin: [0, 0, 0, 10]
      },

      // GŁÓWNA TABELA POZYCJI (kompaktowa, więcej miejsca na "Usługa")
      {
        table: {
          headerRows: 1,
          dontBreakRows: true,
          widths: [20, '*', 34, 28, 58, 48, 66],
          body: tableBody
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#9ca3af',
          vLineColor: () => '#9ca3af',
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 2,
          paddingBottom: () => 2
        },
        margin: [0, 0, 0, 10]
      },

      // DOLNY BLOK: TERMIN + PODSUMOWANIE 2x2 + KLAUZULE + DANE FIRMY + PODPIS
      {
        unbreakable: true,
        stack: [
          {
            columns: [
              {
                width: '*',
                stack: [
                  { text: 'Przewidywany termin realizacji:', bold: true, fontSize: 8.5 },
                  { text: '(wypełnia zleceniodawca)', fontSize: 7.5, color: '#4b5563', margin: [0, 1, 0, 8] },
                  { text: '....................................................................', fontSize: 8, color: '#6b7280' }
                ]
              },
              {
                width: 225,
                table: {
                  widths: ['*', 98],
                  body: [
                    [
                      { text: 'SUMA BRUTTO', bold: true, fontSize: 8, fillColor: '#f3f4f6' },
                      { text: formatPLN(grossBeforeGlobal), bold: true, fontSize: 8, alignment: 'right' }
                    ],
                    [
                      {
                        text: globalDiscountLabel ? `RABAT (${globalDiscountLabel})` : 'RABAT',
                        bold: true,
                        fontSize: 8,
                        fillColor: '#f3f4f6'
                      },
                      {
                        text: globalDiscountAmt > 0 ? `-${formatPLN(globalDiscountAmt)}` : '—',
                        fontSize: 8,
                        alignment: 'right'
                      }
                    ],
                    [
                      { text: 'SUMA KOŃCOWA', bold: true, fontSize: 9.5, fillColor: '#e5e7eb' },
                      { text: formatPLN(finalTotal), bold: true, fontSize: 10.5, alignment: 'right', fillColor: '#e5e7eb' }
                    ]
                  ]
                },
                layout: {
                  hLineWidth: () => 0.6,
                  vLineWidth: () => 0.6,
                  hLineColor: () => '#6b7280',
                  vLineColor: () => '#6b7280',
                  paddingLeft: () => 6,
                  paddingRight: () => 6,
                  paddingTop: () => 2.5,
                  paddingBottom: () => 2.5
                }
              }
            ],
            columnGap: 14,
            margin: [0, 0, 0, 10]
          },
          {
            text: 'Powyższa wycena nie jest ofertą handlową. Koszt projektu może się różnić w zależności od zmiany parametrów projektu.',
            fontSize: 8,
            italics: true,
            color: '#374151',
            margin: [0, 0, 0, 9]
          },
          {
            columns: [
              {
                width: 185,
                stack: [
                  { text: 'Jacek Zamecki JZ Production', bold: true, fontSize: 8.5 },
                  { text: 'ul. Katowicka 48/1 52-022 Wrocław', fontSize: 8 },
                  { text: 'NIP: 8971667886', fontSize: 8 },
                  { text: 'REGON: 388058361', fontSize: 8 }
                ]
              },
              {
                width: '*',
                stack: [
                  {
                    text: 'Oświadczam, że zaznajomiłem/łam się z cennikiem oraz warunkami współpracy zamieszczonymi na stronie internetowej: www.jzproduction.pl. Przyjmuję warunki powyższej oferty oraz zlecam wykonanie prac.',
                    fontSize: 8,
                    color: '#1f2937',
                    margin: [0, 0, 0, 18]
                  },
                  {
                    text: '................................................................',
                    fontSize: 8,
                    alignment: 'right',
                    color: '#6b7280'
                  },
                  {
                    text: 'podpis',
                    alignment: 'right',
                    fontSize: 7.5,
                    color: '#4b5563',
                    margin: [0, 2, 42, 0]
                  }
                ]
              }
            ],
            columnGap: 16
          }
        ]
      }
    ],
    styles: {
      th: {
        bold: true,
        fontSize: 8,
        fillColor: '#e5e7eb',
        color: '#111827'
      }
    }
  };
}

export async function generateEstimatePdf(estimate) {
  const pdfMake = await ensurePdfMake();

  const titlePart = sanitizeFileName(estimate.title || 'Kosztorys');
  const clientPart = sanitizeFileName(estimate.client || '');
  const fileName = clientPart ? `Kosztorys_${titlePart}_${clientPart}.pdf` : `Kosztorys_${titlePart}.pdf`;

  const def = buildDocDefinition(estimate);
  const doc = pdfMake.createPdf(def);

  await new Promise((resolve, reject) => {
    try {
      doc.download(fileName, () => resolve());
      setTimeout(resolve, 600);
    } catch (err) {
      reject(err);
    }
  });
}
